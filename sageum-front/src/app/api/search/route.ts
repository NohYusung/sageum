import type { SearchDocumentsResponse } from '@/lib/documents/contracts';
import { composeExtractiveAnswer } from '@/lib/rag/local-search';
import { parseSearchRequest, SearchRequestError } from '@/lib/rag/search-request';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { generateClaudeGroundedAnswer } from '@/lib/server/claude-rag-answer';
import { getProviderConfiguration } from '@/lib/server/env';
import {
  QdrantConfigurationError,
  QdrantInferenceError,
} from '@/lib/server/qdrant-store';
import { searchRelationAwareRepository } from '@/lib/server/relation-aware-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const configuration = getProviderConfiguration();
  if (!configuration.qdrant.configured) {
    return Response.json(
      { error: 'Qdrant 환경 설정이 필요합니다.', code: 'VECTOR_SEARCH_NOT_CONFIGURED' },
      { status: 503 },
    );
  }
  if (!configuration.embedding.configured) {
    return Response.json(
      { error: 'Qdrant Cloud Inference 환경 설정이 필요합니다.' },
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
    const related = await searchRelationAwareRepository({
      ownerId: context.ownerId,
      supabase: context.supabase,
      query: search.query,
      folderId: search.folderId ?? undefined,
      documentIds: search.documentIds,
      topK: search.topK,
    });
    let answer = composeExtractiveAnswer(related.evidence);
    let answerSources = related.evidence;
    let answerMode: SearchDocumentsResponse['answerMode'] = 'extractive-fallback';

    if (related.evidence.length && configuration.generation.configured) {
      try {
        const generated = await generateClaudeGroundedAnswer(search.query, related.evidence);
        answer = generated.answer;
        answerSources = generated.insufficientEvidence ? [] : related.evidence;
        answerMode = 'claude-platform-aws';
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        console.error(`Claude Platform on AWS answer generation failed: ${message}`);
        answer = `Claude 답변 생성에 실패하여 검색된 원문을 대신 표시합니다. ${answer}`;
      }
    }

    return Response.json({
      answer,
      sources: answerSources,
      mode: 'qdrant',
      answerMode,
      appliedRules: related.appliedRules,
      relationMode: related.relationMode,
    } satisfies SearchDocumentsResponse);
  } catch (error) {
    console.error('Vector search failed', error);
    if (error instanceof QdrantConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    return Response.json(
      {
        error: error instanceof QdrantInferenceError
          ? error.message
          : error instanceof Error && error.message === '검색할 폴더를 찾을 수 없습니다.'
            ? error.message
            : '문서 벡터 검색에 실패했습니다.',
      },
      { status: error instanceof Error && error.message === '검색할 폴더를 찾을 수 없습니다.' ? 404 : 502 },
    );
  }
}
