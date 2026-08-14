import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceReference } from '@/lib/rag/local-search';
import {
  claudeAnswerPresentation,
  claudeFailurePresentation,
  extractiveAnswerPresentation,
} from './search-answer-policy';

function source(chunkId: string, documentTitle: string): SourceReference {
  return {
    documentId: `document-${chunkId}`,
    versionId: `version-${chunkId}`,
    documentTitle,
    chunkId,
    heading: '본문',
    snippet: `${documentTitle}의 검색 본문`,
    score: 0.5,
    sourceSpans: [],
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
  });

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
  });

  assert.deepEqual(result.sources.map(({ chunkId }) => chunkId), ['second', 'first']);
});

test('근거 부족은 빈 근거를 유지하고 Claude 실패는 검색 후보 기반 fallback을 유지한다', () => {
  const candidate = source('candidate', '검색 후보');
  const insufficient = claudeAnswerPresentation({
    answer: '제공된 문서에서 질문에 답할 충분한 근거를 찾지 못했습니다.',
    sources: [],
    insufficientEvidence: true,
  });
  const failed = claudeFailurePresentation(extractiveAnswerPresentation([candidate]));

  assert.deepEqual(insufficient.sources, []);
  assert.deepEqual(failed.sources, [candidate]);
  assert.equal(failed.answerMode, 'extractive-fallback');
  assert.match(failed.answer, /^Claude 답변 생성에 실패하여/);
});
