import type {
  SearchDocumentsResponse,
  SearchProgressEvent,
  SearchStreamEvent,
} from '@/lib/documents/contracts';
import { parseSearchRequest, SearchRequestError } from '@/lib/rag/search-request';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { generateClaudeGroundedAnswer } from '@/lib/server/claude-rag-answer';
import { getProviderConfiguration } from '@/lib/server/env';
import {
  QdrantConfigurationError,
  QdrantInferenceError,
} from '@/lib/server/qdrant-store';
import { searchRelationAwareRepository } from '@/lib/server/relation-aware-search';
import {
  claudeAnswerPresentation,
  claudeFailurePresentation,
  extractiveAnswerPresentation,
} from '@/lib/server/search-answer-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEARCH_STREAM_CONTENT_TYPE = 'application/x-ndjson';

function searchErrorPayload(error: unknown) {
  if (error instanceof QdrantConfigurationError) {
    return { error: error.message, status: 503 };
  }
  const folderNotFound = error instanceof Error
    && error.message === '검색할 폴더를 찾을 수 없습니다.';
  return {
    error: error instanceof QdrantInferenceError
      ? error.message
      : folderNotFound
        ? error.message
        : '문서 벡터 검색에 실패했습니다.',
    status: folderNotFound ? 404 : 502,
  };
}

function streamSearchResponse(
  run: (report: (event: SearchProgressEvent) => void) => Promise<SearchDocumentsResponse>,
) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: SearchStreamEvent) => {
        if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const report = (event: SearchProgressEvent) => send(event);
      report({
        type: 'progress',
        stage: 'preparing',
        message: '검색 요청과 범위를 확인하고 있습니다.',
      });
      void run(report)
        .then((data) => send({ type: 'result', data }))
        .catch((error) => {
          console.error('Streaming vector search failed', error);
          const payload = searchErrorPayload(error);
          send({ type: 'error', error: payload.error });
        })
        .finally(() => {
          if (!cancelled) controller.close();
        });
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': `${SEARCH_STREAM_CONTENT_TYPE}; charset=utf-8`,
      'X-Accel-Buffering': 'no',
    },
  });
}

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

  const execute = async (report?: (event: SearchProgressEvent) => void) => {
    const related = await searchRelationAwareRepository({
      ownerId: context.ownerId,
      supabase: context.supabase,
      query: search.query,
      folderId: search.folderId ?? undefined,
      documentIds: search.documentIds,
      topK: search.topK,
      onProgress: report,
    });
    let presentation = extractiveAnswerPresentation(related.evidence);

    report?.({
      type: 'progress',
      stage: 'generating',
      message: related.evidence.length
        ? '찾은 근거를 바탕으로 답변을 작성하고 있습니다.'
        : '검색 결과를 바탕으로 답변을 정리하고 있습니다.',
      detail: `사용 가능한 근거 ${related.evidence.length}개`,
    });

    if (related.evidence.length && configuration.generation.configured) {
      try {
        const generated = await generateClaudeGroundedAnswer(search.query, related.evidence);
        presentation = claudeAnswerPresentation(
          generated,
          related.evidence,
          related.appliedRules,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        console.error(`Claude Platform on AWS answer generation failed: ${message}`);
        presentation = claudeFailurePresentation(presentation);
      }
    }

    report?.({
      type: 'progress',
      stage: 'verifying',
      message: '답변과 실제 인용 근거를 검증하고 있습니다.',
      detail: `최종 인용 근거 ${presentation.sources.length}개`,
    });

    return {
      answer: presentation.answer,
      sources: presentation.sources,
      mode: 'qdrant',
      answerMode: presentation.answerMode,
      appliedRules: related.appliedRules,
      appliedSemanticLinks: related.appliedSemanticLinks ?? [],
      relationMode: related.relationMode,
    } satisfies SearchDocumentsResponse;
  };

  if (request.headers.get('accept')?.includes(SEARCH_STREAM_CONTENT_TYPE)) {
    return streamSearchResponse((report) => execute(report));
  }

  try {
    return Response.json(await execute());
  } catch (error) {
    console.error('Vector search failed', error);
    const payload = searchErrorPayload(error);
    return Response.json({ error: payload.error }, { status: payload.status });
  }
}
