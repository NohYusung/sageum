import { createHash } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { getProviderConfiguration, requireServerEnvironment } from './env';
import {
  densePassageInferenceText,
  denseQueryInferenceText,
  QDRANT_BM25_MODEL,
  QdrantConfigurationError,
  QdrantInferenceError,
  QDRANT_DENSE_VECTOR_NAME,
  QDRANT_SPARSE_VECTOR_NAME,
} from './qdrant-store';

export type RelationVectorRecord = {
  id: string;
  ownerId: string;
  ruleDocumentId: string;
  ruleVersionId: string;
  sourceChunkId: string;
  statement: string;
  embeddingModel: string;
};

export type RelationVectorSearchResult = Omit<RelationVectorRecord, 'ownerId' | 'embeddingModel'> & {
  score: number;
};

type RelationQdrantClient = Pick<
  QdrantClient,
  'collectionExists' | 'createCollection' | 'getCollection' | 'createPayloadIndex' | 'upsert' | 'query' | 'delete'
>;

const PAYLOAD_INDEXES = [
  { field_name: 'owner_id', field_schema: 'uuid' as const },
  { field_name: 'rule_document_id', field_schema: 'uuid' as const },
  { field_name: 'rule_id', field_schema: 'uuid' as const },
  { field_name: 'embedding_model', field_schema: 'keyword' as const },
];

const BM25_OPTIONS = { language: 'none', tokenizer: 'multilingual' } as const;
const RELATION_INFERENCE_BATCH_SIZE = 8;

function collectionVectorSize(
  collection: Awaited<ReturnType<QdrantClient['getCollection']>>,
) {
  const vectors = collection.config.params.vectors;
  if (!vectors || typeof vectors !== 'object') return null;
  const vector = (vectors as Record<string, unknown>)[QDRANT_DENSE_VECTOR_NAME];
  if (!vector || typeof vector !== 'object' || !('size' in vector)) return null;
  return typeof vector.size === 'number' ? vector.size : null;
}

function collectionHasSparseVector(
  collection: Awaited<ReturnType<QdrantClient['getCollection']>>,
) {
  const sparseVectors = collection.config.params.sparse_vectors;
  return Boolean(
    sparseVectors
      && typeof sparseVectors === 'object'
      && QDRANT_SPARSE_VECTOR_NAME in sparseVectors,
  );
}

function deterministicUuid(seed: string) {
  const bytes = Buffer.from(createHash('sha256').update(seed).digest('hex').slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function relationInferenceText(record: Pick<RelationVectorRecord, 'statement'>) {
  return record.statement.trim();
}

function stringPayload(payload: Record<string, unknown> | null | undefined, key: string) {
  const found = payload?.[key];
  return typeof found === 'string' ? found : '';
}

export class QdrantRelationVectorStore {
  constructor(
    private readonly client: RelationQdrantClient,
    private readonly collectionName: string,
  ) {}

  async ensureCollection(vectorSize: number) {
    const { exists } = await this.client.collectionExists(this.collectionName);
    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: {
          [QDRANT_DENSE_VECTOR_NAME]: { size: vectorSize, distance: 'Cosine' },
        },
        sparse_vectors: {
          [QDRANT_SPARSE_VECTOR_NAME]: { modifier: 'idf' },
        },
        on_disk_payload: true,
      });
    }
    const collection = await this.client.getCollection(this.collectionName);
    const existingVectorSize = collectionVectorSize(collection);
    if (
      existingVectorSize !== vectorSize
      || !collectionHasSparseVector(collection)
    ) {
      throw new QdrantConfigurationError(
        existingVectorSize === null
          ? '관계 Qdrant Collection에 dense named vector가 없습니다.'
          : !collectionHasSparseVector(collection)
            ? '관계 Qdrant Collection에 BM25 sparse named vector가 없습니다.'
            : `관계 Qdrant Collection 차원(${existingVectorSize})이 임베딩 설정(${vectorSize})과 다릅니다.`,
      );
    }
    const schema = collection.payload_schema ?? {};
    await Promise.all(PAYLOAD_INDEXES.filter(({ field_name }) => !(field_name in schema)).map(
      (index) => this.client.createPayloadIndex(this.collectionName, { ...index, wait: true }),
    ));
  }

  async replaceRuleDocument(
    ownerId: string,
    ruleDocumentId: string,
    records: RelationVectorRecord[],
  ) {
    await this.deleteByRuleDocument(ownerId, ruleDocumentId);
    await this.upsertRecords(records);
  }

  async upsertRecords(records: RelationVectorRecord[]) {
    if (!records.length) return;
    try {
      for (let start = 0; start < records.length; start += RELATION_INFERENCE_BATCH_SIZE) {
        const batch = records.slice(start, start + RELATION_INFERENCE_BATCH_SIZE);
        await this.client.upsert(this.collectionName, {
          wait: true,
          points: batch.map((record) => {
            const text = relationInferenceText(record);
            return {
              id: deterministicUuid(record.id),
              vector: {
                [QDRANT_DENSE_VECTOR_NAME]: {
                  text: densePassageInferenceText(record.embeddingModel, text),
                  model: record.embeddingModel,
                },
                [QDRANT_SPARSE_VECTOR_NAME]: {
                  text,
                  model: QDRANT_BM25_MODEL,
                  options: BM25_OPTIONS,
                },
              },
              payload: {
                owner_id: record.ownerId,
                rule_id: record.id,
                rule_document_id: record.ruleDocumentId,
                rule_version_id: record.ruleVersionId,
                source_chunk_id: record.sourceChunkId,
                statement: record.statement,
                embedding_model: record.embeddingModel,
              },
            };
          }),
        });
      }
    } catch (error) {
      throw new QdrantInferenceError(
        'Qdrant Cloud Inference로 관계 임베딩을 생성하지 못했습니다.',
        { cause: error },
      );
    }
  }

  async deleteByRuleIds(ownerId: string, ruleIds: string[]) {
    if (!ruleIds.length) return;
    const { exists } = await this.client.collectionExists(this.collectionName);
    if (!exists) return;
    await this.client.delete(this.collectionName, {
      wait: true,
      ordering: 'strong',
      filter: { must: [
        { key: 'owner_id', match: { value: ownerId } },
        { key: 'rule_id', match: { any: [...new Set(ruleIds)] } },
      ] },
    });
  }

  async query(text: string, ownerId: string, embeddingModel: string, limit = 6) {
    const filter = { must: [
      { key: 'owner_id', match: { value: ownerId } },
      { key: 'embedding_model', match: { value: embeddingModel } },
    ] };
    const response = await this.client.query(this.collectionName, {
      prefetch: [
        {
          query: { text: denseQueryInferenceText(embeddingModel, text), model: embeddingModel },
          using: QDRANT_DENSE_VECTOR_NAME,
          filter,
          limit: Math.max(limit * 3, 20),
        },
        {
          query: { text, model: QDRANT_BM25_MODEL, options: BM25_OPTIONS },
          using: QDRANT_SPARSE_VECTOR_NAME,
          filter,
          limit: Math.max(limit * 3, 20),
        },
      ],
      query: { fusion: 'rrf' },
      filter,
      limit,
      with_payload: true,
    });
    return response.points.map((point): RelationVectorSearchResult => {
      const payload = point.payload as Record<string, unknown> | null | undefined;
      return {
        id: stringPayload(payload, 'rule_id'),
        score: point.score,
        ruleDocumentId: stringPayload(payload, 'rule_document_id'),
        ruleVersionId: stringPayload(payload, 'rule_version_id'),
        sourceChunkId: stringPayload(payload, 'source_chunk_id'),
        statement: stringPayload(payload, 'statement'),
      };
    });
  }

  async deleteByRuleDocument(ownerId: string, ruleDocumentId: string) {
    const { exists } = await this.client.collectionExists(this.collectionName);
    if (!exists) return;
    await this.client.delete(this.collectionName, {
      wait: true,
      ordering: 'strong',
      filter: { must: [
        { key: 'owner_id', match: { value: ownerId } },
        { key: 'rule_document_id', match: { value: ruleDocumentId } },
      ] },
    });
  }
}

let relationVectorStore: QdrantRelationVectorStore | null = null;

export function getQdrantRelationVectorStore() {
  if (relationVectorStore) return relationVectorStore;
  const configuration = getProviderConfiguration();
  relationVectorStore = new QdrantRelationVectorStore(
    new QdrantClient({
      url: requireServerEnvironment('QDRANT_URL'),
      apiKey: requireServerEnvironment('QDRANT_API_KEY'),
    }),
    configuration.qdrant.relationCollection,
  );
  return relationVectorStore;
}
