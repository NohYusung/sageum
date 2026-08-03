import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupDocumentDeletion, type DocumentDeletionOperations } from './document-deletion';

function operations(events: string[], failAt?: 'vectors' | 'storage' | 'complete') {
  return {
    deleteVectors: async () => {
      events.push('vectors');
      if (failAt === 'vectors') throw new Error('Qdrant deletion failed');
    },
    deleteStorage: async () => {
      events.push('storage');
      if (failAt === 'storage') throw new Error('Storage deletion failed');
    },
    complete: async () => {
      events.push('complete');
      if (failAt === 'complete') throw new Error('Database completion failed');
    },
    markFailed: async (message: string) => {
      events.push(`failed:${message}`);
    },
  } satisfies DocumentDeletionOperations;
}

const JOB = {
  jobId: 'job-id',
  storagePaths: ['owner/document/version/file.pdf'],
  requiresVectorCleanup: true,
};

test('벡터·Storage 삭제 후 DB 삭제 트랜잭션을 완료한다', async () => {
  const events: string[] = [];
  await cleanupDocumentDeletion(JOB, operations(events));
  assert.deepEqual(events, ['vectors', 'storage', 'complete']);
});

test('원본 경로가 없는 실패 문서도 벡터와 DB를 삭제한다', async () => {
  const events: string[] = [];
  await cleanupDocumentDeletion({ ...JOB, storagePaths: [] }, operations(events));
  assert.deepEqual(events, ['vectors', 'complete']);
});

test('외부 삭제 실패를 작업에 기록하고 DB 삭제를 실행하지 않는다', async () => {
  const events: string[] = [];
  await assert.rejects(
    () => cleanupDocumentDeletion(JOB, operations(events, 'storage')),
    /Storage deletion failed/u,
  );
  assert.deepEqual(events, [
    'vectors',
    'storage',
    'failed:Storage deletion failed',
  ]);
});
