export type DocumentSourceType = 'markdown' | 'html' | 'text' | 'pdf' | 'docx' | 'xlsx';

export type DocumentLocation = {
  page?: number;
  sheet?: string;
  cellRange?: string;
  startOffset?: number;
  endOffset?: number;
};

export type NormalizedBlock = {
  id: string;
  kind: 'heading' | 'paragraph' | 'list' | 'table';
  text: string;
  headingPath: string[];
  location: DocumentLocation;
};

export type NormalizedDocument = {
  id: string;
  versionId: string;
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
  location: DocumentLocation;
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
