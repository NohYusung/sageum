import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateSemanticLinkCandidates,
  canonicalSemanticNodePair,
  MAX_SEMANTIC_NODE_SEGMENTS,
  selectSemanticRepresentativeChunks,
  semanticNodeId,
  semanticPairScoreFloor,
  semanticPointId,
  type SemanticNodeSegment,
  type SemanticSegmentMatch,
} from './model';

function segment(index: number): SemanticNodeSegment {
  const nodeId = semanticNodeId('document', 'source');
  const id = `source-${index}`;
  return {
    id,
    text: `본문 ${index}`,
    ordinal: index,
    headingPath: index % 3 === 0 ? [`제목 ${index / 3}`] : [],
    pointId: semanticPointId(nodeId, id),
    ownerId: '00000000-0000-4000-8000-000000000001',
    nodeId,
    nodeKind: 'document',
    documentId: '00000000-0000-4000-8000-000000000002',
    versionId: '00000000-0000-4000-8000-000000000003',
    embeddingModel: 'intfloat/multilingual-e5-small',
    segmentCount: 12,
  };
}

test('대표 청크는 결정적이며 첫·마지막을 포함하고 12개를 넘지 않는다', () => {
  const chunks = Array.from({ length: 30 }, (_, index) => segment(index));
  const first = selectSemanticRepresentativeChunks(chunks);
  const second = selectSemanticRepresentativeChunks([...chunks].reverse());
  assert.equal(first.length, MAX_SEMANTIC_NODE_SEGMENTS);
  assert.deepEqual(first.map((chunk) => chunk.id), second.map((chunk) => chunk.id));
  assert.equal(first[0].id, 'source-0');
  assert.equal(first.at(-1)?.id, 'source-29');
});

test('canonical pair는 방향과 무관하고 자기 연결은 거부한다', () => {
  assert.deepEqual(canonicalSemanticNodePair('a', 'b'), ['a', 'b']);
  assert.deepEqual(canonicalSemanticNodePair('b', 'a'), ['a', 'b']);
  assert.equal(canonicalSemanticNodePair('a', 'a'), null);
});

test('후보 점수 하한은 커버리지 가중치를 제외한 값으로 역산한다', () => {
  assert.ok(Math.abs(semanticPairScoreFloor(0.35) - 0.1875) < Number.EPSILON);
  assert.equal(semanticPairScoreFloor(0.2), 0);
  assert.equal(semanticPairScoreFloor(1), 1);
});

test('청크 쌍은 양쪽 중복 없이 최대 3개를 사용해 점수와 커버리지를 집계한다', () => {
  const sourceNodeId = semanticNodeId('document', 'source');
  const targetNodeId = semanticNodeId('document', 'target');
  const matches: SemanticSegmentMatch[] = [
    [0, 'target-0', 0.94],
    [0, 'target-1', 0.93],
    [1, 'target-1', 0.925],
    [2, 'target-2', 0.91],
  ].map(([sourceIndex, targetChunkId, rawScore]) => ({
    source: segment(sourceIndex as number),
    targetPointId: `point-${targetChunkId}`,
    targetNodeId,
    targetNodeKind: 'document',
    targetDocumentId: '00000000-0000-4000-8000-000000000004',
    targetVersionId: '00000000-0000-4000-8000-000000000005',
    targetChunkId: String(targetChunkId),
    targetSegmentCount: 3,
    rawScore: rawScore as number,
  }));
  const [candidate] = aggregateSemanticLinkCandidates(
    sourceNodeId,
    3,
    'intfloat/multilingual-e5-small',
    matches,
    0.2,
  );
  assert.ok(candidate);
  assert.equal(candidate.matchedPairCount, 3);
  assert.equal(candidate.coverageScore, 1);
  assert.equal(new Set(candidate.evidence.map((item) => item.leftChunkId)).size, 3);
  assert.equal(new Set(candidate.evidence.map((item) => item.rightChunkId)).size, 3);
  assert.ok(candidate.semanticScore >= 0.2 && candidate.semanticScore <= 1);
});
