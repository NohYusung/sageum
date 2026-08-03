import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeHtmlSource, normalizeMarkdownSource, parseTextDocumentSource } from './parser';

test('Markdown 제목 경로와 문단을 구조화한다', () => {
  const source = '# 제품 소개\n\n첫 번째 문단입니다.\n\n## 보안\n\n권한 필터를 적용합니다.';
  const document = normalizeMarkdownSource(source);

  assert.equal(document.title, '제품 소개');
  assert.deepEqual(document.blocks.map((block) => block.kind), [
    'heading',
    'paragraph',
    'heading',
    'paragraph',
  ]);
  assert.deepEqual(document.blocks.at(-1)?.headingPath, ['제품 소개', '보안']);
});

test('HTML에서 실행 코드와 스타일을 제거한다', () => {
  const source = '<article><h1>보고서</h1><p>검색 가능한 본문입니다.</p><script>window.secret = "노출 금지"</script><style>.hidden { display: none }</style></article>';
  const document = normalizeHtmlSource(source);

  const text = document.blocks.map((block) => block.text).join(' ');
  assert.match(text, /보고서/u);
  assert.match(text, /검색 가능한 본문/u);
  assert.doesNotMatch(text, /window\.secret|display:\s*none/u);
});

test('HTML 제목 계층을 구조화하고 이후 본문에 보존한다', () => {
  const document = normalizeHtmlSource(`
    <main>
      <h1>개발 매뉴얼</h1>
      <p>개발 소개</p>
      <h2>환경 변수 명세</h2>
      <table><tr><th>변수명</th><th>설명</th></tr><tr><td>DB_HOST</td><td>DB 주소</td></tr></table>
    </main>
  `);

  assert.deepEqual(document.blocks.map((block) => block.kind), [
    'heading',
    'paragraph',
    'heading',
    'table',
  ]);
  assert.deepEqual(document.blocks.at(-1)?.headingPath, ['개발 매뉴얼', '환경 변수 명세']);
});

test('서버가 지정한 문서·버전 식별자와 실제 파일 크기를 유지한다', () => {
  const document = parseTextDocumentSource('# 운영 정책\n\n본문입니다.', {
    name: 'policy.md',
    mimeType: 'text/markdown',
    sizeBytes: 42,
    documentId: 'document-id',
    versionId: 'version-id',
  });

  assert.equal(document.id, 'document-id');
  assert.equal(document.versionId, 'version-id');
  assert.equal(document.sizeBytes, 42);
  assert.equal(document.title, '운영 정책');
});
