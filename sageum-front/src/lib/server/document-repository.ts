import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentIngestionJob } from '@/lib/documents/contracts';
import { mapStoredIngestionJob } from '@/lib/documents/ingestion-jobs';
import { mapStoredDocument } from '@/lib/documents/repository-mapper';
import type { Folder } from '@/lib/folders/types';
import type { IndexedDocument } from '@/lib/rag/local-search';
import type { Database } from '@/lib/supabase/database.types';

const INGESTION_HISTORY_PAGE_SIZE = 1000;

export async function listDocumentIngestionJobs(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<DocumentIngestionJob[]> {
  const jobs: DocumentIngestionJob[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('document_ingestion_jobs')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + INGESTION_HISTORY_PAGE_SIZE - 1);

    if (error) throw new Error('문서 처리 이력을 불러오지 못했습니다.');
    jobs.push(...data.map(mapStoredIngestionJob));
    if (data.length < INGESTION_HISTORY_PAGE_SIZE) return jobs;
    offset += INGESTION_HISTORY_PAGE_SIZE;
  }
}

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

export async function getIndexedDocument(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  documentId: string,
): Promise<IndexedDocument | null> {
  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .eq('owner_id', ownerId)
    .maybeSingle();

  if (documentError) throw new Error('문서를 불러오지 못했습니다.');
  if (!document?.latest_version_id) return null;

  const [versionResult, chunksResult] = await Promise.all([
    supabase
      .from('document_versions')
      .select('*')
      .eq('id', document.latest_version_id)
      .eq('document_id', documentId)
      .eq('owner_id', ownerId)
      .maybeSingle(),
    supabase
      .from('document_chunks')
      .select('*')
      .eq('version_id', document.latest_version_id)
      .eq('document_id', documentId)
      .eq('owner_id', ownerId)
      .order('ordinal', { ascending: true }),
  ]);

  if (versionResult.error || chunksResult.error) {
    throw new Error('문서 인덱스를 불러오지 못했습니다.');
  }
  if (!versionResult.data) return null;
  return mapStoredDocument(document, versionResult.data, chunksResult.data);
}

export async function listFolders(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<Folder[]> {
  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .eq('owner_id', ownerId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new Error('폴더 목록을 불러오지 못했습니다.');
  return data.map((folder) => ({
    id: folder.id,
    parentId: folder.parent_id,
    name: folder.name,
    sortOrder: folder.sort_order,
    createdAt: folder.created_at,
    updatedAt: folder.updated_at,
  }));
}
