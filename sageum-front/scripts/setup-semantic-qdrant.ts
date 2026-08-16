import { getProviderConfiguration } from '../src/lib/server/env';
import { getQdrantSemanticNodeVectorStore } from '../src/lib/server/semantic-node-vector-store';

async function main() {
  const configuration = getProviderConfiguration();
  if (!configuration.qdrant.configured || !configuration.embedding.configured) {
    throw new Error('Qdrant Cloud Inference 환경 설정이 필요합니다.');
  }
  await getQdrantSemanticNodeVectorStore().ensureCollection(configuration.embedding.dimensions);
  console.log(`공통 의미 노드 Collection 준비 완료: ${configuration.qdrant.semanticNodeCollection}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
