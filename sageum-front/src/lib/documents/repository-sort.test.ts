import assert from 'node:assert/strict';
import test from 'node:test';
import type { IndexedDocument } from '@/lib/rag/local-search';
import type { DocumentSourceType } from '@/lib/rag/types';
import { sortRepositoryDocuments, sortRepositoryFolders } from './repository-sort';

function indexedDocument(
  title: string,
  sourceType: DocumentSourceType,
  indexedAt: string,
): IndexedDocument {
  return {
    document: {
      id: `${title}-document`,
      versionId: `${title}-version`,
      name: `${title}.${sourceType}`,
      title,
      mimeType: 'application/octet-stream',
      sourceType,
      sizeBytes: 1,
      blocks: [],
    },
    chunks: [],
    status: 'ready',
    indexedAt,
  };
}

const documents = [
  indexedDocument('문서 10', 'pdf', '2026-08-01T00:00:00.000Z'),
  indexedDocument('문서 2', 'xlsx', '2026-08-03T00:00:00.000Z'),
  indexedDocument('가이드', 'docx', '2026-08-02T00:00:00.000Z'),
];

test('저장소 파일을 기본 이름순으로 자연스럽게 정렬한다', () => {
  assert.deepEqual(
    sortRepositoryDocuments(documents, 'name').map(({ document }) => document.title),
    ['가이드', '문서 2', '문서 10'],
  );
});

test('최근 인덱싱순과 파일 형식순을 선택할 수 있다', () => {
  assert.deepEqual(
    sortRepositoryDocuments(documents, 'recent').map(({ document }) => document.title),
    ['문서 2', '가이드', '문서 10'],
  );
  assert.deepEqual(
    sortRepositoryDocuments(documents, 'type').map(({ document }) => document.sourceType),
    ['docx', 'pdf', 'xlsx'],
  );
});

test('폴더도 Finder 방식의 자연 이름순과 최근 수정순으로 정렬한다', () => {
  const folders = [
    { id: '10', parentId: null, name: '폴더 10', sortOrder: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    { id: '2', parentId: null, name: '폴더 2', sortOrder: 0, createdAt: '2026-01-02', updatedAt: '2026-01-03' },
  ];

  assert.deepEqual(sortRepositoryFolders(folders, 'name').map((folder) => folder.id), ['2', '10']);
  assert.deepEqual(sortRepositoryFolders(folders, 'recent').map((folder) => folder.id), ['2', '10']);
});
