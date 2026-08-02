'use client';

import type { DocumentChunk } from '@/lib/rag/types';
import { documentEmbeddingInput, queryEmbeddingInput } from './config';

export type EmbeddingProgress =
  | {
      phase: 'loading';
      status: string;
      file?: string;
      progress?: number;
      loaded?: number;
      total?: number;
    }
  | {
      phase: 'embedding';
      completed: number;
      total: number;
    };

type PendingRequest = {
  resolve(vectors: number[][]): void;
  reject(error: Error): void;
  onProgress?: (progress: EmbeddingProgress) => void;
};

type WorkerResponse =
  | ({ type: 'progress'; requestId: string } & EmbeddingProgress)
  | { type: 'result'; requestId: string; vectors: number[][] }
  | { type: 'error'; requestId: string; message: string };

let embeddingWorker: Worker | null = null;
const pendingRequests = new Map<string, PendingRequest>();

function rejectPending(message: string) {
  for (const pending of pendingRequests.values()) pending.reject(new Error(message));
  pendingRequests.clear();
}

function getEmbeddingWorker() {
  if (embeddingWorker) return embeddingWorker;
  embeddingWorker = new Worker(new URL('./embedding.worker.ts', import.meta.url), {
    type: 'module',
    name: 'sageum-embeddinggemma',
  });
  embeddingWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;
    if (message.type === 'progress') {
      const { type: _type, requestId: _requestId, ...progress } = message;
      pending.onProgress?.(progress);
      return;
    }
    pendingRequests.delete(message.requestId);
    if (message.type === 'error') pending.reject(new Error(message.message));
    else pending.resolve(message.vectors);
  };
  embeddingWorker.onerror = () => {
    rejectPending('EmbeddingGemma 브라우저 워커를 실행하지 못했습니다.');
    embeddingWorker?.terminate();
    embeddingWorker = null;
  };
  return embeddingWorker;
}

function embedTexts(texts: string[], onProgress?: (progress: EmbeddingProgress) => void) {
  return new Promise<number[][]>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    pendingRequests.set(requestId, { resolve, reject, onProgress });
    getEmbeddingWorker().postMessage({ type: 'embed', requestId, texts });
  });
}

export function embedDocumentChunks(
  title: string,
  chunks: DocumentChunk[],
  onProgress?: (progress: EmbeddingProgress) => void,
) {
  return embedTexts(chunks.map((chunk) => documentEmbeddingInput(title, chunk)), onProgress);
}

export async function embedSearchQuery(
  query: string,
  onProgress?: (progress: EmbeddingProgress) => void,
) {
  const [vector] = await embedTexts([queryEmbeddingInput(query)], onProgress);
  return vector;
}

export function disposeBrowserEmbedding() {
  if (!embeddingWorker) return;
  embeddingWorker.postMessage({ type: 'dispose' });
  embeddingWorker.terminate();
  embeddingWorker = null;
  rejectPending('EmbeddingGemma 워커가 종료되었습니다.');
}
