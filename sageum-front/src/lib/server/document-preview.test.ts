import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildDocumentPreviewPage,
  renderDocumentPreview,
  sanitizeSandboxDocument,
} from './document-preview';

const FIXTURES = new URL('../../../test/fixtures/', import.meta.url);

async function fixture(name: string) {
  const buffer = await readFile(new URL(name, FIXTURES));
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

test('HTML 미리보기에서 실행 코드와 외부 리소스를 제거한다', () => {
  const html = sanitizeSandboxDocument(`
    <html><body>
      <script>alert('run')</script>
      <img src="https://example.com/tracker.png" onerror="alert('run')">
      <a href="javascript:alert('run')">unsafe</a>
      <p>안전한 본문</p>
    </body></html>
  `);

  assert.doesNotMatch(html, /<script|onerror|https:\/\/example\.com|javascript:/iu);
  assert.match(html, /안전한 본문/u);
  assert.match(html, /Content-Security-Policy/u);
});

test('DOCX를 제목·목록·표가 포함된 브라우저 문서로 렌더링한다', async () => {
  const bytes = await fixture('sample-operations.docx');
  const html = await renderDocumentPreview(bytes, {
    name: 'sample-operations.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: bytes.byteLength,
  });

  assert.match(html, /Operations Guide/u);
  assert.match(html, /<table/iu);
  assert.match(html, /<ul/iu);
  assert.match(html, /id="block-0"/u);
  assert.match(html, /\[id\^="block-"\]:target/u);
  assert.doesNotMatch(html, /<script/iu);
});

test('XLSX를 시트별 표가 포함된 브라우저 문서로 렌더링한다', async () => {
  const bytes = await fixture('sample-workbook.xlsx');
  const html = await renderDocumentPreview(bytes, {
    name: 'sample-workbook.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: bytes.byteLength,
  });

  assert.match(html, /Summary/u);
  assert.match(html, /Detail/u);
  assert.match(html, /<table/iu);
  assert.match(html, /id="block-0"/u);
  assert.match(html, /id="block-1"/u);
});

test('Markdown과 HTML 미리보기에 구조 블록 위치를 표시한다', async () => {
  const markdownSource = '# 운영 정책\n\n첫 번째 본문\n\n두 번째 본문';
  const markdown = await renderDocumentPreview(new TextEncoder().encode(markdownSource), {
    name: 'policy.md',
    mimeType: 'text/markdown',
    sizeBytes: Buffer.byteLength(markdownSource),
  });
  const htmlSource = '<main><div>운영 정책</div><section><p>첫 번째 본문</p></section></main>';
  const html = await renderDocumentPreview(new TextEncoder().encode(htmlSource), {
    name: 'policy.html',
    mimeType: 'text/html',
    sizeBytes: Buffer.byteLength(htmlSource),
  });

  assert.match(markdown, /id="block-0"/u);
  assert.match(markdown, /id="block-2"/u);
  assert.match(html, /id="block-0"/u);
  assert.match(html, /id="block-1"/u);
});

test('미리보기 화면과 원본 다운로드 경로를 분리한다', () => {
  const documentId = '123e4567-e89b-42d3-a456-426614174000';
  const page = buildDocumentPreviewPage({
    documentId,
    title: '사내 규정',
    filename: '사내 규정.docx',
    preview: {
      kind: 'sandbox',
      sourceHtml: '<!doctype html><html><body><p>본문</p></body></html>',
    },
  });

  assert.match(page.html, /SAGEUM ORIGINAL PREVIEW/u);
  assert.match(
    page.html,
    new RegExp(`/api/documents/${documentId}/original\\?disposition=attachment`, 'u'),
  );
  assert.match(page.html, /sandbox srcdoc=/u);
  assert.match(page.contentSecurityPolicy, /frame-src 'self'/u);
});

test('PDF 미리보기는 Supabase 원본 도메인만 frame 대상으로 허용한다', () => {
  const page = buildDocumentPreviewPage({
    documentId: '123e4567-e89b-42d3-a456-426614174000',
    title: '정책',
    filename: '정책.pdf',
    preview: {
      kind: 'pdf',
      signedUrl: 'https://project.supabase.co/storage/v1/object/sign/documents/file.pdf?token=test',
    },
  });

  assert.match(page.html, /PDF 원본/u);
  assert.match(page.contentSecurityPolicy, /https:\/\/project\.supabase\.co/u);
});
