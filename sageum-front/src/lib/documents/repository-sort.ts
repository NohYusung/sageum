import type { IndexedDocument } from '@/lib/rag/local-search';
import type { Folder } from '@/lib/folders/types';

export type DocumentSort = 'name' | 'recent' | 'type';

function compareNames(left: IndexedDocument, right: IndexedDocument) {
  return left.document.title.localeCompare(right.document.title, 'ko-KR', {
    numeric: true,
    sensitivity: 'base',
  }) || left.document.name.localeCompare(right.document.name, 'ko-KR', {
    numeric: true,
    sensitivity: 'base',
  });
}

export function sortRepositoryDocuments(documents: IndexedDocument[], sort: DocumentSort) {
  return documents.toSorted((left, right) => {
    if (sort === 'recent') {
      return new Date(right.indexedAt).getTime() - new Date(left.indexedAt).getTime()
        || compareNames(left, right);
    }
    if (sort === 'type') {
      return left.document.sourceType.localeCompare(right.document.sourceType, 'en-US')
        || compareNames(left, right);
    }
    return compareNames(left, right);
  });
}

export function sortRepositoryFolders(folders: Folder[], sort: DocumentSort) {
  return folders.toSorted((left, right) => {
    if (sort === 'recent') {
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        || left.name.localeCompare(right.name, 'ko-KR', {
          numeric: true,
          sensitivity: 'base',
        });
    }
    return left.name.localeCompare(right.name, 'ko-KR', {
      numeric: true,
      sensitivity: 'base',
    });
  });
}
