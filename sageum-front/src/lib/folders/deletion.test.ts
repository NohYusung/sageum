import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRepositoryDeletionTargets } from './deletion';

const folders = [
  { id: 'root', parentId: null },
  { id: 'child', parentId: 'root' },
  { id: 'grandchild', parentId: 'child' },
  { id: 'other', parentId: null },
];

const documents = [
  { id: 'root-file', folderId: 'root' },
  { id: 'child-file', folderId: 'child' },
  { id: 'grandchild-file', folderId: 'grandchild' },
  { id: 'other-file', folderId: 'other' },
  { id: 'loose-file', folderId: null },
];

test('선택한 폴더의 하위 폴더와 모든 문서를 재귀 삭제 대상으로 확장한다', () => {
  assert.deepEqual(resolveRepositoryDeletionTargets({
    documents,
    folders,
    selectedDocumentIds: [],
    selectedFolderIds: ['root'],
  }), {
    documentIds: ['root-file', 'child-file', 'grandchild-file'],
    folderDocumentIds: ['root-file', 'child-file', 'grandchild-file'],
    folderIds: ['root', 'child', 'grandchild'],
    rootFolderIds: ['root'],
  });
});

test('부모와 자식 폴더를 함께 선택해도 최상위 선택 폴더만 서버 삭제 루트로 유지한다', () => {
  const targets = resolveRepositoryDeletionTargets({
    documents,
    folders,
    selectedDocumentIds: ['loose-file', 'child-file'],
    selectedFolderIds: ['child', 'root'],
  });

  assert.deepEqual(targets.rootFolderIds, ['root']);
  assert.deepEqual(targets.documentIds, [
    'loose-file',
    'child-file',
    'root-file',
    'grandchild-file',
  ]);
});

test('존재하지 않는 폴더는 재귀 삭제 대상에서 제외한다', () => {
  assert.deepEqual(resolveRepositoryDeletionTargets({
    documents,
    folders,
    selectedDocumentIds: ['loose-file'],
    selectedFolderIds: ['missing'],
  }), {
    documentIds: ['loose-file'],
    folderDocumentIds: [],
    folderIds: [],
    rootFolderIds: [],
  });
});
