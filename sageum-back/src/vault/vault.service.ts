import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import { SaveDocumentDto } from './dto/save-document.dto';
import { VaultPathService } from './vault-path.service';

export type SaveDocumentResult = {
  documentId: string;
  path: string;
  createdConcepts: string[];
  sidecars: string[];
};

type ConceptInput = {
  id?: unknown;
  name?: unknown;
  aliases?: unknown;
  type?: unknown;
  definition?: unknown;
};

function hashId(prefix: string, text: string) {
  return `${prefix}_${createHash('sha1').update(text).digest('hex').slice(0, 12)}`;
}

function contentHash(text: string) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function vaultJoin(...parts: string[]) {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

function sanitizeFilename(title: string) {
  const safe = title
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return safe || 'Untitled';
}

function uniqueMarkdownPath(paths: VaultPathService, folder: string, title: string, overwrite = false) {
  const base = sanitizeFilename(title);
  let index = 1;
  let name = `${base}.md`;
  while (!overwrite && existsSync(paths.resolveInside(vaultJoin(folder, name)))) {
    index += 1;
    name = `${base} ${index}.md`;
  }
  return vaultJoin(folder, name);
}

function extractSageumId(markdown: string) {
  const match = markdown.match(/^---\n[\s\S]*?^sageum_id:\s*("?)([^"\n]+)\1\s*$/m);
  return match?.[2]?.trim() ?? null;
}

function frontmatter(documentId: string) {
  const now = new Date().toISOString();
  return [
    '---',
    `sageum_id: ${documentId}`,
    'type: guide',
    'status: generated',
    'created_by: sageum-agent',
    `created_at: ${now}`,
    `updated_at: ${now}`,
    '---',
    '',
  ].join('\n');
}

function ensureFrontmatter(markdown: string, documentId: string) {
  if (extractSageumId(markdown)) {
    return markdown.endsWith('\n') ? markdown : `${markdown}\n`;
  }
  if (markdown.startsWith('---\n')) {
    const end = markdown.indexOf('\n---', 4);
    if (end > 0) {
      return `${markdown.slice(0, 4)}sageum_id: ${documentId}\n${markdown.slice(4)}`;
    }
  }
  return `${frontmatter(documentId)}${markdown.endsWith('\n') ? markdown : `${markdown}\n`}`;
}

function normalizeConcepts(concepts: Array<Record<string, unknown>> | undefined) {
  return (concepts ?? [])
    .map((concept: ConceptInput) => {
      const name = text(concept.name);
      if (!name) return null;
      return {
        id: text(concept.id) || hashId('concept', name),
        name,
        aliases: stringList(concept.aliases),
        type: text(concept.type),
        definition: text(concept.definition),
      };
    })
    .filter((concept): concept is NonNullable<typeof concept> => concept !== null);
}

function conceptNote(concept: ReturnType<typeof normalizeConcepts>[number]) {
  const aliases = concept.aliases.length ? concept.aliases.map((alias) => `  - ${alias}`).join('\n') : '  []';
  const tags = ['  - sageum/concept'];
  return [
    '---',
    `sageum_id: ${concept.id}`,
    'type: concept',
    'status: active',
    'created_by: sageum-agent',
    'aliases:',
    aliases,
    `concept_type: ${concept.type || 'general'}`,
    'tags:',
    ...tags,
    '---',
    '',
    `# ${concept.name}`,
    '',
    concept.definition || '',
  ].join('\n').trimEnd() + '\n';
}

function normalizeRelations(relations: Array<Record<string, unknown>> | undefined) {
  return (relations ?? [])
    .map((relation) => ({
      relation_id: text(relation.relation_id) || hashId('rel', JSON.stringify(relation)),
      source_concept_id: text(relation.source_concept_id) || text(relation.source),
      relation_type: text(relation.relation_type),
      target_concept_id: text(relation.target_concept_id) || text(relation.target),
      evidence_text: text(relation.evidence_text),
      confidence: typeof relation.confidence === 'number' ? relation.confidence : Number(relation.confidence ?? 0),
      status: text(relation.status) || 'candidate',
      created_by: text(relation.created_by) || 'sageum-agent',
    }))
    .filter((relation) => relation.source_concept_id && relation.relation_type && relation.target_concept_id);
}

function normalizeKey(value: string) {
  return value.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function extractAliases(markdown: string) {
  if (!markdown.startsWith('---\n')) return [];
  const end = markdown.indexOf('\n---', 4);
  if (end < 0) return [];
  const lines = markdown.slice(4, end).split(/\r?\n/);
  const aliases: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith('aliases:')) continue;
    while (lines[index + 1]?.startsWith('  ')) {
      index += 1;
      const item = lines[index].trim();
      if (item.startsWith('- ')) {
        aliases.push(item.slice(2).replace(/^"|"$/g, '').trim());
      }
    }
  }
  return aliases.filter(Boolean);
}

function extractTitle(markdown: string, path: string) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || basename(path, extname(path));
}

@Injectable()
export class VaultService {
  constructor(private readonly paths: VaultPathService) {}

  async saveDocument(dto: SaveDocumentDto): Promise<SaveDocumentResult> {
    this.paths.ensureVaultRoot();
    if (!dto.title?.trim()) {
      throw new BadRequestException('title is required');
    }
    if (!dto.markdown?.trim()) {
      throw new BadRequestException('markdown is required');
    }

    this.ensureVaultFolders();
    const targetFolder = dto.options?.targetFolder || this.paths.config.noteRoot;
    this.paths.ensureDirectory(targetFolder);

    const relativePath = uniqueMarkdownPath(this.paths, targetFolder, dto.title, dto.options?.overwrite);
    const documentId = extractSageumId(dto.markdown) || hashId('doc', `${dto.jobId ?? ''}:${dto.title}:${dto.markdown}`);
    const markdown = ensureFrontmatter(dto.markdown, documentId);
    const absolutePath = this.paths.resolveInside(relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, markdown, 'utf8');

    const createdConcepts = dto.options?.createConceptNotes === false ? [] : this.writeConceptNotes(dto.concepts);
    const sidecars = this.writeSidecars(documentId, relativePath, markdown, dto);
    return {
      documentId,
      path: relativePath,
      createdConcepts,
      sidecars,
    };
  }

  private ensureVaultFolders() {
    this.paths.ensureDirectory(this.paths.config.noteRoot);
    this.paths.ensureDirectory(this.paths.config.conceptRoot);
    this.paths.ensureDirectory(this.paths.config.sourceRoot);
    this.paths.ensureDirectory(this.paths.config.mapRoot);
    this.paths.ensureDirectory('.sageum');
    this.paths.ensureDirectory('.sageum/annotations');
    this.paths.ensureDirectory('.sageum/relations');
    this.paths.ensureDirectory('.sageum/sources');
    this.ensureManifest();
  }

  private ensureManifest() {
    const relativePath = '.sageum/manifest.json';
    const absolutePath = this.paths.resolveInside(relativePath);
    if (existsSync(absolutePath)) return;
    const manifest = {
      version: 1,
      vault_name: this.paths.root.split('/').at(-1) || 'Sageum Vault',
      created_by: 'sageum-agent',
      created_at: new Date().toISOString(),
      index_schema_version: 1,
      note_roots: [this.paths.config.noteRoot],
      concept_roots: [this.paths.config.conceptRoot],
      source_roots: [this.paths.config.sourceRoot],
      map_roots: [this.paths.config.mapRoot],
    };
    writeFileSync(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  private writeConceptNotes(conceptsInput: SaveDocumentDto['concepts']) {
    const created: string[] = [];
    const existingKeys = this.existingConceptKeys();
    for (const concept of normalizeConcepts(conceptsInput)) {
      const candidateKeys = [concept.name, ...concept.aliases].map(normalizeKey);
      if (candidateKeys.some((key) => existingKeys.has(key))) {
        continue;
      }
      const relativePath = uniqueMarkdownPath(this.paths, this.paths.config.conceptRoot, concept.name, true);
      const absolutePath = this.paths.resolveInside(relativePath);
      if (existsSync(absolutePath)) continue;
      writeFileSync(absolutePath, conceptNote(concept), 'utf8');
      for (const key of candidateKeys) {
        existingKeys.add(key);
      }
      created.push(relativePath);
    }
    return created;
  }

  private existingConceptKeys() {
    const keys = new Set<string>();
    const root = this.paths.resolveInside(this.paths.config.conceptRoot);
    if (!existsSync(root)) return keys;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const relativePath = vaultJoin(this.paths.config.conceptRoot, entry.name);
      const markdown = readFileSync(this.paths.resolveInside(relativePath), 'utf8');
      keys.add(normalizeKey(extractTitle(markdown, relativePath)));
      for (const alias of extractAliases(markdown)) {
        keys.add(normalizeKey(alias));
      }
    }
    return keys;
  }

  private writeSidecars(documentId: string, relativePath: string, markdown: string, dto: SaveDocumentDto) {
    const sidecars: string[] = [];
    const annotationPath = `.sageum/annotations/${documentId}.json`;
    const annotation = {
      document_id: documentId,
      file: relativePath,
      content_hash: contentHash(markdown),
      mentions: dto.mentions ?? [],
    };
    writeFileSync(this.paths.resolveInside(annotationPath), `${JSON.stringify(annotation, null, 2)}\n`, 'utf8');
    sidecars.push(annotationPath);

    const relationPath = `.sageum/relations/${documentId}.json`;
    const relation = {
      document_id: documentId,
      relations: normalizeRelations(dto.relations),
    };
    writeFileSync(this.paths.resolveInside(relationPath), `${JSON.stringify(relation, null, 2)}\n`, 'utf8');
    sidecars.push(relationPath);

    if (dto.sources?.length) {
      const sourcePath = `.sageum/sources/${documentId}.json`;
      writeFileSync(this.paths.resolveInside(sourcePath), `${JSON.stringify({ document_id: documentId, sources: dto.sources }, null, 2)}\n`, 'utf8');
      sidecars.push(sourcePath);
    }
    return sidecars;
  }
}
