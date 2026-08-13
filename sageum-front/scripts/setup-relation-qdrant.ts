import { getProviderConfiguration } from '../src/lib/server/env';
import { getQdrantRelationVectorStore } from '../src/lib/server/relation-vector-store';

async function main() {
  const configuration = getProviderConfiguration();
  if (!configuration.qdrant.configured || !configuration.embedding.configured) {
    throw new Error('Qdrant Cloud Inference 환경 설정이 필요합니다.');
  }
  await getQdrantRelationVectorStore().ensureCollection(configuration.embedding.dimensions);
  console.log(`관계 Collection 준비 완료: ${configuration.qdrant.relationCollection}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
