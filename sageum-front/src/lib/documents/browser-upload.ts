'use client';

import type {
  ApiErrorResponse,
  CreateDocumentUploadResponse,
  IndexDocumentVectorsResponse,
  ProcessDocumentResponse,
} from '@/lib/documents/contracts';
import {
  embedDocumentChunks,
  type EmbeddingProgress,
} from '@/lib/embedding/browser-client';
import { MAX_BROWSER_VECTOR_CHUNKS } from '@/lib/embedding/vector-index-request';
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

export type UploadDocumentOptions = {
  onEmbeddingProgress?: (progress: EmbeddingProgress) => void;
};

async function markVectorIndexAsFailed(
  documentId: string,
  versionId: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : '브라우저 임베딩에 실패했습니다.';
  await fetch(`/api/documents/${encodeURIComponent(documentId)}/vectors`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId, error: message }),
  }).catch(() => undefined);
}

export async function uploadAndProcessDocument(
  file: File,
  options: UploadDocumentOptions = {},
): Promise<IndexedDocument> {
  const createResponse = await fetch('/api/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
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
  if (!processed.vectorIndex) return processed.document;

  if (processed.document.chunks.length > MAX_BROWSER_VECTOR_CHUNKS) {
    const error = new Error(
      `브라우저 색인은 문서당 최대 ${MAX_BROWSER_VECTOR_CHUNKS}개 청크를 지원합니다. 파일을 나눠 업로드해 주세요.`,
    );
    await markVectorIndexAsFailed(upload.documentId, upload.versionId, error);
    throw error;
  }

  try {
    const vectors = await embedDocumentChunks(
      processed.document.document.title,
      processed.document.chunks,
      options.onEmbeddingProgress,
    );
    const vectorResponse = await fetch(
      `/api/documents/${encodeURIComponent(upload.documentId)}/vectors`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          versionId: upload.versionId,
          model: processed.vectorIndex.model,
          dtype: processed.vectorIndex.dtype,
          dimensions: processed.vectorIndex.dimensions,
          vectors: processed.document.chunks.map((chunk, index) => ({
            chunkId: chunk.id,
            vector: vectors[index],
          })),
        }),
      },
    );
    const indexed = await responseJson<IndexDocumentVectorsResponse>(vectorResponse);
    return {
      ...processed.document,
      status: 'ready',
      indexedAt: indexed.indexedAt,
    };
  } catch (error) {
    await markVectorIndexAsFailed(upload.documentId, upload.versionId, error);
    throw error;
  }
}
