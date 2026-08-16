import type { DocumentIngestionJobResponse } from '@/lib/documents/contracts';
import { DOCUMENT_BUCKET } from '@/lib/documents/validation';
import { mapStoredIngestionJob } from '@/lib/documents/ingestion-jobs';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import {
  cleanupDocumentDeletion,
  type DocumentDeletionJob,
} from '@/lib/server/document-deletion';
import { getProviderConfiguration } from '@/lib/server/env';
import { getQdrantVectorStore } from '@/lib/server/qdrant-store';
import { getQdrantSemanticNodeVectorStore } from '@/lib/server/semantic-node-vector-store';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { jobId } = await params;
  if (!UUID_PATTERN.test(jobId)) {
    return Response.json({ error: '올바른 처리 작업 식별자가 필요합니다.' }, { status: 400 });
  }

  const { data: job, error } = await context.supabase
    .from('document_ingestion_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('owner_id', context.ownerId)
    .maybeSingle();

  if (error) {
    return Response.json({ error: '문서 처리 이력을 조회하지 못했습니다.' }, { status: 500 });
  }
  if (!job) return Response.json({ error: '문서 처리 이력을 찾을 수 없습니다.' }, { status: 404 });

  const response = { job: mapStoredIngestionJob(job) } satisfies DocumentIngestionJobResponse;
  return Response.json(response, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { jobId } = await params;
  if (!UUID_PATTERN.test(jobId)) {
    return Response.json({ error: '올바른 처리 작업 식별자가 필요합니다.' }, { status: 400 });
  }

  const { data: cleanupRows, error: requestError } = await context.supabase.rpc(
    'request_failed_ingestion_cleanup',
    { p_job_id: jobId },
  );
  if (requestError?.code === 'P0002') return new Response(null, { status: 204 });
  if (requestError?.code === 'P0001') {
    return Response.json(
      { error: '이미 정리 중이거나 안전하게 정리할 수 없는 실패 작업입니다.' },
      { status: 409 },
    );
  }
  if (requestError) {
    console.error('Failed to request failed ingestion cleanup', requestError);
    return Response.json({ error: '실패 작업 정리를 시작하지 못했습니다.' }, { status: 500 });
  }

  const cleanup = cleanupRows[0];
  if (!cleanup) {
    return Response.json({ error: '실패 작업 정리 정보를 만들지 못했습니다.' }, { status: 500 });
  }
  if (cleanup.cleanup_completed) return new Response(null, { status: 204 });
  if (!cleanup.document_id || !cleanup.deletion_job_id) {
    return Response.json({ error: '실패 작업의 문서 정리 정보가 올바르지 않습니다.' }, { status: 500 });
  }

  const documentId = cleanup.document_id;
  const expectedPathPrefix = `${context.ownerId}/${documentId}/`;
  const storagePaths = [...new Set(cleanup.storage_paths)];
  const deletionJob: DocumentDeletionJob = {
    jobId: cleanup.deletion_job_id,
    storagePaths,
    requiresVectorCleanup: cleanup.requires_vector_cleanup,
  };
  const providers = getProviderConfiguration();

  try {
    await cleanupDocumentDeletion(deletionJob, {
      deleteVectors: async () => {
        if (providers.qdrant.configured) {
          await Promise.all([
            getQdrantVectorStore().deleteByDocument(context.ownerId, documentId),
            getQdrantSemanticNodeVectorStore().deleteByDocument(context.ownerId, documentId),
            getQdrantSemanticNodeVectorStore().deleteByRuleDocument(context.ownerId, documentId),
          ]);
          return;
        }
        if (deletionJob.requiresVectorCleanup) {
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
        const { error } = await context.supabase.rpc('complete_failed_ingestion_cleanup', {
          p_ingestion_job_id: jobId,
          p_document_id: documentId,
          p_deletion_job_id: deletionJob.jobId,
        });
        if (error) {
          throw new Error('실패 작업의 DB 정리 트랜잭션을 완료하지 못했습니다.', { cause: error });
        }
      },
      markFailed: async (message) => {
        const { error } = await context.supabase.rpc('mark_failed_ingestion_cleanup', {
          p_ingestion_job_id: jobId,
          p_deletion_job_id: deletionJob.jobId,
          p_message: message,
        });
        if (error) throw new Error('실패 작업 정리 오류를 저장하지 못했습니다.', { cause: error });
      },
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Failed ingestion cleanup failed', error);
    return Response.json(
      {
        error: '실패 작업 정리를 완료하지 못했습니다. 이력은 유지되며 다시 정리할 수 있습니다.',
        code: 'FAILED_INGESTION_CLEANUP_RETRY_REQUIRED',
      },
      { status: 502 },
    );
  }
}
