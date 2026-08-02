import { randomUUID } from 'node:crypto';
import {
  BROWSER_EMBEDDING_DIMENSIONS,
  BROWSER_EMBEDDING_MODEL,
} from '../src/lib/embedding/config';
import type { DocumentChunk } from '../src/lib/rag/types';
import { getProviderConfiguration } from '../src/lib/server/env';
import { getQdrantVectorStore } from '../src/lib/server/qdrant-store';

async function main() {
  const providers = getProviderConfiguration();
  if (!providers.qdrant.configured) {
    throw new Error('QDRANT_URL과 QDRANT_API_KEY를 설정해 주세요.');
  }
  if (
    providers.embedding.model !== BROWSER_EMBEDDING_MODEL
    || providers.embedding.dimensions !== BROWSER_EMBEDDING_DIMENSIONS
  ) {
    throw new Error('EmbeddingGemma Q8 브라우저 임베딩 설정이 필요합니다.');
  }

  const ownerId = randomUUID();
  const documentId = randomUUID();
  const versionId = randomUUID();
  const vector = Array.from({ length: BROWSER_EMBEDDING_DIMENSIONS }, (_, index) =>
    index === 0 ? 1 : 0,
  );
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

  await store.ensureCollection(BROWSER_EMBEDDING_DIMENSIONS);
  try {
    await store.upsert([{
      chunk,
      ownerId,
      sourceType: 'text',
      documentTitle: 'Qdrant smoke test',
      embeddingModel: BROWSER_EMBEDDING_MODEL,
      vector,
    }]);
    const results = await store.query(vector, ownerId, {
      documentIds: [documentId],
      embeddingModel: BROWSER_EMBEDDING_MODEL,
      limit: 1,
      scoreThreshold: 0.99,
    });
    if (results.length !== 1 || results[0].chunkId !== chunk.id) {
      throw new Error('Qdrant 소유자·모델·문서 필터 검색 결과가 예상과 다릅니다.');
    }
  } finally {
    await store.deleteByVersion(ownerId, versionId);
  }

  const deletedResults = await store.query(vector, ownerId, {
    documentIds: [documentId],
    embeddingModel: BROWSER_EMBEDDING_MODEL,
    limit: 1,
    scoreThreshold: 0.99,
  });
  if (deletedResults.length) {
    throw new Error('Qdrant 스모크 테스트 point 정리에 실패했습니다.');
  }

  console.log(
    `Qdrant Cloud 스모크 테스트 통과: '${providers.qdrant.collection}' 색인·필터 검색·삭제 정상.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Qdrant 스모크 테스트에 실패했습니다.');
  process.exitCode = 1;
});
