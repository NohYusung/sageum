'use client';

import type {
  ApiErrorResponse,
  CreateDocumentUploadResponse,
  DocumentProcessingStatusResponse,
  ProcessDocumentResponse,
} from '@/lib/documents/contracts';
import type { IndexedDocument } from '@/lib/rag/local-search';
import { createClient } from '@/lib/supabase/client';
import { DOCUMENT_BUCKET } from './validation';

export type DocumentUploadStage =
  | 'creating'
  | 'uploading'
  | 'parsing'
  | 'indexing'
  | 'ready';

export type DocumentUploadProgress = {
  stage: DocumentUploadStage;
  documentId?: string;
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

async function markMissingUploadAsFailed(documentId: string, versionId: string) {
  await fetch(`/api/documents/${encodeURIComponent(documentId)}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId }),
  }).catch(() => undefined);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function pollProcessingStatus(
  documentId: string,
  versionId: string,
  shouldStop: () => boolean,
  onProgress?: (progress: DocumentUploadProgress) => void,
) {
  while (!shouldStop()) {
    await wait(PROCESSING_STATUS_POLL_MS);
    if (shouldStop()) return;

    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(documentId)}/process?versionId=${encodeURIComponent(versionId)}`,
        { cache: 'no-store' },
      );
      if (!response.ok) continue;
      const payload = await response.json() as DocumentProcessingStatusResponse;
      if (payload.status === 'parsing' || payload.status === 'indexing') {
        onProgress?.({ stage: payload.status, documentId, versionId });
      }
      if (payload.status === 'ready' || payload.status === 'failed') return;
    } catch {
      // 상태 조회 실패는 실제 처리 요청 결과로 판정합니다.
    }
  }
}

export async function uploadAndProcessDocument(
  file: File,
  folderId: string | null = null,
  onProgress?: (progress: DocumentUploadProgress) => void,
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
    }),
  });
  const { upload } = await responseJson<CreateDocumentUploadResponse>(createResponse);
  onProgress?.({
    stage: 'uploading',
    documentId: upload.documentId,
    versionId: upload.versionId,
  });
  const normalizedFile = file.type === upload.mimeType
    ? file
    : new File([file], file.name, {
        type: upload.mimeType,
        lastModified: file.lastModified,
      });
  const supabase = createClient();
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .uploadToSignedUrl(upload.storagePath, upload.uploadToken, normalizedFile, {
      cacheControl: '3600',
      contentType: upload.mimeType,
      upsert: false,
    });

  if (uploadError) {
    await markMissingUploadAsFailed(upload.documentId, upload.versionId);
    throw new Error('Supabase 원본 업로드에 실패했습니다.');
  }

  onProgress?.({
    stage: 'parsing',
    documentId: upload.documentId,
    versionId: upload.versionId,
  });
  let stopPolling = false;
  const statusPolling = pollProcessingStatus(
    upload.documentId,
    upload.versionId,
    () => stopPolling,
    onProgress,
  );

  try {
    const processResponse = await fetch(
      `/api/documents/${encodeURIComponent(upload.documentId)}/process`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: upload.versionId }),
      },
    );
    const processed = await responseJson<ProcessDocumentResponse>(processResponse);
    onProgress?.({
      stage: 'ready',
      documentId: upload.documentId,
      versionId: upload.versionId,
    });
    return processed.document;
  } finally {
    stopPolling = true;
    await statusPolling;
  }
}
