import type { DocumentSourceType } from '@/lib/rag/types';

export const DOCUMENT_BUCKET = 'documents';
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

const EXTENSION_TYPES = new Map<string, DocumentSourceType>([
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['html', 'html'],
  ['htm', 'html'],
  ['txt', 'text'],
  ['pdf', 'pdf'],
  ['docx', 'docx'],
  ['xlsx', 'xlsx'],
]);

const MIME_TYPES = new Map<string, DocumentSourceType>([
  ['text/markdown', 'markdown'],
  ['text/x-markdown', 'markdown'],
  ['text/plain', 'text'],
  ['text/html', 'html'],
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
]);

const CAN_PROCESS = new Set<DocumentSourceType>([
  'markdown',
  'html',
  'text',
  'pdf',
  'docx',
  'xlsx',
]);
const DEFAULT_MIME_TYPES: Record<DocumentSourceType, string> = {
  markdown: 'text/markdown',
  html: 'text/html',
  text: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const STORAGE_EXTENSIONS: Record<DocumentSourceType, string> = {
  markdown: 'md',
  html: 'html',
  text: 'txt',
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx',
};

export class DocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentValidationError';
  }
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLocaleLowerCase('en-US') : '';
}

export function detectDocumentSourceType(name: string, mimeType: string) {
  return EXTENSION_TYPES.get(extensionOf(name)) ?? MIME_TYPES.get(mimeType) ?? null;
}

export function initialDocumentTitle(name: string) {
  return name.trim() || '제목 없는 문서';
}

function filenameExtension(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot) : '';
}

export function validateRenamedDocumentFilename(currentName: string, value: unknown) {
  if (typeof value !== 'string') {
    throw new DocumentValidationError('새 파일명이 필요합니다.');
  }
  const name = value.trim();
  if (!name || name.length > 1024) {
    throw new DocumentValidationError('파일명은 1자 이상 1,024자 이하여야 합니다.');
  }
  if (/[\\/\u0000-\u001f\u007f]/u.test(name) || name === '.' || name === '..') {
    throw new DocumentValidationError('파일명에는 경로 문자나 제어 문자를 사용할 수 없습니다.');
  }
  const currentExtension = filenameExtension(currentName);
  if (currentExtension && name === currentExtension) {
    throw new DocumentValidationError('확장자를 제외한 파일명을 입력해 주세요.');
  }
  if (!currentExtension || filenameExtension(name) !== currentExtension) {
    throw new DocumentValidationError(`파일 확장자 ${currentExtension || '(없음)'}는 변경할 수 없습니다.`);
  }
  if (!name.slice(0, -currentExtension.length).trim()) {
    throw new DocumentValidationError('확장자를 제외한 파일명을 입력해 주세요.');
  }
  return name;
}

export function persistedDocumentTitle({
  originalFilename,
  sourceMode,
  manualTitle,
  parsedTitle,
}: {
  originalFilename: string;
  sourceMode: 'upload' | 'manual';
  manualTitle: string | null;
  parsedTitle: string;
}) {
  return sourceMode === 'manual'
    ? manualTitle?.trim() || parsedTitle
    : originalFilename;
}

export function storageObjectName(versionId: string, sourceType: DocumentSourceType) {
  return `${versionId}.${STORAGE_EXTENSIONS[sourceType]}`;
}

export function validateDocumentMetadata(input: {
  name: string;
  mimeType: string;
  sizeBytes: number;
}) {
  const name = input.name.trim();
  if (!name || name.length > 1024) {
    throw new DocumentValidationError('파일명은 1자 이상 1,024자 이하여야 합니다.');
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) {
    throw new DocumentValidationError('빈 파일은 업로드할 수 없습니다.');
  }
  if (input.sizeBytes > MAX_DOCUMENT_BYTES) {
    throw new DocumentValidationError('파일당 50MB까지 처리합니다.');
  }

  const sourceType = detectDocumentSourceType(name, input.mimeType);
  if (!sourceType) {
    throw new DocumentValidationError('MD, HTML, TXT, PDF, DOCX, XLSX 파일만 업로드할 수 있습니다.');
  }
  if (!CAN_PROCESS.has(sourceType)) {
    throw new DocumentValidationError(
      `${sourceType.toUpperCase()} 파서는 다음 단계에서 연결됩니다. 현재는 Markdown, HTML, TXT를 사용할 수 있습니다.`,
    );
  }

  return {
    name,
    title: initialDocumentTitle(name),
    sourceType,
    mimeType: DEFAULT_MIME_TYPES[sourceType],
    sizeBytes: input.sizeBytes,
  };
}
