import { getEmbeddingProvider } from '../src/lib/server/embedding-provider';
import { getProviderConfiguration } from '../src/lib/server/env';
import { getQdrantVectorStore } from '../src/lib/server/qdrant-store';

async function main() {
  const providers = getProviderConfiguration();
  if (!providers.embedding.configured || !providers.qdrant.configured) {
    throw new Error(
      'QDRANT_URL, QDRANT_API_KEY, EMBEDDING_PROVIDER, EMBEDDING_API_KEY, EMBEDDING_MODEL을 설정해 주세요.',
    );
  }

  const embeddingProvider = getEmbeddingProvider();
  await getQdrantVectorStore().ensureCollection(embeddingProvider.dimensions);
  console.log(
    `Qdrant Collection '${providers.qdrant.collection}' 준비 완료 (${embeddingProvider.dimensions} dimensions).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Qdrant 초기화에 실패했습니다.');
  process.exitCode = 1;
});
