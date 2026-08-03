import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldSubmitChatOnEnter } from './chat-keyboard';

test('일반 Enter만 채팅 제출로 처리한다', () => {
  assert.equal(shouldSubmitChatOnEnter('Enter', false, false), true);
  assert.equal(shouldSubmitChatOnEnter('Enter', true, false), false);
  assert.equal(shouldSubmitChatOnEnter('Enter', false, true), false);
  assert.equal(shouldSubmitChatOnEnter('a', false, false), false);
});
