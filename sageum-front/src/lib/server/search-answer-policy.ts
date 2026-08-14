import type { SearchDocumentsResponse } from '@/lib/documents/contracts';
import { composeExtractiveAnswer, type SourceReference } from '@/lib/rag/local-search';
import type { GroundedAnswer } from './claude-rag-answer';

export type SearchAnswerPresentation = Pick<
  SearchDocumentsResponse,
  'answer' | 'sources' | 'answerMode'
>;

export function extractiveAnswerPresentation(
  candidates: SourceReference[],
): SearchAnswerPresentation {
  return {
    answer: composeExtractiveAnswer(candidates),
    sources: candidates,
    answerMode: 'extractive-fallback',
  };
}

export function claudeAnswerPresentation(
  generated: GroundedAnswer,
): SearchAnswerPresentation {
  return {
    answer: generated.answer,
    sources: generated.sources,
    answerMode: 'claude-platform-aws',
  };
}

export function claudeFailurePresentation(
  fallback: SearchAnswerPresentation,
): SearchAnswerPresentation {
  return {
    ...fallback,
    answer: `Claude 답변 생성에 실패하여 검색된 원문을 대신 표시합니다. ${fallback.answer}`,
  };
}
