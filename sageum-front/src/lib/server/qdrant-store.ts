import { createHash } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { getProviderConfiguration, requireServerEnvironment } from './env';
import type { DocumentChunk } from '@/lib/rag/types';

export type EmbeddedChunk = {
  chunk: DocumentChunk;
  ownerId: string;
  sourceType: string;
  documentTitle: string;
  vector: number[];
};

export type VectorSearchResult = {
  id: string | number;
  score: number;
  documentId: string;
  versionId: string;
  chunkId: string;
  documentTitle: string;
  sourceType: string;
  ordinal: number;
  text: string;
  headingPath: string[];
  page?: number;
  sheet?: string;
  cellRange?: string;
};

export type VectorSearchOptions = {
  limit?: number;
  documentIds?: string[];
  scoreThreshold?: number;
};

export type QdrantClientAdapter = Pick<
  QdrantClient,
  | 'collectionExists'
  | 'createCollection'
  | 'getCollection'
  | 'createPayloadIndex'
  | 'upsert'
  | 'query'
  | 'delete'
>;

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

function numberPayload(payload: Record<string, unknown> | null | undefined, key: string) {
  const found = payload?.[key];
  return typeof found === 'number' && Number.isFinite(found) ? found : 0;
}

function collectionVectorSize(collection: Awaited<ReturnType<QdrantClient['getCollection']>>) {
  const vectors = collection.config.params.vectors;
  if (!vectors || typeof vectors !== 'object' || !('size' in vectors)) return null;
  return typeof vectors.size === 'number' ? vectors.size : null;
}

export class QdrantConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QdrantConfigurationError';
  }
}

export class QdrantVectorStore {
  constructor(
    private readonly client: QdrantClientAdapter,
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
    const existingVectorSize = collectionVectorSize(collection);
    if (existingVectorSize !== vectorSize) {
      throw new QdrantConfigurationError(
        existingVectorSize === null
          ? 'Qdrant Collection이 지원하지 않는 named vector 구성입니다.'
          : `Qdrant Collection 차원(${existingVectorSize})이 임베딩 설정(${vectorSize})과 다릅니다.`,
      );
    }
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
      points: chunks.map(({ chunk, ownerId, sourceType, documentTitle, vector }) => ({
        id: deterministicUuid(chunk.id),
        vector,
        payload: {
          owner_id: ownerId,
          document_id: chunk.documentId,
          version_id: chunk.versionId,
          chunk_id: chunk.id,
          document_title: documentTitle,
          source_type: sourceType,
          ordinal: chunk.ordinal,
          text: chunk.text,
          heading_path: chunk.headingPath,
          page: chunk.location.page,
          sheet: chunk.location.sheet,
          cell_range: chunk.location.cellRange,
        },
      })),
    });
  }

  async query(
    vector: number[],
    ownerId: string,
    options: VectorSearchOptions = {},
  ): Promise<VectorSearchResult[]> {
    const must = [
      { key: 'owner_id', match: { value: ownerId } },
      ...(options.documentIds?.length
        ? [{ key: 'document_id', match: { any: options.documentIds } }]
        : []),
    ];
    const response = await this.client.query(this.collectionName, {
      query: vector,
      filter: { must },
      limit: options.limit ?? 10,
      score_threshold: options.scoreThreshold,
      with_payload: [
        'document_id',
        'version_id',
        'chunk_id',
        'document_title',
        'source_type',
        'ordinal',
        'text',
        'heading_path',
        'page',
        'sheet',
        'cell_range',
      ],
    });

    return response.points.map((point) => {
      const payload = point.payload as Record<string, unknown> | null | undefined;
      return {
        id: point.id,
        score: point.score,
        documentId: stringPayload(payload, 'document_id'),
        versionId: stringPayload(payload, 'version_id'),
        chunkId: stringPayload(payload, 'chunk_id'),
        documentTitle: stringPayload(payload, 'document_title'),
        sourceType: stringPayload(payload, 'source_type'),
        ordinal: numberPayload(payload, 'ordinal'),
        text: stringPayload(payload, 'text'),
        headingPath: Array.isArray(payload?.heading_path)
          ? payload.heading_path.filter((item): item is string => typeof item === 'string')
          : [],
        page: typeof payload?.page === 'number' ? payload.page : undefined,
        sheet: typeof payload?.sheet === 'string' ? payload.sheet : undefined,
        cellRange: typeof payload?.cell_range === 'string' ? payload.cell_range : undefined,
      };
    });
  }

  async deleteByVersion(ownerId: string, versionId: string) {
    await this.deleteByFilter([
      { key: 'owner_id', match: { value: ownerId } },
      { key: 'version_id', match: { value: versionId } },
    ]);
  }

  async deleteByDocument(ownerId: string, documentId: string) {
    await this.deleteByFilter([
      { key: 'owner_id', match: { value: ownerId } },
      { key: 'document_id', match: { value: documentId } },
    ]);
  }

  private async deleteByFilter(must: Array<{ key: string; match: { value: string } }>) {
    const { exists } = await this.client.collectionExists(this.collectionName);
    if (!exists) return;
    await this.client.delete(this.collectionName, {
      wait: true,
      filter: { must },
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
