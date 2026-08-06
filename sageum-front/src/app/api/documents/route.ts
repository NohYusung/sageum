import { randomUUID } from 'node:crypto';
import type { CreateDocumentUploadResponse } from '@/lib/documents/contracts';
import { FolderValidationError, parseFolderId } from '@/lib/folders/validation';
import {
  DocumentValidationError,
  DOCUMENT_BUCKET,
  storageObjectName,
  validateDocumentMetadata,
} from '@/lib/documents/validation';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';

export const runtime = 'nodejs';

type CreateDocumentBody = {
  name?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  folderId?: unknown;
  retryOfJobId?: unknown;
};

type AuthenticatedContext = NonNullable<Awaited<ReturnType<typeof getAuthenticatedRequestContext>>>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function cleanupDocument(
  documentId: string,
  ownerId: string,
  context: AuthenticatedContext,
) {
  const { error } = await context.supabase
    .from('documents')
    .delete()
    .eq('id', documentId)
    .eq('owner_id', ownerId);
  if (error) console.error('Failed to clean up document initialization', error);
}

async function markIngestionJobFailed(
  jobId: string,
  message: string,
  context: AuthenticatedContext,
) {
  const now = new Date().toISOString();
  const { error } = await context.supabase
    .from('document_ingestion_jobs')
    .update({
      status: 'failed',
      stage: 'failed',
      last_error: message.slice(0, 500),
      completed_at: now,
      updated_at: now,
    })
    .eq('id', jobId)
    .eq('owner_id', context.ownerId);
  if (error) console.error('Failed to mark document ingestion initialization as failed', error);
}

export async function POST(request: Request) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  let body: CreateDocumentBody;
  try {
    body = await request.json() as CreateDocumentBody;
  } catch {
    return Response.json({ error: '올바른 JSON 요청이 필요합니다.' }, { status: 400 });
  }

  let metadata;
  let folderId: string | null;
  let retryOfJobId: string | null;
  try {
    metadata = validateDocumentMetadata({
      name: typeof body.name === 'string' ? body.name : '',
      mimeType: typeof body.mimeType === 'string' ? body.mimeType : '',
      sizeBytes: typeof body.sizeBytes === 'number' ? body.sizeBytes : Number.NaN,
    });
    folderId = parseFolderId(body.folderId, { optional: true });
    retryOfJobId = body.retryOfJobId === undefined || body.retryOfJobId === null
      ? null
      : typeof body.retryOfJobId === 'string' && UUID_PATTERN.test(body.retryOfJobId)
        ? body.retryOfJobId
        : null;
    if (body.retryOfJobId !== undefined && body.retryOfJobId !== null && !retryOfJobId) {
      throw new DocumentValidationError('올바른 재시도 작업 식별자가 필요합니다.');
    }
  } catch (error) {
    const message = error instanceof DocumentValidationError || error instanceof FolderValidationError
      ? error.message
      : '파일 정보를 확인해 주세요.';
    return Response.json({ error: message }, { status: 400 });
  }

  const documentId = randomUUID();
  const versionId = randomUUID();
  const jobId = randomUUID();
  const storagePath = `${context.ownerId}/${documentId}/${versionId}/${storageObjectName(versionId, metadata.sourceType)}`;
  if (folderId) {
    const { data: folder, error: folderError } = await context.supabase
      .from('folders')
      .select('id')
      .eq('id', folderId)
      .eq('owner_id', context.ownerId)
      .maybeSingle();
    if (folderError) {
      return Response.json({ error: '업로드 대상 폴더를 확인하지 못했습니다.' }, { status: 500 });
    }
    if (!folder) return Response.json({ error: '업로드 대상 폴더를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (retryOfJobId) {
    const { data: retryJob, error: retryJobError } = await context.supabase
      .from('document_ingestion_jobs')
      .select('id,status')
      .eq('id', retryOfJobId)
      .eq('owner_id', context.ownerId)
      .maybeSingle();
    if (retryJobError) {
      return Response.json({ error: '재시도 대상 작업을 확인하지 못했습니다.' }, { status: 500 });
    }
    if (!retryJob) return Response.json({ error: '재시도 대상 작업을 찾을 수 없습니다.' }, { status: 404 });
    if (retryJob.status !== 'failed') {
      return Response.json({ error: '실패한 작업만 다시 시도할 수 있습니다.' }, { status: 409 });
    }
  }

  const { error: jobError } = await context.supabase.from('document_ingestion_jobs').insert({
    id: jobId,
    owner_id: context.ownerId,
    retry_of_job_id: retryOfJobId,
    folder_id: folderId,
    file_name: metadata.name,
    mime_type: metadata.mimeType,
    size_bytes: metadata.sizeBytes,
    status: 'queued',
    stage: 'queued',
    attempts: 1,
  });
  if (jobError) {
    console.error('Failed to create document ingestion job', jobError);
    return Response.json({ error: '문서 처리 이력을 만들지 못했습니다.' }, { status: 500 });
  }

  const { error: documentError } = await context.supabase.from('documents').insert({
    id: documentId,
    owner_id: context.ownerId,
    folder_id: folderId,
    title: metadata.title,
    source_type: metadata.sourceType,
  });

  if (documentError) {
    console.error('Failed to create document', documentError);
    await markIngestionJobFailed(jobId, '문서 레코드를 만들지 못했습니다.', context);
    return Response.json({ error: '문서 레코드를 만들지 못했습니다.' }, { status: 500 });
  }

  const { error: versionError } = await context.supabase.from('document_versions').insert({
    id: versionId,
    document_id: documentId,
    owner_id: context.ownerId,
    storage_path: storagePath,
    original_filename: metadata.name,
    mime_type: metadata.mimeType,
    size_bytes: metadata.sizeBytes,
    status: 'uploaded',
  });

  if (versionError) {
    console.error('Failed to create document version', versionError);
    await cleanupDocument(documentId, context.ownerId, context);
    await markIngestionJobFailed(jobId, '문서 버전을 만들지 못했습니다.', context);
    return Response.json({ error: '문서 버전을 만들지 못했습니다.' }, { status: 500 });
  }

  const { error: latestVersionError } = await context.supabase
    .from('documents')
    .update({ latest_version_id: versionId, updated_at: new Date().toISOString() })
    .eq('id', documentId)
    .eq('owner_id', context.ownerId);

  if (latestVersionError) {
    console.error('Failed to connect latest document version', latestVersionError);
    await cleanupDocument(documentId, context.ownerId, context);
    await markIngestionJobFailed(jobId, '문서 버전을 연결하지 못했습니다.', context);
    return Response.json({ error: '문서 버전을 연결하지 못했습니다.' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { error: jobLinkError } = await context.supabase
    .from('document_ingestion_jobs')
    .update({
      document_id: documentId,
      version_id: versionId,
      status: 'uploading',
      stage: 'uploading',
      started_at: now,
      updated_at: now,
    })
    .eq('id', jobId)
    .eq('owner_id', context.ownerId);
  if (jobLinkError) {
    console.error('Failed to connect document ingestion job', jobLinkError);
    await cleanupDocument(documentId, context.ownerId, context);
    await markIngestionJobFailed(jobId, '문서 처리 이력을 연결하지 못했습니다.', context);
    return Response.json({ error: '문서 처리 이력을 연결하지 못했습니다.' }, { status: 500 });
  }

  const { data: signedUpload, error: signedUploadError } = await context.supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: false });

  if (signedUploadError) {
    console.error('Failed to create signed upload URL', signedUploadError);
    await context.supabase
      .from('document_versions')
      .update({ status: 'failed', error_message: '보안 업로드 URL을 만들지 못했습니다.' })
      .eq('id', versionId)
      .eq('owner_id', context.ownerId);
    await markIngestionJobFailed(jobId, '보안 업로드 URL을 만들지 못했습니다.', context);
    return Response.json({ error: '보안 업로드 URL을 만들지 못했습니다.' }, { status: 500 });
  }

  const response = {
    upload: {
      documentId,
      jobId,
      versionId,
      storagePath,
      uploadToken: signedUpload.token,
      mimeType: metadata.mimeType,
    },
  } satisfies CreateDocumentUploadResponse;
  return Response.json(response, { status: 201 });
}
