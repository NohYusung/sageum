import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupFailedIngestionJob } from './browser-delete';

test('실패 작업 정리 API를 DELETE로 호출한다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let request: { input: string; method: string | undefined } | null = null;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), method: init?.method };
    return new Response(null, { status: 204 });
  };

  await cleanupFailedIngestionJob('job/id');
  assert.deepEqual(request, {
    input: '/api/ingestion-jobs/job%2Fid',
    method: 'DELETE',
  });
});

test('실패 작업 정리 API의 오류 메시지를 전달한다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => Response.json(
    { error: '정리할 수 없는 작업입니다.' },
    { status: 409 },
  );

  await assert.rejects(
    () => cleanupFailedIngestionJob('job-id'),
    /정리할 수 없는 작업입니다/u,
  );
});
