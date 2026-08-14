import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calibratedRuleLinkScore,
  canonicalRulePair,
  semanticBindingsFromCandidates,
} from './knowledge-rule-service';

test('semanticBindingsFromCandidates는 문서별 최고 앵커 하나를 최대 20개 유지한다', () => {
  const candidates = Array.from({ length: 24 }, (_, index) => ({
    id: index,
    score: 0.9 - index * 0.01,
    documentId: `document-${index}`,
    versionId: `version-${index}`,
    chunkId: `chunk-${index}`,
    documentTitle: '문서',
    sourceType: 'md',
    ordinal: index,
    text: `정글러와 갱킹 관련 문서 ${index}`,
    headingPath: [],
    sourceSpans: [],
  }));
  const latest = new Map(candidates.map((candidate) => [candidate.documentId, candidate.versionId]));
  latest.set('document-0', 'stale-version');
  candidates.splice(2, 0, {
    ...candidates[1],
    id: 99,
    score: 0.2,
    chunkId: 'lower-score-same-document',
  });
  const bindings = semanticBindingsFromCandidates(
    { id: 'rule-1' },
    candidates,
    latest,
  );
  assert.equal(bindings.length, 20);
  assert.ok(bindings.every((binding) => binding.chunk_text.startsWith('정글러와 갱킹')));
  assert.ok(!bindings.some((binding) => binding.document_id === 'document-0'));
  assert.equal(bindings.filter((binding) => binding.document_id === 'document-1').length, 1);
  assert.equal(bindings.find((binding) => binding.document_id === 'document-1')?.chunk_id, 'chunk-1');
});

test('multilingual-e5 규칙 점수는 높은 cosine 공통 기준선을 제거해 보정한다', () => {
  assert.equal(calibratedRuleLinkScore(0.85, 'intfloat/multilingual-e5-small'), 0);
  assert.ok(calibratedRuleLinkScore(0.91, 'intfloat/multilingual-e5-small') > 0.35);
  assert.ok(calibratedRuleLinkScore(0.86, 'intfloat/multilingual-e5-small') < 0.35);
  assert.equal(calibratedRuleLinkScore(0.6, 'another-model'), 0.6);
});

test('canonicalRulePair는 방향과 무관한 정렬 쌍을 만들고 자기 연결을 제외한다', () => {
  assert.deepEqual(canonicalRulePair('rule-b', 'rule-a'), ['rule-a', 'rule-b']);
  assert.deepEqual(canonicalRulePair('rule-a', 'rule-b'), ['rule-a', 'rule-b']);
  assert.equal(canonicalRulePair('rule-a', 'rule-a'), null);
});
