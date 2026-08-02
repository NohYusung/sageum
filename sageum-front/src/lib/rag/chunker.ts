import {
  DEFAULT_CHUNKING_OPTIONS,
  type ChunkingOptions,
  type DocumentChunk,
  type NormalizedDocument,
} from './types';

type WordToken = {
  value: string;
  blockIndex: number;
  boundaryAfter: boolean;
};

const SENTENCE_END = /[.!?。！？][\]})"'’”]*$/u;

function tokenize(document: NormalizedDocument): WordToken[] {
  const tokens: WordToken[] = [];

  document.blocks.forEach((block, blockIndex) => {
    const words = block.text.trim().split(/\s+/u).filter(Boolean);
    words.forEach((value, wordIndex) => {
      tokens.push({
        value,
        blockIndex,
        boundaryAfter: wordIndex === words.length - 1 || SENTENCE_END.test(value),
      });
    });
  });

  return tokens;
}

function validateOptions(options: ChunkingOptions) {
  if (options.targetWords < 1 || options.maxWords < 1) {
    throw new Error('청크 크기는 1단어 이상이어야 합니다.');
  }
  if (options.targetWords > options.maxWords) {
    throw new Error('targetWords는 maxWords보다 클 수 없습니다.');
  }
  if (options.overlapWords < 0 || options.overlapWords >= options.targetWords) {
    throw new Error('overlapWords는 0 이상 targetWords 미만이어야 합니다.');
  }
}

function chooseChunkEnd(tokens: WordToken[], start: number, options: ChunkingOptions) {
  const total = tokens.length;
  const targetEnd = Math.min(start + options.targetWords, total);
  const maxEnd = Math.min(start + options.maxWords, total);

  if (maxEnd === total) return total;

  for (let end = targetEnd; end < maxEnd; end += 1) {
    if (tokens[end - 1]?.boundaryAfter) return end;
  }

  const minimumEnd = Math.min(
    maxEnd,
    start + Math.max(1, Math.floor(options.targetWords * 0.75)),
  );

  for (let end = targetEnd; end >= minimumEnd; end -= 1) {
    if (tokens[end - 1]?.boundaryAfter) return end;
  }

  return maxEnd;
}

export function chunkDocument(
  document: NormalizedDocument,
  overrides: Partial<ChunkingOptions> = {},
): DocumentChunk[] {
  const options = { ...DEFAULT_CHUNKING_OPTIONS, ...overrides };
  validateOptions(options);

  const tokens = tokenize(document);
  if (!tokens.length) return [];

  const chunks: DocumentChunk[] = [];
  let start = 0;

  while (start < tokens.length) {
    const end = chooseChunkEnd(tokens, start, options);
    const window = tokens.slice(start, end);
    const firstBlockIndex = window[0].blockIndex;
    const lastBlockIndex = window[window.length - 1].blockIndex;
    const firstBlock = document.blocks[firstBlockIndex];
    const lastBlock = document.blocks[lastBlockIndex];
    const ordinal = chunks.length;

    chunks.push({
      id: `${document.versionId}:${String(ordinal).padStart(6, '0')}`,
      documentId: document.id,
      versionId: document.versionId,
      ordinal,
      text: window.map((token) => token.value).join(' '),
      wordCount: window.length,
      headingPath: lastBlock.headingPath.length ? lastBlock.headingPath : firstBlock.headingPath,
      blockStart: firstBlockIndex,
      blockEnd: lastBlockIndex,
      location: {
        page: firstBlock.location.page ?? lastBlock.location.page,
        sheet: firstBlock.location.sheet ?? lastBlock.location.sheet,
        cellRange: firstBlock.location.cellRange ?? lastBlock.location.cellRange,
        startOffset: firstBlock.location.startOffset,
        endOffset: lastBlock.location.endOffset,
      },
    });

    if (end >= tokens.length) break;
    const nextStart = end - options.overlapWords;
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

export function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}
