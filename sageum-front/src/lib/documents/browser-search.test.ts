import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSearchStreamParser,
  isSearchProgressForward,
} from './browser-search';

const progress = JSON.stringify({
  type: 'progress',
  stage: 'retrieving',
  message: '문서·규칙을 검색하고 있습니다.',
});
const result = JSON.stringify({
  type: 'result',
  data: {
    answer: '답변',
    sources: [],
    mode: 'qdrant',
    answerMode: 'extractive-fallback',
    appliedRules: [],
    appliedSemanticLinks: [],
    relationMode: 'content-only',
  },
});

test('NDJSON 한 청크에서 여러 이벤트를 순서대로 복원한다', () => {
  const parser = createSearchStreamParser();
  assert.deepEqual(
    parser.push(`${progress}\n${result}\n`).map((event) => event.type),
    ['progress', 'result'],
  );
  assert.deepEqual(parser.finish(), []);
});

test('JSON 한 줄이 여러 네트워크 청크로 분리되어도 복원한다', () => {
  const parser = createSearchStreamParser();
  const midpoint = Math.floor(progress.length / 2);
  assert.deepEqual(parser.push(progress.slice(0, midpoint)), []);
  assert.deepEqual(
    parser.push(`${progress.slice(midpoint)}\n`).map((event) => event.type),
    ['progress'],
  );
});

test('마지막 줄에 개행이 없어도 finish에서 복원한다', () => {
  const parser = createSearchStreamParser();
  assert.deepEqual(parser.push(result), []);
  assert.deepEqual(parser.finish().map((event) => event.type), ['result']);
});

test('올바르지 않은 JSON과 이벤트 계약을 거부한다', () => {
  const invalidJson = createSearchStreamParser();
  assert.throws(() => invalidJson.push('{invalid}\n'), /해석/u);
  const invalidEvent = createSearchStreamParser();
  assert.throws(() => invalidEvent.push('{"type":"unknown"}\n'), /형식/u);
  const invalidStage = createSearchStreamParser();
  assert.throws(() => invalidStage.push('{"type":"progress","stage":"other","message":"진행"}\n'), /형식/u);
});

test('검색 진행 단계는 같은 단계 갱신과 정방향 이동만 허용한다', () => {
  assert.equal(isSearchProgressForward('retrieving', 'retrieving'), true);
  assert.equal(isSearchProgressForward('retrieving', 'expanding'), true);
  assert.equal(isSearchProgressForward('verifying', 'generating'), false);
});
