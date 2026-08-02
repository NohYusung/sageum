const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_QUERY_LENGTH = 2_000;
const MAX_DOCUMENT_FILTERS = 20;
const MAX_TOP_K = 20;

export type SearchRequest = {
  query: string;
  documentIds: string[];
  topK: number;
  queryVector: number[] | null;
  embeddingModel: string | null;
};

export class SearchRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchRequestError';
  }
}

export function parseSearchRequest(input: unknown): SearchRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SearchRequestError('올바른 검색 요청이 필요합니다.');
  }

  const body = input as Record<string, unknown>;
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) throw new SearchRequestError('검색 질문을 입력해 주세요.');
  if (query.length > MAX_QUERY_LENGTH) {
    throw new SearchRequestError(`검색 질문은 ${MAX_QUERY_LENGTH}자 이하여야 합니다.`);
  }

  const documentIds = body.documentIds === undefined
    ? []
    : Array.isArray(body.documentIds)
      ? Array.from(new Set(body.documentIds))
      : null;
  if (!documentIds || documentIds.length > MAX_DOCUMENT_FILTERS) {
    throw new SearchRequestError(`문서 필터는 최대 ${MAX_DOCUMENT_FILTERS}개까지 사용할 수 있습니다.`);
  }
  if (!documentIds.every((id): id is string => typeof id === 'string' && UUID_PATTERN.test(id))) {
    throw new SearchRequestError('올바르지 않은 문서 식별자가 포함되어 있습니다.');
  }

  const topK = body.topK === undefined ? 8 : body.topK;
  if (!Number.isInteger(topK) || typeof topK !== 'number' || topK < 1 || topK > MAX_TOP_K) {
    throw new SearchRequestError(`검색 결과 개수는 1~${MAX_TOP_K} 사이여야 합니다.`);
  }

  const queryVector = body.queryVector === undefined
    ? null
    : Array.isArray(body.queryVector)
      ? body.queryVector
      : null;
  if (body.queryVector !== undefined && !queryVector) {
    throw new SearchRequestError('질문 벡터 형식이 올바르지 않습니다.');
  }
  if (queryVector && (
    !queryVector.length
    || queryVector.length > 4096
    || !queryVector.every((value) => typeof value === 'number' && Number.isFinite(value))
    || !queryVector.some((value) => Math.abs(value) > Number.EPSILON)
  )) {
    throw new SearchRequestError('질문 벡터에 올바르지 않은 값이 포함되어 있습니다.');
  }
  const embeddingModel = typeof body.embeddingModel === 'string'
    ? body.embeddingModel.trim()
    : null;
  if (queryVector && !embeddingModel) {
    throw new SearchRequestError('질문 벡터의 임베딩 모델이 필요합니다.');
  }
  if (!queryVector && body.embeddingModel !== undefined) {
    throw new SearchRequestError('질문 벡터 없이 임베딩 모델만 지정할 수 없습니다.');
  }

  return { query, documentIds, topK, queryVector, embeddingModel };
}
