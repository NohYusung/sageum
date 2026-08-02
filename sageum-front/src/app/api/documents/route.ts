import { randomUUID } from 'node:crypto';
import type { CreateDocumentUploadResponse } from '@/lib/documents/contracts';
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
};

type AuthenticatedContext = NonNullable<Awaited<ReturnType<typeof getAuthenticatedRequestContext>>>;

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

  const documentId = randomUUID();
  const versionId = randomUUID();
  const storagePath = `${context.ownerId}/${documentId}/${versionId}/${storageObjectName(versionId, metadata.sourceType)}`;
  const { error: documentError } = await context.supabase.from('documents').insert({
    id: documentId,
    owner_id: context.ownerId,
    title: metadata.title,
    source_type: metadata.sourceType,
  });

  if (documentError) {
    console.error('Failed to create document', documentError);
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
    return Response.json({ error: '문서 버전을 연결하지 못했습니다.' }, { status: 500 });
  }

  const { data: signedUpload, error: signedUploadError } = await context.supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: false });

  if (signedUploadError) {
    console.error('Failed to create signed upload URL', signedUploadError);
    await cleanupDocument(documentId, context.ownerId, context);
    return Response.json({ error: '보안 업로드 URL을 만들지 못했습니다.' }, { status: 500 });
  }

  const response = {
    upload: {
      documentId,
      versionId,
      storagePath,
      uploadToken: signedUpload.token,
      mimeType: metadata.mimeType,
    },
  } satisfies CreateDocumentUploadResponse;
  return Response.json(response, { status: 201 });
}
