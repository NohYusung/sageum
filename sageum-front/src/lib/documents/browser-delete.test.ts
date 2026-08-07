import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupFailedIngestionJob, deleteRepositoryItems } from './browser-delete';

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

test('선택한 문서와 폴더를 대량 삭제 API에 전달한다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let request: { input: string; method: string | undefined; body: string | null } | null = null;
  globalThis.fetch = async (input, init) => {
    request = {
      input: String(input),
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : null,
    };
    return Response.json({
      deletedDocumentIds: ['document-id'],
      deletedFolderIds: ['folder-id'],
      failures: [],
      folderError: null,
    });
  };

  const result = await deleteRepositoryItems({
    documentIds: ['document-id'],
    folderIds: ['folder-id'],
  });
  assert.deepEqual(request, {
    input: '/api/repository/delete',
    method: 'POST',
    body: JSON.stringify({ documentIds: ['document-id'], folderIds: ['folder-id'] }),
  });
  assert.deepEqual(result.deletedFolderIds, ['folder-id']);
});

test('대량 삭제 API의 오류 메시지를 전달한다', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => Response.json(
    { error: '일부 항목을 찾을 수 없습니다.' },
    { status: 404 },
  );

  await assert.rejects(
    () => deleteRepositoryItems({ documentIds: [], folderIds: ['missing'] }),
    /일부 항목을 찾을 수 없습니다/u,
  );
});
