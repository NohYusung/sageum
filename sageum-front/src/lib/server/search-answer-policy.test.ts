import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceReference } from '@/lib/rag/local-search';
import type { AppliedRuleReference } from '@/lib/relations/types';
import {
  claudeAnswerPresentation,
  claudeFailurePresentation,
  extractiveAnswerPresentation,
} from './search-answer-policy';

function source(
  chunkId: string,
  documentTitle: string,
  metadata: Pick<SourceReference, 'retrievalRole' | 'ruleId' | 'pathId'> = {},
): SourceReference {
  return {
    documentId: `document-${chunkId}`,
    versionId: `version-${chunkId}`,
    documentTitle,
    chunkId,
    heading: '본문',
    snippet: `${documentTitle}의 검색 본문`,
    score: 0.5,
    sourceSpans: [],
    ...metadata,
  };
}

function appliedRule(
  ruleId: string,
  pathId: string,
  depth: 0 | 1,
): AppliedRuleReference {
  return {
    ruleId,
    ruleDocumentId: `document-${ruleId}`,
    ruleDocumentTitle: `규칙 ${ruleId}`,
    sourceChunkId: `chunk-${ruleId}`,
    statement: `규칙 문장 ${ruleId}`,
    score: 0.8,
    bindingDocumentIds: ['knowledge-document'],
    pathId,
    depth,
    ...(depth === 1 ? { parentRuleId: 'root' } : {}),
  };
}

test('Claude 성공 응답에는 검색 후보 전체가 아닌 실제 인용 근거만 노출한다', () => {
  const about = source('about', 'About');
  const settlement = source('settlement', '정산 데이터');
  const fallback = extractiveAnswerPresentation([about, settlement]);
  const result = claudeAnswerPresentation({
    answer: '노유성의 직업은 Software Engineer입니다.',
    sources: [about],
    insufficientEvidence: false,
  }, [about, settlement], []);

  assert.deepEqual(fallback.sources.map(({ chunkId }) => chunkId), ['about', 'settlement']);
  assert.deepEqual(result.sources.map(({ chunkId }) => chunkId), ['about']);
  assert.equal(result.answerMode, 'claude-platform-aws');
});

test('Claude가 선택한 복수 근거의 순서를 그대로 유지한다', () => {
  const second = source('second', '두 번째 문서');
  const first = source('first', '첫 번째 문서');
  const result = claudeAnswerPresentation({
    answer: '두 근거를 사용한 답변',
    sources: [second, first],
    insufficientEvidence: false,
  }, [second, first], []);

  assert.deepEqual(result.sources.map(({ chunkId }) => chunkId), ['second', 'first']);
});

test('근거 부족은 빈 근거를 유지하고 Claude 실패는 검색 후보 기반 fallback을 유지한다', () => {
  const candidate = source('candidate', '검색 후보');
  const insufficient = claudeAnswerPresentation({
    answer: '제공된 문서에서 질문에 답할 충분한 근거를 찾지 못했습니다.',
    sources: [],
    insufficientEvidence: true,
  }, [candidate], []);
  const failed = claudeFailurePresentation(extractiveAnswerPresentation([candidate]));

  assert.deepEqual(insufficient.sources, []);
  assert.deepEqual(failed.sources, [candidate]);
  assert.equal(failed.answerMode, 'extractive-fallback');
  assert.match(failed.answer, /^Claude 답변 생성에 실패하여/);
});

test('인용된 확장 근거와 같은 경로의 관계 규칙만 함께 노출한다', () => {
  const direct = source('direct', '직접 검색 문서', { retrievalRole: 'seed' });
  const rootRule = source('chunk-root', '신진하이텔 규칙', {
    retrievalRole: 'rule',
    ruleId: 'root',
  });
  const linkedRule = source('chunk-linked', '주소 규칙', {
    retrievalRole: 'rule',
    ruleId: 'linked',
  });
  const unusedRule = source('chunk-unused', '사용하지 않은 규칙', {
    retrievalRole: 'rule',
    ruleId: 'unused',
  });
  const expanded = source('expanded', '무상임대차 계약서', {
    retrievalRole: 'expanded',
    ruleId: 'linked',
    pathId: 'root:linked',
  });
  const unusedExpanded = source('unused-expanded', '사용하지 않은 확장 문서', {
    retrievalRole: 'expanded',
    ruleId: 'unused',
    pathId: 'unused:direct',
  });
  const result = claudeAnswerPresentation({
    answer: '신진하이텔의 구조는 철근콘크리트조입니다.',
    sources: [expanded],
    insufficientEvidence: false,
  }, [direct, rootRule, linkedRule, unusedRule, expanded, unusedExpanded], [
    appliedRule('root', 'root:linked', 0),
    appliedRule('linked', 'root:linked', 1),
    appliedRule('unused', 'unused:direct', 0),
  ]);

  assert.deepEqual(result.sources.map(({ chunkId }) => chunkId), [
    'chunk-root',
    'chunk-linked',
    'expanded',
  ]);
});

test('확장 근거를 인용하지 않은 직접 답변에는 검색된 관계 규칙을 추가하지 않는다', () => {
  const direct = source('direct', 'About', { retrievalRole: 'seed' });
  const rule = source('chunk-root', '관계 규칙', {
    retrievalRole: 'rule',
    ruleId: 'root',
  });
  const result = claudeAnswerPresentation({
    answer: '노유성의 직업은 Software Engineer입니다.',
    sources: [direct],
    insufficientEvidence: false,
  }, [direct, rule], [appliedRule('root', 'root:direct', 0)]);

  assert.deepEqual(result.sources.map(({ chunkId }) => chunkId), ['direct']);
});
