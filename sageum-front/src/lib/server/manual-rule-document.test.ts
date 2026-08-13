import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildManualRuleArtifact } from './manual-rule-document';

test('직접 입력 규칙을 UTF-8 Markdown 원본으로 만든다', () => {
  const artifact = buildManualRuleArtifact('노유성은 신진하이텔에 살고 있다.');
  assert.equal(new TextDecoder().decode(artifact.bytes), artifact.content);
  assert.equal(artifact.title, '노유성은 신진하이텔에 살고 있다.');
  assert.match(artifact.filename, /\.md$/u);
});
