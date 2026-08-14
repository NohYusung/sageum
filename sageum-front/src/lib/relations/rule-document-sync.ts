import type { RuleDocumentSummary } from './types';

type RuleDocumentsResponse = {
  ruleDocuments?: RuleDocumentSummary[];
  error?: string;
};

export type RuleDocumentsRefreshGate = {
  begin: () => number;
  invalidate: () => void;
  isCurrent: (requestId: number) => boolean;
};

export function createRuleDocumentsRefreshGate(): RuleDocumentsRefreshGate {
  let generation = 0;
  return {
    begin() {
      generation += 1;
      return generation;
    },
    invalidate() {
      generation += 1;
    },
    isCurrent(requestId) {
      return generation === requestId;
    },
  };
}

export async function fetchRuleDocuments(): Promise<RuleDocumentSummary[]> {
  const response = await fetch('/api/rule-documents', { cache: 'no-store' });
  const payload = await response.json().catch(() => null) as RuleDocumentsResponse | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? '규칙 문서를 새로고침하지 못했습니다.');
  }
  if (!payload || !Array.isArray(payload.ruleDocuments)) {
    throw new Error('규칙 문서 응답이 비어 있습니다.');
  }
  return payload.ruleDocuments;
}
