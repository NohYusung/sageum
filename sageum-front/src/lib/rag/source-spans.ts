import type { DocumentBoundingBox, DocumentSourceSpan } from './types';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionalNumber(value: unknown) {
  return value === undefined || value === null ? undefined : finiteNumber(value) ?? undefined;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value ? value : undefined;
}

function parseBoxes(value: unknown): DocumentBoundingBox[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const boxes = value.flatMap((item) => {
    const found = record(item);
    if (!found) return [];
    const x = finiteNumber(found.x);
    const y = finiteNumber(found.y);
    const width = finiteNumber(found.width);
    const height = finiteNumber(found.height);
    if (x === null || y === null || width === null || height === null) return [];
    if (width < 0 || height < 0) return [];
    return [{ x, y, width, height }];
  });
  return boxes.length ? boxes : undefined;
}

export function parseDocumentSourceSpans(value: unknown): DocumentSourceSpan[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const found = record(item);
    if (!found) return [];
    const blockId = optionalString(found.blockId);
    const blockIndex = finiteNumber(found.blockIndex);
    const startOffset = finiteNumber(found.startOffset);
    const endOffset = finiteNumber(found.endOffset);
    const startWord = finiteNumber(found.startWord);
    const endWord = finiteNumber(found.endWord);
    if (
      !blockId
      || blockIndex === null
      || startOffset === null
      || endOffset === null
      || startWord === null
      || endWord === null
      || blockIndex < 0
      || startOffset < 0
      || endOffset < startOffset
      || startWord < 0
      || endWord < startWord
    ) {
      return [];
    }
    return [{
      blockId,
      blockIndex,
      startOffset,
      endOffset,
      startWord,
      endWord,
      page: optionalNumber(found.page),
      sheet: optionalString(found.sheet),
      cellRange: optionalString(found.cellRange),
      imageIndex: optionalNumber(found.imageIndex),
      boxes: parseBoxes(found.boxes),
    }];
  });
}

export function sourceSpansFromMetadata(metadata: unknown) {
  const found = record(metadata);
  return parseDocumentSourceSpans(found?.sourceSpans);
}

export function metadataBlockRange(metadata: unknown) {
  const found = record(metadata);
  const blockStart = finiteNumber(found?.blockStart);
  const blockEnd = finiteNumber(found?.blockEnd);
  return {
    blockStart: blockStart !== null && blockStart >= 0 ? blockStart : undefined,
    blockEnd: blockEnd !== null && blockEnd >= 0 ? blockEnd : undefined,
  };
}
