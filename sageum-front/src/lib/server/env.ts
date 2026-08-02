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

export function getProviderConfiguration(): ProviderConfiguration {
  const dimensions = Number.parseInt(value('EMBEDDING_DIMENSIONS') ?? '768', 10);
  return {
    supabase: {
      configured: Boolean(
        value('NEXT_PUBLIC_SUPABASE_URL') &&
          value('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') &&
          value('SUPABASE_SECRET_KEY'),
      ),
    },
    qdrant: {
      configured: Boolean(value('QDRANT_URL') && value('QDRANT_API_KEY')),
      collection: value('QDRANT_COLLECTION') ?? 'document_chunks',
    },
    embedding: {
      configured: Boolean(value('EMBEDDING_PROVIDER') && value('EMBEDDING_MODEL')),
      provider: value('EMBEDDING_PROVIDER'),
      model: value('EMBEDDING_MODEL'),
      dimensions: Number.isFinite(dimensions) && dimensions > 0 ? dimensions : 768,
    },
  };
}

export function requireServerEnvironment(name: string) {
  const found = value(name);
  if (!found) throw new Error(`${name} 환경변수가 필요합니다.`);
  return found;
}
