import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterSeedResultsForSemanticPaths,
  MIN_SEMANTIC_DOCUMENT_ROOT_SCORE,
  prioritizeSemanticPathCandidates,
  selectHybridRuleCandidates,
  selectSemanticRootCandidates,
} from './semantic-aware-repository-search';

test('질문과 일치한 규칙 경로를 점수가 높은 잡음 문서 경로보다 우선한다', () => {
  const selected = prioritizeSemanticPathCandidates([
    { id: 'noisy-document', rootNodeKind: 'document' as const, score: 0.9 },
    { id: 'relevant-rule', rootNodeKind: 'rule' as const, score: 0.4 },
    { id: 'second-rule', rootNodeKind: 'rule' as const, score: 0.3 },
  ]).slice(0, 2);
  assert.deepEqual(selected.map((path) => path.id), ['relevant-rule', 'second-rule']);
});

test('하이브리드 RRF 기준을 넘은 활성 규칙만 시작 규칙으로 선택한다', () => {
  const selected = selectHybridRuleCandidates([
    { id: 'hotel-rule', score: 0.5 },
    { id: 'noise-rule', score: 0.33333334 },
    { id: 'disabled-rule', score: 0.45 },
  ], [
    { id: 'hotel-rule', statement: '노유성이 사는 곳은 신진하이텔이다.' },
    { id: 'noise-rule', statement: '무관한 규칙' },
  ], 0.35);

  assert.deepEqual(selected, [{
    rule: { id: 'hotel-rule', statement: '노유성이 사는 곳은 신진하이텔이다.' },
    score: 0.5,
  }]);
});

test('활성 규칙이 있으면 더 높은 점수의 문서 Seed를 그래프 시작점에서 제외한다', () => {
  const selected = selectSemanticRootCandidates(
    [{ id: 'hotel-rule', score: 0.5 }],
    [{ id: 'noisy-document', score: 0.9 }],
    true,
  );
  assert.deepEqual(selected.map((root) => root.id), ['hotel-rule']);
});

test('규칙이 없을 때만 점수 0.5 이상의 문서 Seed를 의미 경로 시작점으로 사용한다', () => {
  const selected = selectSemanticRootCandidates([], [
    { id: 'weak', score: MIN_SEMANTIC_DOCUMENT_ROOT_SCORE - 0.01 },
    { id: 'strong', score: MIN_SEMANTIC_DOCUMENT_ROOT_SCORE },
  ], false);
  assert.deepEqual(selected.map((root) => root.id), ['strong']);
});

test('활성 규칙에 공통 의미 노드가 없으면 문서 Seed로 우회하지 않는다', () => {
  const selected = selectSemanticRootCandidates(
    [],
    [{ id: 'noisy-document', score: 0.9 }],
    true,
  );
  assert.deepEqual(selected, []);
});

test('규칙 경로가 성공하면 경로 문서와 0.5 초과 직접 근거만 Seed로 유지한다', () => {
  const selected = filterSeedResultsForSemanticPaths([
    { id: 'structure-noise', documentId: 'css-doc', score: 0.5 },
    { id: 'settlement-noise', documentId: 'settlement-doc', score: 0.33333334 },
    { id: 'path-seed', documentId: 'lease-doc', score: 0.25 },
    { id: 'strong-direct', documentId: 'about-doc', score: 0.6 },
  ], [
    { targetDocumentId: 'lease-doc' },
  ], true);

  assert.deepEqual(selected.map((seed) => seed.id), ['path-seed', 'strong-direct']);
});
