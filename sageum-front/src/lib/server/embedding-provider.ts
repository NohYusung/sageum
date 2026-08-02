import { getProviderConfiguration, requireServerEnvironment } from './env';

export type EmbeddingPurpose = 'document' | 'query';

export interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

type ProviderOptions = {
  apiKey: string;
  model: string;
  dimensions: number;
  baseUrl?: string;
  batchSize?: number;
  fetcher?: typeof fetch;
};

type GeminiEmbeddingResponse = {
  embeddings?: Array<{ values?: unknown }>;
  error?: { message?: unknown };
};

type OpenAiEmbeddingResponse = {
  data?: Array<{ index?: unknown; embedding?: unknown }>;
  error?: { message?: unknown };
};

const DEFAULT_BATCH_SIZE = 32;
const REQUEST_TIMEOUT_MS = 30_000;

export class EmbeddingProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingProviderError';
  }
}

function normalizedBaseUrl(value: string) {
  return value.replace(/\/+$/u, '');
}

function normalizedModel(value: string) {
  return value.replace(/^models\//u, '');
}

function normalizedTexts(texts: string[]) {
  return texts.map((text) => {
    const normalized = text.trim();
    if (!normalized) throw new EmbeddingProviderError('빈 텍스트는 임베딩할 수 없습니다.');
    return normalized;
  });
}

function batchSize(value: number | undefined) {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value as number : DEFAULT_BATCH_SIZE;
}

function validateVectors(vectors: unknown[], expectedCount: number, dimensions: number) {
  if (vectors.length !== expectedCount) {
    throw new EmbeddingProviderError('임베딩 공급자가 요청 개수와 다른 결과를 반환했습니다.');
  }

  return vectors.map((candidate) => {
    if (!Array.isArray(candidate) || candidate.length !== dimensions) {
      throw new EmbeddingProviderError(
        `임베딩 벡터 차원이 설정값(${dimensions})과 일치하지 않습니다.`,
      );
    }
    if (!candidate.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new EmbeddingProviderError('임베딩 벡터에 올바르지 않은 값이 포함되어 있습니다.');
    }
    return candidate as number[];
  });
}

async function responseError(response: Response) {
  const payload = await response.json().catch(() => null) as {
    error?: { message?: unknown };
  } | null;
  const providerMessage = typeof payload?.error?.message === 'string'
    ? ` ${payload.error.message.slice(0, 300)}`
    : '';
  return new EmbeddingProviderError(
    `임베딩 공급자 요청이 실패했습니다 (${response.status}).${providerMessage}`,
  );
}

abstract class BatchedEmbeddingProvider implements EmbeddingProvider {
  abstract readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  protected readonly apiKey: string;
  protected readonly baseUrl: string;
  protected readonly fetcher: typeof fetch;
  private readonly maximumBatchSize: number;

  constructor(options: ProviderOptions, defaultBaseUrl: string) {
    this.apiKey = options.apiKey;
    this.model = normalizedModel(options.model);
    this.dimensions = options.dimensions;
    this.baseUrl = normalizedBaseUrl(options.baseUrl ?? defaultBaseUrl);
    this.fetcher = options.fetcher ?? fetch;
    this.maximumBatchSize = batchSize(options.batchSize);
  }

  protected abstract embedBatch(texts: string[], purpose: EmbeddingPurpose): Promise<number[][]>;

  private async embed(texts: string[], purpose: EmbeddingPurpose) {
    const normalized = normalizedTexts(texts);
    const vectors: number[][] = [];
    for (let start = 0; start < normalized.length; start += this.maximumBatchSize) {
      const batch = normalized.slice(start, start + this.maximumBatchSize);
      vectors.push(...await this.embedBatch(batch, purpose));
    }
    return vectors;
  }

  embedDocuments(texts: string[]) {
    return this.embed(texts, 'document');
  }

  async embedQuery(text: string) {
    const [vector] = await this.embed([text], 'query');
    return vector;
  }
}

export class GeminiEmbeddingProvider extends BatchedEmbeddingProvider {
  readonly provider = 'gemini';

  constructor(options: ProviderOptions) {
    super(options, 'https://generativelanguage.googleapis.com/v1beta');
  }

  protected async embedBatch(texts: string[], purpose: EmbeddingPurpose) {
    const modelPath = `models/${this.model}`;
    const response = await this.fetcher(
      `${this.baseUrl}/${modelPath}:batchEmbedContents`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: modelPath,
            content: { parts: [{ text }] },
            embedContentConfig: {
              taskType: purpose === 'document' ? 'RETRIEVAL_DOCUMENT' : 'RETRIEVAL_QUERY',
              outputDimensionality: this.dimensions,
            },
          })),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw await responseError(response);

    const payload = await response.json() as GeminiEmbeddingResponse;
    return validateVectors(
      (payload.embeddings ?? []).map((embedding) => embedding.values),
      texts.length,
      this.dimensions,
    );
  }
}

export class OpenAiCompatibleEmbeddingProvider extends BatchedEmbeddingProvider {
  readonly provider = 'openai-compatible';

  constructor(options: ProviderOptions) {
    super(options, 'https://api.openai.com/v1');
  }

  protected async embedBatch(texts: string[]) {
    const response = await this.fetcher(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        dimensions: this.dimensions,
        encoding_format: 'float',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw await responseError(response);

    const payload = await response.json() as OpenAiEmbeddingResponse;
    const ordered = (payload.data ?? []).toSorted((left, right) => {
      const leftIndex = typeof left.index === 'number' ? left.index : Number.MAX_SAFE_INTEGER;
      const rightIndex = typeof right.index === 'number' ? right.index : Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
    return validateVectors(
      ordered.map((item) => item.embedding),
      texts.length,
      this.dimensions,
    );
  }
}

let embeddingProvider: EmbeddingProvider | null = null;

export function getEmbeddingProvider() {
  if (embeddingProvider) return embeddingProvider;
  const configuration = getProviderConfiguration().embedding;
  const provider = requireServerEnvironment('EMBEDDING_PROVIDER').toLocaleLowerCase('en-US');
  const options: ProviderOptions = {
    apiKey: requireServerEnvironment('EMBEDDING_API_KEY'),
    model: requireServerEnvironment('EMBEDDING_MODEL'),
    dimensions: configuration.dimensions,
    baseUrl: process.env.EMBEDDING_BASE_URL?.trim() || undefined,
  };

  if (provider === 'gemini' || provider === 'google') {
    embeddingProvider = new GeminiEmbeddingProvider(options);
    return embeddingProvider;
  }
  if (provider === 'openai' || provider === 'openai-compatible') {
    embeddingProvider = new OpenAiCompatibleEmbeddingProvider(options);
    return embeddingProvider;
  }
  throw new EmbeddingProviderError(`지원하지 않는 임베딩 공급자입니다: ${provider}`);
}
