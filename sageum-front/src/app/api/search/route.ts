import type { SearchDocumentsResponse } from '@/lib/documents/contracts';
import { composeExtractiveAnswer, type SourceReference } from '@/lib/rag/local-search';
import { parseSearchRequest, SearchRequestError } from '@/lib/rag/search-request';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { EmbeddingProviderError, getEmbeddingProvider } from '@/lib/server/embedding-provider';
import { getProviderConfiguration } from '@/lib/server/env';
import {
  getQdrantVectorStore,
  QdrantConfigurationError,
} from '@/lib/server/qdrant-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function scoreThreshold() {
  const value = Number.parseFloat(process.env.QDRANT_SCORE_THRESHOLD?.trim() ?? '0.45');
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.45;
}

export async function POST(request: Request) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const configuration = getProviderConfiguration();
  if (!configuration.embedding.configured || !configuration.qdrant.configured) {
    return Response.json(
      {
        error: '임베딩과 Qdrant 환경 설정이 모두 필요합니다.',
        code: 'VECTOR_SEARCH_NOT_CONFIGURED',
      },
      { status: 503 },
    );
  }

  let search;
  try {
    search = parseSearchRequest(await request.json());
  } catch (error) {
    const message = error instanceof SearchRequestError
      ? error.message
      : '올바른 JSON 검색 요청이 필요합니다.';
    return Response.json({ error: message }, { status: 400 });
  }

  try {
    const embeddingProvider = getEmbeddingProvider();
    const vectorStore = getQdrantVectorStore();
    const queryVector = await embeddingProvider.embedQuery(search.query);
    await vectorStore.ensureCollection(embeddingProvider.dimensions);
    const results = await vectorStore.query(queryVector, context.ownerId, {
      limit: search.topK,
      documentIds: search.documentIds,
      scoreThreshold: scoreThreshold(),
    });
    const sources: SourceReference[] = results.map((result) => ({
      documentId: result.documentId,
      versionId: result.versionId,
      documentTitle: result.documentTitle || '문서',
      chunkId: result.chunkId,
      heading: result.headingPath.join(' › ') || '본문',
      snippet: result.text,
      score: result.score,
      page: result.page,
      sheet: result.sheet,
      cellRange: result.cellRange,
    }));
    const response = {
      answer: composeExtractiveAnswer(sources),
      sources,
      mode: 'qdrant',
    } satisfies SearchDocumentsResponse;
    return Response.json(response);
  } catch (error) {
    console.error('Vector search failed', error);
    if (error instanceof QdrantConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof EmbeddingProviderError
      ? '질문 임베딩을 생성하지 못했습니다.'
      : '문서 벡터 검색에 실패했습니다.';
    return Response.json({ error: message }, { status: 502 });
  }
}
