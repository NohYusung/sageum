import assert from 'node:assert/strict';
import test from 'node:test';
import { prioritizeSemanticPathCandidates } from './semantic-aware-repository-search';

test('질문과 일치한 규칙 경로를 점수가 높은 잡음 문서 경로보다 우선한다', () => {
  const selected = prioritizeSemanticPathCandidates([
    { id: 'noisy-document', rootNodeKind: 'document' as const, score: 0.9 },
    { id: 'relevant-rule', rootNodeKind: 'rule' as const, score: 0.4 },
    { id: 'second-rule', rootNodeKind: 'rule' as const, score: 0.3 },
  ]).slice(0, 2);
  assert.deepEqual(selected.map((path) => path.id), ['relevant-rule', 'second-rule']);
});
