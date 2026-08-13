import assert from 'node:assert/strict';
import test from 'node:test';
import { QdrantRelationVectorStore } from './relation-vector-store';

function mockClient() {
  const calls: Array<{ method: string; payload?: unknown }> = [];
  return {
    calls,
    client: {
      collectionExists: async () => ({ exists: true }),
      getCollection: async () => ({
        config: { params: { vectors: { dense: { size: 384 } }, sparse_vectors: { bm25: {} } } },
        payload_schema: {
          owner_id: {}, rule_document_id: {}, rule_id: {}, embedding_model: {},
        },
      }),
      createCollection: async (_name: string, payload: unknown) => { calls.push({ method: 'create', payload }); return true; },
      createPayloadIndex: async (_name: string, payload: unknown) => { calls.push({ method: 'index', payload }); return true; },
      upsert: async (_name: string, payload: unknown) => { calls.push({ method: 'upsert', payload }); return { status: 'completed' }; },
      query: async (_name: string, payload: unknown) => { calls.push({ method: 'query', payload }); return { points: [] }; },
      delete: async (_name: string, payload: unknown) => { calls.push({ method: 'delete', payload }); return { status: 'completed' }; },
    },
  };
}

test('관계 벡터 payload와 삭제에 owner 필터를 항상 포함한다', async () => {
  const mocked = mockClient();
  const store = new QdrantRelationVectorStore(mocked.client as never, 'relations');
  await store.ensureCollection(384);
  await store.replaceRuleDocument('owner-id', 'rule-document-id', [{
    id: 'rule-id',
    ownerId: 'owner-id',
    ruleDocumentId: 'rule-document-id',
    ruleVersionId: 'rule-version-id',
    sourceChunkId: 'chunk-id',
    statement: '정글러는 갱킹을 잘해야 한다.',
    embeddingModel: 'intfloat/multilingual-e5-small',
  }]);
  const deleteCall = mocked.calls.find((call) => call.method === 'delete');
  const upsertCall = mocked.calls.find((call) => call.method === 'upsert');
  assert.match(JSON.stringify(deleteCall?.payload), /owner_id/);
  assert.match(JSON.stringify(upsertCall?.payload), /정글러는 갱킹을 잘해야 한다/);
  assert.doesNotMatch(JSON.stringify(upsertCall?.payload), /subject/);
  assert.match(JSON.stringify(upsertCall?.payload), /embedding_model/);
});

test('규칙 수정 스테이징은 문서 전체를 지우지 않고 새 포인트만 추가·선택 삭제한다', async () => {
  const mocked = mockClient();
  const store = new QdrantRelationVectorStore(mocked.client as never, 'relations');
  await store.upsertRecords([{
    id: 'new-rule-id',
    ownerId: 'owner-id',
    ruleDocumentId: 'rule-document-id',
    ruleVersionId: 'new-version-id',
    sourceChunkId: 'new-chunk-id',
    statement: '정글러는 갱킹을 잘해야 한다.',
    embeddingModel: 'intfloat/multilingual-e5-small',
  }]);
  await store.deleteByRuleIds('owner-id', ['old-rule-id']);

  assert.equal(mocked.calls.filter((call) => call.method === 'upsert').length, 1);
  const deletion = mocked.calls.find((call) => call.method === 'delete');
  assert.match(JSON.stringify(deletion?.payload), /owner_id/);
  assert.match(JSON.stringify(deletion?.payload), /old-rule-id/);
  assert.doesNotMatch(JSON.stringify(deletion?.payload), /rule_document_id/);
});
