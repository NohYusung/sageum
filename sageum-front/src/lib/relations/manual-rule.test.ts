import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  manualRuleFilename,
  manualRuleTitle,
  MAX_MANUAL_RULE_CHARACTERS,
  normalizeManualRuleContent,
} from './manual-rule';

test('직접 입력 규칙의 줄바꿈과 바깥 공백을 정규화한다', () => {
  assert.equal(
    normalizeManualRuleContent('  정글러는\r\n갱킹을 잘해야 한다.  '),
    '정글러는\n갱킹을 잘해야 한다.',
  );
});

test('빈 규칙과 2,000자 초과 규칙을 거부한다', () => {
  assert.throws(() => normalizeManualRuleContent('   '), /규칙이 필요/);
  assert.throws(
    () => normalizeManualRuleContent('가'.repeat(MAX_MANUAL_RULE_CHARACTERS + 1)),
    /2,000자/,
  );
});

test('규칙 제목과 내부 Markdown 파일명을 안전하게 만든다', () => {
  const content = `${'가'.repeat(80)}\n두 번째 줄`;
  assert.equal(manualRuleTitle(content).length, 60);
  assert.doesNotMatch(manualRuleFilename('정글러/갱킹:* 관계'), /[\\/:*?"<>|]/u);
  assert.match(manualRuleFilename(content), /\.md$/u);
});
