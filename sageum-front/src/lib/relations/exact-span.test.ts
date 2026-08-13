import assert from 'node:assert/strict';
import test from 'node:test';
import { findExactTextSpan } from './exact-span';

test('findExactTextSpan returns offsets for an exact Korean phrase', () => {
  assert.deepEqual(
    findExactTextSpan('리그오브레전드에서 정글러는 갱킹을 간다.', '정글러'),
    { text: '정글러', startOffset: 10, endOffset: 13 },
  );
});

test('findExactTextSpan tolerates whitespace differences but preserves source offsets', () => {
  assert.deepEqual(
    findExactTextSpan('정글러는\n  갱킹을 잘해야 한다.', '정글러는 갱킹을'),
    { text: '정글러는\n  갱킹을', startOffset: 0, endOffset: 10 },
  );
});

test('findExactTextSpan rejects semantic-only matches', () => {
  assert.equal(findExactTextSpan('라인 개입이 중요하다.', '갱킹'), null);
});
