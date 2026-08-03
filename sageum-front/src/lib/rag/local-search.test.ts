import assert from 'node:assert/strict';
import test from 'node:test';
import { composeExtractiveAnswer, searchDocuments, type IndexedDocument } from './local-search';

const DOCUMENTS: IndexedDocument[] = [
  {
    document: {
      id: 'document-1',
      versionId: 'version-1',
      name: 'remote.md',
      title: '재택근무 운영 가이드',
      mimeType: 'text/markdown',
      sourceType: 'markdown',
      sizeBytes: 100,
      blocks: [],
    },
    chunks: [
      {
        id: 'chunk-1',
        documentId: 'document-1',
        versionId: 'version-1',
        ordinal: 0,
        text: '재택근무는 주 2회까지 신청할 수 있습니다.',
        wordCount: 6,
        headingPath: ['신청 기준'],
        blockStart: 0,
        blockEnd: 0,
        focusBlock: 0,
        location: {},
      },
      {
        id: 'chunk-2',
        documentId: 'document-1',
        versionId: 'version-1',
        ordinal: 1,
        text: '보안 교육은 분기마다 진행합니다.',
        wordCount: 4,
        headingPath: ['교육'],
        blockStart: 1,
        blockEnd: 1,
        focusBlock: 1,
        location: {},
      },
    ],
    status: 'ready',
    indexedAt: '2026-08-02T00:00:00.000Z',
  },
];

test('질문과 일치하는 문서 청크를 점수순으로 찾는다', () => {
  const results = searchDocuments(DOCUMENTS, '재택근무 신청 기준');

  assert.equal(results[0]?.chunkId, 'chunk-1');
  assert.equal(results[0]?.documentTitle, '재택근무 운영 가이드');
  assert.equal(results[0]?.heading, '신청 기준');
  assert.ok((results[0]?.score ?? 0) > 0.8);
});

test('검색 근거가 없을 때 답변 생성을 거부한다', () => {
  const results = searchDocuments(DOCUMENTS, '법인카드');
  const answer = composeExtractiveAnswer(results);

  assert.deepEqual(results, []);
  assert.match(answer, /근거를 찾지 못했습니다/u);
});

test('검색 결과 개수 제한을 적용한다', () => {
  const results = searchDocuments(DOCUMENTS, '재택근무 보안', 1);
  assert.equal(results.length, 1);
});

test('삭제 중인 문서는 로컬 검색 결과에서도 제외한다', () => {
  const deletingDocuments = DOCUMENTS.map((document) => ({
    ...document,
    status: 'deleting' as const,
  }));
  assert.deepEqual(searchDocuments(deletingDocuments, '재택근무'), []);
});
