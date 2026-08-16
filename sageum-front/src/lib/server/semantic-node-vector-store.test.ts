import assert from 'node:assert/strict';
import test from 'node:test';
import {
  semanticNodeId,
  semanticPointId,
  type SemanticNodeSegment,
} from '@/lib/semantic-graph/model';
import {
  QdrantSemanticNodeVectorStore,
  retryTransientQdrant,
} from './semantic-node-vector-store';

test('Qdrant 5xx는 제한 횟수만 재시도하고 성공 결과를 반환한다', async () => {
  let attempts = 0;
  const result = await retryTransientQdrant(async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error('Internal Server Error'), { status: 500 });
    return 'ok';
  }, [0, 0]);
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('의미 링크 후보는 source point 재사용 대신 query 임베딩으로 passage 노드를 검색한다', async () => {
  const requests: unknown[] = [];
  const client = {
    query: async (_collection: string, request: unknown) => {
      requests.push(request);
      return { points: [] };
    },
  } as unknown as ConstructorParameters<typeof QdrantSemanticNodeVectorStore>[0];
  const nodeId = semanticNodeId('rule', 'rule-1');
  const segment: SemanticNodeSegment = {
    id: 'chunk-1',
    text: '노유성이 사는 곳은 신진하이텔이다.',
    ordinal: 0,
    headingPath: [],
    pointId: semanticPointId(nodeId, 'chunk-1'),
    ownerId: '123e4567-e89b-42d3-a456-426614174000',
    nodeId,
    nodeKind: 'rule',
    ruleId: '123e4567-e89b-42d3-a456-426614174001',
    versionId: '123e4567-e89b-42d3-a456-426614174002',
    embeddingModel: 'intfloat/multilingual-e5-small',
    segmentCount: 1,
  };

  const store = new QdrantSemanticNodeVectorStore(client, 'semantic_nodes');
  await store.querySimilarSegments([segment], 0.1875);

  const request = requests[0] as {
    query: { text: string; model: string };
    score_threshold: number;
  };
  assert.match(request.query.text, /^query: 노유성이 사는 곳은 신진하이텔이다\.$/u);
  assert.equal(request.query.model, segment.embeddingModel);
  assert.ok(request.score_threshold > 0.85);
});
