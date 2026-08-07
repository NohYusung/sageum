import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_DOCUMENT_BYTES,
  storageObjectName,
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
    },
  );
});

test('Storage 객체명은 원본 파일명과 무관한 ASCII 버전 키를 사용한다', () => {
  const versionId = 'd9a356c0-87f2-4d3d-b3ce-38971390b623';
  assert.equal(storageObjectName(versionId, 'docx'), `${versionId}.docx`);
  assert.equal(storageObjectName(versionId, 'xlsx'), `${versionId}.xlsx`);
});

test('빈 파일과 50MB 초과 파일을 거부한다', () => {
  assert.equal(
    validateDocumentMetadata({
      name: 'limit.txt',
      mimeType: 'text/plain',
      sizeBytes: MAX_DOCUMENT_BYTES,
    }).sizeBytes,
    MAX_DOCUMENT_BYTES,
  );
  assert.throws(
    () => validateDocumentMetadata({ name: 'empty.txt', mimeType: 'text/plain', sizeBytes: 0 }),
    /빈 파일/u,
  );
  assert.throws(
    () => validateDocumentMetadata({ name: 'large.txt', mimeType: 'text/plain', sizeBytes: MAX_DOCUMENT_BYTES + 1 }),
    /50MB/u,
  );
});

test('PDF·DOCX·XLSX 형식을 처리 대상으로 정규화한다', () => {
  assert.equal(
    validateDocumentMetadata({ name: 'manual.docx', mimeType: '', sizeBytes: 10 }).sourceType,
    'docx',
  );
  assert.equal(
    validateDocumentMetadata({ name: 'report.pdf', mimeType: '', sizeBytes: 10 }).sourceType,
    'pdf',
  );
  assert.equal(
    validateDocumentMetadata({ name: 'metrics.xlsx', mimeType: '', sizeBytes: 10 }).sourceType,
    'xlsx',
  );
});

test('알 수 없는 형식을 거부한다', () => {
  assert.throws(
    () => validateDocumentMetadata({ name: 'archive.zip', mimeType: 'application/zip', sizeBytes: 10 }),
    /파일만 업로드/u,
  );
});
