const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class FolderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FolderValidationError';
  }
}

export function parseFolderId(value: unknown, options: { optional: true }): string | null;
export function parseFolderId(value: unknown, options?: { optional?: false }): string;
export function parseFolderId(value: unknown, { optional = false }: { optional?: boolean } = {}) {
  if ((value === null || value === undefined || value === '') && optional) return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new FolderValidationError('올바른 폴더 식별자가 필요합니다.');
  }
  return value;
}

export function parseFolderName(value: unknown) {
  if (typeof value !== 'string') {
    throw new FolderValidationError('폴더 이름을 입력해 주세요.');
  }
  const name = value.trim();
  if (!name || name.length > 200) {
    throw new FolderValidationError('폴더 이름은 1자 이상 200자 이하여야 합니다.');
  }
  if (name.includes('/')) {
    throw new FolderValidationError('폴더 이름에는 / 문자를 사용할 수 없습니다.');
  }
  return name;
}
