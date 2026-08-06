'use client';

import type {
  ApiErrorResponse,
  CreateDocumentUploadResponse,
  DocumentIngestionJob,
  DocumentIngestionJobResponse,
  DocumentIngestionStage,
  DocumentUploadTicket,
  ProcessDocumentResponse,
  RetryDocumentUploadResponse,
} from '@/lib/documents/contracts';
import type { IndexedDocument } from '@/lib/rag/local-search';
import { createClient } from '@/lib/supabase/client';
import { DOCUMENT_BUCKET } from './validation';

export type DocumentUploadStage = 'creating' | DocumentIngestionStage;

export type DocumentUploadProgress = {
  stage: DocumentUploadStage;
  documentId?: string;
  jobId?: string;
  versionId?: string;
};

const PROCESSING_STATUS_POLL_MS = 700;

async function responseJson<T extends object>(response: Response) {
  const payload = await response.json().catch(() => null) as T | ApiErrorResponse | null;
  if (!response.ok) {
    const message = payload && 'error' in payload
      ? payload.error
      : '문서 요청을 처리하지 못했습니다.';
    throw new Error(message);
  }
  if (!payload) throw new Error('서버 응답이 비어 있습니다.');
  return payload as T;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function progressFromTicket(
  stage: DocumentUploadStage,
  ticket: Pick<DocumentUploadTicket, 'documentId' | 'jobId' | 'versionId'>,
): DocumentUploadProgress {
  return {
    stage,
    documentId: ticket.documentId,
    jobId: ticket.jobId,
    versionId: ticket.versionId,
  };
}

async function uploadOriginal(
  file: File,
  ticket: DocumentUploadTicket,
  { upsert = false }: { upsert?: boolean } = {},
) {
  const normalizedFile = file.type === ticket.mimeType
    ? file
    : new File([file], file.name, {
        type: ticket.mimeType,
        lastModified: file.lastModified,
      });
  const supabase = createClient();
  return supabase.storage
    .from(DOCUMENT_BUCKET)
    .uploadToSignedUrl(ticket.storagePath, ticket.uploadToken, normalizedFile, {
      cacheControl: '3600',
      contentType: ticket.mimeType,
      upsert,
    });
}

async function markMissingUploadAsFailed(ticket: DocumentUploadTicket) {
  await fetch(`/api/documents/${encodeURIComponent(ticket.documentId)}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId: ticket.versionId, jobId: ticket.jobId }),
  }).catch(() => undefined);
}

export async function fetchDocumentIngestionJob(jobId: string) {
  const response = await fetch(`/api/ingestion-jobs/${encodeURIComponent(jobId)}`, {
    cache: 'no-store',
  });
  const payload = await responseJson<DocumentIngestionJobResponse>(response);
  return payload.job;
}

async function pollProcessingStatus(
  ticket: Pick<DocumentUploadTicket, 'documentId' | 'jobId' | 'versionId'>,
  shouldStop: () => boolean,
  onProgress?: (progress: DocumentUploadProgress) => void,
) {
  while (!shouldStop()) {
    await wait(PROCESSING_STATUS_POLL_MS);
    if (shouldStop()) return;

    try {
      const job = await fetchDocumentIngestionJob(ticket.jobId);
      onProgress?.(progressFromTicket(job.stage, ticket));
      if (job.status === 'ready' || job.status === 'failed') return;
    } catch {
      // 상태 조회 실패는 실제 처리 요청 결과로 판정합니다.
    }
  }
}

export async function processStoredDocument(
  ticket: Pick<DocumentUploadTicket, 'documentId' | 'jobId' | 'versionId'>,
  onProgress?: (progress: DocumentUploadProgress) => void,
): Promise<IndexedDocument> {
  onProgress?.(progressFromTicket('parsing', ticket));
  let stopPolling = false;
  const statusPolling = pollProcessingStatus(ticket, () => stopPolling, onProgress);

  try {
    const processResponse = await fetch(
      `/api/documents/${encodeURIComponent(ticket.documentId)}/process`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: ticket.versionId, jobId: ticket.jobId }),
      },
    );
    const processed = await responseJson<ProcessDocumentResponse>(processResponse);
    onProgress?.(progressFromTicket('ready', ticket));
    return processed.document;
  } finally {
    stopPolling = true;
    await statusPolling;
  }
}

export async function uploadAndProcessDocument(
  file: File,
  folderId: string | null = null,
  onProgress?: (progress: DocumentUploadProgress) => void,
  retryOfJobId: string | null = null,
): Promise<IndexedDocument> {
  onProgress?.({ stage: 'creating' });
  const createResponse = await fetch('/api/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      folderId,
      retryOfJobId,
    }),
  });
  const { upload } = await responseJson<CreateDocumentUploadResponse>(createResponse);
  onProgress?.(progressFromTicket('uploading', upload));
  const { error: uploadError } = await uploadOriginal(file, upload);

  if (uploadError) {
    await markMissingUploadAsFailed(upload);
    throw new Error('Supabase 원본 업로드에 실패했습니다.');
  }

  return processStoredDocument(upload, onProgress);
}

export async function retryUploadedDocument(
  job: DocumentIngestionJob,
  onProgress?: (progress: DocumentUploadProgress) => void,
) {
  if (!job.documentId || !job.versionId) {
    throw new Error('원본 파일을 다시 선택해야 합니다.');
  }
  return processStoredDocument({
    documentId: job.documentId,
    jobId: job.id,
    versionId: job.versionId,
  }, onProgress);
}

export async function reuploadAndProcessDocument(
  job: DocumentIngestionJob,
  file: File,
  onProgress?: (progress: DocumentUploadProgress) => void,
) {
  const response = await fetch(
    `/api/ingestion-jobs/${encodeURIComponent(job.id)}/retry-upload`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      }),
    },
  );
  const { upload } = await responseJson<RetryDocumentUploadResponse>(response);
  onProgress?.(progressFromTicket('uploading', upload));
  const { error: uploadError } = await uploadOriginal(file, upload, { upsert: true });
  if (uploadError) {
    await markMissingUploadAsFailed(upload);
    throw new Error('Supabase 원본 재업로드에 실패했습니다.');
  }
  return processStoredDocument(upload, onProgress);
}
