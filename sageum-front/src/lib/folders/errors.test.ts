import assert from 'node:assert/strict';
import test from 'node:test';
import { folderDatabaseError } from './errors';

test('폴더 제약 오류를 사용자 메시지로 변환한다', () => {
  assert.match(folderDatabaseError({ code: '23505' }, '실패'), /동일한 이름/u);
  assert.match(folderDatabaseError({ code: '23503' }, '실패'), /비어 있지 않은/u);
  assert.match(folderDatabaseError({ code: '23514' }, '실패'), /하위 폴더/u);
  assert.equal(folderDatabaseError({ code: 'other' }, '실패'), '실패');
});
