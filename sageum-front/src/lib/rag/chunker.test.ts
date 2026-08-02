import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkDocument } from './chunker';
import type { NormalizedDocument } from './types';

function makeDocument(wordCount: number): NormalizedDocument {
  const first = Array.from({ length: Math.floor(wordCount / 2) }, (_, index) => `첫문단${index}`).join(' ');
  const second = Array.from({ length: Math.ceil(wordCount / 2) }, (_, index) => `둘째문단${index}`).join(' ');

  return {
    id: 'doc-1',
    versionId: 'version-1',
    name: '테스트.md',
    title: '테스트',
    mimeType: 'text/markdown',
    sourceType: 'markdown',
    sizeBytes: 100,
    blocks: [
      {
        id: 'b1',
        kind: 'paragraph',
        text: first,
        headingPath: ['첫 절'],
        location: { startOffset: 0, endOffset: first.length },
      },
      {
        id: 'b2',
        kind: 'paragraph',
        text: second,
        headingPath: ['둘째 절'],
        location: { startOffset: first.length + 1, endOffset: first.length + second.length + 1 },
      },
    ],
  };
}

test('단어 수 기준으로 청크를 만들고 최대 크기를 지킨다', () => {
  const chunks = chunkDocument(makeDocument(920), {
    targetWords: 320,
    maxWords: 380,
    overlapWords: 40,
  });

  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.wordCount <= 380));
  assert.equal(chunks[0].id, 'version-1:000000');
  assert.equal(chunks[1].ordinal, 1);
});

test('인접 청크에 지정한 단어 중첩을 적용한다', () => {
  const chunks = chunkDocument(makeDocument(300), {
    targetWords: 120,
    maxWords: 120,
    overlapWords: 20,
  });

  const firstTail = chunks[0].text.split(/\s+/u).slice(-20);
  const secondHead = chunks[1].text.split(/\s+/u).slice(0, 20);
  assert.deepEqual(secondHead, firstTail);
});

test('빈 문서는 청크를 만들지 않는다', () => {
  const document = makeDocument(0);
  assert.deepEqual(chunkDocument(document), []);
});

test('잘못된 청킹 옵션을 거부한다', () => {
  assert.throws(
    () => chunkDocument(makeDocument(20), { targetWords: 10, maxWords: 20, overlapWords: 10 }),
    /overlapWords/u,
  );
});

test('페이지 경계가 다른 블록을 하나의 청크로 합치지 않는다', () => {
  const document = makeDocument(0);
  document.blocks = [
    {
      id: 'page-1',
      kind: 'paragraph',
      text: Array.from({ length: 80 }, (_, index) => `첫페이지${index}`).join(' '),
      headingPath: [],
      location: { page: 1 },
    },
    {
      id: 'page-2',
      kind: 'paragraph',
      text: Array.from({ length: 80 }, (_, index) => `둘째페이지${index}`).join(' '),
      headingPath: [],
      location: { page: 2 },
    },
  ];

  const chunks = chunkDocument(document, {
    targetWords: 120,
    maxWords: 140,
    overlapWords: 20,
  });

  assert.deepEqual(chunks.map((chunk) => chunk.location.page), [1, 2]);
});
