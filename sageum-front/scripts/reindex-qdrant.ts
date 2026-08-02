import type { DocumentChunk } from '../src/lib/rag/types';
import type { Json, Tables } from '../src/lib/supabase/database.types';
import { getProviderConfiguration } from '../src/lib/server/env';
import { getQdrantVectorStore } from '../src/lib/server/qdrant-store';
import { getSupabaseAdminClient } from '../src/lib/server/supabase';

const PAGE_SIZE = 500;

function metadataNumber(metadata: Json, key: string) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 0;
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toDocumentChunk(row: Tables<'document_chunks'>): DocumentChunk {
  return {
    id: row.id,
    documentId: row.document_id,
    versionId: row.version_id,
    ordinal: row.ordinal,
    text: row.text,
    wordCount: row.word_count,
    headingPath: row.heading_path,
    blockStart: metadataNumber(row.metadata, 'blockStart'),
    blockEnd: metadataNumber(row.metadata, 'blockEnd'),
    location: {
      page: row.page ?? undefined,
      sheet: row.sheet ?? undefined,
      cellRange: row.cell_range ?? undefined,
      startOffset: row.start_offset ?? undefined,
      endOffset: row.end_offset ?? undefined,
    },
  };
}

async function listVersionChunks(ownerId: string, versionId: string) {
  const supabase = getSupabaseAdminClient();
  const chunks: Tables<'document_chunks'>[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('document_chunks')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('version_id', versionId)
      .order('ordinal', { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw new Error(`문서 청크 조회 실패: ${error.message}`);
    chunks.push(...data);
    if (data.length < PAGE_SIZE) return chunks;
  }
}

async function main() {
  const providers = getProviderConfiguration();
  if (!providers.embedding.configured || !providers.qdrant.configured) {
    throw new Error('Qdrant Cloud Inference 환경 설정이 필요합니다.');
  }

  const supabase = getSupabaseAdminClient();
  const { data: documents, error } = await supabase
    .from('documents')
    .select('id, owner_id, title, source_type, latest_version_id')
    .not('latest_version_id', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(1000);
  if (error) throw new Error(`문서 목록 조회 실패: ${error.message}`);

  const store = getQdrantVectorStore();
  await store.ensureCollection(providers.embedding.dimensions);
  let indexedDocuments = 0;
  let indexedChunks = 0;

  for (const document of documents) {
    if (!document.latest_version_id) continue;
    const rows = await listVersionChunks(document.owner_id, document.latest_version_id);
    if (!rows.length) continue;
    await store.deleteByVersion(document.owner_id, document.latest_version_id);
    await store.upsert(rows.map((row) => ({
      chunk: toDocumentChunk(row),
      ownerId: document.owner_id,
      sourceType: document.source_type,
      documentTitle: document.title,
      embeddingModel: providers.embedding.model,
    })));
    indexedDocuments += 1;
    indexedChunks += rows.length;
  }

  console.log(
    `Qdrant 재색인 완료: '${providers.qdrant.collection}'에 ${indexedDocuments}개 문서, ${indexedChunks}개 청크 (${providers.embedding.model}).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Qdrant 재색인에 실패했습니다.');
  process.exitCode = 1;
});
