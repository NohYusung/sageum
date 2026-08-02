import type { SupabaseClient } from '@supabase/supabase-js';
import type { IndexDocumentVectorsResponse } from '@/lib/documents/contracts';
import { mapStoredDocument } from '@/lib/documents/repository-mapper';
import {
  parseVectorIndexRequest,
  VectorIndexRequestError,
} from '@/lib/embedding/vector-index-request';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { getProviderConfiguration } from '@/lib/server/env';
import {
  getQdrantVectorStore,
  QdrantConfigurationError,
} from '@/lib/server/qdrant-store';
import type { Database, Json } from '@/lib/supabase/database.types';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

class VectorIndexError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = 'VectorIndexError';
  }
}

function metadataRecord(metadata: Json): Record<string, Json | undefined> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {};
}

async function markIndexFailed(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  documentId: string,
  versionId: string,
  message: string,
) {
  const { error } = await supabase
    .from('document_versions')
    .update({ status: 'failed', error_message: message.slice(0, 500) })
    .eq('id', versionId)
    .eq('document_id', documentId)
    .eq('owner_id', ownerId);
  if (error) console.error('Failed to mark browser vector index as failed', error);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { documentId } = await params;
  if (!UUID_PATTERN.test(documentId)) {
    return Response.json({ error: '올바른 문서 식별자가 필요합니다.' }, { status: 400 });
  }

  const providers = getProviderConfiguration();
  if (
    !providers.qdrant.configured
    || !providers.embedding.configured
    || providers.embedding.execution !== 'browser'
    || !providers.embedding.model
    || !providers.embedding.dtype
  ) {
    return Response.json(
      { error: '브라우저 임베딩과 Qdrant 환경 설정이 필요합니다.' },
      { status: 503 },
    );
  }

  let indexRequest;
  try {
    indexRequest = parseVectorIndexRequest(await request.json(), {
      model: providers.embedding.model,
      dtype: providers.embedding.dtype,
      dimensions: providers.embedding.dimensions,
    });
  } catch (error) {
    const message = error instanceof VectorIndexRequestError
      ? error.message
      : '올바른 JSON 벡터 색인 요청이 필요합니다.';
    return Response.json({ error: message }, { status: 400 });
  }

  const [documentResult, versionResult, chunksResult] = await Promise.all([
    context.supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('owner_id', context.ownerId)
      .maybeSingle(),
    context.supabase
      .from('document_versions')
      .select('*')
      .eq('id', indexRequest.versionId)
      .eq('document_id', documentId)
      .eq('owner_id', context.ownerId)
      .maybeSingle(),
    context.supabase
      .from('document_chunks')
      .select('*')
      .eq('version_id', indexRequest.versionId)
      .eq('document_id', documentId)
      .eq('owner_id', context.ownerId)
      .order('ordinal'),
  ]);

  if (documentResult.error || versionResult.error || chunksResult.error) {
    return Response.json({ error: '문서 색인 정보를 조회하지 못했습니다.' }, { status: 500 });
  }
  if (!documentResult.data || !versionResult.data) {
    return Response.json({ error: '색인할 문서를 찾을 수 없습니다.' }, { status: 404 });
  }
  if (documentResult.data.latest_version_id !== indexRequest.versionId) {
    return Response.json({ error: '최신 문서 버전만 색인할 수 있습니다.' }, { status: 409 });
  }
  if (versionResult.data.status !== 'indexing') {
    return Response.json({ error: '문서가 브라우저 색인 대기 상태가 아닙니다.' }, { status: 409 });
  }

  const storedChunks = chunksResult.data ?? [];
  const requestedChunkIds = new Set(indexRequest.vectors.map(({ chunkId }) => chunkId));
  if (
    storedChunks.length !== indexRequest.vectors.length
    || storedChunks.some((chunk) => !requestedChunkIds.has(chunk.id))
  ) {
    return Response.json(
      { error: '브라우저 벡터가 저장된 문서 청크 전체와 일치하지 않습니다.' },
      { status: 400 },
    );
  }

  const vectorByChunkId = new Map(
    indexRequest.vectors.map(({ chunkId, vector }) => [chunkId, vector]),
  );
  const indexedDocument = mapStoredDocument(
    documentResult.data,
    versionResult.data,
    storedChunks,
  );
  const vectorStore = getQdrantVectorStore();
  let qdrantChanged = false;

  try {
    await vectorStore.ensureCollection(providers.embedding.dimensions);
    await vectorStore.deleteByVersion(context.ownerId, indexRequest.versionId);
    qdrantChanged = true;
    await vectorStore.upsert(indexedDocument.chunks.map((chunk) => ({
      chunk,
      ownerId: context.ownerId,
      sourceType: indexedDocument.document.sourceType,
      documentTitle: indexedDocument.document.title,
      embeddingModel: providers.embedding.model!,
      vector: vectorByChunkId.get(chunk.id)!,
    })));

    const indexedAt = new Date().toISOString();
    const metadata = {
      ...metadataRecord(versionResult.data.metadata),
      vectorIndexed: true,
      vectorIndexedAt: indexedAt,
      embeddingProvider: providers.embedding.provider,
      embeddingModel: providers.embedding.model,
      embeddingDtype: providers.embedding.dtype,
      embeddingDimensions: providers.embedding.dimensions,
    };
    const { error: versionUpdateError } = await context.supabase
      .from('document_versions')
      .update({ status: 'ready', error_message: null, metadata })
      .eq('id', indexRequest.versionId)
      .eq('document_id', documentId)
      .eq('owner_id', context.ownerId);
    if (versionUpdateError) {
      throw new VectorIndexError('문서 벡터 색인 결과를 확정하지 못했습니다.');
    }

    const response = {
      indexedAt,
      vectorCount: indexedDocument.chunks.length,
    } satisfies IndexDocumentVectorsResponse;
    return Response.json(response);
  } catch (error) {
    if (qdrantChanged) {
      try {
        await vectorStore.deleteByVersion(context.ownerId, indexRequest.versionId);
      } catch (cleanupError) {
        console.error('Failed to clean up browser vectors after indexing failure', cleanupError);
      }
    }
    const publicError = error instanceof VectorIndexError
      || error instanceof QdrantConfigurationError
      ? error.message
      : '문서 벡터를 Qdrant에 저장하지 못했습니다.';
    console.error('Browser vector indexing failed', error);
    await markIndexFailed(
      context.supabase,
      context.ownerId,
      documentId,
      indexRequest.versionId,
      publicError,
    );
    return Response.json(
      { error: publicError },
      { status: error instanceof QdrantConfigurationError ? 503 : 502 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { documentId } = await params;
  let versionId = '';
  let message = '브라우저 임베딩을 완료하지 못했습니다.';
  try {
    const body = await request.json() as { versionId?: unknown; error?: unknown };
    versionId = typeof body.versionId === 'string' ? body.versionId : '';
    if (typeof body.error === 'string' && body.error.trim()) message = body.error.trim();
  } catch {
    return Response.json({ error: '올바른 JSON 요청이 필요합니다.' }, { status: 400 });
  }
  if (!UUID_PATTERN.test(documentId) || !UUID_PATTERN.test(versionId)) {
    return Response.json({ error: '올바른 문서 식별자가 필요합니다.' }, { status: 400 });
  }

  const { data: version, error } = await context.supabase
    .from('document_versions')
    .select('id, status')
    .eq('id', versionId)
    .eq('document_id', documentId)
    .eq('owner_id', context.ownerId)
    .maybeSingle();
  if (error) return Response.json({ error: '문서 상태를 조회하지 못했습니다.' }, { status: 500 });
  if (!version) return Response.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
  if (version.status === 'ready') {
    return Response.json({ error: '완료된 문서 색인은 실패 처리할 수 없습니다.' }, { status: 409 });
  }

  await markIndexFailed(context.supabase, context.ownerId, documentId, versionId, message);
  return Response.json({ status: 'failed' });
}
