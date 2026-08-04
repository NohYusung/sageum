import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import {
  decodeEmbeddedImageDataUrl,
  extractEmbeddedImages,
  normalizeImageInsights,
  normalizePdfInsights,
  visualInsightText,
} from './visual-ocr';
import type { NormalizedDocument } from '@/lib/rag/types';

test('embedded data image URLs are decoded only for supported formats', () => {
  const decoded = decodeEmbeddedImageDataUrl('data:image/png;base64,aGVsbG8=');
  assert.equal(decoded?.mediaType, 'image/png');
  assert.equal(Buffer.from(decoded?.data ?? []).toString('utf8'), 'hello');
  assert.equal(decodeEmbeddedImageDataUrl('https://example.com/image.png'), null);
  assert.equal(decodeEmbeddedImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='), null);
});

test('image insights reject malformed and empty model output', () => {
  assert.deepEqual(normalizeImageInsights({ images: [{ imageId: '', visibleText: 'x' }] }), []);
  assert.deepEqual(normalizeImageInsights({ images: [{
    imageId: 'image-1',
    visibleText: '승인 필요',
    description: '결재 흐름도',
    keyFacts: ['팀장 승인 후 배포'],
  }] }), [{
    imageId: 'image-1',
    visibleText: '승인 필요',
    description: '결재 흐름도',
    keyFacts: ['팀장 승인 후 배포'],
  }]);
});

test('PDF insights retain one-based page locations', () => {
  assert.deepEqual(normalizePdfInsights({ visuals: [{
    page: 3,
    visibleText: '환경 변수',
    description: '설정 표',
    keyFacts: [],
  }] }), [{
    imageId: 'pdf-visual-1',
    page: 3,
    visibleText: '환경 변수',
    description: '설정 표',
    keyFacts: [],
  }]);
  assert.deepEqual(normalizePdfInsights({ visuals: [{ page: 0, description: 'invalid' }] }), []);
});

test('visual text contains OCR, description, and facts for embedding', () => {
  assert.equal(
    visualInsightText({
      imageId: 'image-1',
      visibleText: '배포 승인',
      description: '승인 절차 구조도',
      keyFacts: ['개발팀 검토', '팀장 승인'],
    }, '배포 흐름'),
    '대체 텍스트: 배포 흐름\n이미지에서 읽은 텍스트: 배포 승인\n이미지 설명: 승인 절차 구조도\n핵심 정보: 개발팀 검토; 팀장 승인',
  );
});

test('XLSX embedded images retain sheet and anchor cell locations', async () => {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="재무" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', '<worksheet xmlns:r="r"><drawing r:id="rIdDraw"/></worksheet>');
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships><Relationship Id="rIdDraw" Target="../drawings/drawing1.xml"/></Relationships>');
  zip.file('xl/drawings/drawing1.xml', '<xdr:wsDr xmlns:xdr="xdr" xmlns:a="a" xmlns:r="r"><xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="rIdImage"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor></xdr:wsDr>');
  zip.file('xl/drawings/_rels/drawing1.xml.rels', '<Relationships><Relationship Id="rIdImage" Target="../media/image1.png"/></Relationships>');
  zip.file('xl/media/image1.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64'));
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const document: NormalizedDocument = {
    id: 'document',
    versionId: 'version',
    name: 'book.xlsx',
    title: 'book',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sourceType: 'xlsx',
    sizeBytes: bytes.byteLength,
    blocks: [],
  };

  const images = await extractEmbeddedImages(bytes, document);
  assert.equal(images.length, 1);
  assert.deepEqual(images[0]?.headingPath, ['재무']);
  assert.deepEqual(images[0]?.location, { sheet: '재무', cellRange: 'B3', imageIndex: 1 });
  assert.equal(images[0]?.mediaType, 'image/png');
});
