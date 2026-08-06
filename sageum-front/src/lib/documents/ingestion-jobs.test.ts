import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canResumeDocumentIngestion,
  INGESTION_RECOVERY_DELAY_MS,
  mapStoredIngestionJob,
} from './ingestion-jobs';

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  owner_id: '22222222-2222-4222-8222-222222222222',
  document_id: '33333333-3333-4333-8333-333333333333',
  version_id: '44444444-4444-4444-8444-444444444444',
  retry_of_job_id: null,
  folder_id: null,
  file_name: '운영문서.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  status: 'failed',
  stage: 'indexing',
  attempts: 2,
  original_available: true,
  processing_token: null,
  workflow_run_id: 'wfr_test',
  last_error: 'Qdrant 색인 실패',
  started_at: '2026-08-06T00:00:00.000Z',
  completed_at: '2026-08-06T00:01:00.000Z',
  created_at: '2026-08-05T23:59:00.000Z',
  updated_at: '2026-08-06T00:01:00.000Z',
};

test('DB ingestion job을 영구 처리 이력 모델로 변환한다', () => {
  const job = mapStoredIngestionJob(ROW);

  assert.equal(job.id, ROW.id);
  assert.equal(job.fileName, '운영문서.pdf');
  assert.equal(job.status, 'failed');
  assert.equal(job.stage, 'indexing');
  assert.equal(job.attempts, 2);
  assert.equal(job.originalAvailable, true);
  assert.equal(job.workflowRunId, 'wfr_test');
});

test('알 수 없는 상태는 실패 상태로 안전하게 변환한다', () => {
  const job = mapStoredIngestionJob({ ...ROW, status: 'unknown', stage: 'unknown' });

  assert.equal(job.status, 'failed');
  assert.equal(job.stage, 'failed');
});

test('원본 업로드 단계에서 Workflow가 시작되지 않은 정체 작업은 재개할 수 있다', () => {
  const job = mapStoredIngestionJob({
    ...ROW,
    status: 'uploading',
    stage: 'uploading',
    workflow_run_id: null,
    original_available: false,
    updated_at: '2026-08-06T00:00:00.000Z',
  });

  assert.equal(
    canResumeDocumentIngestion(
      job,
      Date.parse(job.updatedAt) + INGESTION_RECOVERY_DELAY_MS,
    ),
    true,
  );
});

test('정상 업로드 중이거나 이미 Workflow가 시작된 작업은 재개 대상으로 보지 않는다', () => {
  const uploading = mapStoredIngestionJob({
    ...ROW,
    status: 'uploading',
    stage: 'uploading',
    workflow_run_id: null,
    updated_at: '2026-08-06T00:00:00.000Z',
  });
  const now = Date.parse(uploading.updatedAt) + INGESTION_RECOVERY_DELAY_MS - 1;

  assert.equal(canResumeDocumentIngestion(uploading, now), false);
  assert.equal(
    canResumeDocumentIngestion({ ...uploading, workflowRunId: 'wfr_started' }, now + 1),
    false,
  );
  assert.equal(
    canResumeDocumentIngestion({ ...uploading, status: 'processing', stage: 'parsing' }, now + 1),
    false,
  );
});
