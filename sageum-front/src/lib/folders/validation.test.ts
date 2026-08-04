import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFolderId, parseFolderName } from './validation';

const FOLDER_ID = '123e4567-e89b-42d3-a456-426614174000';

test('폴더 이름의 공백을 정리하고 경로 구분자를 거부한다', () => {
  assert.equal(parseFolderName('  개발 문서  '), '개발 문서');
  assert.throws(() => parseFolderName('개발/API'), /\//u);
});

test('선택적 폴더 식별자는 루트 null과 UUID를 허용한다', () => {
  assert.equal(parseFolderId(null, { optional: true }), null);
  assert.equal(parseFolderId(FOLDER_ID, { optional: true }), FOLDER_ID);
  assert.throws(() => parseFolderId('root', { optional: true }), /식별자/u);
});
