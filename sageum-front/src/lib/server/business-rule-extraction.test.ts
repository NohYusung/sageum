import assert from 'node:assert/strict';
import test from 'node:test';
import type { DocumentChunk } from '@/lib/rag/types';
import {
  RULE_EXTRACTION_SCHEMA,
  validateExtractedRuleCandidates,
  type ExtractedRuleCandidate,
} from './business-rule-extraction';

test('Claude 구조화 출력 스키마는 지원하지 않는 숫자 범위 키워드를 포함하지 않는다', () => {
  const confidence = RULE_EXTRACTION_SCHEMA.properties.rules.items.properties.confidence;
  assert.deepEqual(confidence, { type: 'number' });
});

const chunk: DocumentChunk = {
  id: 'chunk-rule',
  documentId: 'doc-rule',
  versionId: 'version-rule',
  ordinal: 0,
  text: '정글러는 갱킹을 잘해야 한다.',
  wordCount: 4,
  headingPath: [],
  blockStart: 0,
  blockEnd: 0,
  focusBlock: 0,
  location: {},
  sourceSpans: [],
};

const candidate: ExtractedRuleCandidate = {
  sourceChunkId: chunk.id,
  statement: chunk.text,
  evidenceQuote: chunk.text,
  confidence: 0.95,
};

test('규칙 원문 근거가 정확히 존재할 때 전체 문장을 검증한다', () => {
  const result = validateExtractedRuleCandidates([chunk], [candidate], 'model');
  assert.equal(result.rules.length, 1);
  assert.equal(result.rules[0]?.evidenceStartOffset, 0);
  assert.equal(result.rules[0]?.evidenceEndOffset, chunk.text.length);
});

test('원문에 없는 근거 인용문을 거부한다', () => {
  const result = validateExtractedRuleCandidates([chunk], [{ ...candidate, evidenceQuote: '없는 규칙' }], 'model');
  assert.equal(result.rules.length, 0);
  assert.match(result.rejectedReasons[0] ?? '', /정확한/);
});

test('deduplicates the same normalized rule', () => {
  const result = validateExtractedRuleCandidates([chunk], [candidate, candidate], 'model');
  assert.equal(result.rules.length, 1);
});

test('서버 검증에서 낮은 신뢰도의 규칙을 제외한다', () => {
  const result = validateExtractedRuleCandidates(
    [chunk],
    [{ ...candidate, confidence: 0.59 }],
    'model',
  );
  assert.equal(result.rules.length, 0);
  assert.match(result.rejectedReasons[0] ?? '', /신뢰도/);
});
