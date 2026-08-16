import type {
  ApiErrorResponse,
  RenameDocumentResponse,
} from './contracts';

export function splitDocumentFilename(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1
    ? { basename: name.slice(0, dot), extension: name.slice(dot) }
    : { basename: name, extension: '' };
}

export async function renameStoredDocument(documentId: string, name: string) {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const payload = await response.json().catch(() => null) as
    | RenameDocumentResponse
    | ApiErrorResponse
    | null;
  if (!response.ok || !payload || !('document' in payload)) {
    throw new Error(payload && 'error' in payload
      ? payload.error
      : '문서 이름을 변경하지 못했습니다.');
  }
  return payload;
}
