import type { SupabaseClient } from '@supabase/supabase-js';
import { mapStoredDocument } from '@/lib/documents/repository-mapper';
import type { IndexedDocument } from '@/lib/rag/local-search';
import type { Database } from '@/lib/supabase/database.types';

export async function listIndexedDocuments(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<IndexedDocument[]> {
  const { data: documents, error: documentsError } = await supabase
    .from('documents')
    .select('*')
    .eq('owner_id', ownerId)
    .not('latest_version_id', 'is', null)
    .order('updated_at', { ascending: false });

  if (documentsError) throw new Error('문서 목록을 불러오지 못했습니다.');
  if (!documents.length) return [];

  const versionIds = documents.flatMap((document) =>
    document.latest_version_id ? [document.latest_version_id] : [],
  );
  const [versionsResult, chunksResult] = await Promise.all([
    supabase
      .from('document_versions')
      .select('*')
      .eq('owner_id', ownerId)
      .in('id', versionIds),
    supabase
      .from('document_chunks')
      .select('*')
      .eq('owner_id', ownerId)
      .in('version_id', versionIds)
      .order('ordinal', { ascending: true }),
  ]);

  if (versionsResult.error || chunksResult.error) {
    throw new Error('문서 인덱스를 불러오지 못했습니다.');
  }

  const versions = new Map(versionsResult.data.map((version) => [version.id, version]));
  const chunksByVersion = new Map<string, typeof chunksResult.data>();
  chunksResult.data.forEach((chunk) => {
    const chunks = chunksByVersion.get(chunk.version_id) ?? [];
    chunks.push(chunk);
    chunksByVersion.set(chunk.version_id, chunks);
  });

  return documents.flatMap((document) => {
    if (!document.latest_version_id) return [];
    const version = versions.get(document.latest_version_id);
    if (!version) return [];
    return [mapStoredDocument(document, version, chunksByVersion.get(version.id) ?? [])];
  });
}
