import { load } from 'cheerio';
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

const HTML_BLOCK_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'ul', 'ol', 'table', 'pre', 'blockquote',
  'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav',
].join(',');
const HTML_CONTAINER_TAGS = new Set([
  'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav',
]);

function htmlHeadingPath(headings: Map<number, string>) {
  return [...headings.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, title]) => title);
}

export function normalizeHtmlSource(
  source: string,
  name = 'document.html',
  mimeType = 'text/html',
): NormalizedDocument {
  const $ = load(source, null, false);
  $('script,style,noscript,iframe,object,embed,form').remove();
  $('br').replaceWith('\n');

  const blocks: NormalizedBlock[] = [];
  const headings = new Map<number, string>();
  $(HTML_BLOCK_SELECTOR).each((_index, element) => {
    const selection = $(element);
    const tagName = selection.prop('tagName')?.toLocaleLowerCase('en-US') ?? '';
    const hasNestedBlock = HTML_CONTAINER_TAGS.has(tagName)
      && selection.find(HTML_BLOCK_SELECTOR).length > 0;
    if (
      hasNestedBlock
      || selection.parents('table,ul,ol').length
      || !selection.text().replace(/\s+/gu, ' ').trim()
    ) {
      return;
    }

    if (/^h[1-6]$/u.test(tagName)) {
      const level = Number(tagName.slice(1));
      const title = selection.text().replace(/\s+/gu, ' ').trim();
      for (const existingLevel of headings.keys()) {
        if (existingLevel >= level) headings.delete(existingLevel);
      }
      headings.set(level, title);
      appendNormalizedBlock(blocks, 'heading', title, htmlHeadingPath(headings));
      return;
    }

    if (tagName === 'ul' || tagName === 'ol') {
      const ordered = tagName === 'ol';
      const items = selection.find('li').map((itemIndex, item) => {
        const itemSelection = $(item).clone();
        itemSelection.find('ul,ol').remove();
        return `${ordered ? `${itemIndex + 1}.` : '-'} ${itemSelection.text()}`;
      }).get();
      appendNormalizedBlock(blocks, 'list', items.join('\n'), htmlHeadingPath(headings));
      return;
    }

    if (tagName === 'table') {
      const rows = selection.find('tr').map((_rowIndex, row) =>
        $(row).find('th,td').map((_cellIndex, cell) => $(cell).text()).get().join(' | '),
      ).get();
      appendNormalizedBlock(blocks, 'table', rows.join('\n'), htmlHeadingPath(headings));
      return;
    }

    appendNormalizedBlock(blocks, 'paragraph', selection.text(), htmlHeadingPath(headings));
  });

  return buildNormalizedDocument(name, mimeType, 'html', source.length, blocks);
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
