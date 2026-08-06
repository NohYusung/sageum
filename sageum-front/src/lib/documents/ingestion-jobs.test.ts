import assert from 'node:assert/strict';
import test from 'node:test';
import { mapStoredIngestionJob } from './ingestion-jobs';

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
});

test('알 수 없는 상태는 실패 상태로 안전하게 변환한다', () => {
  const job = mapStoredIngestionJob({ ...ROW, status: 'unknown', stage: 'unknown' });

  assert.equal(job.status, 'failed');
  assert.equal(job.stage, 'failed');
});
