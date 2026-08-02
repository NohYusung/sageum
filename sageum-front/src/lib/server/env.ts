export const DEFAULT_QDRANT_INFERENCE_MODEL = 'sentence-transformers/all-minilm-l6-v2';
export const DEFAULT_QDRANT_INFERENCE_DIMENSIONS = 384;
export const DEFAULT_QDRANT_COLLECTION = 'document_chunks_qdrant_hybrid_v1';

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
    provider: 'qdrant-cloud-inference';
    model: string;
    dimensions: number;
    execution: 'qdrant';
    dtype: null;
  };
};

function value(name: string) {
  return process.env[name]?.trim() || null;
}

export function getProviderConfiguration(): ProviderConfiguration {
  const qdrantConfigured = Boolean(value('QDRANT_URL') && value('QDRANT_API_KEY'));
  const requestedDimensions = Number.parseInt(
    value('QDRANT_INFERENCE_DIMENSIONS') ?? String(DEFAULT_QDRANT_INFERENCE_DIMENSIONS),
    10,
  );
  const dimensions = Number.isFinite(requestedDimensions) && requestedDimensions > 0
    ? requestedDimensions
    : DEFAULT_QDRANT_INFERENCE_DIMENSIONS;
  const model = value('QDRANT_INFERENCE_MODEL') ?? DEFAULT_QDRANT_INFERENCE_MODEL;

  return {
    supabase: {
      configured: Boolean(
        value('NEXT_PUBLIC_SUPABASE_URL')
          && value('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
      ),
    },
    qdrant: {
      configured: qdrantConfigured,
      collection: value('QDRANT_COLLECTION') ?? DEFAULT_QDRANT_COLLECTION,
    },
    embedding: {
      configured: qdrantConfigured && Boolean(model),
      provider: 'qdrant-cloud-inference',
      model,
      dimensions,
      execution: 'qdrant',
      dtype: null,
    },
  };
}

export function requireServerEnvironment(name: string) {
  const found = value(name);
  if (!found) throw new Error(`${name} 환경변수가 필요합니다.`);
  return found;
}
