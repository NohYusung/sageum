import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const require = createRequire(join(root, 'sageum-back/package.json'));
const Database = require('better-sqlite3');

const latestNotePath = '10_Notes/파이썬 세트 컴프리헨션.md';
const latestNoteAbsolutePath = join(root, latestNotePath);

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

function parseFrontmatter(markdown) {
  assert.ok(markdown.startsWith('---\n'), 'markdown should start with frontmatter');
  const end = markdown.indexOf('\n---', 4);
  assert.ok(end > 0, 'frontmatter should be closed');

  const frontmatter = {};
  const lines = markdown.slice(4, end).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (value) {
      frontmatter[key] = value.replace(/^"|"$/g, '');
      continue;
    }

    const items = [];
    while (lines[index + 1]?.startsWith('  ')) {
      index += 1;
      const item = lines[index].trim();
      if (item.startsWith('- ')) {
        items.push(item.slice(2).replace(/^"|"$/g, ''));
      }
    }
    frontmatter[key] = items;
  }

  return {
    frontmatter,
    body: markdown.slice(end + 5).replace(/^\r?\n/, ''),
  };
}

function markdownFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relative(root, absolutePath);
    if (
      entry.isDirectory() &&
      !['.git', '.obsidian', '.sageum', 'node_modules', 'sageum-back/node_modules', 'sageum-front/node_modules'].includes(relativePath)
    ) {
      files.push(...markdownFiles(absolutePath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relativePath);
    }
  }
  return files;
}

test('generated Obsidian vault artifacts are internally consistent and indexed', () => {
  assert.ok(existsSync(join(root, '.sageum/manifest.json')), 'manifest should exist');
  assert.ok(existsSync(join(root, '.sageum/index.sqlite')), 'SQLite index should exist');
  assert.ok(existsSync(latestNoteAbsolutePath), `${latestNotePath} should exist`);

  const manifest = readJson('.sageum/manifest.json');
  assert.equal(manifest.created_by, 'sageum-agent');
  assert.deepEqual(manifest.note_roots, ['10_Notes']);
  assert.deepEqual(manifest.concept_roots, ['20_Concepts']);

  const markdown = readFileSync(latestNoteAbsolutePath, 'utf8');
  const parsed = parseFrontmatter(markdown);
  const documentId = parsed.frontmatter.sageum_id;
  assert.match(documentId, /^doc_[a-f0-9]{12}$/);
  assert.equal(parsed.frontmatter.created_by, 'sageum-agent');
  assert.equal(parsed.frontmatter.source_topic, '파이썬 세트 컴프리헨션');
  assert.ok(parsed.frontmatter.concepts.length >= 8);
  assert.ok(parsed.frontmatter.tags.includes('python/comprehension'));
  assert.equal((parsed.body.match(/^#\s+/gm) ?? []).length, 1, 'note should have exactly one H1');
  assert.match(parsed.body, /^# 파이썬 세트 컴프리헨션/m);
  assert.match(parsed.body, /```mermaid\n/);
  assert.match(parsed.body, /\[\[세트 컴프리헨션\|파이썬 세트 컴프리헨션\]\]/);
  assert.match(parsed.body, /\[\[리스트 컴프리헨션\]\]/);

  for (const conceptPath of [
    '20_Concepts/세트 컴프리헨션.md',
    '20_Concepts/set.md',
    '20_Concepts/딕셔너리 컴프리헨션.md',
    '20_Concepts/리스트 컴프리헨션.md',
  ]) {
    assert.ok(existsSync(join(root, conceptPath)), `${conceptPath} should exist`);
  }

  const annotationPath = `.sageum/annotations/${documentId}.json`;
  const relationPath = `.sageum/relations/${documentId}.json`;
  const sourcePath = `.sageum/sources/${documentId}.json`;
  assert.ok(existsSync(join(root, annotationPath)), 'annotation sidecar should exist');
  assert.ok(existsSync(join(root, relationPath)), 'relation sidecar should exist');
  assert.ok(existsSync(join(root, sourcePath)), 'source sidecar should exist');

  const annotation = readJson(annotationPath);
  assert.equal(annotation.document_id, documentId);
  assert.equal(annotation.file, latestNotePath);
  assert.ok(annotation.mentions.length >= 8);
  assert.ok(annotation.mentions.some((mention) => mention.concept_id === 'python-set-comprehension'));

  const relationSidecar = readJson(relationPath);
  assert.equal(relationSidecar.document_id, documentId);
  assert.ok(relationSidecar.relations.length >= 8);
  for (const relation of relationSidecar.relations) {
    assert.match(relation.relation_id, /^rel_[a-f0-9]{12}$/);
    assert.ok(relation.source_concept_id || relation.source);
    assert.ok(relation.target_concept_id || relation.target);
    assert.ok(['candidate', 'approved', 'rejected', 'stale'].includes(relation.status));
  }

  const sourceSidecar = readJson(sourcePath);
  assert.equal(sourceSidecar.document_id, documentId);
  assert.ok(sourceSidecar.sources.length >= 1);

  const malformed = markdownFiles(root)
    .map((file) => [file, readFileSync(join(root, file), 'utf8')])
    .filter(([, content]) => /\[\[\[/.test(content) || /\[\[[^\]\n]*\[\[/.test(content));
  assert.deepEqual(malformed, [], 'markdown should not contain malformed nested wikilinks');

  const db = new Database(join(root, '.sageum/index.sqlite'), { readonly: true });
  try {
    const document = db.prepare('SELECT * FROM documents WHERE path = ?').get(latestNotePath);
    assert.ok(document, 'latest note should be indexed as a document');
    assert.equal(document.id, documentId);
    assert.equal(document.title, '파이썬 세트 컴프리헨션');
    assert.equal(document.type, 'guide');

    const indexedConceptCount = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM concepts
         WHERE name IN ('세트 컴프리헨션', 'set', '딕셔너리 컴프리헨션', '리스트 컴프리헨션')`,
      )
      .get();
    assert.equal(Number(indexedConceptCount.count), 4);

    const wikilinks = db.prepare('SELECT target_title, target_document_id FROM wikilinks WHERE source_document_id = ?').all(documentId);
    assert.ok(wikilinks.length >= 8);
    assert.ok(wikilinks.some((link) => link.target_title === '세트 컴프리헨션' && link.target_document_id));
    assert.ok(wikilinks.some((link) => link.target_title === '리스트 컴프리헨션' && link.target_document_id));

    const mentions = db.prepare('SELECT COUNT(*) AS count FROM mentions WHERE document_id = ?').get(documentId);
    assert.ok(Number(mentions.count) >= annotation.mentions.length);

    const relations = db.prepare('SELECT COUNT(*) AS count FROM relations WHERE evidence_document_id = ?').get(documentId);
    assert.equal(Number(relations.count), relationSidecar.relations.length);

    const databaseFile = statSync(join(root, '.sageum/index.sqlite'));
    assert.ok(databaseFile.size > 0);
  } finally {
    db.close();
  }
});
