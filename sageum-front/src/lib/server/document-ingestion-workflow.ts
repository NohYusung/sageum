import { start } from 'workflow/api';
import type { DocumentIngestionInput } from '@/lib/server/document-ingestion';
import { getSupabaseAdminClient } from '@/lib/server/supabase';
import { documentIngestionWorkflow } from '@/workflows/document-ingestion';

export type DocumentIngestionStartResult = {
  jobId: string;
  workflowRunId: string | null;
  started: boolean;
  status: string;
};

export async function startDocumentIngestionWorkflow(
  input: DocumentIngestionInput,
): Promise<DocumentIngestionStartResult> {
  const supabase = getSupabaseAdminClient();
  const { data: job, error } = await supabase
    .from('document_ingestion_jobs')
    .select('id,status,original_available,workflow_run_id')
    .eq('id', input.jobId)
    .eq('owner_id', input.ownerId)
    .eq('document_id', input.documentId)
    .eq('version_id', input.versionId)
    .maybeSingle();
  if (error) throw new Error('문서 처리 이력을 조회하지 못했습니다.');
  if (!job) throw new Error('문서 처리 이력을 찾을 수 없습니다.');

  if (job.status === 'ready' || job.status === 'processing') {
    return {
      jobId: job.id,
      workflowRunId: job.workflow_run_id,
      started: false,
      status: job.status,
    };
  }
  if (job.status === 'uploading' && job.workflow_run_id) {
    return {
      jobId: job.id,
      workflowRunId: job.workflow_run_id,
      started: false,
      status: job.status,
    };
  }
  if (job.status === 'failed' && !job.original_available) {
    throw new Error('원본 파일을 다시 업로드해야 합니다.');
  }
  if (job.status !== 'uploading' && job.status !== 'failed') {
    throw new Error('현재 상태에서는 문서 처리를 시작할 수 없습니다.');
  }

  const run = await start(documentIngestionWorkflow, [input]);
  const { error: updateError } = await supabase
    .from('document_ingestion_jobs')
    .update({ workflow_run_id: run.runId, updated_at: new Date().toISOString() })
    .eq('id', input.jobId)
    .eq('owner_id', input.ownerId);
  if (updateError) {
    console.error('Failed to save document ingestion workflow run ID', updateError);
  }

  return {
    jobId: job.id,
    workflowRunId: run.runId,
    started: true,
    status: job.status,
  };
}
