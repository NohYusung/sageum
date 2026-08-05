import { load } from 'cheerio';
import type { AnyNode, Text } from 'domhandler';
import ExcelJS, {
  type Alignment,
  type Border,
  type Cell,
  type Color,
  type Fill,
  type Font,
  type Worksheet,
} from 'exceljs';
import JSZip from 'jszip';
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

function normalizePrefixedOoxml(source: string) {
  const root = /<([A-Za-z_][\w.-]*):(workbook|worksheet|styleSheet|sst)\b/u.exec(source);
  if (!root) return source;
  const prefix = root[1].replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return source
    .replace(new RegExp(`(<\\/?)(?:${prefix}):`, 'gu'), '$1')
    .replace(new RegExp(`xmlns:${prefix}=`, 'u'), 'xmlns=');
}

async function loadExcelWorkbook(bytes: Uint8Array) {
  const sourceBuffer = asBuffer(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(sourceBuffer as never);
    return workbook;
  } catch (directLoadError) {
    try {
      const zip = await JSZip.loadAsync(sourceBuffer);
      await Promise.all(Object.values(zip.files).map(async (entry) => {
        if (entry.dir || !entry.name.endsWith('.xml')) return;
        const source = await entry.async('string');
        const normalized = normalizePrefixedOoxml(source);
        if (normalized !== source) zip.file(entry.name, normalized);
      }));
      const normalizedBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const normalizedWorkbook = new ExcelJS.Workbook();
      await normalizedWorkbook.xlsx.load(normalizedBuffer as never);
      return normalizedWorkbook;
    } catch (normalizedLoadError) {
      throw new Error('XLSX preview workbook load failed', {
        cause: normalizedLoadError ?? directLoadError,
      });
    }
  }
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
    .preview-note { margin: 16px 0 28px; padding: 11px 13px; border-radius: 8px; background: #f7ead8; color: #69451c; font-size: 12px; }
    body.spreadsheet-preview { max-width: none; padding: 0; background: #f3f5f2; line-height: 1.4; overflow: hidden; }
    .workbook-shell { display: flex; height: 100vh; min-height: 340px; flex-direction: column; }
    .sheet-switch { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    .sheet-tabs { z-index: 5; display: flex; flex: none; min-height: 42px; padding: 7px 12px 0; gap: 3px; overflow-x: auto; border-bottom: 1px solid #c9cec8; background: #e7ebe7; scrollbar-width: thin; }
    .sheet-tab { display: inline-flex; min-width: 76px; max-width: 220px; height: 35px; align-items: center; justify-content: center; padding: 0 16px; border: 1px solid transparent; border-bottom: 0; border-radius: 7px 7px 0 0; color: #52615a; font-size: 12px; font-weight: 650; white-space: nowrap; cursor: pointer; }
    .sheet-tab:hover { background: rgba(255, 255, 255, .55); color: #203d31; }
    .sheet-panels { position: relative; flex: 1; min-height: 0; }
    .spreadsheet-sheet { display: none; position: absolute; inset: 0; overflow: auto; background: #fff; }
    .spreadsheet-grid { width: max-content; min-width: 100%; margin: 0; border: 0; border-collapse: separate; border-spacing: 0; table-layout: fixed; background: #fff; font-size: 13px; }
    .spreadsheet-grid th, .spreadsheet-grid td { min-width: 0; height: 24px; padding: 3px 6px; border: 0; border-right: 1px solid #dfe3df; border-bottom: 1px solid #dfe3df; background: #fff; line-height: 1.25; text-align: left; vertical-align: bottom; white-space: nowrap; overflow: hidden; }
    .spreadsheet-grid thead th { position: sticky; top: 0; z-index: 3; height: 25px; padding: 2px 4px; background: #edf0ed; color: #637168; font-family: Inter, Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 10px; font-weight: 650; text-align: center; vertical-align: middle; }
    .spreadsheet-grid .row-number { position: sticky; left: 0; z-index: 2; width: 44px; min-width: 44px; max-width: 44px; padding: 2px 6px; border-right-color: #cbd1cb; background: #edf0ed; color: #637168; font-family: Inter, Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 10px; font-weight: 600; text-align: right; vertical-align: middle; }
    .spreadsheet-grid .sheet-corner { left: 0; z-index: 4; width: 44px; min-width: 44px; max-width: 44px; border-right-color: #cbd1cb; }
    .spreadsheet-grid tr:nth-child(even) td { background-color: #fff; }
    .spreadsheet-grid td.wrap-text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .spreadsheet-grid td.chunk-range-cell { position: relative; background-image: linear-gradient(rgba(255, 226, 139, .48), rgba(255, 226, 139, .48)); box-shadow: inset 0 0 0 2px rgba(167, 111, 42, .5); }
    .spreadsheet-grid tr.chunk-range-block > .row-number { background: #fff0bd; color: #7d541e; }
    .spreadsheet-empty { display: grid; min-height: 100%; place-items: center; padding: 40px; color: #7a867f; }
  `;
}

function sandboxDocument(body: string, bodyClass = '') {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'"><style>${sandboxStyles()}</style></head><body${bodyClass ? ` class="${escapeHtml(bodyClass)}"` : ''}>${body}</body></html>`;
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

type CellRange = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

type SheetBlockMap = {
  rowAnchors: Map<number, number>;
  rowBlocks: Map<number, number>;
};

const OFFICE_THEME_COLORS = [
  '#ffffff', '#000000', '#eeece1', '#1f497d', '#4f81bd', '#c0504d',
  '#9bbb59', '#8064a2', '#4bacc6', '#f79646', '#0000ff', '#800080',
];

function columnNumber(value: string) {
  return [...value.toLocaleUpperCase('en-US')].reduce(
    (result, character) => result * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

function columnLabel(column: number) {
  let current = column;
  let result = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function parseCellRange(value: string): CellRange | null {
  const match = /^(?:[^!]+!)?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/iu.exec(value);
  if (!match) return null;
  const left = columnNumber(match[1]);
  const top = Number(match[2]);
  const right = columnNumber(match[3] ?? match[1]);
  const bottom = Number(match[4] ?? match[2]);
  if (![left, top, right, bottom].every(Number.isInteger)) return null;
  return {
    top: Math.min(top, bottom),
    left: Math.min(left, right),
    bottom: Math.max(top, bottom),
    right: Math.max(left, right),
  };
}

function rangesOverlap(left: CellRange, right: CellRange) {
  return left.left <= right.right
    && left.right >= right.left
    && left.top <= right.bottom
    && left.bottom >= right.top;
}

function colorCss(color?: Partial<Color>) {
  if (!color) return null;
  const extended = color as Partial<Color> & { indexed?: number; tint?: number };
  const withTint = (red: number, green: number, blue: number, alpha = 1) => {
    const tint = Math.min(Math.max(extended.tint ?? 0, -1), 1);
    const tintChannel = (channel: number) => Math.round(
      tint < 0 ? channel * (1 + tint) : channel * (1 - tint) + 255 * tint,
    );
    const tinted = [tintChannel(red), tintChannel(green), tintChannel(blue)];
    return alpha < 0.995
      ? `rgba(${tinted.join(',')},${alpha.toFixed(3)})`
      : `#${tinted.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  };
  if (extended.argb && /^[0-9a-f]{6,8}$/iu.test(extended.argb)) {
    const argb = extended.argb.padStart(8, 'f');
    const alpha = Number.parseInt(argb.slice(0, 2), 16) / 255;
    const red = Number.parseInt(argb.slice(2, 4), 16);
    const green = Number.parseInt(argb.slice(4, 6), 16);
    const blue = Number.parseInt(argb.slice(6, 8), 16);
    return withTint(red, green, blue, alpha);
  }
  if (extended.theme !== undefined) {
    const themeColor = OFFICE_THEME_COLORS[extended.theme];
    if (!themeColor) return null;
    return withTint(
      Number.parseInt(themeColor.slice(1, 3), 16),
      Number.parseInt(themeColor.slice(3, 5), 16),
      Number.parseInt(themeColor.slice(5, 7), 16),
    );
  }
  if (extended.indexed === 0) return '#000000';
  if (extended.indexed === 1) return '#ffffff';
  return null;
}

function fontStyles(font?: Partial<Font>) {
  if (!font) return [];
  const styles: string[] = [];
  if (font.name) styles.push(`font-family:${JSON.stringify(font.name)},sans-serif`);
  if (font.size && Number.isFinite(font.size)) {
    styles.push(`font-size:${Math.min(Math.max(font.size, 7), 40)}pt`);
  }
  if (font.bold) styles.push('font-weight:700');
  if (font.italic) styles.push('font-style:italic');
  const decorations = [font.underline && font.underline !== 'none' ? 'underline' : '', font.strike ? 'line-through' : ''].filter(Boolean);
  if (decorations.length) styles.push(`text-decoration:${decorations.join(' ')}`);
  const color = colorCss(font.color);
  if (color) styles.push(`color:${color}`);
  return styles;
}

function fillStyles(fill?: Fill) {
  if (!fill) return [];
  if (fill.type === 'pattern') {
    const foreground = colorCss(fill.fgColor);
    const background = colorCss(fill.bgColor);
    const color = foreground ?? background;
    return color && fill.pattern !== 'none' ? [`background-color:${color}`] : [];
  }
  const stops = fill.stops
    .map((stop) => {
      const color = colorCss(stop.color);
      return color ? `${color} ${Math.round(stop.position * 100)}%` : null;
    })
    .filter((value): value is string => Boolean(value));
  if (stops.length < 2) return [];
  const degree = fill.gradient === 'angle' ? fill.degree : 90;
  return [`background-image:linear-gradient(${degree}deg,${stops.join(',')})`];
}

function borderStyles(border?: Partial<Border>, side?: 'top' | 'right' | 'bottom' | 'left') {
  if (!border?.style || !side) return [];
  const width = border.style === 'thick'
    ? 3
    : border.style.startsWith('medium') || border.style === 'double'
      ? 2
      : 1;
  const style = border.style === 'double'
    ? 'double'
    : border.style.includes('dash')
      ? 'dashed'
      : ['dotted', 'hair'].includes(border.style)
        ? 'dotted'
        : 'solid';
  return [`border-${side}:${width}px ${style} ${colorCss(border.color) ?? '#8e9892'}`];
}

function alignmentStyles(alignment?: Partial<Alignment>) {
  if (!alignment) return [];
  const styles: string[] = [];
  const horizontal = alignment.horizontal === 'centerContinuous'
    ? 'center'
    : alignment.horizontal === 'distributed'
      ? 'justify'
      : alignment.horizontal;
  if (horizontal && ['left', 'center', 'right', 'justify'].includes(horizontal)) {
    styles.push(`text-align:${horizontal}`);
  }
  const vertical = alignment.vertical === 'middle' ? 'middle' : alignment.vertical;
  if (vertical && ['top', 'middle', 'bottom'].includes(vertical)) {
    styles.push(`vertical-align:${vertical}`);
  }
  if (alignment.indent && alignment.indent > 0) {
    styles.push(`padding-left:${Math.min(alignment.indent, 12) * 12 + 6}px`);
  }
  if (alignment.shrinkToFit) styles.push('font-size:smaller');
  return styles;
}

function cellStyles(cell: Cell) {
  return [
    ...fontStyles(cell.font),
    ...fillStyles(cell.fill),
    ...alignmentStyles(cell.alignment),
    ...borderStyles(cell.border?.top, 'top'),
    ...borderStyles(cell.border?.right, 'right'),
    ...borderStyles(cell.border?.bottom, 'bottom'),
    ...borderStyles(cell.border?.left, 'left'),
  ];
}

function sheetBlockMap(rows: unknown[][], nextBlockIndex: { value: number }): SheetBlockMap {
  const rowAnchors = new Map<number, number>();
  const rowBlocks = new Map<number, number>();
  let activeBlockIndex: number | null = null;
  rows.forEach((row, rowIndex) => {
    const hasContent = row.some((cell) => cellText(cell).trim());
    if (hasContent && activeBlockIndex === null) {
      activeBlockIndex = nextBlockIndex.value;
      rowAnchors.set(rowIndex, activeBlockIndex);
      nextBlockIndex.value += 1;
    }
    if (hasContent && activeBlockIndex !== null) rowBlocks.set(rowIndex, activeBlockIndex);
    if (!hasContent) activeBlockIndex = null;
  });
  return { rowAnchors, rowBlocks };
}

function excelColumnWidthPixels(width?: number) {
  if (!width || !Number.isFinite(width)) return 86;
  return Math.round(Math.min(Math.max(width * 7 + 5, 32), 440));
}

function formulaResult(value: unknown) {
  if (value && typeof value === 'object' && 'result' in value) {
    return (value as { result?: unknown }).result;
  }
  return value;
}

function formattedDate(value: Date, numberFormat: string) {
  const format = numberFormat.toLocaleLowerCase('en-US');
  const includesDate = /(?:^|[^a-z])(?:yyyy|yy|mm|m|dd|d)(?:[^a-z]|$)/u.test(format);
  const includesTime = /(?:h|s|am\/pm)/u.test(format);
  if (!includesDate && !includesTime) return value.toLocaleString('ko-KR');
  if (includesTime) {
    return new Intl.DateTimeFormat('ko-KR', {
      year: includesDate ? 'numeric' : undefined,
      month: includesDate ? '2-digit' : undefined,
      day: includesDate ? '2-digit' : undefined,
      hour: '2-digit',
      minute: '2-digit',
      second: format.includes('s') ? '2-digit' : undefined,
      hour12: format.includes('am/pm'),
    }).format(value);
  }
  const year = format.includes('yyyy')
    ? String(value.getFullYear())
    : String(value.getFullYear()).slice(-2);
  const month = String(value.getMonth() + 1).padStart(format.includes('mm') ? 2 : 1, '0');
  const day = String(value.getDate()).padStart(format.includes('dd') ? 2 : 1, '0');
  const separator = format.includes('/') ? '/' : format.includes('.') ? '.' : '-';
  const yearIndex = format.search(/y/u);
  const monthIndex = format.search(/m/u);
  const dayIndex = format.search(/d/u);
  return [
    { value: year, index: yearIndex },
    { value: month, index: monthIndex },
    { value: day, index: dayIndex },
  ]
    .filter((part) => part.index >= 0)
    .toSorted((left, right) => left.index - right.index)
    .map((part) => part.value)
    .join(separator);
}

function formattedNumber(value: number, numberFormat: string) {
  const section = numberFormat.split(';')[value < 0 ? 1 : 0] ?? numberFormat;
  const normalized = section.replace(/\[[^\]]*\]/gu, '').replace(/"([^"]*)"/gu, '$1');
  if (!/[0#?]/u.test(normalized)) return String(value);
  const percentage = normalized.includes('%');
  const decimalPattern = /\.([0#?]+)/u.exec(normalized)?.[1] ?? '';
  const minimumFractionDigits = [...decimalPattern].filter((character) => character === '0').length;
  const maximumFractionDigits = decimalPattern.length;
  const formatted = new Intl.NumberFormat('ko-KR', {
    useGrouping: normalized.includes(','),
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(percentage ? value * 100 : value);
  const currency = /[₩$€£¥]/u.exec(normalized)?.[0] ?? '';
  const result = `${currency}${formatted}${percentage ? '%' : ''}`;
  return value < 0 && normalized.includes('(') ? `(${result.replace('-', '')})` : result;
}

function displayedCellText(cell: Cell) {
  const value = formulaResult(cell.value);
  if (value instanceof Date) return formattedDate(value, cell.numFmt || 'yyyy-mm-dd');
  if (typeof value === 'number' && cell.numFmt && cell.numFmt !== 'General') {
    return formattedNumber(value, cell.numFmt);
  }
  return cell.text;
}

function renderSpreadsheetSheet({
  worksheet,
  blockMap,
  highlightedBlocks,
  highlightRanges,
}: {
  worksheet: Worksheet;
  blockMap: SheetBlockMap;
  highlightedBlocks: Set<number>;
  highlightRanges: CellRange[];
}) {
  const mergeMasters = new Map<string, CellRange>();
  const coveredCells = new Set<string>();
  worksheet.model.merges.forEach((value) => {
    const range = parseCellRange(value);
    if (!range) return;
    mergeMasters.set(`${range.top}:${range.left}`, range);
    for (let row = range.top; row <= range.bottom; row += 1) {
      for (let column = range.left; column <= range.right; column += 1) {
        if (row !== range.top || column !== range.left) coveredCells.add(`${row}:${column}`);
      }
    }
  });

  const maximumMergeRow = Math.max(0, ...[...mergeMasters.values()].map((range) => range.bottom));
  const maximumMergeColumn = Math.max(0, ...[...mergeMasters.values()].map((range) => range.right));
  const totalRows = Math.max(worksheet.rowCount, maximumMergeRow);
  const totalColumns = Math.max(worksheet.columnCount, worksheet.columns.length, maximumMergeColumn);
  if (!totalRows || !totalColumns) {
    return '<div class="spreadsheet-empty">이 시트에는 표시할 셀이 없습니다.</div>';
  }

  const rowCount = Math.min(totalRows, MAX_PREVIEW_ROWS);
  const columnCount = Math.min(totalColumns, MAX_PREVIEW_COLUMNS);
  const truncated = totalRows > rowCount || totalColumns > columnCount;
  const columns = Array.from({ length: columnCount }, (_value, index) => {
    const column = worksheet.getColumn(index + 1);
    const width = column.hidden ? 0 : excelColumnWidthPixels(column.width);
    return `<col style="width:${width}px;min-width:${width}px;${column.hidden ? 'visibility:collapse;' : ''}">`;
  }).join('');
  const columnHeaders = Array.from({ length: columnCount }, (_value, index) =>
    `<th scope="col">${columnLabel(index + 1)}</th>`,
  ).join('');

  const rows = Array.from({ length: rowCount }, (_value, rowOffset) => {
    const rowNumber = rowOffset + 1;
    const row = worksheet.getRow(rowNumber);
    const blockIndex = blockMap.rowAnchors.get(rowOffset);
    const rowBlock = blockMap.rowBlocks.get(rowOffset);
    const highlighted = rowBlock !== undefined && highlightedBlocks.has(rowBlock);
    const anchor = blockIndex === undefined
      ? highlighted ? ' class="chunk-range-block"' : ''
      : blockAnchor(blockIndex, highlighted);
    const rowHeight = row.height && Number.isFinite(row.height)
      ? `height:${Math.min(Math.max(row.height, 12), 240)}pt;`
      : '';
    const rowStyle = `${rowHeight}${row.hidden ? 'display:none;' : ''}`;
    const cells: string[] = [];
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      const cellKey = `${rowNumber}:${columnNumber}`;
      if (coveredCells.has(cellKey)) continue;
      const cell = worksheet.getCell(rowNumber, columnNumber);
      const merge = mergeMasters.get(cellKey);
      const displayedRange: CellRange = merge
        ? {
            top: merge.top,
            left: merge.left,
            bottom: Math.min(merge.bottom, rowCount),
            right: Math.min(merge.right, columnCount),
          }
        : { top: rowNumber, left: columnNumber, bottom: rowNumber, right: columnNumber };
      const isHighlighted = highlightRanges.some((range) => rangesOverlap(displayedRange, range));
      const classes = [cell.alignment?.wrapText ? 'wrap-text' : '', isHighlighted ? 'chunk-range-cell' : ''].filter(Boolean);
      const styles = cellStyles(cell);
      const rowSpan = displayedRange.bottom - displayedRange.top + 1;
      const columnSpan = displayedRange.right - displayedRange.left + 1;
      const attributes = [
        classes.length ? `class="${classes.join(' ')}"` : '',
        styles.length ? `style="${escapeHtml(styles.join(';'))}"` : '',
        rowSpan > 1 ? `rowspan="${rowSpan}"` : '',
        columnSpan > 1 ? `colspan="${columnSpan}"` : '',
        `title="${columnLabel(columnNumber)}${rowNumber}"`,
      ].filter(Boolean).join(' ');
      cells.push(`<td ${attributes}>${lineBreaks(displayedCellText(cell))}</td>`);
    }
    return `<tr${anchor}${rowStyle ? ` style="${rowStyle}"` : ''}><th class="row-number" scope="row">${rowNumber}</th>${cells.join('')}</tr>`;
  }).join('');

  return `${truncated
    ? `<p class="preview-note">미리보기는 최대 ${MAX_PREVIEW_ROWS}행 × ${MAX_PREVIEW_COLUMNS}열까지 표시합니다. 전체 내용은 원본을 다운로드해 확인하세요.</p>`
    : ''}<table class="spreadsheet-grid"><colgroup><col style="width:44px;min-width:44px">${columns}</colgroup><thead><tr><th class="sheet-corner"></th>${columnHeaders}</tr></thead><tbody>${rows}</tbody></table>`;
}

async function renderXlsx(bytes: Uint8Array, highlight?: PreviewHighlight) {
  const [sheets, workbook] = await Promise.all([
    readXlsxFile(asBuffer(bytes)),
    loadExcelWorkbook(bytes),
  ]);
  const highlightedBlocks = highlightedBlockIndexes(highlight);
  const nextBlockIndex = { value: 0 };
  const blockMaps = new Map(sheets.map((sheet) => [
    sheet.sheet,
    sheetBlockMap(sheet.data, nextBlockIndex),
  ]));
  const emptyBlockMap: SheetBlockMap = { rowAnchors: new Map(), rowBlocks: new Map() };
  const highlightedSheetNames = new Set(
    highlight?.sourceSpans?.flatMap((span) => span.sheet ? [span.sheet] : []) ?? [],
  );
  if (!highlightedSheetNames.size && highlightedBlocks.size) {
    blockMaps.forEach((blockMap, sheetName) => {
      if ([...blockMap.rowBlocks.values()].some((blockIndex) => highlightedBlocks.has(blockIndex))) {
        highlightedSheetNames.add(sheetName);
      }
    });
  }

  const worksheets = workbook.worksheets;
  if (!worksheets.length) {
    return sandboxDocument('<div class="spreadsheet-empty">표시할 시트가 없습니다.</div>', 'spreadsheet-preview');
  }
  const selectedSheetIndex = Math.max(0, worksheets.findIndex((sheet) => highlightedSheetNames.has(sheet.name)));
  const inputs = worksheets.map((_worksheet, index) =>
    `<input class="sheet-switch" id="sheet-switch-${index}" name="sheet-switch" type="radio"${index === selectedSheetIndex ? ' checked' : ''}>`,
  ).join('');
  const tabs = worksheets.map((worksheet, index) =>
    `<label class="sheet-tab" for="sheet-switch-${index}" title="${escapeHtml(worksheet.name)}">${escapeHtml(worksheet.name)}</label>`,
  ).join('');
  const panels = worksheets.map((worksheet, index) => {
    const highlightRanges = highlight?.sourceSpans
      ?.filter((span) => span.sheet === worksheet.name && span.cellRange)
      .flatMap((span) => {
        const range = parseCellRange(span.cellRange!);
        return range ? [range] : [];
      }) ?? [];
    return `<section class="spreadsheet-sheet" id="sheet-panel-${index}" aria-label="${escapeHtml(worksheet.name)}">${renderSpreadsheetSheet({
      worksheet,
      blockMap: blockMaps.get(worksheet.name) ?? emptyBlockMap,
      highlightedBlocks,
      highlightRanges,
    })}</section>`;
  }).join('');
  const sheetRules = worksheets.map((_worksheet, index) => `
    #sheet-switch-${index}:checked ~ .sheet-tabs label[for="sheet-switch-${index}"] { border-color: #c9cec8; background: #fff; color: #214536; }
    #sheet-switch-${index}:checked ~ .sheet-panels #sheet-panel-${index} { display: block; }
  `).join('');
  return sandboxDocument(
    `<div class="workbook-shell">${inputs}<nav class="sheet-tabs" aria-label="워크시트">${tabs}</nav><div class="sheet-panels">${panels}</div><style>${sheetRules}</style></div>`,
    'spreadsheet-preview',
  );
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
