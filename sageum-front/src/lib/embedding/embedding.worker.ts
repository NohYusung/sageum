/// <reference lib="webworker" />

import {
  BROWSER_EMBEDDING_BATCH_SIZE,
  BROWSER_EMBEDDING_DIMENSIONS,
  BROWSER_EMBEDDING_DTYPE,
  BROWSER_EMBEDDING_MODEL,
} from './config';

type EmbedRequest = {
  type: 'embed';
  requestId: string;
  texts: string[];
};

type DisposeRequest = {
  type: 'dispose';
};

type WorkerRequest = EmbedRequest | DisposeRequest;

type ProgressPayload = {
  status?: unknown;
  file?: unknown;
  progress?: unknown;
  loaded?: unknown;
  total?: unknown;
};

type EmbeddingRuntime = {
  tokenizer: Awaited<ReturnType<typeof import('@huggingface/transformers')['AutoTokenizer']['from_pretrained']>>;
  model: Awaited<ReturnType<typeof import('@huggingface/transformers')['AutoModel']['from_pretrained']>>;
};

const workerScope = self as DedicatedWorkerGlobalScope;
let runtime: EmbeddingRuntime | null = null;
let runtimePromise: Promise<EmbeddingRuntime> | null = null;
let workQueue = Promise.resolve();

function postProgress(requestId: string, payload: ProgressPayload) {
  workerScope.postMessage({
    type: 'progress',
    requestId,
    phase: 'loading',
    status: typeof payload.status === 'string' ? payload.status : 'loading',
    file: typeof payload.file === 'string' ? payload.file : undefined,
    progress: typeof payload.progress === 'number' ? payload.progress : undefined,
    loaded: typeof payload.loaded === 'number' ? payload.loaded : undefined,
    total: typeof payload.total === 'number' ? payload.total : undefined,
  });
}

async function loadRuntime(requestId: string) {
  if (runtime) return runtime;
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const { AutoModel, AutoTokenizer } = await import('@huggingface/transformers');
      const progressCallback = (payload: ProgressPayload) => postProgress(requestId, payload);
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(BROWSER_EMBEDDING_MODEL, {
          progress_callback: progressCallback,
        }),
        AutoModel.from_pretrained(BROWSER_EMBEDDING_MODEL, {
          dtype: BROWSER_EMBEDDING_DTYPE,
          progress_callback: progressCallback,
        }),
      ]);
      runtime = { tokenizer, model };
      return runtime;
    })().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

function vectorsFromOutput(value: unknown, expectedCount: number) {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw new Error('모델이 요청 개수와 다른 임베딩 결과를 반환했습니다.');
  }
  return value.map((candidate) => {
    if (!Array.isArray(candidate) || candidate.length !== BROWSER_EMBEDDING_DIMENSIONS) {
      throw new Error('EmbeddingGemma 벡터 차원이 768과 일치하지 않습니다.');
    }
    if (!candidate.every((item) => typeof item === 'number' && Number.isFinite(item))) {
      throw new Error('EmbeddingGemma 벡터에 올바르지 않은 값이 포함되어 있습니다.');
    }
    return candidate as number[];
  });
}

async function embed(request: EmbedRequest) {
  if (!request.texts.length || request.texts.some((text) => !text.trim())) {
    throw new Error('임베딩할 텍스트가 비어 있습니다.');
  }
  const { tokenizer, model } = await loadRuntime(request.requestId);
  const vectors: number[][] = [];

  for (let start = 0; start < request.texts.length; start += BROWSER_EMBEDDING_BATCH_SIZE) {
    const batch = request.texts.slice(start, start + BROWSER_EMBEDDING_BATCH_SIZE);
    const inputs = await tokenizer(batch, {
      padding: true,
      truncation: true,
      max_length: 2048,
    });
    const output = await model(inputs) as unknown as {
      sentence_embedding?: { tolist(): unknown };
    };
    if (!output.sentence_embedding) {
      throw new Error('EmbeddingGemma sentence_embedding 출력을 찾지 못했습니다.');
    }
    vectors.push(...vectorsFromOutput(output.sentence_embedding.tolist(), batch.length));
    workerScope.postMessage({
      type: 'progress',
      requestId: request.requestId,
      phase: 'embedding',
      completed: Math.min(start + batch.length, request.texts.length),
      total: request.texts.length,
    });
  }

  workerScope.postMessage({ type: 'result', requestId: request.requestId, vectors });
}

async function disposeRuntime() {
  const activeRuntime = runtime ?? await runtimePromise?.catch(() => null);
  await activeRuntime?.model.dispose();
  runtime = null;
  runtimePromise = null;
}

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === 'dispose') {
    workQueue = workQueue.then(disposeRuntime);
    return;
  }

  const request = event.data;
  workQueue = workQueue
    .then(() => embed(request))
    .catch((error: unknown) => {
      workerScope.postMessage({
        type: 'error',
        requestId: request.requestId,
        message: error instanceof Error ? error.message : '브라우저 임베딩에 실패했습니다.',
      });
    });
};

export {};
