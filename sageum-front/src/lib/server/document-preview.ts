import { load } from 'cheerio';
import type { AnyNode, Text } from 'domhandler';
import mammoth from 'mammoth';
import readXlsxFile from 'read-excel-file/node';
import { validateDocumentMetadata } from '@/lib/documents/validation';
import { parseTextDocumentSource } from '@/lib/rag/parser';
import type { DocumentSourceSpan, NormalizedBlock } from '@/lib/rag/types';

const MAX_PREVIEW_ROWS = 500;
const MAX_PREVIEW_COLUMNS = 50;

type PreviewInput = {
  name: string;
  mimeType: string;
  sizeBytes: number;
};

export type PreviewHighlight = {
  sourceSpans?: DocumentSourceSpan[];
  blockStart?: number;
  blockEnd?: number;
};

export type DocumentPreview =
  | { kind: 'pdf'; signedUrl: string }
  | { kind: 'sandbox'; sourceHtml: string };

export type DocumentPreviewPage = {
  html: string;
  contentSecurityPolicy: string;
};

function asBuffer(bytes: Uint8Array) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function lineBreaks(value: string) {
  return escapeHtml(value).replace(/\n/gu, '<br>');
}

function highlightedBlockIndexes(highlight?: PreviewHighlight) {
  const indexes = new Set(highlight?.sourceSpans?.map((span) => span.blockIndex) ?? []);
  if (!indexes.size && highlight?.blockStart !== undefined) {
    const end = highlight.blockEnd ?? highlight.blockStart;
    for (let index = highlight.blockStart; index <= end; index += 1) indexes.add(index);
  }
  return indexes;
}

function blockAnchor(blockIndex: number, highlighted = false) {
  return ` id="block-${blockIndex}" class="preview-block${highlighted ? ' chunk-range-block' : ''}"`;
}

function blockSourceSpans(highlight: PreviewHighlight | undefined, blockIndex: number) {
  return highlight?.sourceSpans?.filter((span) => span.blockIndex === blockIndex) ?? [];
}

function highlightedText(value: string, spans: DocumentSourceSpan[]) {
  if (!spans.length) return escapeHtml(value);
  const ranges = spans
    .map((span) => ({
      start: Math.max(0, Math.min(value.length, span.startOffset)),
      end: Math.max(0, Math.min(value.length, span.endOffset)),
    }))
    .filter(({ start, end }) => end > start)
    .toSorted((left, right) => left.start - right.start);
  if (!ranges.length) return escapeHtml(value);
  let cursor = 0;
  let html = '';
  ranges.forEach(({ start, end }) => {
    if (start > cursor) html += escapeHtml(value.slice(cursor, start));
    const rangeStart = Math.max(cursor, start);
    if (end > rangeStart) {
      html += `<mark class="chunk-range">${escapeHtml(value.slice(rangeStart, end))}</mark>`;
    }
    cursor = Math.max(cursor, end);
  });
  if (cursor < value.length) html += escapeHtml(value.slice(cursor));
  return html;
}

function renderBlock(
  block: NormalizedBlock,
  blockIndex: number,
  highlight?: PreviewHighlight,
) {
  const spans = blockSourceSpans(highlight, blockIndex);
  const highlighted = highlightedBlockIndexes(highlight).has(blockIndex);
  const anchor = blockAnchor(blockIndex, highlighted);
  if (block.kind === 'heading') {
    const level = Math.min(Math.max(block.headingPath.length, 1), 6);
    return `<h${level}${anchor}>${highlightedText(block.text, spans)}</h${level}>`;
  }
  if (block.kind === 'list') {
    const lines = block.text.split('\n').filter(Boolean);
    const ordered = lines.every((line) => /^\d+\.\s+/u.test(line));
    const tag = ordered ? 'ol' : 'ul';
    const items = lines.map((line) =>
      line.replace(ordered ? /^\d+\.\s+/u : /^[-*+]\s+/u, ''),
    );
    return `<${tag}${anchor}>${items.map((item) => `<li>${lineBreaks(item)}</li>`).join('')}</${tag}>`;
  }
  if (block.kind === 'table') {
    const rows = block.text.split('\n').map((row) => row.split('|').map((cell) => cell.trim()));
    return renderTable(
      rows,
      new Map([[0, blockIndex]]),
      new Map(rows.map((_row, rowIndex) => [rowIndex, blockIndex])),
      highlightedBlockIndexes(highlight),
    );
  }
  return `<p${anchor}>${highlightedText(block.text, spans).replace(/\n/gu, '<br>')}</p>`;
}

function sandboxStyles() {
  return `
    :root { color-scheme: light; font-family: Inter, Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { max-width: 980px; margin: 0 auto; padding: 42px clamp(24px, 6vw, 72px) 80px; background: #fff; color: #17211d; font-size: 15px; line-height: 1.75; overflow-wrap: anywhere; }
    h1, h2, h3, h4, h5, h6 { margin: 1.6em 0 .55em; color: #17211d; font-family: Georgia, "Noto Serif KR", serif; line-height: 1.3; }
    h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
    p { margin: 0 0 1em; }
    ul, ol { margin: 0 0 1.2em; padding-left: 1.8em; }
    table { width: 100%; margin: 20px 0 32px; border-collapse: collapse; font-size: 13px; }
    th, td { min-width: 86px; padding: 9px 11px; border: 1px solid #dfe2dc; text-align: left; vertical-align: top; white-space: pre-wrap; }
    th { position: sticky; top: 0; background: #eef4f0; color: #29483b; font-weight: 700; }
    tr:nth-child(even) td { background: #fafbf9; }
    img { max-width: 100%; height: auto; }
    pre { margin: 0; padding: 24px; border: 1px solid #e5e5dc; border-radius: 10px; background: #f8f8f4; font-family: "SFMono-Regular", Consolas, monospace; font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
    [id^="block-"] { scroll-margin-top: 24px; }
    [id^="block-"]:target { outline: 3px solid rgba(167, 111, 42, .45); outline-offset: 5px; background: #fff5d8; }
    tr[id^="block-"]:target > th, tr[id^="block-"]:target > td { background: #fff0bd; }
    .chunk-range-block { outline: 3px solid rgba(167, 111, 42, .45); outline-offset: 4px; }
    .chunk-range-block:is(ul, ol, table, tr) { background: #fff7df; }
    tr.chunk-range-block > th, tr.chunk-range-block > td { background: #fff0bd; }
    mark.chunk-range { border-radius: 3px; background: #ffe49a; color: inherit; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
    .sheet { margin-bottom: 52px; overflow-x: auto; }
    .sheet h2 { position: sticky; left: 0; margin-top: 0; }
    .preview-note { margin: 16px 0 28px; padding: 11px 13px; border-radius: 8px; background: #f7ead8; color: #69451c; font-size: 12px; }
  `;
}

function sandboxDocument(body: string) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'"><style>${sandboxStyles()}</style></head><body>${body}</body></html>`;
}

function isSafeEmbeddedImage(value: string) {
  return /^data:image\/(?:png|gif|jpeg|jpg|webp|svg\+xml);/iu.test(value);
}

function annotatePreviewBlocks(
  $: ReturnType<typeof load>,
  { includeContainers = false }: { includeContainers?: boolean } = {},
) {
  const baseSelector = 'h1,h2,h3,h4,h5,h6,p,ul,ol,table';
  const selector = includeContainers
    ? `${baseSelector},pre,blockquote,div,section,article,main,header,footer,aside,nav`
    : baseSelector;
  const containerTags = new Set([
    'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav',
  ]);
  let blockIndex = 0;
  $(selector).each((_index, element) => {
    const selection = $(element);
    const tagName = selection.prop('tagName')?.toLocaleLowerCase('en-US') ?? '';
    const hasNestedCandidate = includeContainers
      && containerTags.has(tagName)
      && selection.find(selector).length > 0;
    if (
      hasNestedCandidate
      || selection.parents('table,ul,ol').length
      || (!selection.text().replace(/\s+/gu, ' ').trim() && !selection.find('img').length)
    ) {
      return;
    }
    selection.attr('id', `block-${blockIndex}`);
    selection.addClass('preview-block');
    blockIndex += 1;
  });
}

function collectTextNodes(node: AnyNode, result: Text[]) {
  if (node.type === 'text') {
    result.push(node as Text);
    return;
  }
  if ('children' in node) node.children.forEach((child) => collectTextNodes(child, result));
}

function highlightElementWords(
  $: ReturnType<typeof load>,
  blockIndex: number,
  spans: DocumentSourceSpan[],
) {
  const selection = $(`#block-${blockIndex}`);
  if (!selection.length) return;
  selection.addClass('chunk-range-block');
  const tagName = selection.prop('tagName')?.toLocaleLowerCase('en-US') ?? '';
  if (['table', 'ul', 'ol'].includes(tagName) || !spans.length) return;

  const textNodes: Text[] = [];
  const root = selection.get(0);
  if (root) collectTextNodes(root, textNodes);
  let wordIndex = 0;
  textNodes.forEach((node) => {
    const value = node.data;
    let cursor = 0;
    let changed = false;
    let html = '';
    for (const match of value.matchAll(/\S+/gu)) {
      const start = match.index;
      const end = start + match[0].length;
      const highlighted = spans.some(
        (span) => wordIndex >= span.startWord && wordIndex < span.endWord,
      );
      if (highlighted) {
        html += escapeHtml(value.slice(cursor, start));
        html += `<mark class="chunk-range">${escapeHtml(match[0])}</mark>`;
        cursor = end;
        changed = true;
      }
      wordIndex += 1;
    }
    if (!changed) return;
    html += escapeHtml(value.slice(cursor));
    $(node).replaceWith(html);
  });
}

function applyPreviewHighlight($: ReturnType<typeof load>, highlight?: PreviewHighlight) {
  const indexes = highlightedBlockIndexes(highlight);
  indexes.forEach((blockIndex) => {
    highlightElementWords($, blockIndex, blockSourceSpans(highlight, blockIndex));
  });
}

export function sanitizeSandboxDocument(
  source: string,
  {
    annotateBlocks = false,
    includeContainerBlocks = false,
    highlight,
  }: {
    annotateBlocks?: boolean;
    includeContainerBlocks?: boolean;
    highlight?: PreviewHighlight;
  } = {},
) {
  const $ = load(source);
  $('script,iframe,object,embed,form,input,button,textarea,select,option,base,link,meta,foreignObject').remove();

  $('*').each((_index, element) => {
    const selection = $(element);
    const attributes = selection.attr() ?? {};
    Object.entries(attributes).forEach(([name, value]) => {
      const normalizedName = name.toLocaleLowerCase('en-US');
      if (
        normalizedName.startsWith('on')
        || ['srcdoc', 'srcset', 'action', 'formaction'].includes(normalizedName)
      ) {
        selection.removeAttr(name);
        return;
      }
      if (normalizedName === 'src') {
        if (!isSafeEmbeddedImage(value)) selection.removeAttr(name);
        return;
      }
      if (normalizedName === 'href' || normalizedName === 'xlink:href') {
        if (!value.startsWith('#')) selection.removeAttr(name);
      }
    });
  });

  if (annotateBlocks) {
    annotatePreviewBlocks($, { includeContainers: includeContainerBlocks });
  }
  applyPreviewHighlight($, highlight);

  $('html').attr('lang', 'ko');
  $('head').prepend(
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'"><style data-sageum-preview>${sandboxStyles()}</style>`,
  );
  return $.html();
}

function renderTable(
  rows: string[][],
  rowAnchors = new Map<number, number>(),
  rowBlocks = new Map<number, number>(),
  highlightedBlocks = new Set<number>(),
) {
  if (!rows.length) return '<p>표시할 셀이 없습니다.</p>';
  const body = rows.map((row, rowIndex) => {
    const cellTag = rowIndex === 0 ? 'th' : 'td';
    const blockIndex = rowAnchors.get(rowIndex);
    const rowBlock = rowBlocks.get(rowIndex);
    const highlighted = rowBlock !== undefined && highlightedBlocks.has(rowBlock);
    const anchor = blockIndex === undefined
      ? highlighted ? ' class="chunk-range-block"' : ''
      : blockAnchor(blockIndex, highlighted);
    return `<tr${anchor}>${row.map((cell) => `<${cellTag}>${lineBreaks(cell)}</${cellTag}>`).join('')}</tr>`;
  }).join('');
  return `<table><tbody>${body}</tbody></table>`;
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function renderXlsx(bytes: Uint8Array, highlight?: PreviewHighlight) {
  const sheets = await readXlsxFile(asBuffer(bytes));
  const highlightedBlocks = highlightedBlockIndexes(highlight);
  let nextBlockIndex = 0;
  const sections = sheets.map((sheet) => {
    const rowAnchors = new Map<number, number>();
    const rowBlocks = new Map<number, number>();
    let insideRegion = false;
    let activeBlockIndex: number | null = null;
    sheet.data.forEach((row, rowIndex) => {
      const hasContent = row.some((cell) => cellText(cell).trim());
      if (hasContent && !insideRegion) {
        activeBlockIndex = nextBlockIndex;
        rowAnchors.set(rowIndex, activeBlockIndex);
        nextBlockIndex += 1;
      }
      if (hasContent && activeBlockIndex !== null) rowBlocks.set(rowIndex, activeBlockIndex);
      if (!hasContent) activeBlockIndex = null;
      insideRegion = hasContent;
    });
    const rows = sheet.data
      .slice(0, MAX_PREVIEW_ROWS)
      .map((row) => row.slice(0, MAX_PREVIEW_COLUMNS).map(cellText));
    const truncated = sheet.data.length > MAX_PREVIEW_ROWS
      || sheet.data.some((row) => row.length > MAX_PREVIEW_COLUMNS);
    return `<section class="sheet"><h2>${escapeHtml(sheet.sheet)}</h2>${
      truncated
        ? `<p class="preview-note">미리보기는 최대 ${MAX_PREVIEW_ROWS}행 × ${MAX_PREVIEW_COLUMNS}열까지 표시합니다. 전체 내용은 원본을 다운로드해 확인하세요.</p>`
        : ''
    }${renderTable(rows, rowAnchors, rowBlocks, highlightedBlocks)}</section>`;
  });
  return sandboxDocument(sections.join('') || '<p>표시할 시트가 없습니다.</p>');
}

async function renderDocx(bytes: Uint8Array, highlight?: PreviewHighlight) {
  const result = await mammoth.convertToHtml(
    { buffer: asBuffer(bytes) },
    {
      convertImage: mammoth.images.dataUri,
      externalFileAccess: false,
      ignoreEmptyParagraphs: true,
    },
  );
  return sanitizeSandboxDocument(result.value, { annotateBlocks: true, highlight });
}

export async function renderDocumentPreview(
  bytes: Uint8Array,
  input: PreviewInput,
  highlight?: PreviewHighlight,
): Promise<string> {
  const metadata = validateDocumentMetadata(input);
  if (metadata.sourceType === 'pdf') {
    throw new Error('PDF preview requires a signed URL');
  }
  if (metadata.sourceType === 'docx') return renderDocx(bytes, highlight);
  if (metadata.sourceType === 'xlsx') return renderXlsx(bytes, highlight);

  const source = new TextDecoder('utf-8').decode(bytes);
  if (metadata.sourceType === 'html') {
    return sanitizeSandboxDocument(source, {
      annotateBlocks: true,
      includeContainerBlocks: true,
      highlight,
    });
  }

  const document = parseTextDocumentSource(source, input);
  return sandboxDocument(document.blocks.map((block, index) =>
    renderBlock(block, index, highlight),
  ).join(''));
}

function previewPageStyles() {
  return `
    :root { color-scheme: light; font-family: Inter, Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { min-width: 320px; min-height: 100vh; margin: 0; background: #e9ebe6; color: #17211d; }
    header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 68px; padding: 12px clamp(18px, 4vw, 48px); border-bottom: 1px solid #d4d6cc; background: rgba(251, 251, 248, .96); backdrop-filter: blur(12px); }
    .identity { min-width: 0; }
    .identity span { display: block; color: #6f7d77; font-size: 10px; font-weight: 800; letter-spacing: .14em; }
    .identity strong { display: block; overflow: hidden; margin-top: 2px; font-family: Georgia, "Noto Serif KR", serif; font-size: 17px; text-overflow: ellipsis; white-space: nowrap; }
    nav { display: flex; flex: none; gap: 8px; }
    a { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 7px 12px; border: 1px solid #d4d6cc; border-radius: 8px; background: #fff; color: #29483b; font-size: 11px; font-weight: 750; text-decoration: none; }
    a.download { border-color: #29483b; background: #29483b; color: #fff; }
    a:hover { border-color: #496b5b; background: #496b5b; color: #fff; }
    main { height: calc(100vh - 68px); padding: clamp(12px, 2.5vw, 28px); }
    iframe { display: block; width: min(1180px, 100%); height: 100%; margin: 0 auto; border: 1px solid #d4d6cc; border-radius: 12px; background: #fff; box-shadow: 0 18px 50px rgba(31, 43, 37, .12); }
    @media (max-width: 620px) { header { align-items: flex-start; flex-direction: column; } main { height: calc(100vh - 112px); padding: 8px; } nav { width: 100%; } nav a { flex: 1; } }
  `;
}

export function buildDocumentPreviewPage({
  documentId,
  title,
  filename,
  preview,
}: {
  documentId: string;
  title: string;
  filename: string;
  preview: DocumentPreview;
}): DocumentPreviewPage {
  const downloadUrl = `/api/documents/${encodeURIComponent(documentId)}/original?disposition=attachment`;
  const frame = preview.kind === 'pdf'
    ? `<iframe src="${escapeHtml(preview.signedUrl)}" title="${escapeHtml(filename)} PDF 원본"></iframe>`
    : `<iframe sandbox srcdoc="${escapeHtml(preview.sourceHtml)}" title="${escapeHtml(filename)} 문서 미리보기"></iframe>`;
  const frameOrigin = preview.kind === 'pdf' ? new URL(preview.signedUrl).origin : '';
  const contentSecurityPolicy = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `frame-src 'self'${frameOrigin ? ` ${frameOrigin}` : ''}`,
    "img-src data:",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join('; ');

  return {
    contentSecurityPolicy,
    html: `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · 원본 미리보기</title><style>${previewPageStyles()}</style></head><body><header><div class="identity"><span>SAGEUM ORIGINAL PREVIEW</span><strong>${escapeHtml(filename)}</strong></div><nav><a href="/">저장소로 돌아가기</a><a class="download" href="${escapeHtml(downloadUrl)}">원본 다운로드</a></nav></header><main>${frame}</main></body></html>`,
  };
}
