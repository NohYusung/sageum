import type { SearchDocumentsResponse } from '@/lib/documents/contracts';
import { composeExtractiveAnswer, type SourceReference } from '@/lib/rag/local-search';
import type { AppliedRuleReference } from '@/lib/relations/types';
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
  candidates: SourceReference[],
  appliedRules: AppliedRuleReference[],
): SearchAnswerPresentation {
  if (generated.insufficientEvidence || !generated.sources.length) {
    return {
      answer: generated.answer,
      sources: [],
      answerMode: 'claude-platform-aws',
    };
  }

  const citedSources = uniqueSources(generated.sources);
  const citedPathIds = new Set(citedSources.flatMap((source) => (
    source.retrievalRole === 'expanded' && source.pathId ? [source.pathId] : []
  )));
  const pathRuleIds = new Set(appliedRules.flatMap((rule) => (
    citedPathIds.has(rule.pathId) ? [rule.ruleId] : []
  )));
  const citedRuleChunkIds = new Set(citedSources.flatMap((source) => (
    source.retrievalRole === 'rule' ? [source.chunkId] : []
  )));
  const directSources = citedSources.filter((source) => (
    source.retrievalRole !== 'rule' && source.retrievalRole !== 'expanded'
  ));
  const ruleSources = candidates.filter((source) => (
    source.retrievalRole === 'rule'
    && (citedRuleChunkIds.has(source.chunkId) || Boolean(source.ruleId && pathRuleIds.has(source.ruleId)))
  ));
  const citedRulesMissingFromCandidates = citedSources.filter((source) => (
    source.retrievalRole === 'rule'
    && !ruleSources.some((candidate) => candidate.chunkId === source.chunkId)
  ));
  const expandedSources = citedSources.filter((source) => source.retrievalRole === 'expanded');

  return {
    answer: generated.answer,
    sources: uniqueSources([
      ...directSources,
      ...ruleSources,
      ...citedRulesMissingFromCandidates,
      ...expandedSources,
    ]),
    answerMode: 'claude-platform-aws',
  };
}

function uniqueSources(sources: SourceReference[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.chunkId)) return false;
    seen.add(source.chunkId);
    return true;
  });
}

export function claudeFailurePresentation(
  fallback: SearchAnswerPresentation,
): SearchAnswerPresentation {
  return {
    ...fallback,
    answer: `Claude 답변 생성에 실패하여 검색된 원문을 대신 표시합니다. ${fallback.answer}`,
  };
}
