import { randomUUID } from 'node:crypto';
import type { DocumentChunk } from '../src/lib/rag/types';
import { getProviderConfiguration } from '../src/lib/server/env';
import { getQdrantVectorStore } from '../src/lib/server/qdrant-store';

async function main() {
  const providers = getProviderConfiguration();
  if (!providers.qdrant.configured) {
    throw new Error('QDRANT_URL과 QDRANT_API_KEY를 설정해 주세요.');
  }
  if (!providers.embedding.configured) {
    throw new Error('Qdrant Cloud Inference 설정이 필요합니다.');
  }

  const ownerId = randomUUID();
  const documentId = randomUUID();
  const versionId = randomUUID();
  const chunk: DocumentChunk = {
    id: `qdrant-smoke-${randomUUID()}`,
    documentId,
    versionId,
    ordinal: 0,
    text: 'Qdrant Cloud 연결을 확인하기 위한 임시 검색 청크입니다.',
    wordCount: 8,
    headingPath: ['Qdrant smoke test'],
    blockStart: 0,
    blockEnd: 0,
    location: {},
  };
  const store = getQdrantVectorStore();

  await store.ensureCollection(providers.embedding.dimensions);
  try {
    await store.upsert([{
      chunk,
      ownerId,
      sourceType: 'text',
      documentTitle: 'Qdrant smoke test',
      embeddingModel: providers.embedding.model,
    }]);
    const results = await store.query('Qdrant Cloud 연결 확인', ownerId, {
      documentIds: [documentId],
      embeddingModel: providers.embedding.model,
      limit: 1,
      scoreThreshold: 0.2,
    });
    if (results.length !== 1 || results[0].chunkId !== chunk.id) {
      throw new Error('Qdrant 소유자·모델·문서 필터 검색 결과가 예상과 다릅니다.');
    }
  } finally {
    await store.deleteByVersion(ownerId, versionId);
  }

  const deletedResults = await store.query('Qdrant Cloud 연결 확인', ownerId, {
    documentIds: [documentId],
    embeddingModel: providers.embedding.model,
    limit: 1,
    scoreThreshold: 0.2,
  });
  if (deletedResults.length) {
    throw new Error('Qdrant 스모크 테스트 point 정리에 실패했습니다.');
  }

  console.log(
    `Qdrant Cloud Inference 스모크 테스트 통과: '${providers.qdrant.collection}' 임베딩·하이브리드 검색·소유자 필터·삭제 정상.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Qdrant 스모크 테스트에 실패했습니다.');
  process.exitCode = 1;
});
