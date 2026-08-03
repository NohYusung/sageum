import type { SupabaseClient } from '@supabase/supabase-js';
import { isExpectedOriginalStoragePath } from '@/lib/documents/original-access';
import type { Database } from '@/lib/supabase/database.types';

export type OwnedOriginalDocument = {
  documentId: string;
  title: string;
  versionId: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
};

export async function findOwnedOriginalDocument(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  documentId: string,
): Promise<OwnedOriginalDocument | null> {
  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('title, latest_version_id, deletion_status')
    .eq('id', documentId)
    .eq('owner_id', ownerId)
    .maybeSingle();

  if (documentError) throw new Error('Original document lookup failed', { cause: documentError });
  if (!document?.latest_version_id || document.deletion_status === 'deleting') return null;

  const { data: version, error: versionError } = await supabase
    .from('document_versions')
    .select('id, storage_path, original_filename, mime_type, size_bytes')
    .eq('id', document.latest_version_id)
    .eq('document_id', documentId)
    .eq('owner_id', ownerId)
    .maybeSingle();

  if (versionError) throw new Error('Original document version lookup failed', { cause: versionError });
  if (!version) return null;

  if (!isExpectedOriginalStoragePath({
    storagePath: version.storage_path,
    ownerId,
    documentId,
    versionId: version.id,
  })) {
    throw new Error('Unexpected original storage path');
  }

  return {
    documentId,
    title: document.title,
    versionId: version.id,
    storagePath: version.storage_path,
    originalFilename: version.original_filename,
    mimeType: version.mime_type,
    sizeBytes: version.size_bytes,
  };
}
