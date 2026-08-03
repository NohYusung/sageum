export const ORIGINAL_URL_TTL_SECONDS = 120;
export const ORIGINAL_PREVIEW_URL_TTL_SECONDS = 900;

export type OriginalDisposition = 'inline' | 'attachment';

export function parseOriginalDisposition(value: string | null): OriginalDisposition | null {
  if (value === null || value === 'inline') return 'inline';
  if (value === 'attachment') return 'attachment';
  return null;
}

export function isExpectedOriginalStoragePath({
  storagePath,
  ownerId,
  documentId,
  versionId,
}: {
  storagePath: string;
  ownerId: string;
  documentId: string;
  versionId: string;
}) {
  const pathSegments = storagePath.split('/');
  return pathSegments.length === 4
    && pathSegments[0] === ownerId
    && pathSegments[1] === documentId
    && pathSegments[2] === versionId
    && pathSegments[3].length > 0;
}

export function signedUrlOptions(
  disposition: OriginalDisposition,
  originalFilename: string,
) {
  return disposition === 'attachment'
    ? { download: originalFilename }
    : undefined;
}
