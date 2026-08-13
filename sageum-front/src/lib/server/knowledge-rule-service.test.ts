import assert from 'node:assert/strict';
import test from 'node:test';
import { semanticBindingsFromCandidates } from './knowledge-rule-service';

test('semanticBindingsFromCandidates는 최신 청크를 의미 유사도 순서대로 최대 20개 유지한다', () => {
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
  const bindings = semanticBindingsFromCandidates(
    { id: 'rule-1' },
    candidates,
    latest,
  );
  assert.equal(bindings.length, 20);
  assert.ok(bindings.every((binding) => binding.chunk_text.startsWith('정글러와 갱킹')));
  assert.ok(!bindings.some((binding) => binding.document_id === 'document-0'));
});
