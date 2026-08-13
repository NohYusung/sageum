import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentUploadTicket } from '@/lib/documents/contracts';
import {
  DOCUMENT_BUCKET,
  storageObjectName,
  validateDocumentMetadata,
} from '@/lib/documents/validation';
import type { Database } from '@/lib/supabase/database.types';
import type { DocumentKind } from '@/lib/relations/types';

export type CreateDocumentUploadInput = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  folderId?: string | null;
  retryOfJobId?: string | null;
  documentKind?: DocumentKind;
};

export class DocumentUploadInitializationError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = 'DocumentUploadInitializationError';
  }
}

async function markIngestionJobFailed(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  jobId: string,
  message: string,
) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('document_ingestion_jobs')
    .update({
      status: 'failed',
      stage: 'failed',
      last_error: message.slice(0, 500),
      completed_at: now,
      updated_at: now,
    })
    .eq('id', jobId)
    .eq('owner_id', ownerId);
  if (error) console.error('Failed to mark document ingestion initialization as failed', error);
}

async function cleanupDocument(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  documentId: string,
) {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId)
    .eq('owner_id', ownerId);
  if (error) console.error('Failed to clean up document initialization', error);
}

export async function createDocumentUpload(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  input: CreateDocumentUploadInput,
): Promise<DocumentUploadTicket> {
  const metadata = validateDocumentMetadata(input);
  const folderId = input.folderId ?? null;
  const retryOfJobId = input.retryOfJobId ?? null;
  const documentKind = input.documentKind ?? 'knowledge';
  const documentId = randomUUID();
  const versionId = randomUUID();
  const jobId = randomUUID();
  const storagePath = `${ownerId}/${documentId}/${versionId}/${storageObjectName(versionId, metadata.sourceType)}`;

  if (folderId) {
    const { data: folder, error: folderError } = await supabase
      .from('folders')
      .select('id')
      .eq('id', folderId)
      .eq('owner_id', ownerId)
      .maybeSingle();
    if (folderError) throw new DocumentUploadInitializationError('업로드 대상 폴더를 확인하지 못했습니다.');
    if (!folder) throw new DocumentUploadInitializationError('업로드 대상 폴더를 찾을 수 없습니다.', 404);
  }

  if (retryOfJobId) {
    const { data: retryJob, error: retryJobError } = await supabase
      .from('document_ingestion_jobs')
      .select('id,status')
      .eq('id', retryOfJobId)
      .eq('owner_id', ownerId)
      .maybeSingle();
    if (retryJobError) throw new DocumentUploadInitializationError('재시도 대상 작업을 확인하지 못했습니다.');
    if (!retryJob) throw new DocumentUploadInitializationError('재시도 대상 작업을 찾을 수 없습니다.', 404);
    if (retryJob.status !== 'failed') {
      throw new DocumentUploadInitializationError('실패한 작업만 다시 시도할 수 있습니다.', 409);
    }
  }

  const { error: jobError } = await supabase.from('document_ingestion_jobs').insert({
    id: jobId,
    owner_id: ownerId,
    document_kind: documentKind,
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
    throw new DocumentUploadInitializationError('문서 처리 이력을 만들지 못했습니다.');
  }

  const { error: documentError } = await supabase.from('documents').insert({
    id: documentId,
    owner_id: ownerId,
    document_kind: documentKind,
    folder_id: folderId,
    title: metadata.title,
    source_type: metadata.sourceType,
  });
  if (documentError) {
    console.error('Failed to create document', documentError);
    await markIngestionJobFailed(supabase, ownerId, jobId, '문서 레코드를 만들지 못했습니다.');
    throw new DocumentUploadInitializationError('문서 레코드를 만들지 못했습니다.');
  }

  const { error: versionError } = await supabase.from('document_versions').insert({
    id: versionId,
    document_id: documentId,
    owner_id: ownerId,
    storage_path: storagePath,
    original_filename: metadata.name,
    mime_type: metadata.mimeType,
    size_bytes: metadata.sizeBytes,
    status: 'uploaded',
  });
  if (versionError) {
    console.error('Failed to create document version', versionError);
    await cleanupDocument(supabase, ownerId, documentId);
    await markIngestionJobFailed(supabase, ownerId, jobId, '문서 버전을 만들지 못했습니다.');
    throw new DocumentUploadInitializationError('문서 버전을 만들지 못했습니다.');
  }

  const { error: latestVersionError } = await supabase
    .from('documents')
    .update({ latest_version_id: versionId, updated_at: new Date().toISOString() })
    .eq('id', documentId)
    .eq('owner_id', ownerId);
  if (latestVersionError) {
    console.error('Failed to connect latest document version', latestVersionError);
    await cleanupDocument(supabase, ownerId, documentId);
    await markIngestionJobFailed(supabase, ownerId, jobId, '문서 버전을 연결하지 못했습니다.');
    throw new DocumentUploadInitializationError('문서 버전을 연결하지 못했습니다.');
  }

  const now = new Date().toISOString();
  const { error: jobLinkError } = await supabase
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
    .eq('owner_id', ownerId);
  if (jobLinkError) {
    console.error('Failed to connect document ingestion job', jobLinkError);
    await cleanupDocument(supabase, ownerId, documentId);
    await markIngestionJobFailed(supabase, ownerId, jobId, '문서 처리 이력을 연결하지 못했습니다.');
    throw new DocumentUploadInitializationError('문서 처리 이력을 연결하지 못했습니다.');
  }

  const { data: signedUpload, error: signedUploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: false });
  if (signedUploadError) {
    console.error('Failed to create signed upload URL', signedUploadError);
    await supabase
      .from('document_versions')
      .update({ status: 'failed', error_message: '보안 업로드 URL을 만들지 못했습니다.' })
      .eq('id', versionId)
      .eq('owner_id', ownerId);
    await markIngestionJobFailed(supabase, ownerId, jobId, '보안 업로드 URL을 만들지 못했습니다.');
    throw new DocumentUploadInitializationError('보안 업로드 URL을 만들지 못했습니다.');
  }

  return {
    documentId,
    jobId,
    versionId,
    storagePath,
    signedUploadUrl: signedUpload.signedUrl,
    uploadToken: signedUpload.token,
    mimeType: metadata.mimeType,
  };
}
