import { QdrantClient } from '@qdrant/js-client-rest';
import {
  rawSemanticScoreThreshold,
  type SemanticNodeKind,
  type SemanticNodeSegment,
  type SemanticSegmentMatch,
} from '@/lib/semantic-graph/model';
import { getProviderConfiguration, requireServerEnvironment } from './env';
import {
  densePassageInferenceText,
  denseQueryInferenceText,
  QDRANT_DENSE_VECTOR_NAME,
  QdrantConfigurationError,
  QdrantInferenceError,
} from './qdrant-store';

type SemanticQdrantClient = Pick<
  QdrantClient,
  'collectionExists' | 'createCollection' | 'getCollection' | 'createPayloadIndex' | 'upsert' | 'query' | 'delete'
>;

export type SemanticRuleSearchResult = {
  nodeId: string;
  ruleId: string;
  versionId: string;
  chunkId: string;
  statement: string;
  score: number;
};

const PAYLOAD_INDEXES = [
  { field_name: 'owner_id', field_schema: 'uuid' as const },
  { field_name: 'node_id', field_schema: 'uuid' as const },
  { field_name: 'node_kind', field_schema: 'keyword' as const },
  { field_name: 'document_id', field_schema: 'uuid' as const },
  { field_name: 'rule_id', field_schema: 'uuid' as const },
  { field_name: 'rule_document_id', field_schema: 'uuid' as const },
  { field_name: 'version_id', field_schema: 'uuid' as const },
  { field_name: 'embedding_model', field_schema: 'keyword' as const },
];
const INFERENCE_BATCH_SIZE = 8;
const QUERY_INFERENCE_CONCURRENCY = 3;
const TRANSIENT_RETRY_DELAYS_MS = [250, 750];

function transientQdrantError(error: unknown) {
  const status = typeof error === 'object' && error !== null
    ? ('status' in error && typeof error.status === 'number'
        ? error.status
        : 'response' in error
          && typeof error.response === 'object'
          && error.response !== null
          && 'status' in error.response
          && typeof error.response.status === 'number'
            ? error.response.status
            : null)
    : null;
  if (status === 429 || (status !== null && status >= 500)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /internal server error|fetch failed|econnreset|etimedout|timeout/iu.test(message);
}

export async function retryTransientQdrant<T>(
  operation: () => Promise<T>,
  retryDelaysMs = TRANSIENT_RETRY_DELAYS_MS,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delay = retryDelaysMs[attempt];
      if (delay === undefined || !transientQdrantError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
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
  if (!vectors || typeof vectors !== 'object') return null;
  const vector = (vectors as Record<string, unknown>)[QDRANT_DENSE_VECTOR_NAME];
  if (!vector || typeof vector !== 'object' || !('size' in vector)) return null;
  return typeof vector.size === 'number' ? vector.size : null;
}

function segmentInferenceText(segment: SemanticNodeSegment) {
  return [segment.headingPath.join(' › '), segment.text.trim()].filter(Boolean).join('\n');
}

export class QdrantSemanticNodeVectorStore {
  constructor(
    private readonly client: SemanticQdrantClient,
    private readonly collectionName: string,
  ) {}

  async ensureCollection(vectorSize: number) {
    const { exists } = await this.client.collectionExists(this.collectionName);
    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: { [QDRANT_DENSE_VECTOR_NAME]: { size: vectorSize, distance: 'Cosine' } },
        on_disk_payload: true,
      });
    }
    const collection = await this.client.getCollection(this.collectionName);
    const existingSize = collectionVectorSize(collection);
    if (existingSize !== vectorSize) {
      throw new QdrantConfigurationError(
        existingSize === null
          ? '공통 의미 Qdrant Collection에 dense named vector가 없습니다.'
          : `공통 의미 Qdrant Collection 차원(${existingSize})이 임베딩 설정(${vectorSize})과 다릅니다.`,
      );
    }
    const schema = collection.payload_schema ?? {};
    await Promise.all(PAYLOAD_INDEXES.filter(({ field_name }) => !(field_name in schema)).map(
      (index) => this.client.createPayloadIndex(this.collectionName, { ...index, wait: true }),
    ));
  }

  async replaceNode(segments: SemanticNodeSegment[], ruleDocumentId?: string) {
    const first = segments[0];
    if (!first) return;
    await this.deleteByNode(first.ownerId, first.nodeId);
    try {
      for (let start = 0; start < segments.length; start += INFERENCE_BATCH_SIZE) {
        const batch = segments.slice(start, start + INFERENCE_BATCH_SIZE);
        await retryTransientQdrant(() => this.client.upsert(this.collectionName, {
          wait: true,
          points: batch.map((segment) => ({
            id: segment.pointId,
            vector: {
              [QDRANT_DENSE_VECTOR_NAME]: {
                text: densePassageInferenceText(segment.embeddingModel, segmentInferenceText(segment)),
                model: segment.embeddingModel,
              },
            },
            payload: {
              owner_id: segment.ownerId,
              node_id: segment.nodeId,
              node_kind: segment.nodeKind,
              document_id: segment.documentId,
              rule_id: segment.ruleId,
              rule_document_id: ruleDocumentId,
              version_id: segment.versionId,
              chunk_id: segment.id,
              text: segment.text,
              heading_path: segment.headingPath,
              ordinal: segment.ordinal,
              segment_count: segment.segmentCount,
              embedding_model: segment.embeddingModel,
            },
          })),
        }));
      }
    } catch (error) {
      throw new QdrantInferenceError('공통 의미 노드 임베딩을 생성하지 못했습니다.', { cause: error });
    }
  }

  async querySimilarSegments(
    segments: SemanticNodeSegment[],
    scoreThreshold: number,
    limitPerSegment = 30,
  ): Promise<SemanticSegmentMatch[]> {
    if (!segments.length) return [];
    const first = segments[0];
    const rawThreshold = rawSemanticScoreThreshold(first.embeddingModel, scoreThreshold);
    const responses: SemanticSegmentMatch[][] = [];
    for (let start = 0; start < segments.length; start += QUERY_INFERENCE_CONCURRENCY) {
      const batch = segments.slice(start, start + QUERY_INFERENCE_CONCURRENCY);
      responses.push(...await Promise.all(batch.map(async (source) => {
        const response = await retryTransientQdrant(() => this.client.query(this.collectionName, {
          query: {
            text: denseQueryInferenceText(
              source.embeddingModel,
              segmentInferenceText(source),
            ),
            model: source.embeddingModel,
          },
          using: QDRANT_DENSE_VECTOR_NAME,
          filter: {
            must: [
              { key: 'owner_id', match: { value: source.ownerId } },
              { key: 'embedding_model', match: { value: source.embeddingModel } },
            ],
            must_not: [{ key: 'node_id', match: { value: source.nodeId } }],
          },
          limit: limitPerSegment,
          score_threshold: rawThreshold,
          with_payload: true,
        }));
        return response.points.map((point): SemanticSegmentMatch => {
          const payload = point.payload as Record<string, unknown> | null | undefined;
          return {
            source,
            targetPointId: String(point.id),
            targetNodeId: stringPayload(payload, 'node_id'),
            targetNodeKind: stringPayload(payload, 'node_kind') as SemanticNodeKind,
            targetDocumentId: stringPayload(payload, 'document_id') || undefined,
            targetRuleId: stringPayload(payload, 'rule_id') || undefined,
            targetVersionId: stringPayload(payload, 'version_id'),
            targetChunkId: stringPayload(payload, 'chunk_id'),
            targetSegmentCount: Math.max(1, numberPayload(payload, 'segment_count')),
            rawScore: point.score,
          };
        });
      })));
    }
    return responses.flat();
  }

  async queryRules(
    text: string,
    ownerId: string,
    embeddingModel: string,
    scoreThreshold: number,
    limit = 8,
  ): Promise<SemanticRuleSearchResult[]> {
    const response = await retryTransientQdrant(() => this.client.query(this.collectionName, {
      query: { text: denseQueryInferenceText(embeddingModel, text), model: embeddingModel },
      using: QDRANT_DENSE_VECTOR_NAME,
      filter: { must: [
        { key: 'owner_id', match: { value: ownerId } },
        { key: 'node_kind', match: { value: 'rule' } },
        { key: 'embedding_model', match: { value: embeddingModel } },
      ] },
      limit,
      score_threshold: rawSemanticScoreThreshold(embeddingModel, scoreThreshold),
      with_payload: true,
    }));
    return response.points.map((point) => {
      const payload = point.payload as Record<string, unknown> | null | undefined;
      return {
        nodeId: stringPayload(payload, 'node_id'),
        ruleId: stringPayload(payload, 'rule_id'),
        versionId: stringPayload(payload, 'version_id'),
        chunkId: stringPayload(payload, 'chunk_id'),
        statement: stringPayload(payload, 'text'),
        score: point.score,
      };
    }).filter((result) => result.nodeId && result.ruleId);
  }

  async deleteByNode(ownerId: string, nodeId: string) {
    await this.deleteByFilter(ownerId, { key: 'node_id', match: { value: nodeId } });
  }

  async deleteByDocument(ownerId: string, documentId: string) {
    await this.deleteByFilter(ownerId, { key: 'document_id', match: { value: documentId } });
  }

  async deleteByRuleDocument(ownerId: string, documentId: string) {
    await this.deleteByFilter(ownerId, { key: 'rule_document_id', match: { value: documentId } });
  }

  private async deleteByFilter(ownerId: string, condition: Record<string, unknown>) {
    const { exists } = await this.client.collectionExists(this.collectionName);
    if (!exists) return;
    await this.client.delete(this.collectionName, {
      wait: true,
      ordering: 'strong',
      filter: { must: [{ key: 'owner_id', match: { value: ownerId } }, condition] },
    });
  }
}

let semanticStore: QdrantSemanticNodeVectorStore | null = null;

export function getQdrantSemanticNodeVectorStore() {
  if (semanticStore) return semanticStore;
  const configuration = getProviderConfiguration();
  semanticStore = new QdrantSemanticNodeVectorStore(
    new QdrantClient({
      url: requireServerEnvironment('QDRANT_URL'),
      apiKey: requireServerEnvironment('QDRANT_API_KEY'),
    }),
    configuration.qdrant.semanticNodeCollection,
  );
  return semanticStore;
}
