import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DOCUMENT_BUCKET, DocumentValidationError } from '@/lib/documents/validation';
import { CHUNKER_VERSION, chunkDocument } from '@/lib/rag/chunker';
import type { IndexedDocument } from '@/lib/rag/local-search';
import {
  DocumentParsingError,
  parseDocumentSourceWithHash,
  parserVersion,
} from '@/lib/server/document-parser';
import { cleanupFailedDocumentVersion } from '@/lib/server/document-processing-failure';
import { getIndexedDocument } from '@/lib/server/document-repository';
import { getProviderConfiguration } from '@/lib/server/env';
import {
  getQdrantVectorStore,
  QdrantConfigurationError,
  QdrantInferenceError,
} from '@/lib/server/qdrant-store';
import { getSupabaseAdminClient } from '@/lib/server/supabase';
import { enrichDocumentWithVisualOcr, VISUAL_OCR_VERSION } from '@/lib/server/visual-ocr';
import type {
  Database,
  TablesInsert,
  TablesUpdate,
} from '@/lib/supabase/database.types';

export type DocumentIngestionInput = {
  ownerId: string;
  documentId: string;
  versionId: string;
  jobId: string;
};

export type DocumentIngestionExecution = DocumentIngestionInput & {
  processingToken: string;
  finalAttempt: boolean;
};

export class DocumentIngestionProcessingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'DocumentIngestionProcessingError';
  }
}

type AdminClient = SupabaseClient<Database>;

class ProcessingError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = 'ProcessingError';
  }
}

function safeProcessingToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function publicProcessingError(error: unknown) {
  const known = error instanceof ProcessingError
    || error instanceof DocumentValidationError
    || error instanceof DocumentParsingError
    || error instanceof QdrantConfigurationError
    || error instanceof QdrantInferenceError;
  const message = known ? error.message : '문서 처리에 실패했습니다.';
  const status = error instanceof ProcessingError
    ? error.status
    : error instanceof QdrantConfigurationError
      ? 503
      : error instanceof QdrantInferenceError
        ? 502
        : error instanceof DocumentValidationError || error instanceof DocumentParsingError
          ? 422
          : 500;
  const retryable = error instanceof QdrantInferenceError
    || error instanceof ProcessingError && error.status >= 500
    || !known;
  return { message, status, retryable };
}

async function updateIngestionJob(
  supabase: AdminClient,
  ownerId: string,
  jobId: string,
  values: TablesUpdate<'document_ingestion_jobs'>,
) {
  const { error } = await supabase
    .from('document_ingestion_jobs')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('owner_id', ownerId);
  if (error) throw new ProcessingError('문서 처리 이력을 갱신하지 못했습니다.');
}

async function claimIngestionJob(
  supabase: AdminClient,
  execution: DocumentIngestionExecution,
) {
  const processingToken = safeProcessingToken(execution.processingToken);
  const { data: current, error: currentError } = await supabase
    .from('document_ingestion_jobs')
    .select('*')
    .eq('id', execution.jobId)
    .eq('owner_id', execution.ownerId)
    .eq('document_id', execution.documentId)
    .eq('version_id', execution.versionId)
    .maybeSingle();
  if (currentError) {
    throw new DocumentIngestionProcessingError('문서 처리 이력을 조회하지 못했습니다.', 500, true);
  }
  if (!current) {
    throw new DocumentIngestionProcessingError('문서 처리 이력을 찾을 수 없습니다.', 404, false);
  }
  if (current.status === 'ready') return { alreadyReady: true as const };
  if (current.status === 'failed' && !current.original_available) {
    throw new DocumentIngestionProcessingError('원본 파일을 다시 업로드해야 합니다.', 409, false);
  }

  const attempts = current.status === 'failed' || current.status === 'processing'
    ? current.attempts + 1
    : current.attempts;
  const { data: claimed, error: claimError } = await supabase
    .from('document_ingestion_jobs')
    .update({
      status: 'processing',
      stage: 'parsing',
      attempts,
      processing_token: processingToken,
      last_error: null,
      started_at: new Date().toISOString(),
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', execution.jobId)
    .eq('owner_id', execution.ownerId)
    .eq('document_id', execution.documentId)
    .eq('version_id', execution.versionId)
    .or(
      `status.eq.uploading,and(status.eq.failed,original_available.eq.true),and(status.eq.processing,processing_token.eq.${processingToken})`,
    )
    .select('id');

  if (claimError) {
    throw new DocumentIngestionProcessingError('문서 처리 작업을 시작하지 못했습니다.', 500, true);
  }
  if (!claimed.length) {
    throw new DocumentIngestionProcessingError('이미 다른 작업에서 처리 중인 문서입니다.', 409, false);
  }
  return { alreadyReady: false as const };
}

async function markProcessingFailure(
  supabase: AdminClient,
  execution: DocumentIngestionExecution,
  error: unknown,
  originalAvailability: boolean | null,
) {
  const failure = publicProcessingError(error);
  const finalFailure = execution.finalAttempt || !failure.retryable;
  await cleanupFailedDocumentVersion(failure.message, {
    deleteChunks: async () => {
      const { error: chunkCleanupError } = await supabase
        .from('document_chunks')
        .delete()
        .eq('version_id', execution.versionId)
        .eq('owner_id', execution.ownerId);
      if (chunkCleanupError) throw chunkCleanupError;
    },
    markFailed: async (message) => {
      const { error: versionFailureError } = await supabase
        .from('document_versions')
        .update({
          status: finalFailure ? 'failed' : 'parsing',
          error_message: message.slice(0, 500),
        })
        .eq('id', execution.versionId)
        .eq('owner_id', execution.ownerId);
      if (versionFailureError) throw versionFailureError;
    },
  });

  const failedAt = new Date().toISOString();
  const { error: jobFailureError } = await supabase
    .from('document_ingestion_jobs')
    .update({
      status: finalFailure ? 'failed' : 'processing',
      last_error: failure.message.slice(0, 500),
      completed_at: finalFailure ? failedAt : null,
      updated_at: failedAt,
      ...(originalAvailability === null ? {} : { original_available: originalAvailability }),
    })
    .eq('id', execution.jobId)
    .eq('owner_id', execution.ownerId);
  if (jobFailureError) {
    console.error('Failed to mark document ingestion job as failed', jobFailureError);
  }
  return failure;
}

export async function processDocumentIngestion(
  execution: DocumentIngestionExecution,
): Promise<IndexedDocument> {
  const supabase = getSupabaseAdminClient();
  const claim = await claimIngestionJob(supabase, execution);
  if (claim.alreadyReady) {
    const existing = await getIndexedDocument(supabase, execution.ownerId, execution.documentId);
    if (!existing) {
      throw new DocumentIngestionProcessingError('완료된 문서 인덱스를 찾을 수 없습니다.', 404, false);
    }
    return existing;
  }

  let vectorStore: ReturnType<typeof getQdrantVectorStore> | null = null;
  let vectorIndexStarted = false;
  let originalAvailability: boolean | null = null;
  try {
    const [documentResult, versionResult] = await Promise.all([
      supabase
        .from('documents')
        .select('*')
        .eq('id', execution.documentId)
        .eq('owner_id', execution.ownerId)
        .maybeSingle(),
      supabase
        .from('document_versions')
        .select('*')
        .eq('id', execution.versionId)
        .eq('document_id', execution.documentId)
        .eq('owner_id', execution.ownerId)
        .maybeSingle(),
    ]);
    if (documentResult.error || versionResult.error) {
      throw new ProcessingError('문서 정보를 조회하지 못했습니다.');
    }
    if (!documentResult.data || !versionResult.data) {
      throw new ProcessingError('문서를 찾을 수 없습니다.', 404);
    }
    if (documentResult.data.deletion_status === 'deleting') {
      throw new ProcessingError('삭제 중인 문서는 다시 처리할 수 없습니다.', 409);
    }

    const version = versionResult.data;
    const expectedPathPrefix = `${execution.ownerId}/${execution.documentId}/${execution.versionId}/`;
    if (!version.storage_path.startsWith(expectedPathPrefix)) {
      throw new ProcessingError('문서 저장 경로가 올바르지 않습니다.', 403);
    }

    const startedAt = new Date().toISOString();
    const { error: parsingStatusError } = await supabase
      .from('document_versions')
      .update({ status: 'parsing', error_message: null, metadata: { processingStartedAt: startedAt } })
      .eq('id', execution.versionId)
      .eq('owner_id', execution.ownerId);
    if (parsingStatusError) {
      throw new ProcessingError('문서 처리 상태를 갱신하지 못했습니다.');
    }

    const { data: originalFile, error: downloadError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .download(version.storage_path);
    if (downloadError || !originalFile) {
      originalAvailability = false;
      throw new ProcessingError('업로드된 원본 파일을 찾을 수 없습니다.', 422);
    }
    originalAvailability = true;
    await updateIngestionJob(supabase, execution.ownerId, execution.jobId, {
      stage: 'parsing',
      original_available: true,
    });

    const fileBuffer = await originalFile.arrayBuffer();
    if (fileBuffer.byteLength !== version.size_bytes) {
      originalAvailability = false;
      throw new ProcessingError('업로드된 원본 파일 크기가 요청 정보와 일치하지 않습니다.', 422);
    }
    const { document: parsedDocument, contentHash } = await parseDocumentSourceWithHash(
      new Uint8Array(fileBuffer),
      {
        name: version.original_filename,
        mimeType: version.mime_type,
        sizeBytes: version.size_bytes,
        documentId: execution.documentId,
        versionId: execution.versionId,
      },
    );
    await updateIngestionJob(supabase, execution.ownerId, execution.jobId, { stage: 'ocr' });
    const { document: parsed, report: visualOcr } = await enrichDocumentWithVisualOcr(
      new Uint8Array(fileBuffer),
      parsedDocument,
    );
    await updateIngestionJob(supabase, execution.ownerId, execution.jobId, { stage: 'chunking' });
    const chunks = chunkDocument(parsed);
    if (!chunks.length) {
      throw new ProcessingError('검색 가능한 본문이 없는 문서입니다.', 422);
    }

    const providers = getProviderConfiguration();
    const vectorIndexEnabled = providers.embedding.configured && providers.qdrant.configured;
    if (vectorIndexEnabled) {
      const indexingStartedAt = new Date().toISOString();
      const { error: indexingStatusError } = await supabase
        .from('document_versions')
        .update({
          status: 'indexing',
          error_message: null,
          metadata: { processingStartedAt: startedAt, indexingStartedAt },
        })
        .eq('id', execution.versionId)
        .eq('owner_id', execution.ownerId);
      if (indexingStatusError) {
        throw new ProcessingError('문서 인덱싱 상태를 갱신하지 못했습니다.');
      }
      await updateIngestionJob(supabase, execution.ownerId, execution.jobId, { stage: 'indexing' });

      vectorStore = getQdrantVectorStore();
      await vectorStore.ensureCollection(providers.embedding.dimensions);
      vectorIndexStarted = true;
      await vectorStore.deleteByVersion(execution.ownerId, execution.versionId);
      await vectorStore.upsert(chunks.map((chunk) => ({
        chunk,
        ownerId: execution.ownerId,
        sourceType: parsed.sourceType,
        documentTitle: parsed.title,
        embeddingModel: providers.embedding.model,
      })));
    }

    const { error: clearChunksError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('version_id', execution.versionId)
      .eq('owner_id', execution.ownerId);
    if (clearChunksError) throw new ProcessingError('기존 문서 청크를 정리하지 못했습니다.');

    const chunkRows: TablesInsert<'document_chunks'>[] = chunks.map((chunk) => ({
      id: chunk.id,
      document_id: execution.documentId,
      version_id: execution.versionId,
      owner_id: execution.ownerId,
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
    const { error: chunksError } = await supabase.from('document_chunks').insert(chunkRows);
    if (chunksError) throw new ProcessingError('문서 청크를 저장하지 못했습니다.');

    const processedAt = new Date().toISOString();
    const { error: documentUpdateError } = await supabase
      .from('documents')
      .update({
        title: parsed.title,
        source_type: parsed.sourceType,
        latest_version_id: execution.versionId,
        updated_at: processedAt,
      })
      .eq('id', execution.documentId)
      .eq('owner_id', execution.ownerId);
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
    const { error: versionUpdateError } = await supabase
      .from('document_versions')
      .update({
        status: 'ready',
        content_hash: contentHash,
        error_message: null,
        metadata: versionMetadata,
      })
      .eq('id', execution.versionId)
      .eq('owner_id', execution.ownerId);
    if (versionUpdateError) throw new ProcessingError('문서 처리 결과를 확정하지 못했습니다.');

    await updateIngestionJob(supabase, execution.ownerId, execution.jobId, {
      status: 'ready',
      stage: 'ready',
      original_available: true,
      last_error: null,
      completed_at: processedAt,
      processing_token: null,
    });

    return {
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
  } catch (error) {
    if (vectorIndexStarted && vectorStore) {
      try {
        await vectorStore.deleteByVersion(execution.ownerId, execution.versionId);
      } catch (cleanupError) {
        console.error('Failed to clean up Qdrant points after processing failure', cleanupError);
      }
    }
    console.error('Document processing failed', error);
    const failure = await markProcessingFailure(
      supabase,
      execution,
      error,
      originalAvailability,
    );
    throw new DocumentIngestionProcessingError(
      failure.message,
      failure.status,
      failure.retryable,
    );
  }
}
