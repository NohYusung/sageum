import { createHash } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { getProviderConfiguration, requireServerEnvironment } from './env';
import type { DocumentChunk } from '@/lib/rag/types';

export type EmbeddedChunk = {
  chunk: DocumentChunk;
  ownerId: string;
  sourceType: string;
  vector: number[];
};

export type VectorSearchResult = {
  id: string | number;
  score: number;
  documentId: string;
  chunkId: string;
  text: string;
  headingPath: string[];
  page?: number;
  sheet?: string;
};

const PAYLOAD_INDEXES = [
  { field_name: 'owner_id', field_schema: 'uuid' as const },
  { field_name: 'document_id', field_schema: 'uuid' as const },
  { field_name: 'version_id', field_schema: 'uuid' as const },
  { field_name: 'source_type', field_schema: 'keyword' as const },
];

function deterministicUuid(seed: string) {
  const bytes = Buffer.from(createHash('sha256').update(seed).digest('hex').slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stringPayload(payload: Record<string, unknown> | null | undefined, key: string) {
  const found = payload?.[key];
  return typeof found === 'string' ? found : '';
}

export class QdrantVectorStore {
  constructor(
    private readonly client: QdrantClient,
    private readonly collectionName: string,
  ) {}

  async ensureCollection(vectorSize: number) {
    const { exists } = await this.client.collectionExists(this.collectionName);
    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: { size: vectorSize, distance: 'Cosine' },
        on_disk_payload: true,
      });
    }

    const collection = await this.client.getCollection(this.collectionName);
    const schema = collection.payload_schema ?? {};
    await Promise.all(
      PAYLOAD_INDEXES.filter((index) => !(index.field_name in schema)).map((index) =>
        this.client.createPayloadIndex(this.collectionName, {
          ...index,
          wait: true,
        }),
      ),
    );
  }

  async upsert(chunks: EmbeddedChunk[]) {
    if (!chunks.length) return;
    await this.client.upsert(this.collectionName, {
      wait: true,
      points: chunks.map(({ chunk, ownerId, sourceType, vector }) => ({
        id: deterministicUuid(chunk.id),
        vector,
        payload: {
          owner_id: ownerId,
          document_id: chunk.documentId,
          version_id: chunk.versionId,
          chunk_id: chunk.id,
          source_type: sourceType,
          ordinal: chunk.ordinal,
          text: chunk.text,
          heading_path: chunk.headingPath,
          page: chunk.location.page,
          sheet: chunk.location.sheet,
        },
      })),
    });
  }

  async query(vector: number[], ownerId: string, limit = 10): Promise<VectorSearchResult[]> {
    const response = await this.client.query(this.collectionName, {
      query: vector,
      filter: {
        must: [{ key: 'owner_id', match: { value: ownerId } }],
      },
      limit,
      with_payload: true,
    });

    return response.points.map((point) => {
      const payload = point.payload as Record<string, unknown> | null | undefined;
      return {
        id: point.id,
        score: point.score,
        documentId: stringPayload(payload, 'document_id'),
        chunkId: stringPayload(payload, 'chunk_id'),
        text: stringPayload(payload, 'text'),
        headingPath: Array.isArray(payload?.heading_path)
          ? payload.heading_path.filter((item): item is string => typeof item === 'string')
          : [],
        page: typeof payload?.page === 'number' ? payload.page : undefined,
        sheet: typeof payload?.sheet === 'string' ? payload.sheet : undefined,
      };
    });
  }
}

let vectorStore: QdrantVectorStore | null = null;

export function getQdrantVectorStore() {
  if (vectorStore) return vectorStore;
  const configuration = getProviderConfiguration();
  vectorStore = new QdrantVectorStore(
    new QdrantClient({
      url: requireServerEnvironment('QDRANT_URL'),
      apiKey: requireServerEnvironment('QDRANT_API_KEY'),
    }),
    configuration.qdrant.collection,
  );
  return vectorStore;
}
