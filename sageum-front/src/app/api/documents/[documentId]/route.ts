import { DOCUMENT_BUCKET } from '@/lib/documents/validation';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { getIndexedDocument } from '@/lib/server/document-repository';
import {
  cleanupDocumentDeletion,
  type DocumentDeletionJob,
} from '@/lib/server/document-deletion';
import { getProviderConfiguration } from '@/lib/server/env';
import { getQdrantVectorStore } from '@/lib/server/qdrant-store';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { documentId } = await params;
  if (!UUID_PATTERN.test(documentId)) {
    return Response.json({ error: '올바른 문서 식별자가 필요합니다.' }, { status: 400 });
  }
  try {
    const document = await getIndexedDocument(context.supabase, context.ownerId, documentId);
    if (!document) return Response.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
    return Response.json({ document }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to load document', error);
    return Response.json({ error: '문서를 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { documentId } = await params;
  if (!UUID_PATTERN.test(documentId)) {
    return Response.json({ error: '올바른 문서 식별자가 필요합니다.' }, { status: 400 });
  }

  const { data: deletionRows, error: requestError } = await context.supabase.rpc(
    'request_document_deletion',
    { p_document_id: documentId },
  );
  if (requestError?.code === 'P0002') return new Response(null, { status: 204 });
  if (requestError) {
    console.error('Failed to request document deletion', requestError);
    return Response.json({ error: '문서 삭제 요청을 등록하지 못했습니다.' }, { status: 500 });
  }

  const deletionRow = deletionRows[0];
  if (!deletionRow) {
    return Response.json({ error: '문서 삭제 작업을 생성하지 못했습니다.' }, { status: 500 });
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
          await getQdrantVectorStore().deleteByDocument(context.ownerId, documentId);
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
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Document deletion failed', error);
    return Response.json(
      {
        error: '문서 삭제를 완료하지 못했습니다. 문서는 검색에서 제외되었으며 다시 삭제할 수 있습니다.',
        code: 'DOCUMENT_DELETION_RETRY_REQUIRED',
      },
      { status: 502 },
    );
  }
}
