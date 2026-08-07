'use client';

import type { ApiErrorResponse, RepositoryBulkDeleteResponse } from './contracts';

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

export async function deleteRepositoryItems({
  documentIds,
  folderIds,
}: {
  documentIds: string[];
  folderIds: string[];
}) {
  const response = await fetch('/api/repository/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentIds, folderIds }),
  });
  const payload = await response.json().catch(() => null) as
    | RepositoryBulkDeleteResponse
    | ApiErrorResponse
    | null;
  if (!response.ok) {
    throw new Error(payload && 'error' in payload ? payload.error : '선택한 항목을 삭제하지 못했습니다.');
  }
  if (!payload || 'error' in payload) {
    throw new Error('대량 삭제 응답이 비어 있습니다.');
  }
  return payload;
}
