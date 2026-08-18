import {
  SEARCH_PROGRESS_STAGES,
  type ApiErrorResponse,
  type SearchDocumentsResponse,
  type SearchProgressEvent,
  type SearchProgressStage,
  type SearchStreamEvent,
} from './contracts';
import {
  composeExtractiveAnswer,
  searchDocuments,
  type IndexedDocument,
} from '@/lib/rag/local-search';

const SEARCH_STREAM_CONTENT_TYPE = 'application/x-ndjson';
const SEARCH_PROGRESS_STAGE_SET = new Set<string>(SEARCH_PROGRESS_STAGES);

export const SEARCH_PROGRESS_PRESENTATION = [
  { stage: 'preparing', label: '검색 요청 준비' },
  { stage: 'retrieving', label: '문서·규칙 검색' },
  { stage: 'expanding', label: '의미 연결과 추가 근거 확인' },
  { stage: 'generating', label: '답변 생성' },
  { stage: 'verifying', label: '인용 근거 검증' },
] as const;

type SearchRepositoryInput = {
  documents: IndexedDocument[];
  query: string;
  folderId: string | null;
  onProgress?: (event: SearchProgressEvent) => void;
};

function isSearchStreamEvent(value: unknown): value is SearchStreamEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (event.type === 'progress') {
    return typeof event.stage === 'string'
      && SEARCH_PROGRESS_STAGE_SET.has(event.stage)
      && typeof event.message === 'string';
  }
  if (event.type === 'result') {
    return Boolean(event.data && typeof event.data === 'object');
  }
  return event.type === 'error' && typeof event.error === 'string';
}

export function isSearchProgressForward(
  current: SearchProgressStage,
  next: SearchProgressStage,
) {
  return SEARCH_PROGRESS_STAGES.indexOf(next) >= SEARCH_PROGRESS_STAGES.indexOf(current);
}

function parseSearchStreamLine(line: string) {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('검색 진행 응답을 해석하지 못했습니다.');
  }
  if (!isSearchStreamEvent(value)) {
    throw new Error('검색 진행 응답 형식이 올바르지 않습니다.');
  }
  return value;
}

export function createSearchStreamParser() {
  let buffer = '';
  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      return lines
        .map((line) => line.trim())
        .filter(Boolean)
        .map(parseSearchStreamLine);
    },
    finish() {
      const line = buffer.trim();
      buffer = '';
      return line ? [parseSearchStreamLine(line)] : [];
    },
  };
}

async function readSearchStream(
  response: Response,
  onProgress?: (event: SearchProgressEvent) => void,
) {
  if (!response.body) throw new Error('검색 진행 응답 본문이 없습니다.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSearchStreamParser();
  let result: SearchDocumentsResponse | null = null;

  const apply = (events: SearchStreamEvent[]) => events.forEach((event) => {
    if (event.type === 'progress') onProgress?.(event);
    if (event.type === 'result') result = event.data;
    if (event.type === 'error') throw new Error(event.error);
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    apply(parser.push(decoder.decode(value, { stream: true })));
  }
  apply(parser.push(decoder.decode()));
  apply(parser.finish());
  if (!result) throw new Error('검색 결과가 완료되지 않았습니다.');
  return result;
}

export async function searchRepository({
  documents,
  query,
  folderId,
  onProgress,
}: SearchRepositoryInput) {
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: {
      Accept: SEARCH_STREAM_CONTENT_TYPE,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, folderId, topK: 8 }),
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (response.ok && contentType.includes(SEARCH_STREAM_CONTENT_TYPE)) {
    return readSearchStream(response, onProgress);
  }

  const payload = await response.json().catch(() => null) as
    | SearchDocumentsResponse
    | ApiErrorResponse
    | null;
  if (response.ok && payload && 'sources' in payload) return payload;
  if (
    response.status === 503
    && payload
    && 'code' in payload
    && payload.code === 'VECTOR_SEARCH_NOT_CONFIGURED'
  ) {
    onProgress?.({
      type: 'progress',
      stage: 'retrieving',
      message: '로컬 검색으로 전환하고 있습니다.',
    });
    const sources = searchDocuments(documents, query);
    return {
      answer: composeExtractiveAnswer(sources),
      sources,
      mode: 'qdrant',
      answerMode: 'extractive-fallback',
      appliedRules: [],
      appliedSemanticLinks: [],
      relationMode: 'fallback',
    } satisfies SearchDocumentsResponse;
  }
  throw new Error(payload && 'error' in payload
    ? payload.error
    : '문서 검색 요청을 처리하지 못했습니다.');
}
