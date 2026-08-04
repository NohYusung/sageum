export type DocumentSourceType = 'markdown' | 'html' | 'text' | 'pdf' | 'docx' | 'xlsx';

export type DocumentLocation = {
  page?: number;
  sheet?: string;
  cellRange?: string;
  imageIndex?: number;
  previewBlock?: number;
  startOffset?: number;
  endOffset?: number;
};

export type DocumentBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DocumentSourceSpan = {
  blockId: string;
  blockIndex: number;
  startOffset: number;
  endOffset: number;
  startWord: number;
  endWord: number;
  page?: number;
  sheet?: string;
  cellRange?: string;
  imageIndex?: number;
  boxes?: DocumentBoundingBox[];
};

export type NormalizedBlock = {
  id: string;
  kind: 'heading' | 'paragraph' | 'list' | 'table' | 'image';
  text: string;
  headingPath: string[];
  location: DocumentLocation;
};

export type NormalizedDocument = {
  id: string;
  versionId: string;
  folderId?: string | null;
  sortOrder?: number;
  name: string;
  title: string;
  mimeType: string;
  sourceType: DocumentSourceType;
  sizeBytes: number;
  blocks: NormalizedBlock[];
};

export type DocumentChunk = {
  id: string;
  documentId: string;
  versionId: string;
  ordinal: number;
  text: string;
  wordCount: number;
  headingPath: string[];
  blockStart: number;
  blockEnd: number;
  focusBlock: number;
  location: DocumentLocation;
  sourceSpans: DocumentSourceSpan[];
};

export type ChunkingOptions = {
  targetWords: number;
  maxWords: number;
  overlapWords: number;
};

export const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
  targetWords: 400,
  maxWords: 500,
  overlapWords: 60,
};
