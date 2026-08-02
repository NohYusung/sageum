import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSearchRequest } from './search-request';

const DOCUMENT_ID = '123e4567-e89b-42d3-a456-426614174000';

test('검색 요청의 기본 topK와 중복 제거된 문서 필터를 반환한다', () => {
  assert.deepEqual(
    parseSearchRequest({
      query: '  재택근무 기준  ',
      documentIds: [DOCUMENT_ID, DOCUMENT_ID],
    }),
    {
      query: '재택근무 기준',
      documentIds: [DOCUMENT_ID],
      topK: 8,
    },
  );
});

test('빈 질문과 올바르지 않은 문서 ID를 거부한다', () => {
  assert.throws(() => parseSearchRequest({ query: ' ' }), /질문/u);
  assert.throws(
    () => parseSearchRequest({ query: '질문', documentIds: ['other-user-document'] }),
    /식별자/u,
  );
});

test('검색 결과 개수를 1~20으로 제한한다', () => {
  assert.throws(() => parseSearchRequest({ query: '질문', topK: 0 }), /1~20/u);
  assert.throws(() => parseSearchRequest({ query: '질문', topK: 21 }), /1~20/u);
  assert.equal(parseSearchRequest({ query: '질문', topK: 4 }).topK, 4);
});

test('브라우저 벡터 필드 없이 질문 원문만 반환한다', () => {
  assert.deepEqual(parseSearchRequest({ query: ' 질문 ' }), {
    query: '질문',
    documentIds: [],
    topK: 8,
  });
});
