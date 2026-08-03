import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanupFailedDocumentVersion,
  type FailedDocumentVersionCleanupOperations,
} from './document-processing-failure';

function operations(events: string[], chunkCleanupFails = false) {
  return {
    deleteChunks: async () => {
      events.push('chunks');
      if (chunkCleanupFails) throw new Error('chunk cleanup failed');
    },
    markFailed: async (message: string) => {
      events.push(`failed:${message}`);
    },
  } satisfies FailedDocumentVersionCleanupOperations;
}

test('문서 처리 실패 시 생성된 청크를 지운 뒤 버전을 실패 처리한다', async () => {
  const events: string[] = [];
  await cleanupFailedDocumentVersion('processing failed', operations(events));
  assert.deepEqual(events, ['chunks', 'failed:processing failed']);
});

test('청크 정리 실패와 무관하게 버전 실패 상태를 기록한다', async (context) => {
  const events: string[] = [];
  const loggedErrors: unknown[][] = [];
  context.mock.method(console, 'error', (...args: unknown[]) => {
    loggedErrors.push(args);
  });

  await cleanupFailedDocumentVersion('processing failed', operations(events, true));

  assert.deepEqual(events, ['chunks', 'failed:processing failed']);
  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0][0], 'Failed to clean up document chunks after processing failure');
});
