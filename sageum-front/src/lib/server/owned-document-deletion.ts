import { DOCUMENT_BUCKET } from '@/lib/documents/validation';
import type { AuthenticatedRequestContext } from '@/lib/server/api-auth';
import { cleanupDocumentDeletion, type DocumentDeletionJob } from '@/lib/server/document-deletion';
import { getProviderConfiguration } from '@/lib/server/env';
import { getQdrantRelationVectorStore } from '@/lib/server/relation-vector-store';
import { getQdrantVectorStore } from '@/lib/server/qdrant-store';
import { getQdrantSemanticNodeVectorStore } from '@/lib/server/semantic-node-vector-store';

export class OwnedDocumentDeletionError extends Error {
  constructor(
    message: string,
    readonly status: 500 | 502,
    readonly code?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'OwnedDocumentDeletionError';
  }
}

export async function deleteOwnedDocument(
  context: AuthenticatedRequestContext,
  documentId: string,
) {
  const { data: deletionRows, error: requestError } = await context.supabase.rpc(
    'request_document_deletion',
    { p_document_id: documentId },
  );
  if (requestError?.code === 'P0002') return;
  if (requestError) {
    throw new OwnedDocumentDeletionError(
      '문서 삭제 요청을 등록하지 못했습니다.',
      500,
      undefined,
      { cause: requestError },
    );
  }

  const deletionRow = deletionRows[0];
  if (!deletionRow) {
    throw new OwnedDocumentDeletionError('문서 삭제 작업을 생성하지 못했습니다.', 500);
  }

  const expectedPathPrefix = `${context.ownerId}/${documentId}/`;
  const storagePaths = [...new Set(deletionRow.storage_paths)];
  const job: DocumentDeletionJob = {
    jobId: deletionRow.job_id,
    storagePaths,
    requiresVectorCleanup: deletionRow.requires_vector_cleanup,
  };
  const providers = getProviderConfiguration();

  try {
    await cleanupDocumentDeletion(job, {
      deleteVectors: async () => {
        if (providers.qdrant.configured) {
          await Promise.all([
            getQdrantVectorStore().deleteByDocument(context.ownerId, documentId),
            getQdrantRelationVectorStore().deleteByRuleDocument(context.ownerId, documentId),
            getQdrantSemanticNodeVectorStore().deleteByDocument(context.ownerId, documentId),
            getQdrantSemanticNodeVectorStore().deleteByRuleDocument(context.ownerId, documentId),
          ]);
          return;
        }
        if (job.requiresVectorCleanup) {
          throw new Error('Qdrant 설정이 없어 기존 벡터를 안전하게 삭제할 수 없습니다.');
        }
      },
      deleteStorage: async (paths) => {
        if (paths.some((path) => !path.startsWith(expectedPathPrefix))) {
          throw new Error('문서 원본 저장 경로가 소유 범위를 벗어났습니다.');
        }
        for (let start = 0; start < paths.length; start += 1000) {
          const { error } = await context.supabase.storage
            .from(DOCUMENT_BUCKET)
            .remove(paths.slice(start, start + 1000));
          if (error) throw new Error('Supabase Storage 원본 삭제에 실패했습니다.', { cause: error });
        }
      },
      complete: async () => {
        const { error } = await context.supabase.rpc('complete_document_deletion', {
          p_document_id: documentId,
          p_job_id: job.jobId,
        });
        if (error && error.code !== 'P0002') {
          throw new Error('Supabase 문서 삭제 트랜잭션을 완료하지 못했습니다.', { cause: error });
        }
      },
      markFailed: async (message) => {
        const { error } = await context.supabase
          .from('document_deletion_jobs')
          .update({
            status: 'failed',
            last_error: message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.jobId)
          .eq('owner_id', context.ownerId);
        if (error) throw new Error('삭제 실패 상태를 저장하지 못했습니다.', { cause: error });
      },
    });
  } catch (error) {
    throw new OwnedDocumentDeletionError(
      '문서 삭제를 완료하지 못했습니다. 문서는 검색에서 제외되었으며 다시 삭제할 수 있습니다.',
      502,
      'DOCUMENT_DELETION_RETRY_REQUIRED',
      { cause: error },
    );
  }
}
