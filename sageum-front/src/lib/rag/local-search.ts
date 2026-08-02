import type { DocumentChunk, NormalizedDocument } from './types';

export type IndexedDocument = {
  document: NormalizedDocument;
  chunks: DocumentChunk[];
  status: 'ready' | 'processing' | 'failed';
  indexedAt: string;
};

export type SourceReference = {
  documentId: string;
  versionId?: string;
  documentTitle: string;
  chunkId: string;
  heading: string;
  snippet: string;
  score: number;
  page?: number;
  sheet?: string;
  cellRange?: string;
};

function queryTerms(query: string) {
  return Array.from(
    new Set(
      query
        .toLocaleLowerCase('ko-KR')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/u)
        .map((term) => term.trim())
        .filter((term) => term.length > 1),
    ),
  );
}

export function searchDocuments(
  documents: IndexedDocument[],
  query: string,
  limit = 4,
): SourceReference[] {
  const terms = queryTerms(query);
  if (!terms.length || limit < 1) return [];

  const results = documents.flatMap(({ document, chunks }) =>
    chunks.flatMap((chunk) => {
      const title = document.title.toLocaleLowerCase('ko-KR');
      const haystack = `${title} ${chunk.headingPath.join(' ')} ${chunk.text}`.toLocaleLowerCase('ko-KR');
      const matched = terms.filter((term) => haystack.includes(term));
      if (!matched.length) return [];

      const titleBonus = terms.some((term) => title.includes(term)) ? 0.2 : 0;
      return [{
        documentId: document.id,
        documentTitle: document.title,
        chunkId: chunk.id,
        heading: chunk.headingPath.join(' › ') || '본문',
        snippet: chunk.text,
        score: Math.min(0.99, matched.length / terms.length + titleBonus),
      }];
    }),
  );

  return results.toSorted((left, right) => right.score - left.score).slice(0, limit);
}

export function composeExtractiveAnswer(sources: SourceReference[]) {
  if (!sources.length) {
    return '현재 저장소에서는 질문을 뒷받침할 근거를 찾지 못했습니다. 다른 표현으로 질문하거나 관련 문서를 먼저 추가해 주세요.';
  }

  const primary = sources[0];
  const related = sources.length > 1 ? ` 추가로 ${sources.length - 1}개의 관련 근거를 함께 찾았습니다.` : '';
  return `${primary.documentTitle}의 “${primary.heading}”에서 다음 내용을 확인했습니다. ${primary.snippet}${related}`;
}
