'use client';

import type {
  ApiErrorResponse,
  CreateDocumentUploadResponse,
  ProcessDocumentResponse,
} from '@/lib/documents/contracts';
import type { IndexedDocument } from '@/lib/rag/local-search';
import { createClient } from '@/lib/supabase/client';
import { DOCUMENT_BUCKET } from './validation';

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

export async function uploadAndProcessDocument(
  file: File,
  folderId: string | null = null,
): Promise<IndexedDocument> {
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

  const processResponse = await fetch(
    `/api/documents/${encodeURIComponent(upload.documentId)}/process`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId: upload.versionId }),
    },
  );
  const processed = await responseJson<ProcessDocumentResponse>(processResponse);
  return processed.document;
}
