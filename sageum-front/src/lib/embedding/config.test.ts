import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DocumentChunk } from '@/lib/rag/types';
import { documentEmbeddingInput, queryEmbeddingInput } from './config';

const CHUNK: DocumentChunk = {
  id: 'chunk-1',
  documentId: '123e4567-e89b-42d3-a456-426614174000',
  versionId: '123e4567-e89b-42d3-a456-426614174001',
  ordinal: 0,
  text: '재택근무는 주 2회까지 가능합니다.',
  wordCount: 5,
  headingPath: ['근무 규정', '신청 기준'],
  blockStart: 0,
  blockEnd: 0,
  location: { page: 2 },
};

test('EmbeddingGemma 권장 검색 프롬프트를 만든다', () => {
  assert.equal(
    queryEmbeddingInput('  재택근무 기준  '),
    'task: search result | query: 재택근무 기준',
  );
});

test('문서 제목과 청크 제목 경로를 문서 프롬프트에 보존한다', () => {
  assert.equal(
    documentEmbeddingInput('운영 가이드', CHUNK),
    'title: 운영 가이드 | text: 근무 규정 › 신청 기준\n재택근무는 주 2회까지 가능합니다.',
  );
});
