import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_DOCUMENT_BYTES,
  persistedDocumentTitle,
  storageObjectName,
  validateDocumentMetadata,
  validateRenamedDocumentFilename,
} from './validation';

test('Markdown 확장자를 MIME보다 우선해 정규화한다', () => {
  assert.deepEqual(
    validateDocumentMetadata({ name: ' 정책 문서.md ', mimeType: 'text/plain', sizeBytes: 128 }),
    {
      name: '정책 문서.md',
      title: '정책 문서.md',
      sourceType: 'markdown',
      mimeType: 'text/markdown',
      sizeBytes: 128,
    },
  );
});

test('문서 제목은 확장자를 포함한 원본 파일명과 동일하다', () => {
  assert.equal(
    validateDocumentMetadata({ name: ' 운영 문서.v2.docx ', mimeType: '', sizeBytes: 10 }).title,
    '운영 문서.v2.docx',
  );
});

test('업로드 문서는 파서 제목 대신 파일명을 영구 제목으로 사용한다', () => {
  assert.equal(persistedDocumentTitle({
    originalFilename: '운영문서.docx',
    sourceMode: 'upload',
    manualTitle: null,
    parsedTitle: '개정 이력',
  }), '운영문서.docx');
  assert.equal(persistedDocumentTitle({
    originalFilename: 'manual-rule.md',
    sourceMode: 'manual',
    manualTitle: '노유성은 두비덥을 퇴사했다',
    parsedTitle: 'manual-rule',
  }), '노유성은 두비덥을 퇴사했다');
});

test('이름 변경은 기존 확장자를 그대로 보존한다', () => {
  assert.equal(
    validateRenamedDocumentFilename('운영 문서.v2.docx', '최종 운영 문서.docx'),
    '최종 운영 문서.docx',
  );
  assert.throws(
    () => validateRenamedDocumentFilename('운영 문서.docx', '운영 문서.pdf'),
    /확장자/u,
  );
  assert.throws(
    () => validateRenamedDocumentFilename('운영 문서.docx', '../운영 문서.docx'),
    /경로 문자/u,
  );
  assert.throws(
    () => validateRenamedDocumentFilename('운영 문서.docx', '.docx'),
    /확장자를 제외한/u,
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
