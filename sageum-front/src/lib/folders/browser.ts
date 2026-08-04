'use client';

import type { ApiErrorResponse } from '@/lib/documents/contracts';
import type { DocumentMoveResponse, FolderResponse } from './contracts';
import type { Folder } from './types';

async function folderRequest<T extends object>(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null) as T | ApiErrorResponse | null;
  if (!response.ok) {
    throw new Error(payload && 'error' in payload ? payload.error : '폴더 요청을 처리하지 못했습니다.');
  }
  if (!payload) throw new Error('폴더 요청 응답이 비어 있습니다.');
  return payload as T;
}

export async function createFolder(name: string, parentId: string | null): Promise<Folder> {
  const { folder } = await folderRequest<FolderResponse>('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentId }),
  });
  return folder;
}

export async function renameFolder(folderId: string, name: string): Promise<Folder> {
  const { folder } = await folderRequest<FolderResponse>(
    `/api/folders/${encodeURIComponent(folderId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  );
  return folder;
}

export async function moveFolder(folderId: string, parentId: string | null): Promise<Folder> {
  const { folder } = await folderRequest<FolderResponse>(
    `/api/folders/${encodeURIComponent(folderId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId }),
    },
  );
  return folder;
}

export async function deleteFolder(folderId: string) {
  const response = await fetch(`/api/folders/${encodeURIComponent(folderId)}`, {
    method: 'DELETE',
  });
  if (response.ok) return;
  const payload = await response.json().catch(() => null) as ApiErrorResponse | null;
  throw new Error(payload?.error ?? '폴더를 삭제하지 못했습니다.');
}

export async function moveDocumentToFolder(documentId: string, folderId: string | null) {
  return folderRequest<DocumentMoveResponse>(
    `/api/documents/${encodeURIComponent(documentId)}/folder`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId }),
    },
  );
}
