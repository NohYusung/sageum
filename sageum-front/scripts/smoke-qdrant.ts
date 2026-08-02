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
  const targetChunk: DocumentChunk = {
    id: `qdrant-smoke-${randomUUID()}`,
    documentId,
    versionId,
    ordinal: 0,
    text: '직원은 일주일에 이틀까지 자택에서 근무할 수 있습니다.',
    wordCount: 7,
    headingPath: ['근무 제도'],
    blockStart: 0,
    blockEnd: 0,
    location: {},
  };
  const distractorChunks: DocumentChunk[] = [
    {
      ...targetChunk,
      id: `qdrant-smoke-${randomUUID()}`,
      ordinal: 1,
      text: '출장비는 영수증을 제출한 뒤 정산합니다.',
      wordCount: 5,
      headingPath: ['출장비'],
    },
    {
      ...targetChunk,
      id: `qdrant-smoke-${randomUUID()}`,
      ordinal: 2,
      text: '신입 직원의 수습 기간은 입사일부터 석 달입니다.',
      wordCount: 7,
      headingPath: ['수습 기간'],
    },
  ];
  const store = getQdrantVectorStore();

  await store.ensureCollection(providers.embedding.dimensions);
  try {
    await store.upsert([targetChunk, ...distractorChunks].map((chunk) => ({
      chunk,
      ownerId,
      sourceType: 'text',
      documentTitle: '한국어 사내 규정',
      embeddingModel: providers.embedding.model,
    })));
    const results = await store.query('재택근무는 주 몇 회 가능한가요?', ownerId, {
      documentIds: [documentId],
      embeddingModel: providers.embedding.model,
      limit: 3,
      scoreThreshold: 0.2,
    });
    if (!results.length || results[0].chunkId !== targetChunk.id) {
      throw new Error('한국어 유사어 질문이 예상 청크를 1위로 검색하지 못했습니다.');
    }
  } finally {
    await store.deleteByVersion(ownerId, versionId);
  }

  const deletedResults = await store.query('재택근무는 주 몇 회 가능한가요?', ownerId, {
    documentIds: [documentId],
    embeddingModel: providers.embedding.model,
    limit: 1,
    scoreThreshold: 0.2,
  });
  if (deletedResults.length) {
    throw new Error('Qdrant 스모크 테스트 point 정리에 실패했습니다.');
  }

  console.log(
    `Qdrant Cloud Inference 스모크 테스트 통과: '${providers.qdrant.collection}' 한국어 유사어 임베딩·하이브리드 검색·소유자 필터·삭제 정상.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Qdrant 스모크 테스트에 실패했습니다.');
  process.exitCode = 1;
});
