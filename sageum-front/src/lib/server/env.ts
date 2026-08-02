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

export function getProviderConfiguration(): ProviderConfiguration {
  const dimensions = Number.parseInt(value('EMBEDDING_DIMENSIONS') ?? '768', 10);
  const embeddingProvider = value('EMBEDDING_PROVIDER')?.toLocaleLowerCase('en-US') ?? null;
  const embeddingModel = value('EMBEDDING_MODEL');
  const validDimensions = Number.isFinite(dimensions) && dimensions > 0 ? dimensions : 768;
  return {
    supabase: {
      configured: Boolean(
        value('NEXT_PUBLIC_SUPABASE_URL') &&
          value('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
      ),
    },
    qdrant: {
      configured: Boolean(value('QDRANT_URL') && value('QDRANT_API_KEY')),
      collection: value('QDRANT_COLLECTION') ?? 'document_chunks',
    },
    embedding: {
      configured: Boolean(
        embeddingProvider &&
          SUPPORTED_EMBEDDING_PROVIDERS.has(embeddingProvider) &&
          embeddingModel &&
          value('EMBEDDING_API_KEY'),
      ),
      provider: embeddingProvider,
      model: embeddingModel,
      dimensions: validDimensions,
    },
  };
}

export function requireServerEnvironment(name: string) {
  const found = value(name);
  if (!found) throw new Error(`${name} 환경변수가 필요합니다.`);
  return found;
}
