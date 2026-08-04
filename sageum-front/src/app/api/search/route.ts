import type { SearchDocumentsResponse } from '@/lib/documents/contracts';
import { descendantFolderIds } from '@/lib/folders/tree';
import { composeExtractiveAnswer, type SourceReference } from '@/lib/rag/local-search';
import { parseSearchRequest, SearchRequestError } from '@/lib/rag/search-request';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { generateClaudeGroundedAnswer } from '@/lib/server/claude-rag-answer';
import { getProviderConfiguration } from '@/lib/server/env';
import {
  getQdrantVectorStore,
  QdrantConfigurationError,
  QdrantInferenceError,
} from '@/lib/server/qdrant-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function scoreThreshold() {
  const value = Number.parseFloat(process.env.QDRANT_SCORE_THRESHOLD?.trim() ?? '0.2');
  return Number.isFinite(value) && value >= 0 ? value : 0.2;
}

export async function POST(request: Request) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const configuration = getProviderConfiguration();
  if (!configuration.qdrant.configured) {
    return Response.json(
      {
        error: 'Qdrant 환경 설정이 필요합니다.',
        code: 'VECTOR_SEARCH_NOT_CONFIGURED',
      },
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
    const vectorStore = getQdrantVectorStore();
    await vectorStore.ensureCollection(configuration.embedding.dimensions);
    let documentIds = search.documentIds;
    if (search.folderId) {
      const [foldersResult, documentsResult] = await Promise.all([
        context.supabase
          .from('folders')
          .select('id,parent_id,name,sort_order,created_at,updated_at')
          .eq('owner_id', context.ownerId),
        context.supabase
          .from('documents')
          .select('id,folder_id')
          .eq('owner_id', context.ownerId)
          .eq('deletion_status', 'active'),
      ]);
      if (foldersResult.error || documentsResult.error) {
        throw new Error('폴더 검색 범위를 확인하지 못했습니다.');
      }
      const folders = foldersResult.data.map((folder) => ({
        id: folder.id,
        parentId: folder.parent_id,
        name: folder.name,
        sortOrder: folder.sort_order,
        createdAt: folder.created_at,
        updatedAt: folder.updated_at,
      }));
      if (!folders.some((folder) => folder.id === search.folderId)) {
        return Response.json({ error: '검색할 폴더를 찾을 수 없습니다.' }, { status: 404 });
      }
      const folderIds = descendantFolderIds(folders, search.folderId);
      const scopedDocumentIds = documentsResult.data
        .filter((document) => document.folder_id && folderIds.has(document.folder_id))
        .map((document) => document.id);
      documentIds = documentIds.length
        ? documentIds.filter((documentId) => scopedDocumentIds.includes(documentId))
        : scopedDocumentIds;

      if (!documentIds.length) {
        return Response.json({
          answer: composeExtractiveAnswer([]),
          sources: [],
          mode: 'qdrant',
          answerMode: 'extractive-fallback',
        } satisfies SearchDocumentsResponse);
      }
    }
    const results = await vectorStore.query(search.query, context.ownerId, {
      limit: Math.min(search.topK * 2, 40),
      documentIds,
      scoreThreshold: scoreThreshold(),
      embeddingModel: configuration.embedding.model,
    });
    const resultDocumentIds = [...new Set(results.map((result) => result.documentId).filter(Boolean))];
    const { data: activeDocuments, error: activeDocumentsError } = resultDocumentIds.length
      ? await context.supabase
        .from('documents')
        .select('id')
        .eq('owner_id', context.ownerId)
        .eq('deletion_status', 'active')
        .in('id', resultDocumentIds)
      : { data: [], error: null };
    if (activeDocumentsError) throw new Error('활성 문서 상태를 확인하지 못했습니다.');
    const activeDocumentIds = new Set(activeDocuments.map((document) => document.id));
    const activeResults = results
      .filter((result) => activeDocumentIds.has(result.documentId))
      .slice(0, search.topK);
    const sources: SourceReference[] = activeResults.map((result) => ({
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
    let answer = composeExtractiveAnswer(sources);
    let answerSources = sources;
    let answerMode: SearchDocumentsResponse['answerMode'] = 'extractive-fallback';

    if (sources.length && configuration.generation.configured) {
      try {
        const generated = await generateClaudeGroundedAnswer(search.query, sources);
        answer = generated.answer;
        answerSources = generated.sources;
        answerMode = 'claude-platform-aws';
      } catch (error) {
        const message = error instanceof Error ? error.message : '알 수 없는 오류';
        console.error(`Claude Platform on AWS answer generation failed: ${message}`);
        answer = `Claude 답변 생성에 실패하여 검색된 원문을 대신 표시합니다. ${answer}`;
      }
    }

    const response = {
      answer,
      sources: answerSources,
      mode: 'qdrant',
      answerMode,
    } satisfies SearchDocumentsResponse;
    return Response.json(response);
  } catch (error) {
    console.error('Vector search failed', error);
    if (error instanceof QdrantConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    return Response.json(
      {
        error: error instanceof QdrantInferenceError
          ? error.message
          : '문서 벡터 검색에 실패했습니다.',
      },
      { status: 502 },
    );
  }
}
