import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapStoredDocument,
  type StoredDocument,
  type StoredDocumentChunk,
  type StoredDocumentVersion,
} from './repository-mapper';

const document: StoredDocument = {
  id: 'document-id',
  owner_id: 'owner-id',
  deletion_status: 'active',
  document_kind: 'knowledge',
  folder_id: null,
  title: '운영 정책',
  source_type: 'markdown',
  latest_version_id: 'version-id',
  sort_order: 0,
  created_at: '2026-08-02T00:00:00.000Z',
  updated_at: '2026-08-02T00:01:00.000Z',
};

const version: StoredDocumentVersion = {
  id: 'version-id',
  document_id: 'document-id',
  owner_id: 'owner-id',
  storage_path: 'owner-id/document-id/version-id/policy.md',
  original_filename: 'policy.md',
  mime_type: 'text/markdown',
  size_bytes: 120,
  status: 'ready',
  content_hash: 'hash',
  error_message: null,
  metadata: { processedAt: '2026-08-02T00:02:00.000Z' },
  created_at: '2026-08-02T00:01:00.000Z',
};

const chunk: StoredDocumentChunk = {
  id: 'version-id:000000',
  document_id: 'document-id',
  version_id: 'version-id',
  owner_id: 'owner-id',
  ordinal: 0,
  text: '재택근무는 주 2회 가능합니다.',
  word_count: 4,
  heading_path: ['운영 정책'],
  page: null,
  sheet: null,
  cell_range: null,
  start_offset: 0,
  end_offset: 20,
  metadata: {
    blockStart: 1,
    blockEnd: 2,
    sourceSpans: [{
      blockId: 'block_000001',
      blockIndex: 1,
      startOffset: 3,
      endOffset: 20,
      startWord: 1,
      endWord: 4,
    }],
  },
  created_at: '2026-08-02T00:02:00.000Z',
};

test('Supabase 문서 행을 클라이언트 검색 모델로 복원한다', () => {
  const indexed = mapStoredDocument(document, version, [chunk]);

  assert.equal(indexed.document.versionId, 'version-id');
  assert.equal(indexed.document.folderId, null);
  assert.equal(indexed.document.sourceType, 'markdown');
  assert.equal(indexed.status, 'ready');
  assert.equal(indexed.indexedAt, '2026-08-02T00:02:00.000Z');
  assert.deepEqual(indexed.chunks[0].headingPath, ['운영 정책']);
  assert.equal(indexed.chunks[0].blockStart, 1);
  assert.equal(indexed.chunks[0].focusBlock, 2);
  assert.equal(indexed.chunks[0].location.startOffset, 0);
  assert.equal(indexed.chunks[0].sourceSpans[0].blockId, 'block_000001');
  assert.equal(indexed.chunks[0].sourceSpans[0].startOffset, 3);
});

test('새 청크의 명시적인 이동 블록을 우선한다', () => {
  const indexed = mapStoredDocument(document, version, [{
    ...chunk,
    metadata: { blockStart: 1, blockEnd: 4, focusBlock: 2 },
  }]);

  assert.equal(indexed.chunks[0].focusBlock, 2);
});

test('처리 중과 실패 상태를 UI 상태로 변환한다', () => {
  assert.equal(mapStoredDocument(document, { ...version, status: 'parsing' }, []).status, 'processing');
  assert.equal(mapStoredDocument(document, { ...version, status: 'failed' }, []).status, 'failed');
});

test('삭제 요청된 문서를 삭제 진행 상태로 변환한다', () => {
  assert.equal(
    mapStoredDocument({ ...document, deletion_status: 'deleting' }, version, []).status,
    'deleting',
  );
});
