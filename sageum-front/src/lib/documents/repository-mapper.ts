import type { IndexedDocument } from '@/lib/rag/local-search';
import type { DocumentSourceType } from '@/lib/rag/types';
import type { Json, Tables } from '@/lib/supabase/database.types';

export type StoredDocument = Tables<'documents'>;
export type StoredDocumentVersion = Tables<'document_versions'>;
export type StoredDocumentChunk = Tables<'document_chunks'>;

const SOURCE_TYPES = new Set<DocumentSourceType>([
  'markdown',
  'html',
  'text',
  'pdf',
  'docx',
  'xlsx',
]);

function sourceType(value: string): DocumentSourceType {
  return SOURCE_TYPES.has(value as DocumentSourceType) ? value as DocumentSourceType : 'text';
}

function metadataObject(metadata: Json) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
}

function metadataNumber(metadata: Json, key: string) {
  const value = metadataObject(metadata)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function metadataString(metadata: Json, key: string) {
  const value = metadataObject(metadata)[key];
  return typeof value === 'string' ? value : undefined;
}

function indexedStatus(status: string): IndexedDocument['status'] {
  if (status === 'ready') return 'ready';
  if (status === 'failed') return 'failed';
  return 'processing';
}

export function mapStoredDocument(
  document: StoredDocument,
  version: StoredDocumentVersion,
  chunks: StoredDocumentChunk[],
): IndexedDocument {
  return {
    document: {
      id: document.id,
      versionId: version.id,
      name: version.original_filename,
      title: document.title,
      mimeType: version.mime_type,
      sourceType: sourceType(document.source_type),
      sizeBytes: version.size_bytes,
      blocks: [],
    },
    chunks: chunks.map((chunk) => {
      const blockStart = metadataNumber(chunk.metadata, 'blockStart') ?? 0;
      const blockEnd = metadataNumber(chunk.metadata, 'blockEnd') ?? blockStart;
      return {
        id: chunk.id,
        documentId: chunk.document_id,
        versionId: chunk.version_id,
        ordinal: chunk.ordinal,
        text: chunk.text,
        wordCount: chunk.word_count,
        headingPath: chunk.heading_path,
        blockStart,
        blockEnd,
        focusBlock: metadataNumber(chunk.metadata, 'focusBlock') ?? blockEnd,
        location: {
          page: chunk.page ?? undefined,
          sheet: chunk.sheet ?? undefined,
          cellRange: chunk.cell_range ?? undefined,
          startOffset: chunk.start_offset ?? undefined,
          endOffset: chunk.end_offset ?? undefined,
        },
      };
    }),
    status: document.deletion_status === 'deleting'
      ? 'deleting'
      : indexedStatus(version.status),
    indexedAt: metadataString(version.metadata, 'processedAt') ?? version.created_at,
  };
}
