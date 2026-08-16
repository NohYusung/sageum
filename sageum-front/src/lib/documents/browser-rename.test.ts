import assert from 'node:assert/strict';
import test from 'node:test';
import { splitDocumentFilename } from './browser-rename';

test('마지막 확장자만 고정 영역으로 분리한다', () => {
  assert.deepEqual(splitDocumentFilename('운영 문서.v2.docx'), {
    basename: '운영 문서.v2',
    extension: '.docx',
  });
  assert.deepEqual(splitDocumentFilename('문서'), {
    basename: '문서',
    extension: '',
  });
});
