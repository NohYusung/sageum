import type { ProcessDocumentResponse } from '@/lib/documents/contracts';
import { DOCUMENT_BUCKET, DocumentValidationError } from '@/lib/documents/validation';
import { CHUNKER_VERSION, chunkDocument } from '@/lib/rag/chunker';
import type { IndexedDocument } from '@/lib/rag/local-search';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import {
  DocumentParsingError,
  parseDocumentSourceWithHash,
  parserVersion,
} from '@/lib/server/document-parser';
import { cleanupFailedDocumentVersion } from '@/lib/server/document-processing-failure';
import { getProviderConfiguration } from '@/lib/server/env';
import {
  getQdrantVectorStore,
  QdrantConfigurationError,
  QdrantInferenceError,
} from '@/lib/server/qdrant-store';
import { enrichDocumentWithVisualOcr, VISUAL_OCR_VERSION } from '@/lib/server/visual-ocr';
import type { TablesInsert } from '@/lib/supabase/database.types';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

class ProcessingError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = 'ProcessingError';
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { documentId } = await params;
  let versionId = '';
  try {
    const body = await request.json() as { versionId?: unknown };
    versionId = typeof body.versionId === 'string' ? body.versionId : '';
  } catch {
    return Response.json({ error: '올바른 JSON 요청이 필요합니다.' }, { status: 400 });
  }

  if (!UUID_PATTERN.test(documentId) || !UUID_PATTERN.test(versionId)) {
    return Response.json({ error: '올바른 문서 식별자가 필요합니다.' }, { status: 400 });
  }

  const [documentResult, versionResult] = await Promise.all([
    context.supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('owner_id', context.ownerId)
      .maybeSingle(),
    context.supabase
      .from('document_versions')
      .select('*')
      .eq('id', versionId)
      .eq('document_id', documentId)
      .eq('owner_id', context.ownerId)
      .maybeSingle(),
  ]);

  if (documentResult.error || versionResult.error) {
    return Response.json({ error: '문서 정보를 조회하지 못했습니다.' }, { status: 500 });
  }
  if (!documentResult.data || !versionResult.data) {
    return Response.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
  }
  if (documentResult.data.deletion_status === 'deleting') {
    return Response.json({ error: '삭제 중인 문서는 다시 처리할 수 없습니다.' }, { status: 409 });
  }

  const version = versionResult.data;
  const expectedPathPrefix = `${context.ownerId}/${documentId}/${versionId}/`;
  if (!version.storage_path.startsWith(expectedPathPrefix)) {
    return Response.json({ error: '문서 저장 경로가 올바르지 않습니다.' }, { status: 403 });
  }

  const startedAt = new Date().toISOString();
  const { error: parsingStatusError } = await context.supabase
    .from('document_versions')
    .update({ status: 'parsing', error_message: null, metadata: { processingStartedAt: startedAt } })
    .eq('id', versionId)
    .eq('owner_id', context.ownerId);

  if (parsingStatusError) {
    return Response.json({ error: '문서 처리 상태를 갱신하지 못했습니다.' }, { status: 500 });
  }

  let vectorStore: ReturnType<typeof getQdrantVectorStore> | null = null;
  let vectorIndexStarted = false;
  try {
    const { data: originalFile, error: downloadError } = await context.supabase.storage
      .from(DOCUMENT_BUCKET)
      .download(version.storage_path);
    if (downloadError || !originalFile) {
      throw new ProcessingError('업로드된 원본 파일을 찾을 수 없습니다.', 422);
    }

    const fileBuffer = await originalFile.arrayBuffer();
    if (fileBuffer.byteLength !== version.size_bytes) {
      throw new ProcessingError('업로드된 원본 파일 크기가 요청 정보와 일치하지 않습니다.', 422);
    }
    const { document: parsedDocument, contentHash } = await parseDocumentSourceWithHash(
      new Uint8Array(fileBuffer),
      {
        name: version.original_filename,
        mimeType: version.mime_type,
        sizeBytes: version.size_bytes,
        documentId,
        versionId,
      },
    );
    const { document: parsed, report: visualOcr } = await enrichDocumentWithVisualOcr(
      new Uint8Array(fileBuffer),
      parsedDocument,
    );
    const chunks = chunkDocument(parsed);
    if (!chunks.length) {
      throw new ProcessingError('검색 가능한 본문이 없는 문서입니다.', 422);
    }

    const providers = getProviderConfiguration();
    const vectorIndexEnabled = providers.embedding.configured && providers.qdrant.configured;
    if (vectorIndexEnabled) {
      const indexingStartedAt = new Date().toISOString();
      const { error: indexingStatusError } = await context.supabase
        .from('document_versions')
        .update({
          status: 'indexing',
          error_message: null,
          metadata: { processingStartedAt: startedAt, indexingStartedAt },
        })
        .eq('id', versionId)
        .eq('owner_id', context.ownerId);
      if (indexingStatusError) {
        throw new ProcessingError('문서 인덱싱 상태를 갱신하지 못했습니다.');
      }

      vectorStore = getQdrantVectorStore();
      await vectorStore.ensureCollection(providers.embedding.dimensions);
      vectorIndexStarted = true;
      await vectorStore.deleteByVersion(context.ownerId, versionId);
      await vectorStore.upsert(chunks.map((chunk) => ({
        chunk,
        ownerId: context.ownerId,
        sourceType: parsed.sourceType,
        documentTitle: parsed.title,
        embeddingModel: providers.embedding.model,
      })));
    }

    const { error: clearChunksError } = await context.supabase
      .from('document_chunks')
      .delete()
      .eq('version_id', versionId)
      .eq('owner_id', context.ownerId);
    if (clearChunksError) throw new ProcessingError('기존 문서 청크를 정리하지 못했습니다.');

    const chunkRows: TablesInsert<'document_chunks'>[] = chunks.map((chunk) => ({
      id: chunk.id,
      document_id: documentId,
      version_id: versionId,
      owner_id: context.ownerId,
      ordinal: chunk.ordinal,
      text: chunk.text,
      word_count: chunk.wordCount,
      heading_path: chunk.headingPath,
      page: chunk.location.page ?? null,
      sheet: chunk.location.sheet ?? null,
      cell_range: chunk.location.cellRange ?? null,
      start_offset: chunk.location.startOffset ?? null,
      end_offset: chunk.location.endOffset ?? null,
      metadata: {
        blockStart: chunk.blockStart,
        blockEnd: chunk.blockEnd,
        focusBlock: chunk.focusBlock,
        imageIndex: chunk.location.imageIndex ?? null,
        previewBlock: chunk.location.previewBlock ?? null,
        sourceSpans: chunk.sourceSpans,
      },
    }));
    const { error: chunksError } = await context.supabase
      .from('document_chunks')
      .insert(chunkRows);
    if (chunksError) throw new ProcessingError('문서 청크를 저장하지 못했습니다.');

    const processedAt = new Date().toISOString();
    const { error: documentUpdateError } = await context.supabase
      .from('documents')
      .update({
        title: parsed.title,
        source_type: parsed.sourceType,
        latest_version_id: versionId,
        updated_at: processedAt,
      })
      .eq('id', documentId)
      .eq('owner_id', context.ownerId);
    if (documentUpdateError) throw new ProcessingError('문서 메타데이터를 갱신하지 못했습니다.');

    const versionMetadata = {
      blockCount: parsed.blocks.length,
      chunkCount: chunks.length,
      chunker: CHUNKER_VERSION,
      parser: parserVersion(parsed.sourceType),
      processedAt,
      processingStartedAt: startedAt,
      vectorIndexed: vectorIndexEnabled,
      embeddingProvider: vectorIndexEnabled ? providers.embedding.provider : null,
      embeddingModel: vectorIndexEnabled ? providers.embedding.model : null,
      embeddingDimensions: vectorIndexEnabled ? providers.embedding.dimensions : null,
      visualOcr: {
        version: VISUAL_OCR_VERSION,
        ...visualOcr,
        warning: visualOcr.warning ?? null,
      },
    };
    const { error: versionUpdateError } = await context.supabase
      .from('document_versions')
      .update({
        status: 'ready',
        content_hash: contentHash,
        error_message: null,
        metadata: versionMetadata,
      })
      .eq('id', versionId)
      .eq('owner_id', context.ownerId);
    if (versionUpdateError) throw new ProcessingError('문서 처리 결과를 확정하지 못했습니다.');

    const indexedDocument: IndexedDocument = {
      document: {
        ...parsed,
        folderId: documentResult.data.folder_id,
        sortOrder: documentResult.data.sort_order,
        blocks: [],
      },
      chunks,
      status: 'ready',
      indexedAt: processedAt,
    };
    const response = { document: indexedDocument } satisfies ProcessDocumentResponse;
    return Response.json(response);
  } catch (error) {
    if (vectorIndexStarted && vectorStore) {
      try {
        await vectorStore.deleteByVersion(context.ownerId, versionId);
      } catch (cleanupError) {
        console.error('Failed to clean up Qdrant points after processing failure', cleanupError);
      }
    }
    const publicError = error instanceof ProcessingError
      || error instanceof DocumentValidationError
      || error instanceof DocumentParsingError
      || error instanceof QdrantConfigurationError
      || error instanceof QdrantInferenceError
      ? error.message
      : '문서 처리에 실패했습니다.';
    const status = error instanceof ProcessingError
      ? error.status
      : error instanceof QdrantConfigurationError
        ? 503
      : error instanceof QdrantInferenceError
        ? 502
      : error instanceof DocumentValidationError || error instanceof DocumentParsingError
        ? 422
        : 500;
    console.error('Document processing failed', error);
    await cleanupFailedDocumentVersion(publicError, {
      deleteChunks: async () => {
        const { error: chunkCleanupError } = await context.supabase
          .from('document_chunks')
          .delete()
          .eq('version_id', versionId)
          .eq('owner_id', context.ownerId);
        if (chunkCleanupError) throw chunkCleanupError;
      },
      markFailed: async (message) => {
        const { error: versionFailureError } = await context.supabase
          .from('document_versions')
          .update({ status: 'failed', error_message: message.slice(0, 500) })
          .eq('id', versionId)
          .eq('owner_id', context.ownerId);
        if (versionFailureError) throw versionFailureError;
      },
    });
    return Response.json({ error: publicError }, { status });
  }
}
