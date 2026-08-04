import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chunkDocument } from '@/lib/rag/chunker';
import {
  parseDocumentSource,
  parseDocumentSourceWithHash,
  parserVersion,
} from './document-parser';

const FIXTURES = new URL('../../../test/fixtures/', import.meta.url);

async function fixture(name: string) {
  const buffer = await readFile(new URL(name, FIXTURES));
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

test('PDF를 페이지별 블록과 페이지 경계 청크로 변환한다', async () => {
  const bytes = await fixture('sample-policy.pdf');
  const document = await parseDocumentSource(bytes, {
    name: 'sample-policy.pdf',
    mimeType: 'application/pdf',
    sizeBytes: bytes.byteLength,
    documentId: 'pdf-document',
    versionId: 'pdf-version',
  });
  const chunks = chunkDocument(document, {
    targetWords: 20,
    maxWords: 30,
    overlapWords: 4,
  });

  assert.equal(document.sourceType, 'pdf');
  assert.deepEqual(document.blocks.map((block) => block.location.page), [1, 2]);
  assert.match(document.blocks[0].text, /Remote work requests/u);
  assert.match(document.blocks[1].text, /Security Controls/u);
  assert.deepEqual(new Set(chunks.map((chunk) => chunk.location.page)), new Set([1, 2]));
  assert.ok(chunks.every((chunk) => chunk.location.page !== undefined));
  assert.equal(parserVersion(document.sourceType), 'pdf-v1');
});

test('PDF 파싱 후 호출자 원본 버퍼를 OCR 입력으로 다시 사용할 수 있다', async () => {
  const fixtureBytes = await fixture('sample-policy.pdf');
  const fileBuffer = fixtureBytes.slice().buffer;
  const parserInput = new Uint8Array(fileBuffer);
  const sizeBytes = parserInput.byteLength;
  const { document, contentHash } = await parseDocumentSourceWithHash(parserInput, {
    name: 'sample-policy.pdf',
    mimeType: 'application/pdf',
    sizeBytes,
  });
  const ocrInput = new Uint8Array(fileBuffer);

  assert.equal(document.sourceType, 'pdf');
  assert.equal(contentHash, '3d9e98fd9cd9d074217be8f26b5733c6944f0be18a8645f6a9b836ae88d824d8');
  assert.equal(parserInput.byteLength, sizeBytes);
  assert.equal(ocrInput.byteLength, sizeBytes);
  assert.deepEqual(ocrInput, fixtureBytes);
});

test('DOCX 제목·문단·목록·표와 제목 계층을 보존한다', async () => {
  const bytes = await fixture('sample-operations.docx');
  const document = await parseDocumentSource(bytes, {
    name: 'sample-operations.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: bytes.byteLength,
    documentId: 'docx-document',
    versionId: 'docx-version',
  });

  assert.equal(document.title, 'Operations Guide');
  assert.ok(document.blocks.some((block) => block.kind === 'paragraph'));
  assert.ok(document.blocks.some((block) => block.kind === 'list'));
  assert.ok(document.blocks.some((block) => block.kind === 'table'));
  assert.deepEqual(
    document.blocks.find((block) => block.kind === 'list')?.headingPath,
    ['Operations Guide', 'Security'],
  );
  assert.deepEqual(
    document.blocks.find((block) => block.kind === 'table')?.headingPath,
    ['Operations Guide', 'Control Matrix'],
  );
  assert.match(
    document.blocks.find((block) => block.kind === 'table')?.text ?? '',
    /Access review.*Security Team/u,
  );
  const chunks = chunkDocument(document, {
    targetWords: 20,
    maxWords: 30,
    overlapWords: 4,
  });
  assert.ok(chunks.every((chunk) => {
    const coveredBlocks = document.blocks.slice(chunk.blockStart, chunk.blockEnd + 1);
    return coveredBlocks.every((block) =>
      JSON.stringify(block.headingPath) === JSON.stringify(chunk.headingPath));
  }));
  assert.ok(chunks.every((chunk) => chunk.focusBlock === chunk.blockStart));
  assert.equal(parserVersion(document.sourceType), 'docx-v1');
});

test('XLSX를 시트와 연속 표 범위별 블록·청크로 변환한다', async () => {
  const bytes = await fixture('sample-workbook.xlsx');
  const document = await parseDocumentSource(bytes, {
    name: 'sample-workbook.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: bytes.byteLength,
    documentId: 'xlsx-document',
    versionId: 'xlsx-version',
  });
  const chunks = chunkDocument(document, {
    targetWords: 30,
    maxWords: 40,
    overlapWords: 5,
  });

  assert.deepEqual(
    document.blocks.map((block) => [block.location.sheet, block.location.cellRange]),
    [
      ['Summary', 'A1:C3'],
      ['Summary', 'A5:B7'],
      ['Detail', 'A1:D4'],
    ],
  );
  assert.ok(document.blocks.every((block) => block.kind === 'table'));
  assert.ok(chunks.every((chunk) => chunk.location.sheet && chunk.location.cellRange));
  assert.deepEqual(new Set(chunks.map((chunk) => chunk.location.sheet)), new Set(['Summary', 'Detail']));
  assert.equal(parserVersion(document.sourceType), 'xlsx-v1');
});

test('손상된 바이너리 문서는 형식별 공개 오류로 거부한다', async () => {
  const bytes = new TextEncoder().encode('not a real pdf');
  await assert.rejects(
    () => parseDocumentSource(bytes, {
      name: 'broken.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.byteLength,
    }),
    /PDF 문서 구조/u,
  );
});
