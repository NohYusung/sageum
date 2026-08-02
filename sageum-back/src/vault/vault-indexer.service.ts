import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import { VaultPathService } from './vault-path.service';

const BetterSqlite3 = require('better-sqlite3') as new (path: string) => any;

export type VaultIndexStatus = {
  documentCount: number;
  conceptCount: number;
  relationCount: number;
  blockCount: number;
  indexedAt: string | null;
  indexPath: string;
};

type ParsedMarkdown = {
  frontmatter: Record<string, unknown>;
  body: string;
};

function hashId(prefix: string, text: string) {
  return `${prefix}_${createHash('sha1').update(text).digest('hex').slice(0, 12)}`;
}

function textHash(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

function normalize(value: string) {
  return value.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function listStrings(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function parseFrontmatter(markdown: string): ParsedMarkdown {
  if (!markdown.startsWith('---\n')) {
    return { frontmatter: {}, body: markdown };
  }
  const end = markdown.indexOf('\n---', 4);
  if (end < 0) {
    return { frontmatter: {}, body: markdown };
  }

  const raw = markdown.slice(4, end).split(/\r?\n/);
  const frontmatter: Record<string, unknown> = {};
  for (let index = 0; index < raw.length; index += 1) {
    const line = raw[index];
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (value) {
      frontmatter[key] = value.replace(/^"|"$/g, '');
      continue;
    }
    const items: string[] = [];
    while (raw[index + 1]?.startsWith('  ')) {
      index += 1;
      const item = raw[index].trim();
      if (item === '[]') continue;
      if (item.startsWith('- ')) {
        items.push(item.slice(2).replace(/^"|"$/g, ''));
      }
    }
    frontmatter[key] = items;
  }
  return { frontmatter, body: markdown.slice(end + 5).replace(/^\r?\n/, '') };
}

function titleFromBody(body: string, path: string) {
  const h1 = body.match(/^#\s+(.+)$/m);
  return h1?.[1]?.trim() || basename(path, extname(path));
}

function extractDefinition(body: string) {
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .find((block) => block && !block.startsWith('#')) || '';
}

function blockTypeFor(text: string) {
  if (text.startsWith('```')) return 'code';
  if (text.startsWith('|')) return 'table';
  if (/^[-*+]\s+/.test(text) || /^\d+\.\s+/.test(text)) return 'list';
  return 'paragraph';
}

function extractBlocks(documentId: string, body: string) {
  const blocks: Array<{ id: string; headingPath: string; blockIndex: number; blockType: string; text: string }> = [];
  const headingPath: string[] = [];
  let pending: string[] = [];
  let blockIndex = 0;
  let inCode = false;

  const flush = () => {
    const text = pending.join('\n').trim();
    pending = [];
    if (!text) return;
    blockIndex += 1;
    blocks.push({
      id: hashId('blk', `${documentId}:${blockIndex}:${text}`),
      headingPath: headingPath.join(' > '),
      blockIndex,
      blockType: blockTypeFor(text),
      text,
    });
  };

  for (const line of body.split(/\r?\n/)) {
    if (line.trim().startsWith('```')) {
      pending.push(line);
      if (inCode) {
        inCode = false;
        flush();
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      pending.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      headingPath.splice(level - 1);
      headingPath[level - 1] = heading[2].trim();
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    pending.push(line);
  }
  flush();
  return blocks;
}

function extractWikilinks(text: string) {
  const links: Array<{ targetTitle: string; linkText: string; startOffset: number; ordinal: number }> = [];
  const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match: RegExpExecArray | null;
  let ordinal = 0;
  while ((match = pattern.exec(text))) {
    links.push({
      targetTitle: match[1].trim(),
      linkText: match[2]?.trim() || match[1].trim(),
      startOffset: match.index,
      ordinal,
    });
    ordinal += 1;
  }
  return links;
}

function markdownFiles(paths: VaultPathService, rootRelative = '') {
  const files: string[] = [];
  const root = rootRelative ? paths.resolveInside(rootRelative) : paths.root;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.obsidian' || entry.name === '.trash' || entry.name === '.sageum' || entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }
    const relativePath = rootRelative ? `${rootRelative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...markdownFiles(paths, relativePath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relativePath);
    }
  }
  return files;
}

function relationSidecars(paths: VaultPathService) {
  const root = paths.resolveInside('.sageum/relations');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => `.sageum/relations/${entry.name}`);
}

function annotationSidecars(paths: VaultPathService) {
  const root = paths.resolveInside('.sageum/annotations');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => `.sageum/annotations/${entry.name}`);
}

export function openVaultDatabase(paths: VaultPathService) {
  paths.ensureVaultRoot();
  const indexPath = paths.resolveInside(paths.config.indexPath);
  mkdirSync(dirname(indexPath), { recursive: true });
  return new BetterSqlite3(indexPath);
}

@Injectable()
export class VaultIndexerService {
  constructor(private readonly paths: VaultPathService) {}

  async rebuild(): Promise<VaultIndexStatus> {
    const db = openVaultDatabase(this.paths);
    try {
      this.recreateSchema(db);
      const indexedAt = new Date().toISOString();
      const documentIdsByTitle = new Map<string, string>();
      const documentIds = new Set<string>();

      for (const path of markdownFiles(this.paths)) {
        const markdown = readFileSync(this.paths.resolveInside(path), 'utf8');
        const parsed = parseFrontmatter(markdown);
        const title = titleFromBody(parsed.body, path);
        const id = String(parsed.frontmatter.sageum_id || hashId('doc', path));
        const type = String(parsed.frontmatter.type || (path.startsWith(`${this.paths.config.conceptRoot}/`) ? 'concept' : 'note'));
        const status = String(parsed.frontmatter.status || 'active');
        const document = {
          id,
          path,
          normalized_path: normalize(path),
          title,
          type,
          status,
          content_hash: textHash(markdown),
          frontmatter_json: JSON.stringify(parsed.frontmatter),
          created_at: String(parsed.frontmatter.created_at || ''),
          updated_at: String(parsed.frontmatter.updated_at || ''),
          indexed_at: indexedAt,
        };
        db.prepare(
          `INSERT OR REPLACE INTO documents
          (id, path, normalized_path, title, type, status, content_hash, frontmatter_json, created_at, updated_at, indexed_at)
          VALUES (@id, @path, @normalized_path, @title, @type, @status, @content_hash, @frontmatter_json, @created_at, @updated_at, @indexed_at)`,
        ).run(document);
        documentIdsByTitle.set(normalize(title), id);
        documentIds.add(id);

        const blocks = extractBlocks(id, parsed.body);
        for (const block of blocks) {
          db.prepare(
            `INSERT INTO document_blocks (id, document_id, heading_path, block_index, block_type, text, text_hash)
             VALUES (@id, @documentId, @headingPath, @blockIndex, @blockType, @text, @textHash)`,
          ).run({ ...block, documentId: id, textHash: textHash(block.text) });
          db.prepare('INSERT INTO search_index (owner_type, owner_id, title, body, aliases) VALUES (?, ?, ?, ?, ?)').run(
            'block',
            block.id,
            title,
            block.text,
            '',
          );
          for (const link of block.blockType === 'code' ? [] : extractWikilinks(block.text)) {
            db.prepare(
              `INSERT INTO wikilinks (id, source_document_id, source_block_id, target_title, target_document_id, link_text, context_text)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ).run(
              hashId('wlk', `${block.id}:${link.targetTitle}:${link.linkText}:${link.startOffset}:${link.ordinal}`),
              id,
              block.id,
              link.targetTitle,
              null,
              link.linkText,
              block.text,
            );
          }
        }

        db.prepare('INSERT INTO search_index (owner_type, owner_id, title, body, aliases) VALUES (?, ?, ?, ?, ?)').run(
          'document',
          id,
          title,
          parsed.body,
          '',
        );

        if (type === 'concept' || path.startsWith(`${this.paths.config.conceptRoot}/`)) {
          const aliases = listStrings(parsed.frontmatter.aliases);
          const concept = {
            id,
            path,
            name: title,
            type: String(parsed.frontmatter.concept_type || parsed.frontmatter.type || ''),
            status,
            aliases_json: JSON.stringify(aliases),
            definition: extractDefinition(parsed.body),
            created_at: String(parsed.frontmatter.created_at || ''),
            updated_at: String(parsed.frontmatter.updated_at || ''),
            indexed_at: indexedAt,
          };
          db.prepare(
            `INSERT OR REPLACE INTO concepts
            (id, path, name, type, status, aliases_json, definition, created_at, updated_at, indexed_at)
            VALUES (@id, @path, @name, @type, @status, @aliases_json, @definition, @created_at, @updated_at, @indexed_at)`,
          ).run(concept);
          for (const alias of aliases) {
            db.prepare('INSERT OR IGNORE INTO aliases (id, concept_id, alias, normalized_alias, source) VALUES (?, ?, ?, ?, ?)').run(
              hashId('als', `${id}:${alias}`),
              id,
              alias,
              normalize(alias),
              'frontmatter',
            );
          }
          db.prepare('INSERT INTO search_index (owner_type, owner_id, title, body, aliases) VALUES (?, ?, ?, ?, ?)').run(
            'concept',
            id,
            title,
            concept.definition,
            aliases.join(' '),
          );
        }
      }

      for (const sidecarPath of relationSidecars(this.paths)) {
        const payload = JSON.parse(readFileSync(this.paths.resolveInside(sidecarPath), 'utf8')) as {
          document_id?: string;
          relations?: Array<Record<string, unknown>>;
        };
        const documentId = String(payload.document_id || '');
        if (!documentId || !documentIds.has(documentId)) {
          continue;
        }
        for (const relation of payload.relations ?? []) {
          const relationId = String(relation.relation_id || hashId('rel', JSON.stringify(relation)));
          db.prepare(
            `INSERT OR REPLACE INTO relations
            (id, source_concept_id, relation_type, target_concept_id, evidence_document_id, evidence_block_id, evidence_text, confidence, status, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            relationId,
            String(relation.source_concept_id || relation.source || ''),
            String(relation.relation_type || ''),
            String(relation.target_concept_id || relation.target || ''),
            documentId,
            null,
            String(relation.evidence_text || ''),
            Number(relation.confidence ?? 0),
            String(relation.status || 'candidate'),
            String(relation.created_by || 'sageum-agent'),
            new Date().toISOString(),
          );
        }
      }

      for (const sidecarPath of annotationSidecars(this.paths)) {
        const payload = JSON.parse(readFileSync(this.paths.resolveInside(sidecarPath), 'utf8')) as {
          document_id?: string;
          mentions?: Array<Record<string, unknown>>;
        };
        const documentId = String(payload.document_id || '');
        if (!documentId || !documentIds.has(documentId)) {
          continue;
        }
        for (const mention of payload.mentions ?? []) {
          const locator = typeof mention.locator === 'object' && mention.locator !== null ? (mention.locator as Record<string, unknown>) : {};
          db.prepare(
            `INSERT OR REPLACE INTO mentions
            (id, document_id, block_id, concept_id, text, start_offset, end_offset, confidence, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            String(mention.mention_id || hashId('men', `${payload.document_id}:${JSON.stringify(mention)}`)),
            documentId,
            null,
            String(mention.concept_id || ''),
            String(mention.text || ''),
            Number(locator.start ?? mention.start_offset ?? 0),
            Number(locator.end ?? mention.end_offset ?? 0),
            Number(mention.confidence ?? 0),
            String(mention.created_by || 'sageum-agent'),
          );
        }
      }

      const links = db.prepare('SELECT id, target_title FROM wikilinks').all() as Array<{ id: string; target_title: string }>;
      for (const link of links) {
        const targetId = documentIdsByTitle.get(normalize(link.target_title));
        if (targetId) {
          db.prepare('UPDATE wikilinks SET target_document_id = ? WHERE id = ?').run(targetId, link.id);
        }
      }
      return this.statusFromDb(db);
    } finally {
      db.close();
    }
  }

  async status(): Promise<VaultIndexStatus> {
    const indexPath = this.paths.resolveInside(this.paths.config.indexPath);
    if (!existsSync(indexPath)) {
      return {
        documentCount: 0,
        conceptCount: 0,
        relationCount: 0,
        blockCount: 0,
        indexedAt: null,
        indexPath: this.paths.config.indexPath,
      };
    }
    const db = openVaultDatabase(this.paths);
    try {
      return this.statusFromDb(db);
    } finally {
      db.close();
    }
  }

  private recreateSchema(db: any) {
    db.exec(`
      PRAGMA foreign_keys = OFF;

      DROP TABLE IF EXISTS aliases;
      DROP TABLE IF EXISTS relations;
      DROP TABLE IF EXISTS mentions;
      DROP TABLE IF EXISTS wikilinks;
      DROP TABLE IF EXISTS document_blocks;
      DROP TABLE IF EXISTS concepts;
      DROP TABLE IF EXISTS documents;
      DROP TABLE IF EXISTS search_index;

      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        normalized_path TEXT NOT NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        frontmatter_json TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        indexed_at TEXT NOT NULL
      );

      CREATE TABLE concepts (
        id TEXT PRIMARY KEY,
        path TEXT,
        name TEXT NOT NULL,
        type TEXT,
        status TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        definition TEXT,
        created_at TEXT,
        updated_at TEXT,
        indexed_at TEXT NOT NULL
      );

      CREATE TABLE document_blocks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        heading_path TEXT NOT NULL,
        block_index INTEGER NOT NULL,
        block_type TEXT NOT NULL,
        text TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(id)
      );

      CREATE TABLE wikilinks (
        id TEXT PRIMARY KEY,
        source_document_id TEXT NOT NULL,
        source_block_id TEXT,
        target_title TEXT NOT NULL,
        target_document_id TEXT,
        link_text TEXT NOT NULL,
        context_text TEXT,
        FOREIGN KEY (source_document_id) REFERENCES documents(id)
      );

      CREATE TABLE mentions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        block_id TEXT,
        concept_id TEXT,
        text TEXT NOT NULL,
        start_offset INTEGER,
        end_offset INTEGER,
        confidence REAL,
        created_by TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(id)
      );

      CREATE TABLE relations (
        id TEXT PRIMARY KEY,
        source_concept_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        target_concept_id TEXT NOT NULL,
        evidence_document_id TEXT,
        evidence_block_id TEXT,
        evidence_text TEXT,
        confidence REAL,
        status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE aliases (
        id TEXT PRIMARY KEY,
        concept_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        source TEXT NOT NULL,
        UNIQUE (concept_id, normalized_alias),
        FOREIGN KEY (concept_id) REFERENCES concepts(id)
      );

      CREATE VIRTUAL TABLE search_index USING fts5(
        owner_type,
        owner_id,
        title,
        body,
        aliases,
        tokenize = 'unicode61'
      );

      PRAGMA foreign_keys = ON;
    `);
  }

  private statusFromDb(db: any): VaultIndexStatus {
    const documentCount = Number(db.prepare('SELECT COUNT(*) AS count FROM documents').get().count);
    const conceptCount = Number(db.prepare('SELECT COUNT(*) AS count FROM concepts').get().count);
    const relationCount = Number(db.prepare('SELECT COUNT(*) AS count FROM relations').get().count);
    const blockCount = Number(db.prepare('SELECT COUNT(*) AS count FROM document_blocks').get().count);
    const latest = db.prepare('SELECT MAX(indexed_at) AS indexedAt FROM documents').get();
    return {
      documentCount,
      conceptCount,
      relationCount,
      blockCount,
      indexedAt: latest?.indexedAt ?? null,
      indexPath: this.paths.config.indexPath,
    };
  }
}
