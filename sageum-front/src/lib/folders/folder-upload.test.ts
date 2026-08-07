import assert from 'node:assert/strict';
import test from 'node:test';
import type { Folder } from './types';
import {
  buildFolderUploadPlan,
  ensureFolderUploadTree,
  folderUploadPathKey,
} from './folder-upload';

function file(name: string) {
  return new File(['sample'], name, { type: 'text/plain' });
}

function folder(id: string, name: string, parentId: string | null): Folder {
  return {
    id,
    name,
    parentId,
    sortOrder: 0,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
  };
}

test('선택한 폴더를 루트로 삼고 하위 경로만 보존한다', () => {
  const plan = buildFolderUploadPlan([
    { file: file('운영.md'), relativePath: '2026/운영.md' },
    { file: file('1분기.xlsx'), relativePath: '2026/매출/1분기.xlsx' },
    { file: file('서울.txt'), relativePath: '2026/지점/서울/서울.txt' },
  ]);

  assert.equal(plan.rootName, '2026');
  assert.deepEqual(plan.directories, [
    ['2026'],
    ['2026', '매출'],
    ['2026', '지점'],
    ['2026', '지점', '서울'],
  ]);
  assert.deepEqual(plan.files.map(({ directoryPath }) => directoryPath), [
    ['2026'],
    ['2026', '매출'],
    ['2026', '지점', '서울'],
  ]);
});

test('서로 다른 최상위 폴더나 상위 탐색 경로는 거부한다', () => {
  assert.throws(() => buildFolderUploadPlan([
    { file: file('a.txt'), relativePath: '2026/a.txt' },
    { file: file('b.txt'), relativePath: '2027/b.txt' },
  ]), /한 번에 하나씩/);
  assert.throws(() => buildFolderUploadPlan([
    { file: file('a.txt'), relativePath: '2026/../a.txt' },
  ]), /상위 경로/);
});

test('목적지 아래 기존 폴더를 재사용하고 누락된 하위 폴더만 만든다', async () => {
  const destination = folder('operations', '운영', null);
  const existingRoot = folder('year-2026', '2026', destination.id);
  const plan = buildFolderUploadPlan([
    { file: file('a.txt'), relativePath: '2026/a.txt' },
    { file: file('b.txt'), relativePath: '2026/보고서/b.txt' },
  ]);
  const created: Array<{ name: string; parentId: string | null }> = [];

  const result = await ensureFolderUploadTree({
    plan,
    destinationFolderId: destination.id,
    existingFolders: [destination, existingRoot],
    create: async (name, parentId) => {
      created.push({ name, parentId });
      return folder('reports', name, parentId);
    },
  });

  assert.equal(result.rootFolderId, existingRoot.id);
  assert.deepEqual(created, [{ name: '보고서', parentId: existingRoot.id }]);
  assert.equal(
    result.folderIdsByPath.get(folderUploadPathKey(['2026', '보고서'])),
    'reports',
  );
});
