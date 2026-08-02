import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_DOCUMENT_BYTES,
  safeStorageFileName,
  validateDocumentMetadata,
} from './validation';

test('Markdown 확장자를 MIME보다 우선해 정규화한다', () => {
  assert.deepEqual(
    validateDocumentMetadata({ name: ' 정책 문서.md ', mimeType: 'text/plain', sizeBytes: 128 }),
    {
      name: '정책 문서.md',
      title: '정책 문서',
      sourceType: 'markdown',
      mimeType: 'text/markdown',
      sizeBytes: 128,
      storageFileName: '정책_문서.md',
    },
  );
});

test('경로 문자가 포함된 파일명을 안전한 Storage 파일명으로 바꾼다', () => {
  assert.equal(safeStorageFileName('../보고서 / 2026?.txt'), '2026_.txt');
});

test('빈 파일과 10MB 초과 파일을 거부한다', () => {
  assert.throws(
    () => validateDocumentMetadata({ name: 'empty.txt', mimeType: 'text/plain', sizeBytes: 0 }),
    /빈 파일/u,
  );
  assert.throws(
    () => validateDocumentMetadata({ name: 'large.txt', mimeType: 'text/plain', sizeBytes: MAX_DOCUMENT_BYTES + 1 }),
    /10MB/u,
  );
});

test('아직 처리하지 못하는 Office 및 알 수 없는 형식을 거부한다', () => {
  assert.throws(
    () => validateDocumentMetadata({ name: 'manual.docx', mimeType: '', sizeBytes: 10 }),
    /다음 단계/u,
  );
  assert.throws(
    () => validateDocumentMetadata({ name: 'archive.zip', mimeType: 'application/zip', sizeBytes: 10 }),
    /현재 업로드/u,
  );
});
