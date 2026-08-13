import assert from 'node:assert/strict';
import test from 'node:test';

test('그래프 문서 쌍은 방향 없이 정렬된 키로 묶는다', () => {
  const key = (left: string, right: string) => [left, right].sort().join(':');
  assert.equal(key('a', 'b'), key('b', 'a'));
});
