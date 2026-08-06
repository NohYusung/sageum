import type { RetryDocumentUploadResponse } from '@/lib/documents/contracts';
import {
  DOCUMENT_BUCKET,
  DocumentValidationError,
  validateDocumentMetadata,
} from '@/lib/documents/validation';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type RetryUploadBody = {
  name?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
};

async function markRetryFailed(
  context: NonNullable<Awaited<ReturnType<typeof getAuthenticatedRequestContext>>>,
  jobId: string,
  versionId: string,
  message: string,
) {
  const failedAt = new Date().toISOString();
  const [versionResult, jobResult] = await Promise.all([
    context.supabase
      .from('document_versions')
      .update({ status: 'failed', error_message: message })
      .eq('id', versionId)
      .eq('owner_id', context.ownerId),
    context.supabase
      .from('document_ingestion_jobs')
      .update({
        status: 'failed',
        stage: 'uploading',
        original_available: false,
        last_error: message,
        completed_at: failedAt,
        updated_at: failedAt,
      })
      .eq('id', jobId)
      .eq('owner_id', context.ownerId),
  ]);
  if (versionResult.error) console.error('Failed to close retry document version', versionResult.error);
  if (jobResult.error) console.error('Failed to close retry ingestion job', jobResult.error);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { jobId } = await params;
  if (!UUID_PATTERN.test(jobId)) {
    return Response.json({ error: '올바른 처리 작업 식별자가 필요합니다.' }, { status: 400 });
  }

  let body: RetryUploadBody;
  try {
    body = await request.json() as RetryUploadBody;
  } catch {
    return Response.json({ error: '올바른 JSON 요청이 필요합니다.' }, { status: 400 });
  }

  let metadata;
  try {
    metadata = validateDocumentMetadata({
      name: typeof body.name === 'string' ? body.name : '',
      mimeType: typeof body.mimeType === 'string' ? body.mimeType : '',
      sizeBytes: typeof body.sizeBytes === 'number' ? body.sizeBytes : Number.NaN,
    });
  } catch (error) {
    const message = error instanceof DocumentValidationError
      ? error.message
      : '파일 정보를 확인해 주세요.';
    return Response.json({ error: message }, { status: 400 });
  }

  const { data: job, error: jobError } = await context.supabase
    .from('document_ingestion_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('owner_id', context.ownerId)
    .maybeSingle();
  if (jobError) {
    return Response.json({ error: '재시도 작업을 확인하지 못했습니다.' }, { status: 500 });
  }
  if (!job) return Response.json({ error: '재시도 작업을 찾을 수 없습니다.' }, { status: 404 });
  if (job.status !== 'failed' || job.original_available) {
    return Response.json({ error: '원본 재업로드가 필요한 실패 작업이 아닙니다.' }, { status: 409 });
  }
  if (!job.document_id || !job.version_id) {
    return Response.json(
      { error: '새 문서로 다시 업로드해야 합니다.', code: 'NEW_UPLOAD_REQUIRED' },
      { status: 409 },
    );
  }
  if (
    job.file_name.normalize('NFC') !== metadata.name.normalize('NFC')
    || job.mime_type !== metadata.mimeType
    || job.size_bytes !== metadata.sizeBytes
  ) {
    return Response.json({ error: '실패한 작업과 동일한 원본 파일을 선택해 주세요.' }, { status: 400 });
  }

  const { data: version, error: versionError } = await context.supabase
    .from('document_versions')
    .select('storage_path')
    .eq('id', job.version_id)
    .eq('document_id', job.document_id)
    .eq('owner_id', context.ownerId)
    .maybeSingle();
  if (versionError) {
    return Response.json({ error: '문서 버전을 확인하지 못했습니다.' }, { status: 500 });
  }
  if (!version) {
    return Response.json(
      { error: '새 문서로 다시 업로드해야 합니다.', code: 'NEW_UPLOAD_REQUIRED' },
      { status: 409 },
    );
  }

  const { data: claimedJobs, error: claimError } = await context.supabase.rpc(
    'claim_document_ingestion_reupload',
    { p_job_id: jobId },
  );
  if (claimError || !claimedJobs?.length) {
    return Response.json({ error: '이미 재시도 중이거나 다시 시도할 수 없는 작업입니다.' }, { status: 409 });
  }

  const { error: versionStatusError } = await context.supabase
    .from('document_versions')
    .update({ status: 'uploaded', error_message: null })
    .eq('id', job.version_id)
    .eq('owner_id', context.ownerId);
  if (versionStatusError) {
    await markRetryFailed(
      context,
      jobId,
      job.version_id,
      '문서 버전 재시도 상태를 갱신하지 못했습니다.',
    );
    return Response.json({ error: '문서 버전 재시도 상태를 갱신하지 못했습니다.' }, { status: 500 });
  }

  const { data: signedUpload, error: signedUploadError } = await context.supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUploadUrl(version.storage_path, { upsert: true });
  if (signedUploadError) {
    await markRetryFailed(
      context,
      jobId,
      job.version_id,
      '보안 재업로드 URL을 만들지 못했습니다.',
    );
    return Response.json({ error: '보안 재업로드 URL을 만들지 못했습니다.' }, { status: 500 });
  }

  const response = {
    upload: {
      documentId: job.document_id,
      jobId,
      versionId: job.version_id,
      storagePath: version.storage_path,
      uploadToken: signedUpload.token,
      mimeType: metadata.mimeType,
    },
  } satisfies RetryDocumentUploadResponse;
  return Response.json(response);
}
