import type { DocumentChunk } from '@/lib/rag/types';

export const BROWSER_EMBEDDING_PROVIDER = 'browser-embeddinggemma';
export const BROWSER_EMBEDDING_MODEL = 'onnx-community/embeddinggemma-300m-ONNX';
export const BROWSER_EMBEDDING_DTYPE = 'q8';
export const BROWSER_EMBEDDING_DIMENSIONS = 768;
export const BROWSER_EMBEDDING_COLLECTION = 'document_chunks_embeddinggemma_q8';
export const BROWSER_EMBEDDING_BATCH_SIZE = 8;

export function documentEmbeddingInput(title: string, chunk: DocumentChunk) {
  const chunkText = [chunk.headingPath.join(' › '), chunk.text]
    .filter(Boolean)
    .join('\n');
  return `title: ${title.trim() || 'none'} | text: ${chunkText}`;
}

export function queryEmbeddingInput(query: string) {
  return `task: search result | query: ${query.trim()}`;
}
