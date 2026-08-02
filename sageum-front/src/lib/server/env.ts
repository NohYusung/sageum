import {
  BROWSER_EMBEDDING_COLLECTION,
  BROWSER_EMBEDDING_DIMENSIONS,
  BROWSER_EMBEDDING_DTYPE,
  BROWSER_EMBEDDING_MODEL,
  BROWSER_EMBEDDING_PROVIDER,
} from '@/lib/embedding/config';

export type ProviderConfiguration = {
  supabase: {
    configured: boolean;
  };
  qdrant: {
    configured: boolean;
    collection: string;
  };
  embedding: {
    configured: boolean;
    provider: string | null;
    model: string | null;
    dimensions: number;
    execution: 'browser' | 'server' | null;
    dtype: string | null;
  };
};

function value(name: string) {
  return process.env[name]?.trim() || null;
}

const SUPPORTED_EMBEDDING_PROVIDERS = new Set([
  'gemini',
  'google',
  'openai',
  'openai-compatible',
]);

const BROWSER_EMBEDDING_PROVIDERS = new Set([
  'browser',
  'browser-embeddinggemma',
  'embeddinggemma',
]);

export function getProviderConfiguration(): ProviderConfiguration {
  const requestedProvider = value('EMBEDDING_PROVIDER')?.toLocaleLowerCase('en-US')
    ?? BROWSER_EMBEDDING_PROVIDER;
  const browserEmbedding = BROWSER_EMBEDDING_PROVIDERS.has(requestedProvider);
  const serverEmbedding = SUPPORTED_EMBEDDING_PROVIDERS.has(requestedProvider);
  const requestedDimensions = Number.parseInt(value('EMBEDDING_DIMENSIONS') ?? '768', 10);
  const validDimensions = Number.isFinite(requestedDimensions) && requestedDimensions > 0
    ? requestedDimensions
    : 768;
  const embeddingProvider = browserEmbedding ? BROWSER_EMBEDDING_PROVIDER : requestedProvider;
  const embeddingModel = browserEmbedding ? BROWSER_EMBEDDING_MODEL : value('EMBEDDING_MODEL');
  const dimensions = browserEmbedding ? BROWSER_EMBEDDING_DIMENSIONS : validDimensions;
  const execution = browserEmbedding ? 'browser' : serverEmbedding ? 'server' : null;
  return {
    supabase: {
      configured: Boolean(
        value('NEXT_PUBLIC_SUPABASE_URL') &&
          value('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
      ),
    },
    qdrant: {
      configured: Boolean(value('QDRANT_URL') && value('QDRANT_API_KEY')),
      collection: value('QDRANT_COLLECTION')
        ?? (browserEmbedding ? BROWSER_EMBEDDING_COLLECTION : 'document_chunks'),
    },
    embedding: {
      configured: Boolean(
        browserEmbedding || (serverEmbedding && embeddingModel && value('EMBEDDING_API_KEY')),
      ),
      provider: embeddingProvider,
      model: embeddingModel,
      dimensions,
      execution,
      dtype: browserEmbedding ? BROWSER_EMBEDDING_DTYPE : null,
    },
  };
}

export function requireServerEnvironment(name: string) {
  const found = value(name);
  if (!found) throw new Error(`${name} 환경변수가 필요합니다.`);
  return found;
}
