import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import mammoth from 'mammoth';
import readXlsxFile from 'read-excel-file/node';
import { extractText } from 'unpdf';
import { validateDocumentMetadata } from '@/lib/documents/validation';
import {
  appendNormalizedBlock,
  buildNormalizedDocument,
  parseTextDocumentSource,
} from '@/lib/rag/parser';
import type {
  DocumentSourceType,
  NormalizedBlock,
  NormalizedDocument,
} from '@/lib/rag/types';

type ParseDocumentInput = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  documentId?: string;
  versionId?: string;
};

export class DocumentParsingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentParsingError';
  }
}

function asBuffer(bytes: Uint8Array) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function buildBinaryDocument(
  input: ParseDocumentInput,
  sourceType: Extract<DocumentSourceType, 'pdf' | 'docx' | 'xlsx'>,
  blocks: NormalizedBlock[],
) {
  return buildNormalizedDocument(
    input.name,
    input.mimeType,
    sourceType,
    input.sizeBytes,
    blocks,
    input.documentId,
    input.versionId,
  );
}

async function parsePdf(bytes: Uint8Array, input: ParseDocumentInput) {
  let pages: string[];
  try {
    const result = await extractText(bytes, { mergePages: false });
    pages = result.text;
  } catch {
    throw new DocumentParsingError('PDF 문서 구조를 읽지 못했습니다.');
  }

  const blocks: NormalizedBlock[] = [];
  pages.forEach((text, pageIndex) => {
    appendNormalizedBlock(blocks, 'paragraph', text, [], { page: pageIndex + 1 });
  });
  return buildBinaryDocument(input, 'pdf', blocks);
}

function activeHeadingPath(headings: Map<number, string>) {
  return [...headings.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([, title]) => title);
}

async function parseDocx(bytes: Uint8Array, input: ParseDocumentInput) {
  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: asBuffer(bytes) },
      {
        externalFileAccess: false,
        ignoreEmptyParagraphs: true,
      },
    );
    html = result.value;
  } catch {
    throw new DocumentParsingError('DOCX 문서 구조를 읽지 못했습니다.');
  }

  const $ = load(html, null, false);
  const blocks: NormalizedBlock[] = [];
  const headings = new Map<number, string>();

  $('h1,h2,h3,h4,h5,h6,p,ul,ol,table').each((_index, element) => {
    const selection = $(element);
    const tagName = selection.prop('tagName')?.toLocaleLowerCase('en-US') ?? '';
    if (selection.parents('table,ul,ol').length) return;

    if (/^h[1-6]$/u.test(tagName)) {
      const title = selection.text();
      const level = Number(tagName.slice(1));
      for (const existingLevel of headings.keys()) {
        if (existingLevel >= level) headings.delete(existingLevel);
      }
      headings.set(level, title.replace(/\s+/gu, ' ').trim());
      appendNormalizedBlock(blocks, 'heading', title, activeHeadingPath(headings));
      return;
    }

    if (tagName === 'ul' || tagName === 'ol') {
      const ordered = tagName === 'ol';
      const items = selection.find('li').map((itemIndex, item) => {
        const itemSelection = $(item).clone();
        itemSelection.find('ul,ol').remove();
        const marker = ordered ? `${itemIndex + 1}.` : '-';
        return `${marker} ${itemSelection.text()}`;
      }).get();
      appendNormalizedBlock(blocks, 'list', items.join('\n'), activeHeadingPath(headings));
      return;
    }

    if (tagName === 'table') {
      const rows = selection.find('tr').map((_rowIndex, row) =>
        $(row).find('th,td').map((_cellIndex, cell) => $(cell).text()).get().join(' | '),
      ).get();
      appendNormalizedBlock(blocks, 'table', rows.join('\n'), activeHeadingPath(headings));
      return;
    }

    appendNormalizedBlock(blocks, 'paragraph', selection.text(), activeHeadingPath(headings));
  });

  return buildBinaryDocument(input, 'docx', blocks);
}

function columnName(columnIndex: number) {
  let current = columnIndex + 1;
  let name = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\s+/gu, ' ').trim();
}

function appendSheetTables(
  blocks: NormalizedBlock[],
  sheetName: string,
  rows: unknown[][],
) {
  let regionStart = -1;
  let regionEnd = -1;
  let minimumColumn = Number.POSITIVE_INFINITY;
  let maximumColumn = -1;

  const flushRegion = () => {
    if (regionStart < 0 || maximumColumn < 0) return;
    const text = rows.slice(regionStart, regionEnd + 1)
      .map((row) => row.slice(minimumColumn, maximumColumn + 1).map(cellText).join(' | '))
      .join('\n');
    const cellRange = `${columnName(minimumColumn)}${regionStart + 1}:${columnName(maximumColumn)}${regionEnd + 1}`;
    appendNormalizedBlock(blocks, 'table', text, [sheetName], { sheet: sheetName, cellRange });
    regionStart = -1;
    regionEnd = -1;
    minimumColumn = Number.POSITIVE_INFINITY;
    maximumColumn = -1;
  };

  rows.forEach((row, rowIndex) => {
    const nonEmptyColumns = row.flatMap((value, columnIndex) =>
      cellText(value) ? [columnIndex] : [],
    );
    if (!nonEmptyColumns.length) {
      flushRegion();
      return;
    }
    if (regionStart < 0) regionStart = rowIndex;
    regionEnd = rowIndex;
    minimumColumn = Math.min(minimumColumn, ...nonEmptyColumns);
    maximumColumn = Math.max(maximumColumn, ...nonEmptyColumns);
  });
  flushRegion();
}

async function parseXlsx(bytes: Uint8Array, input: ParseDocumentInput) {
  let sheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    sheets = await readXlsxFile(asBuffer(bytes));
  } catch {
    throw new DocumentParsingError('XLSX 문서 구조를 읽지 못했습니다.');
  }

  const blocks: NormalizedBlock[] = [];
  sheets.forEach((sheet) => appendSheetTables(blocks, sheet.sheet, sheet.data));
  return buildBinaryDocument(input, 'xlsx', blocks);
}

export function parserVersion(sourceType: DocumentSourceType) {
  if (sourceType === 'pdf') return 'pdf-v1';
  if (sourceType === 'docx') return 'docx-v1';
  if (sourceType === 'xlsx') return 'xlsx-v1';
  return 'text-v1';
}

export async function parseDocumentSource(
  bytes: Uint8Array,
  input: ParseDocumentInput,
): Promise<NormalizedDocument> {
  const metadata = validateDocumentMetadata(input);
  const normalizedInput = {
    ...input,
    name: metadata.name,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
  };

  if (metadata.sourceType === 'pdf') return parsePdf(bytes, normalizedInput);
  if (metadata.sourceType === 'docx') return parseDocx(bytes, normalizedInput);
  if (metadata.sourceType === 'xlsx') return parseXlsx(bytes, normalizedInput);

  return parseTextDocumentSource(new TextDecoder('utf-8').decode(bytes), normalizedInput);
}

export async function parseDocumentSourceWithHash(
  bytes: Uint8Array,
  input: ParseDocumentInput,
) {
  // PDF.js can transfer the supplied Uint8Array to a worker and detach its buffer.
  // Keep the caller-owned bytes reusable for later steps such as visual OCR.
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const document = await parseDocumentSource(bytes.slice(), input);
  return { document, contentHash };
}
