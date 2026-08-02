const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const MAX_BROWSER_VECTOR_CHUNKS = 128;

export type VectorIndexConfiguration = {
  model: string;
  dtype: string;
  dimensions: number;
};

export type VectorIndexRequest = {
  versionId: string;
  model: string;
  dtype: string;
  dimensions: number;
  vectors: Array<{ chunkId: string; vector: number[] }>;
};

export class VectorIndexRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VectorIndexRequestError';
  }
}

function validVector(candidate: unknown, dimensions: number): candidate is number[] {
  if (!Array.isArray(candidate) || candidate.length !== dimensions) return false;
  if (!candidate.every((value) => typeof value === 'number' && Number.isFinite(value))) return false;
  return candidate.some((value) => Math.abs(value) > Number.EPSILON);
}

export function parseVectorIndexRequest(
  input: unknown,
  expected: VectorIndexConfiguration,
): VectorIndexRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new VectorIndexRequestError('올바른 벡터 색인 요청이 필요합니다.');
  }
  const body = input as Record<string, unknown>;
  const versionId = typeof body.versionId === 'string' ? body.versionId : '';
  if (!UUID_PATTERN.test(versionId)) {
    throw new VectorIndexRequestError('올바른 문서 버전 식별자가 필요합니다.');
  }
  if (body.model !== expected.model || body.dtype !== expected.dtype) {
    throw new VectorIndexRequestError('문서 벡터 모델이 서버 색인 설정과 일치하지 않습니다.');
  }
  if (body.dimensions !== expected.dimensions) {
    throw new VectorIndexRequestError('문서 벡터 차원이 서버 색인 설정과 일치하지 않습니다.');
  }
  if (!Array.isArray(body.vectors) || !body.vectors.length) {
    throw new VectorIndexRequestError('색인할 문서 벡터가 필요합니다.');
  }
  if (body.vectors.length > MAX_BROWSER_VECTOR_CHUNKS) {
    throw new VectorIndexRequestError(
      `브라우저 색인은 문서당 최대 ${MAX_BROWSER_VECTOR_CHUNKS}개 청크를 지원합니다.`,
    );
  }

  const vectors = body.vectors.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new VectorIndexRequestError('올바르지 않은 청크 벡터가 포함되어 있습니다.');
    }
    const item = candidate as Record<string, unknown>;
    if (typeof item.chunkId !== 'string' || !item.chunkId.trim()) {
      throw new VectorIndexRequestError('청크 식별자가 비어 있습니다.');
    }
    if (!validVector(item.vector, expected.dimensions)) {
      throw new VectorIndexRequestError('올바르지 않은 문서 벡터가 포함되어 있습니다.');
    }
    return { chunkId: item.chunkId, vector: item.vector };
  });
  if (new Set(vectors.map(({ chunkId }) => chunkId)).size !== vectors.length) {
    throw new VectorIndexRequestError('중복된 청크 벡터가 포함되어 있습니다.');
  }
  return {
    versionId,
    model: expected.model,
    dtype: expected.dtype,
    dimensions: expected.dimensions,
    vectors,
  };
}
