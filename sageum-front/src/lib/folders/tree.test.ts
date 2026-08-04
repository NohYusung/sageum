import assert from 'node:assert/strict';
import test from 'node:test';
import type { IndexedDocument } from '@/lib/rag/local-search';
import type { Folder } from './types';
import {
  canMoveFolder,
  descendantFolderIds,
  documentsInFolderScope,
  flattenFolderTree,
  folderPath,
} from './tree';

function folder(id: string, name: string, parentId: string | null): Folder {
  return {
    id,
    name,
    parentId,
    sortOrder: 0,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
  };
}

const folders = [
  folder('root-a', '개발팀', null),
  folder('child-a', 'API', 'root-a'),
  folder('grandchild-a', '인증', 'child-a'),
  folder('root-b', '인사팀', null),
];

function document(id: string, folderId: string | null): IndexedDocument {
  return {
    document: {
      id,
      versionId: `${id}-version`,
      name: `${id}.txt`,
      title: id,
      mimeType: 'text/plain',
      sourceType: 'text',
      sizeBytes: 10,
      folderId,
      sortOrder: 0,
      blocks: [],
    },
    chunks: [],
    status: 'ready',
    indexedAt: '2026-08-04T00:00:00.000Z',
  };
}

test('폴더를 깊이 우선 순서와 경로로 변환한다', () => {
  assert.deepEqual(
    flattenFolderTree(folders).map(({ id, depth }) => [id, depth]),
    [['root-a', 0], ['child-a', 1], ['grandchild-a', 2], ['root-b', 0]],
  );
  assert.deepEqual(folderPath(folders, 'grandchild-a').map(({ id }) => id), [
    'root-a',
    'child-a',
    'grandchild-a',
  ]);
});

test('하위 폴더 범위의 문서만 재귀적으로 선택한다', () => {
  const documents = [
    document('root-document', null),
    document('api-document', 'child-a'),
    document('auth-document', 'grandchild-a'),
    document('hr-document', 'root-b'),
  ];
  assert.deepEqual([...descendantFolderIds(folders, 'root-a')], [
    'root-a',
    'child-a',
    'grandchild-a',
  ]);
  assert.deepEqual(
    documentsInFolderScope(documents, folders, 'root-a', { recursive: true })
      .map(({ document: found }) => found.id),
    ['api-document', 'auth-document'],
  );
  assert.equal(documentsInFolderScope(documents, folders, null).length, 1);
});

test('폴더를 자기 하위 폴더 아래로 이동하지 못하게 한다', () => {
  assert.equal(canMoveFolder(folders, 'root-a', 'grandchild-a'), false);
  assert.equal(canMoveFolder(folders, 'root-a', 'root-b'), true);
  assert.equal(canMoveFolder(folders, 'root-a', null), true);
});
