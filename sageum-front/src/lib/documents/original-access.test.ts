import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isExpectedOriginalStoragePath,
  parseOriginalDisposition,
  signedUrlOptions,
} from './original-access';

const OWNER_ID = '123e4567-e89b-42d3-a456-426614174010';
const DOCUMENT_ID = '123e4567-e89b-42d3-a456-426614174000';
const VERSION_ID = '123e4567-e89b-42d3-a456-426614174001';

test('원본 접근 방식은 기본값과 inline만 브라우저 표시로 허용한다', () => {
  assert.equal(parseOriginalDisposition(null), 'inline');
  assert.equal(parseOriginalDisposition('inline'), 'inline');
  assert.equal(parseOriginalDisposition('attachment'), 'attachment');
  assert.equal(parseOriginalDisposition('preview'), null);
});

test('원본 Storage 경로가 요청 사용자·문서·버전 하위인지 확인한다', () => {
  const storagePath = `${OWNER_ID}/${DOCUMENT_ID}/${VERSION_ID}/${VERSION_ID}.pdf`;

  assert.equal(isExpectedOriginalStoragePath({
    storagePath,
    ownerId: OWNER_ID,
    documentId: DOCUMENT_ID,
    versionId: VERSION_ID,
  }), true);
  assert.equal(isExpectedOriginalStoragePath({
    storagePath,
    ownerId: '123e4567-e89b-42d3-a456-426614174099',
    documentId: DOCUMENT_ID,
    versionId: VERSION_ID,
  }), false);
  assert.equal(isExpectedOriginalStoragePath({
    storagePath,
    ownerId: OWNER_ID,
    documentId: '123e4567-e89b-42d3-a456-426614174099',
    versionId: VERSION_ID,
  }), false);
  assert.equal(isExpectedOriginalStoragePath({
    storagePath: `${OWNER_ID}/${DOCUMENT_ID}/${VERSION_ID}/nested/${VERSION_ID}.pdf`,
    ownerId: OWNER_ID,
    documentId: DOCUMENT_ID,
    versionId: VERSION_ID,
  }), false);
});

test('다운로드 서명 URL에 DB의 원래 한글 파일명을 보존한다', () => {
  assert.equal(signedUrlOptions('inline', '사내 규정.pdf'), undefined);
  assert.deepEqual(
    signedUrlOptions('attachment', '사내 규정.pdf'),
    { download: '사내 규정.pdf' },
  );
});
