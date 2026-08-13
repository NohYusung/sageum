export const MAX_MANUAL_RULE_CHARACTERS = 2_000;

export class ManualRuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManualRuleValidationError';
  }
}

export function normalizeManualRuleContent(value: unknown) {
  if (typeof value !== 'string') {
    throw new ManualRuleValidationError('직접 입력할 규칙이 필요합니다.');
  }
  const content = value.replaceAll('\r\n', '\n').trim();
  if (!content) {
    throw new ManualRuleValidationError('직접 입력할 규칙이 필요합니다.');
  }
  if (content.length > MAX_MANUAL_RULE_CHARACTERS) {
    throw new ManualRuleValidationError('직접 입력 규칙은 2,000자까지 등록할 수 있습니다.');
  }
  return content;
}

export function manualRuleTitle(content: string) {
  const firstLine = content.split('\n').find((line) => line.trim())?.trim() ?? content;
  return firstLine.slice(0, 60);
}

export function manualRuleFilename(content: string) {
  const safeTitle = manualRuleTitle(content)
    .replace(/[\u0000-\u001f/\\:*?"<>|]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 48);
  return `${safeTitle || '직접 입력 규칙'}.md`;
}
