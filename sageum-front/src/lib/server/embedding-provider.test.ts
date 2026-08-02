import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EmbeddingProviderError,
  GeminiEmbeddingProvider,
  OpenAiCompatibleEmbeddingProvider,
} from './embedding-provider';

test('Gemini 문서 임베딩을 배치하고 검색 목적 설정을 구분한다', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const provider = new GeminiEmbeddingProvider({
    apiKey: 'test-key',
    model: 'gemini-embedding-001',
    dimensions: 3,
    batchSize: 2,
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        requests: Array<Record<string, unknown>>;
      };
      requests.push(...body.requests);
      return Response.json({
        embeddings: body.requests.map((_request, index) => ({ values: [index, 0.5, 1] })),
      });
    },
  });

  const vectors = await provider.embedDocuments([' 첫 문서 ', '둘째 문서', '셋째 문서']);
  assert.equal(vectors.length, 3);
  assert.equal(requests.length, 3);
  assert.deepEqual(
    (requests[0].embedContentConfig as Record<string, unknown>).taskType,
    'RETRIEVAL_DOCUMENT',
  );
  assert.deepEqual(
    (requests[0].embedContentConfig as Record<string, unknown>).outputDimensionality,
    3,
  );

  requests.length = 0;
  await provider.embedQuery('검색 질문');
  assert.equal(
    (requests[0].embedContentConfig as Record<string, unknown>).taskType,
    'RETRIEVAL_QUERY',
  );
});

test('OpenAI 호환 결과를 index 순서대로 정렬한다', async () => {
  const provider = new OpenAiCompatibleEmbeddingProvider({
    apiKey: 'test-key',
    model: 'text-embedding-3-small',
    dimensions: 2,
    fetcher: async () => Response.json({
      data: [
        { index: 1, embedding: [0.3, 0.4] },
        { index: 0, embedding: [0.1, 0.2] },
      ],
    }),
  });

  assert.deepEqual(
    await provider.embedDocuments(['첫 문서', '둘째 문서']),
    [[0.1, 0.2], [0.3, 0.4]],
  );
});

test('공급자가 다른 차원의 벡터를 반환하면 거부한다', async () => {
  const provider = new GeminiEmbeddingProvider({
    apiKey: 'test-key',
    model: 'gemini-embedding-001',
    dimensions: 3,
    fetcher: async () => Response.json({ embeddings: [{ values: [0.1, 0.2] }] }),
  });

  await assert.rejects(
    () => provider.embedQuery('검색 질문'),
    (error: unknown) => error instanceof EmbeddingProviderError && /차원/u.test(error.message),
  );
});

test('공급자 오류 응답을 제한된 메시지로 변환한다', async () => {
  const provider = new GeminiEmbeddingProvider({
    apiKey: 'test-key',
    model: 'gemini-embedding-001',
    dimensions: 3,
    fetcher: async () => Response.json(
      { error: { message: 'rate limit' } },
      { status: 429 },
    ),
  });

  await assert.rejects(() => provider.embedQuery('검색 질문'), /429.*rate limit/u);
});
