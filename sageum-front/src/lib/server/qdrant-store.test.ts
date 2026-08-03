import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DocumentChunk } from '@/lib/rag/types';
import {
  QdrantConfigurationError,
  QdrantVectorStore,
  type QdrantClientAdapter,
} from './qdrant-store';

function fakeClient(vectorSize = 3) {
  let exists = false;
  const payloadSchema: Record<string, object> = {};
  const createdIndexes: string[] = [];
  const upserts: unknown[] = [];
  const queries: unknown[] = [];
  const deletions: unknown[] = [];

  const client = {
    collectionExists: async () => ({ exists }),
    createCollection: async () => {
      exists = true;
      return true;
    },
    getCollection: async () => ({
      config: {
        params: {
          vectors: { dense: { size: vectorSize, distance: 'Cosine' } },
          sparse_vectors: { bm25: { modifier: 'idf' } },
        },
      },
      payload_schema: payloadSchema,
    }),
    createPayloadIndex: async (_collection: string, input: { field_name: string }) => {
      createdIndexes.push(input.field_name);
      payloadSchema[input.field_name] = {};
      return {};
    },
    upsert: async (_collection: string, input: unknown) => {
      upserts.push(input);
      return {};
    },
    query: async (_collection: string, input: unknown) => {
      queries.push(input);
      return {
        points: [{
          id: 'point-id',
          score: 0.91,
          payload: {
            document_id: '123e4567-e89b-42d3-a456-426614174000',
            version_id: '123e4567-e89b-42d3-a456-426614174001',
            chunk_id: 'chunk-1',
            document_title: '운영 가이드',
            source_type: 'pdf',
            ordinal: 0,
            text: '재택근무는 주 2회 가능합니다.',
            heading_path: ['신청 기준'],
            page: 2,
            cell_range: 'A1:B2',
          },
        }],
      };
    },
    delete: async (_collection: string, input: unknown) => {
      deletions.push(input);
      return {};
    },
  } as unknown as QdrantClientAdapter;

  return { client, createdIndexes, upserts, queries, deletions };
}

const CHUNK: DocumentChunk = {
  id: 'chunk-1',
  documentId: '123e4567-e89b-42d3-a456-426614174000',
  versionId: '123e4567-e89b-42d3-a456-426614174001',
  ordinal: 0,
  text: '재택근무는 주 2회 가능합니다.',
  wordCount: 4,
  headingPath: ['신청 기준'],
  blockStart: 0,
  blockEnd: 0,
  focusBlock: 0,
  location: { page: 2, cellRange: 'A1:B2' },
};

test('Collection과 필터 payload index를 벡터 저장 전에 준비한다', async () => {
  const fake = fakeClient();
  const store = new QdrantVectorStore(fake.client, 'document_chunks');

  await store.ensureCollection(3);
  assert.deepEqual(fake.createdIndexes, [
    'owner_id',
    'document_id',
    'version_id',
    'source_type',
    'embedding_model',
  ]);
});

test('기존 Collection 차원이 다르면 색인을 거부한다', async () => {
  const fake = fakeClient(4);
  await fake.client.createCollection('document_chunks', {
    vectors: { dense: { size: 4, distance: 'Cosine' } },
    sparse_vectors: { bm25: { modifier: 'idf' } },
  });
  const store = new QdrantVectorStore(fake.client, 'document_chunks');

  await assert.rejects(
    () => store.ensureCollection(3),
    (error: unknown) => error instanceof QdrantConfigurationError && /차원/u.test(error.message),
  );
});

test('청크 위치를 payload로 저장하고 소유자·문서 필터로 검색한다', async () => {
  const fake = fakeClient();
  const store = new QdrantVectorStore(fake.client, 'document_chunks');
  await store.ensureCollection(3);
  await store.upsert([{
    chunk: CHUNK,
    ownerId: '123e4567-e89b-42d3-a456-426614174010',
    sourceType: 'pdf',
    documentTitle: '운영 가이드',
    embeddingModel: 'intfloat/multilingual-e5-small',
  }]);
  const upsert = fake.upserts[0] as {
    points: Array<{
      vector: Record<string, { text: string; model: string; options?: Record<string, unknown> }>;
      payload: Record<string, unknown>;
    }>;
  };
  assert.equal(upsert.points[0].payload.page, 2);
  assert.equal(upsert.points[0].payload.cell_range, 'A1:B2');
  assert.equal(upsert.points[0].payload.focus_block, 0);
  assert.equal(
    upsert.points[0].vector.dense.model,
    'intfloat/multilingual-e5-small',
  );
  assert.match(
    upsert.points[0].vector.dense.text,
    /^passage: 운영 가이드.*신청 기준.*재택근무/su,
  );
  assert.match(upsert.points[0].vector.bm25.text, /^운영 가이드.*신청 기준.*재택근무/su);
  assert.equal(upsert.points[0].vector.bm25.model, 'qdrant/bm25');
  assert.equal(upsert.points[0].vector.bm25.options?.tokenizer, 'multilingual');

  const results = await store.query(
    '재택근무 기준',
    '123e4567-e89b-42d3-a456-426614174010',
    {
      documentIds: [CHUNK.documentId],
      limit: 8,
      scoreThreshold: 0.45,
      embeddingModel: 'intfloat/multilingual-e5-small',
    },
  );
  const query = fake.queries[0] as {
    filter: { must: Array<{ key: string }> };
    prefetch: Array<{
      using: string;
      query: { text: string; model: string; options?: Record<string, unknown> };
    }>;
    query: { fusion: string };
    limit: number;
    score_threshold: number;
  };
  assert.deepEqual(
    query.filter.must.map((condition) => condition.key),
    ['owner_id', 'embedding_model', 'document_id'],
  );
  assert.equal(query.limit, 8);
  assert.equal(query.score_threshold, 0.45);
  assert.deepEqual(query.prefetch.map(({ using }) => using), ['dense', 'bm25']);
  assert.equal(query.prefetch[0].query.text, 'query: 재택근무 기준');
  assert.equal(query.prefetch[1].query.text, '재택근무 기준');
  assert.equal(query.prefetch[1].query.options?.tokenizer, 'multilingual');
  assert.equal(query.query.fusion, 'rrf');
  assert.equal(results[0].documentTitle, '운영 가이드');
  assert.equal(results[0].page, 2);
});

test('버전 삭제에도 owner_id 필터를 항상 포함한다', async () => {
  const fake = fakeClient();
  const store = new QdrantVectorStore(fake.client, 'document_chunks');
  await store.ensureCollection(3);
  await store.deleteByVersion(
    '123e4567-e89b-42d3-a456-426614174010',
    '123e4567-e89b-42d3-a456-426614174001',
  );

  const deletion = fake.deletions[0] as {
    filter: { must: Array<{ key: string }> };
    ordering: string;
    wait: boolean;
  };
  assert.deepEqual(deletion.filter.must.map((condition) => condition.key), ['owner_id', 'version_id']);
  assert.equal(deletion.wait, true);
  assert.equal(deletion.ordering, 'strong');
});
