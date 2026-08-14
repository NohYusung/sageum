import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuleDocumentsRefreshGate } from './rule-document-sync';

test('가장 최근에 시작한 규칙 목록 요청만 상태를 갱신한다', () => {
  const gate = createRuleDocumentsRefreshGate();
  const first = gate.begin();
  const second = gate.begin();

  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});

test('로컬 등록·삭제 변경은 진행 중인 이전 목록 요청을 무효화한다', () => {
  const gate = createRuleDocumentsRefreshGate();
  const request = gate.begin();
  gate.invalidate();

  assert.equal(gate.isCurrent(request), false);
});
