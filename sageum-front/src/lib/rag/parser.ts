import type {
  DocumentLocation,
  DocumentSourceType,
  NormalizedBlock,
  NormalizedDocument,
} from './types';
import { validateDocumentMetadata } from '@/lib/documents/validation';

function createId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function appendNormalizedBlock(
  blocks: NormalizedBlock[],
  kind: NormalizedBlock['kind'],
  text: string,
  headingPath: string[],
  location: DocumentLocation = {},
) {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (!normalized) return;
  blocks.push({
    id: `block_${String(blocks.length).padStart(6, '0')}`,
    kind,
    text: normalized,
    headingPath: [...headingPath],
    location: { ...location },
  });
}

function pushBlock(
  blocks: NormalizedBlock[],
  kind: NormalizedBlock['kind'],
  text: string,
  headingPath: string[],
  startOffset: number,
  endOffset: number,
) {
  appendNormalizedBlock(blocks, kind, text, headingPath, { startOffset, endOffset });
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
  return buildNormalizedDocument(name, mimeType, 'markdown', source.length, blocks);
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

export function buildNormalizedDocument(
  name: string,
  mimeType: string,
  sourceType: DocumentSourceType,
  sizeBytes: number,
  blocks: NormalizedBlock[],
  documentId?: string,
  versionId?: string,
): NormalizedDocument {
  const firstHeading = blocks.find((block) => block.kind === 'heading')?.text;
  const fallbackTitle = name.replace(/\.[^.]+$/u, '');
  return {
    id: documentId ?? createId(),
    versionId: versionId ?? createId(),
    name,
    title: firstHeading || fallbackTitle,
    mimeType,
    sourceType,
    sizeBytes,
    blocks,
  };
}

export function parseTextDocumentSource(
  source: string,
  input: {
    name: string;
    mimeType: string;
    sizeBytes: number;
    documentId?: string;
    versionId?: string;
  },
) {
  const metadata = validateDocumentMetadata(input);
  if (!['markdown', 'html', 'text'].includes(metadata.sourceType)) {
    throw new Error('바이너리 문서는 서버 문서 파서를 사용해야 합니다.');
  }
  let document: NormalizedDocument;

  if (metadata.sourceType === 'html') {
    document = normalizeHtmlSource(source, metadata.name, metadata.mimeType);
  } else if (metadata.sourceType === 'markdown') {
    document = normalizeMarkdownSource(source, metadata.name, metadata.mimeType);
  } else {
    document = normalizeTextSource(source, metadata.name, metadata.mimeType);
  }

  return {
    ...document,
    id: input.documentId ?? document.id,
    versionId: input.versionId ?? document.versionId,
    sizeBytes: metadata.sizeBytes,
  };
}
