import { getProviderConfiguration } from '../src/lib/server/env';
import { getQdrantVectorStore } from '../src/lib/server/qdrant-store';

async function main() {
  const providers = getProviderConfiguration();
  if (!providers.embedding.configured || !providers.qdrant.configured) {
    throw new Error(
      'QDRANT_URL과 QDRANT_API_KEY를 설정해 주세요.',
    );
  }

  await getQdrantVectorStore().ensureCollection(providers.embedding.dimensions);
  console.log(
    `Qdrant Cloud Inference Collection '${providers.qdrant.collection}' 준비 완료 (${providers.embedding.model}, ${providers.embedding.dimensions} dimensions).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Qdrant 초기화에 실패했습니다.');
  process.exitCode = 1;
});
