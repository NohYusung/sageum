import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseVectorIndexRequest } from './vector-index-request';

const CONFIGURATION = { model: 'embeddinggemma', dtype: 'q8', dimensions: 3 };
const VERSION_ID = '123e4567-e89b-42d3-a456-426614174001';

test('모델 계약과 유효한 청크 벡터를 검증한다', () => {
  assert.deepEqual(parseVectorIndexRequest({
    versionId: VERSION_ID,
    model: 'embeddinggemma',
    dtype: 'q8',
    dimensions: 3,
    vectors: [{ chunkId: 'chunk-1', vector: [0.1, 0.2, 0.3] }],
  }, CONFIGURATION).vectors, [{ chunkId: 'chunk-1', vector: [0.1, 0.2, 0.3] }]);
});

test('모델 불일치, 영벡터, 중복 청크를 거부한다', () => {
  assert.throws(() => parseVectorIndexRequest({
    versionId: VERSION_ID,
    model: 'other',
    dtype: 'q8',
    dimensions: 3,
    vectors: [{ chunkId: 'chunk-1', vector: [0.1, 0.2, 0.3] }],
  }, CONFIGURATION), /모델/u);
  assert.throws(() => parseVectorIndexRequest({
    versionId: VERSION_ID,
    model: 'embeddinggemma',
    dtype: 'q8',
    dimensions: 3,
    vectors: [{ chunkId: 'chunk-1', vector: [0, 0, 0] }],
  }, CONFIGURATION), /벡터/u);
  assert.throws(() => parseVectorIndexRequest({
    versionId: VERSION_ID,
    model: 'embeddinggemma',
    dtype: 'q8',
    dimensions: 3,
    vectors: [
      { chunkId: 'chunk-1', vector: [0.1, 0.2, 0.3] },
      { chunkId: 'chunk-1', vector: [0.2, 0.3, 0.4] },
    ],
  }, CONFIGURATION), /중복/u);
});
