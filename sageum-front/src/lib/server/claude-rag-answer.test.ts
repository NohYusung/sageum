import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SourceReference } from '@/lib/rag/local-search';
import {
  buildClaudeGroundingContext,
  INSUFFICIENT_EVIDENCE_ANSWER,
  normalizeClaudeGroundedAnswer,
} from './claude-rag-answer';

function source(chunkId: string, snippet = '재택근무는 일주일에 이틀까지 가능합니다.'): SourceReference {
  return {
    documentId: `document-${chunkId}`,
    versionId: `version-${chunkId}`,
    documentTitle: '근무 규정',
    chunkId,
    heading: '재택근무',
    snippet,
    score: 0.9,
    page: 3,
  };
}

test('Claude 인용 ID 중 실제 검색 근거에 포함된 청크만 반환한다', () => {
  const first = source('chunk-1');
  const second = source('chunk-2', '승인은 팀장이 처리합니다.');
  const result = normalizeClaudeGroundedAnswer({
    answer: '재택근무는 주 2회까지 가능하며 팀장 승인이 필요합니다.',
    citationChunkIds: ['chunk-1', 'invented-chunk', 'chunk-2', 'chunk-1'],
    insufficientEvidence: false,
  }, [first, second]);

  assert.equal(result.answer, '재택근무는 주 2회까지 가능하며 팀장 승인이 필요합니다.');
  assert.deepEqual(result.sources.map(({ chunkId }) => chunkId), ['chunk-1', 'chunk-2']);
  assert.equal(result.insufficientEvidence, false);
});

test('유효한 인용이 없거나 Claude가 근거 부족으로 판정하면 답변을 생성하지 않는다', () => {
  const noCitation = normalizeClaudeGroundedAnswer({
    answer: '근거 없는 답변',
    citationChunkIds: ['invented-chunk'],
    insufficientEvidence: false,
  }, [source('chunk-1')]);
  const insufficient = normalizeClaudeGroundedAnswer({
    answer: '모르겠습니다.',
    citationChunkIds: ['chunk-1'],
    insufficientEvidence: true,
  }, [source('chunk-1')]);

  assert.equal(noCitation.answer, INSUFFICIENT_EVIDENCE_ANSWER);
  assert.deepEqual(noCitation.sources, []);
  assert.equal(insufficient.answer, INSUFFICIENT_EVIDENCE_ANSWER);
  assert.deepEqual(insufficient.sources, []);
});

test('Claude에 전달하는 검색 근거 수와 본문 길이를 제한하고 위치 정보를 보존한다', () => {
  const sources = Array.from({ length: 8 }, (_, index) =>
    source(`chunk-${index}`, '가'.repeat(4_000)));
  const grounding = buildClaudeGroundingContext(sources);
  const context = JSON.parse(grounding.context) as Array<{
    content: string;
    page?: number;
    chunkId: string;
  }>;

  assert.ok(grounding.sources.length <= 6);
  assert.ok(context.reduce((sum, item) => sum + item.content.length, 0) <= 16_000);
  assert.equal(context[0].page, 3);
  assert.equal(context[0].chunkId, 'chunk-0');
});
