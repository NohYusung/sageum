export const DEFAULT_QDRANT_INFERENCE_MODEL = 'intfloat/multilingual-e5-small';
export const DEFAULT_QDRANT_INFERENCE_DIMENSIONS = 384;
export const DEFAULT_QDRANT_COLLECTION = 'document_chunks_qdrant_hybrid_v2';
export const DEFAULT_QDRANT_RELATION_COLLECTION = 'knowledge_relations_qdrant_v1';
export const DEFAULT_QDRANT_SEMANTIC_NODE_COLLECTION = 'knowledge_semantic_nodes_qdrant_v1';
export const DEFAULT_CLAUDE_AWS_MODEL = 'claude-haiku-4-5';

export type ProviderConfiguration = {
  supabase: {
    configured: boolean;
  };
  qdrant: {
    configured: boolean;
    collection: string;
    relationCollection: string;
    semanticNodeCollection: string;
  };
  embedding: {
    configured: boolean;
    provider: 'qdrant-cloud-inference';
    model: string;
    dimensions: number;
    execution: 'qdrant';
    dtype: null;
  };
  generation: {
    configured: boolean;
    provider: 'claude-platform-aws';
    model: string;
    region: string | null;
    auth: 'api-key' | 'sigv4' | null;
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
  const claudeAwsRegion = value('AWS_REGION') ?? value('AWS_DEFAULT_REGION');
  const claudeAwsWorkspaceId = value('ANTHROPIC_AWS_WORKSPACE_ID');
  const hasClaudeAwsApiKey = Boolean(value('ANTHROPIC_AWS_API_KEY'));
  const hasClaudeAwsSigV4Credentials = Boolean(
    (value('AWS_ACCESS_KEY_ID') && value('AWS_SECRET_ACCESS_KEY'))
      || value('AWS_PROFILE')
      || (value('AWS_WEB_IDENTITY_TOKEN_FILE') && value('AWS_ROLE_ARN')),
  );
  const claudeAwsAuth = hasClaudeAwsApiKey
    ? 'api-key'
    : hasClaudeAwsSigV4Credentials
      ? 'sigv4'
      : null;

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
      relationCollection: value('QDRANT_RELATION_COLLECTION') ?? DEFAULT_QDRANT_RELATION_COLLECTION,
      semanticNodeCollection: value('QDRANT_SEMANTIC_NODE_COLLECTION')
        ?? DEFAULT_QDRANT_SEMANTIC_NODE_COLLECTION,
    },
    embedding: {
      configured: qdrantConfigured && Boolean(model),
      provider: 'qdrant-cloud-inference',
      model,
      dimensions,
      execution: 'qdrant',
      dtype: null,
    },
    generation: {
      configured: Boolean(claudeAwsRegion && claudeAwsWorkspaceId && claudeAwsAuth),
      provider: 'claude-platform-aws',
      model: value('CLAUDE_AWS_MODEL') ?? DEFAULT_CLAUDE_AWS_MODEL,
      region: claudeAwsRegion,
      auth: claudeAwsAuth,
    },
  };
}

export function requireServerEnvironment(name: string) {
  const found = value(name);
  if (!found) throw new Error(`${name} 환경변수가 필요합니다.`);
  return found;
}
