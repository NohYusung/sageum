'use client';

import type { ApiErrorResponse } from './contracts';

export async function deleteStoredDocument(documentId: string) {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });
  if (response.ok) return;

  const payload = await response.json().catch(() => null) as ApiErrorResponse | null;
  throw new Error(payload?.error ?? '문서를 삭제하지 못했습니다.');
}

export async function cleanupFailedIngestionJob(jobId: string) {
  const response = await fetch(`/api/ingestion-jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  });
  if (response.ok) return;

  const payload = await response.json().catch(() => null) as ApiErrorResponse | null;
  throw new Error(payload?.error ?? '실패 작업을 정리하지 못했습니다.');
}
