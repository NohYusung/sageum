import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceReference } from '@/lib/rag/local-search';
import { groupRuleBindingsForExpansion } from './relation-aware-search';

test('관계 근거 역할 계약은 seed, rule, expanded만 허용한다', () => {
  const roles: Array<NonNullable<SourceReference['retrievalRole']>> = [
    'seed', 'rule', 'expanded',
  ];
  assert.deepEqual(roles, ['seed', 'rule', 'expanded']);
});

test('규칙 바인딩은 subject/object 없이 seed 문서와 나머지 문서를 1단계로 연결한다', () => {
  const rules = [{
    id: 'rule-1',
    rule_document_id: 'rule-document',
    rule_version_id: 'rule-version',
    source_chunk_id: 'rule-chunk',
    statement: '정글러는 갱킹을 잘해야 한다.',
    evidence_quote: '정글러는 갱킹을 잘해야 한다.',
    enabled: true,
  }];
  const bindings = [
    { rule_id: 'rule-1', document_id: 'document-a', version_id: 'version-a', chunk_id: 'chunk-a', chunk_text: '정글러 설명', vector_score: 0.82 },
    { rule_id: 'rule-1', document_id: 'document-b', version_id: 'version-b', chunk_id: 'chunk-b', chunk_text: '갱킹 방법', vector_score: 0.79 },
  ];
  const grouped = groupRuleBindingsForExpansion(
    rules,
    bindings,
    new Set(['document-a']),
    new Map([['document-a', 'version-a'], ['document-b', 'version-b']]),
  );
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0]?.seedBindings.map((binding) => binding.document_id), ['document-a']);
  assert.deepEqual(grouped[0]?.expandedBindings.map((binding) => binding.document_id), ['document-b']);
});

test('seed 문서가 같은 규칙의 바인딩에 없으면 관계를 적용하지 않는다', () => {
  const grouped = groupRuleBindingsForExpansion(
    [{
      id: 'rule-1', rule_document_id: 'rule-document', rule_version_id: 'rule-version',
      source_chunk_id: 'rule-chunk', statement: '규칙', evidence_quote: '규칙', enabled: true,
    }],
    [{
      rule_id: 'rule-1', document_id: 'document-b', version_id: 'version-b',
      chunk_id: 'chunk-b', chunk_text: '문서', vector_score: 0.8,
    }],
    new Set(['document-a']),
    new Map([['document-b', 'version-b']]),
  );
  assert.equal(grouped.length, 0);
});
