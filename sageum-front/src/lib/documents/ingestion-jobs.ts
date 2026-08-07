import type {
  DocumentIngestionJob,
  DocumentIngestionStage,
  DocumentIngestionStatus,
} from '@/lib/documents/contracts';
import type { Tables } from '@/lib/supabase/database.types';

type StoredIngestionJob = Tables<'document_ingestion_jobs'>;

export const INGESTION_RECOVERY_DELAY_MS = 30_000;

type RecoverableIngestionJob = Pick<
  DocumentIngestionJob,
  'documentId' | 'status' | 'updatedAt' | 'versionId' | 'workflowRunId'
> & {
  stage: DocumentIngestionJob['stage'] | 'creating';
};

const STATUSES = new Set<DocumentIngestionStatus>([
  'queued',
  'uploading',
  'processing',
  'ready',
  'failed',
]);

const STAGES = new Set<DocumentIngestionStage>([
  'queued',
  'uploading',
  'parsing',
  'ocr',
  'chunking',
  'indexing',
  'ready',
  'failed',
]);

export function canResumeDocumentIngestion(
  job: RecoverableIngestionJob,
  now = Date.now(),
) {
  const updatedAt = Date.parse(job.updatedAt);
  return job.status === 'uploading'
    && job.stage === 'uploading'
    && Boolean(job.documentId && job.versionId)
    && !job.workflowRunId
    && Number.isFinite(updatedAt)
    && now - updatedAt >= INGESTION_RECOVERY_DELAY_MS;
}

export function mapStoredIngestionJob(row: StoredIngestionJob): DocumentIngestionJob {
  return {
    id: row.id,
    documentId: row.document_id,
    versionId: row.version_id,
    retryOfJobId: row.retry_of_job_id,
    folderId: row.folder_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: STATUSES.has(row.status as DocumentIngestionStatus)
      ? row.status as DocumentIngestionStatus
      : 'failed',
    stage: STAGES.has(row.stage as DocumentIngestionStage)
      ? row.stage as DocumentIngestionStage
      : 'failed',
    attempts: row.attempts,
    originalAvailable: row.original_available,
    cleanupStartedAt: row.cleanup_started_at,
    cleanupError: row.cleanup_error,
    lastError: row.last_error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    workflowRunId: row.workflow_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
