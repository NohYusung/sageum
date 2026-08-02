import type {
  DocumentSourceType,
  NormalizedBlock,
  NormalizedDocument,
} from './types';

const MAX_BROWSER_FILE_SIZE = 10 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Map<string, DocumentSourceType>([
  ['text/markdown', 'markdown'],
  ['text/x-markdown', 'markdown'],
  ['text/html', 'html'],
  ['text/plain', 'text'],
]);

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

export class UnsupportedDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedDocumentError';
  }
}

function createId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function detectSourceType(name: string, mimeType: string): DocumentSourceType {
  return SUPPORTED_MIME_TYPES.get(mimeType) ?? EXTENSION_TYPES.get(extensionOf(name)) ?? 'text';
}

function pushBlock(
  blocks: NormalizedBlock[],
  kind: NormalizedBlock['kind'],
  text: string,
  headingPath: string[],
  startOffset: number,
  endOffset: number,
) {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (!normalized) return;
  blocks.push({
    id: `block_${String(blocks.length).padStart(6, '0')}`,
    kind,
    text: normalized,
    headingPath: [...headingPath],
    location: { startOffset, endOffset },
  });
}

export function normalizeMarkdownSource(
  source: string,
  name = 'document.md',
  mimeType = 'text/markdown',
): NormalizedDocument {
  const blocks: NormalizedBlock[] = [];
  const headings: string[] = [];
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  let paragraph: string[] = [];
  let paragraphStart = 0;
  let offset = 0;
  let inFence = false;

  const flushParagraph = (endOffset: number) => {
    if (!paragraph.length) return;
    const text = paragraph.join('\n');
    const kind = /^\s*[-*+]\s+/u.test(text) ? 'list' : 'paragraph';
    pushBlock(blocks, kind, text, headings, paragraphStart, endOffset);
    paragraph = [];
  };

  lines.forEach((line) => {
    const lineStart = offset;
    offset += line.length + 1;

    if (/^\s*```/u.test(line)) {
      if (!paragraph.length) paragraphStart = lineStart;
      paragraph.push(line);
      inFence = !inFence;
      return;
    }

    const heading = inFence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (heading) {
      flushParagraph(lineStart);
      const level = heading[1].length;
      const title = heading[2].trim();
      headings.splice(level - 1);
      headings[level - 1] = title;
      pushBlock(blocks, 'heading', title, headings, lineStart, lineStart + line.length);
      return;
    }

    if (!inFence && !line.trim()) {
      flushParagraph(lineStart);
      return;
    }

    if (!paragraph.length) paragraphStart = lineStart;
    paragraph.push(line);
  });

  flushParagraph(source.length);
  return buildDocument(name, mimeType, 'markdown', source.length, blocks);
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'");
}

export function normalizeHtmlSource(
  source: string,
  name = 'document.html',
  mimeType = 'text/html',
): NormalizedDocument {
  const withoutNoise = source
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<\s*br\s*\/?\s*>/giu, '\n')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6])\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ');
  const text = decodeHtmlEntities(withoutNoise)
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  const document = normalizeMarkdownSource(text, name, mimeType);
  return { ...document, sourceType: 'html' };
}

export function normalizeTextSource(
  source: string,
  name = 'document.txt',
  mimeType = 'text/plain',
): NormalizedDocument {
  const document = normalizeMarkdownSource(source, name, mimeType);
  return { ...document, sourceType: 'text' };
}

function buildDocument(
  name: string,
  mimeType: string,
  sourceType: DocumentSourceType,
  sizeBytes: number,
  blocks: NormalizedBlock[],
): NormalizedDocument {
  const id = createId();
  const firstHeading = blocks.find((block) => block.kind === 'heading')?.text;
  const fallbackTitle = name.replace(/\.[^.]+$/u, '');
  return {
    id,
    versionId: createId(),
    name,
    title: firstHeading || fallbackTitle,
    mimeType,
    sourceType,
    sizeBytes,
    blocks,
  };
}

export async function parseBrowserFile(file: File): Promise<NormalizedDocument> {
  if (file.size > MAX_BROWSER_FILE_SIZE) {
    throw new Error('개인 데모에서는 파일당 10MB까지 처리합니다.');
  }

  const sourceType = detectSourceType(file.name, file.type);
  if (sourceType === 'pdf' || sourceType === 'docx' || sourceType === 'xlsx') {
    throw new UnsupportedDocumentError(
      `${sourceType.toUpperCase()} 파서는 다음 구현 단계에서 연결됩니다. 현재는 Markdown, HTML, TXT를 사용할 수 있습니다.`,
    );
  }

  const source = await file.text();
  if (sourceType === 'html') return normalizeHtmlSource(source, file.name, file.type || 'text/html');
  if (sourceType === 'markdown') return normalizeMarkdownSource(source, file.name, file.type || 'text/markdown');
  return normalizeTextSource(source, file.name, file.type || 'text/plain');
}
