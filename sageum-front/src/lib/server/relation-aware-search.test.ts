import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceReference } from '@/lib/rag/local-search';
import {
  appliedRulesForRulePaths,
  buildRuleSearchPaths,
  filterSeedResultsForPaths,
  mergeExpandedResults,
  type StoredBinding,
  type StoredRule,
  type StoredRuleLink,
} from './relation-aware-search';
import type { VectorSearchResult } from './qdrant-store';

function rule(id: string): StoredRule {
  return {
    id,
    rule_document_id: `document-${id}`,
    rule_version_id: `version-${id}`,
    source_chunk_id: `chunk-${id}`,
    statement: `규칙 ${id}`,
    evidence_quote: `규칙 ${id}`,
    enabled: true,
  };
}

function binding(ruleId: string, documentId: string): StoredBinding {
  return {
    rule_id: ruleId,
    document_id: documentId,
    version_id: `version-${documentId}`,
    chunk_id: `anchor-${documentId}`,
    chunk_text: `앵커 ${documentId}`,
    vector_score: 0.8,
  };
}

test('관계 근거 역할 계약은 seed, rule, expanded만 허용한다', () => {
  const roles: Array<NonNullable<SourceReference['retrievalRole']>> = [
    'seed', 'rule', 'expanded',
  ];
  assert.deepEqual(roles, ['seed', 'rule', 'expanded']);
});

test('연결 경로가 없는 시작 규칙을 독립 사실 근거로 만든다', () => {
  const standalone = rule('standalone');
  const applied = appliedRulesForRulePaths(
    [{ rule: standalone, score: 0.93 }],
    [],
  );

  assert.deepEqual(applied, [{
    ruleId: 'standalone',
    ruleDocumentId: 'document-standalone',
    ruleDocumentTitle: '비즈니스 규칙',
    sourceChunkId: 'chunk-standalone',
    statement: '규칙 standalone',
    score: 0.93,
    bindingDocumentIds: [],
    pathId: 'rule:standalone:standalone',
    depth: 0,
  }]);
});

test('문서 경로에 포함된 규칙은 standalone 근거와 중복하지 않는다', () => {
  const root = rule('root');
  const linked = rule('linked');
  const unrelated = rule('unrelated');
  const applied = appliedRulesForRulePaths(
    [
      { rule: root, score: 0.95 },
      { rule: linked, score: 0.9 },
      { rule: unrelated, score: 0.85 },
    ],
    [{
      id: 'root:linked',
      score: 0.92,
      rootRule: root,
      linkedRule: linked,
      linkScore: 0.88,
      documentIds: ['knowledge-document'],
    }],
  );

  assert.deepEqual(applied.map(({ ruleId, pathId }) => ({ ruleId, pathId })), [
    { ruleId: 'root', pathId: 'root:linked' },
    { ruleId: 'linked', pathId: 'root:linked' },
    { ruleId: 'unrelated', pathId: 'rule:unrelated:standalone' },
  ]);
});

test('문서·폴더 범위 검색에서는 범위 문서 경로가 없는 standalone 규칙을 제외한다', () => {
  const root = rule('scoped-out');
  const applied = appliedRulesForRulePaths(
    [{ rule: root, score: 0.95 }],
    [],
    false,
  );

  assert.deepEqual(applied, []);
});

test('직접 문서 근거가 없어도 시작 규칙에서 연결 규칙의 문서 경로를 만든다', () => {
  const root = rule('rule-b');
  const linked = rule('rule-a');
  const links: StoredRuleLink[] = [{
    id: 'link',
    left_rule_id: 'rule-a',
    right_rule_id: 'rule-b',
    vector_score: 0.91,
  }];
  const paths = buildRuleSearchPaths(
    [{ rule: root, score: 0.95 }],
    [linked],
    links,
    [binding('rule-a', 'contract-document')],
  );
  assert.equal(paths.length, 1);
  assert.equal(paths[0]?.rootRule.id, 'rule-b');
  assert.equal(paths[0]?.linkedRule?.id, 'rule-a');
  assert.deepEqual(paths[0]?.documentIds, ['contract-document']);
});

test('규칙 경로는 저장된 연결 한 단계까지만 만들고 최대 두 개로 제한한다', () => {
  const root = rule('root');
  const linkedA = rule('linked-a');
  const linkedB = rule('linked-b');
  const secondHop = rule('second-hop');
  const links: StoredRuleLink[] = [
    { id: '1', left_rule_id: 'linked-a', right_rule_id: 'root', vector_score: 0.9 },
    { id: '2', left_rule_id: 'linked-b', right_rule_id: 'root', vector_score: 0.8 },
    { id: '3', left_rule_id: 'linked-a', right_rule_id: 'second-hop', vector_score: 0.99 },
  ];
  const paths = buildRuleSearchPaths(
    [{ rule: root, score: 0.95 }],
    [linkedA, linkedB, secondHop],
    links,
    [
      binding('root', 'direct-document'),
      binding('linked-a', 'document-a'),
      binding('linked-b', 'document-b'),
      binding('second-hop', 'must-not-expand'),
    ],
  );
  assert.equal(paths.length, 2);
  assert.ok(paths.every((path) => path.rootRule.id === 'root'));
  assert.ok(!paths.some((path) => path.linkedRule?.id === 'second-hop'));
});

test('순환 또는 자기 연결은 경로를 중복 생성하지 않는다', () => {
  const root = rule('root');
  const linked = rule('linked');
  const paths = buildRuleSearchPaths(
    [{ rule: root, score: 0.9 }],
    [linked],
    [
      { id: 'same', left_rule_id: 'root', right_rule_id: 'root', vector_score: 1 },
      { id: 'valid', left_rule_id: 'linked', right_rule_id: 'root', vector_score: 0.8 },
    ],
    [binding('linked', 'document-a')],
  );
  assert.equal(paths.length, 1);
  assert.equal(paths[0]?.linkedRule?.id, 'linked');
});

test('같은 확장 청크는 최고 점수 결과의 관계 경로를 보존한다', () => {
  const lowRule = rule('low-rule');
  const highRule = rule('high-rule');
  const result = (score: number): VectorSearchResult => ({
    id: `result-${score}`,
    score,
    documentId: 'contract-document',
    versionId: 'contract-version',
    chunkId: 'structure-chunk',
    documentTitle: '무상임대차 계약서',
    sourceType: 'pdf',
    ordinal: 3,
    text: '구조는 철근콘크리트조이다.',
    headingPath: ['건물 정보'],
    sourceSpans: [],
  });
  const expanded = mergeExpandedResults([
    {
      path: {
        id: 'low-path',
        score: 0.7,
        rootRule: lowRule,
        documentIds: ['contract-document'],
      },
      results: [result(0.6)],
    },
    {
      path: {
        id: 'high-path',
        score: 0.9,
        rootRule: highRule,
        documentIds: ['contract-document'],
      },
      results: [result(0.9)],
    },
  ], new Set());

  assert.equal(expanded.length, 1);
  assert.equal(expanded[0]?.ruleId, 'high-rule');
  assert.equal(expanded[0]?.pathId, 'high-path');
});

test('관계 경로가 성공하면 RRF 단일 모달리티 잡음 seed를 경로 밖에서 제외한다', () => {
  const base = (documentId: string, score: number): VectorSearchResult => ({
    id: documentId,
    score,
    documentId,
    versionId: `version-${documentId}`,
    chunkId: `chunk-${documentId}`,
    documentTitle: documentId,
    sourceType: 'md',
    ordinal: 0,
    text: documentId,
    headingPath: [],
    sourceSpans: [],
  });
  const root = rule('root');
  const paths = [{
    path: {
      id: 'path',
      score: 0.9,
      rootRule: root,
      documentIds: ['path-document'],
    },
    results: [base('path-document', 0.5)],
  }];
  const filtered = filterSeedResultsForPaths([
    base('noisy-document', 0.5),
    base('path-document', 0.5),
    base('strong-direct-document', 1),
  ], paths);
  assert.deepEqual(filtered.map((result) => result.documentId), [
    'path-document',
    'strong-direct-document',
  ]);
});
