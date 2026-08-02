import { BadRequestException, Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { openVaultDatabase } from './vault-indexer.service';
import { VaultPathService } from './vault-path.service';

export type VaultMatchedConcept = {
  id: string;
  name: string;
  matchedBy: 'alias' | 'name';
  alias?: string;
};

export type VaultSearchResult = {
  type: 'block' | 'document' | 'concept';
  documentTitle: string;
  path: string;
  heading: string;
  snippet: string;
  score: number;
};

export type VaultSearchResponse = {
  query: string;
  matchedConcepts: VaultMatchedConcept[];
  expandedConcepts: string[];
  results: VaultSearchResult[];
};

type ConceptRow = {
  id: string;
  name: string;
  aliases_json: string;
};

type AliasRow = {
  concept_id: string;
  alias: string;
  normalized_alias: string;
  name: string;
};

type RelationRow = {
  source_concept_id: string;
  target_concept_id: string;
  status: string;
};

type BlockRow = {
  id: string;
  text: string;
  heading_path: string;
  title: string;
  path: string;
};

type DocumentRow = {
  id: string;
  title: string;
  path: string;
  body: string;
};

type ConceptResultRow = {
  id: string;
  name: string;
  path: string | null;
  definition: string | null;
  aliases_json: string;
};

type WeightedTerm = {
  term: string;
  weight: number;
};

function normalize(value: string) {
  return value.normalize('NFC').trim().toLowerCase().replace(/[?!.,]/g, '').replace(/\s+/g, ' ');
}

function uniqById(concepts: VaultMatchedConcept[]) {
  const seen = new Set<string>();
  return concepts.filter((concept) => {
    if (seen.has(concept.id)) return false;
    seen.add(concept.id);
    return true;
  });
}

function snippet(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function relationWeight(status: string, depth: number) {
  const base = status === 'approved' ? 5 : status === 'stale' ? 1 : 2;
  return Math.max(1, base - depth);
}

function weightedTerms(terms: WeightedTerm[]) {
  const normalizedTerms = new Map<string, number>();
  for (const term of terms) {
    const normalized = normalize(term.term);
    if (!normalized) continue;
    normalizedTerms.set(normalized, Math.max(normalizedTerms.get(normalized) ?? 0, term.weight));
  }
  return normalizedTerms;
}

function queryMatchesConceptName(normalizedQuery: string, normalizedName: string) {
  if (!normalizedName) return false;
  if (normalizedQuery.includes(normalizedName) || normalizedName.includes(normalizedQuery)) {
    return true;
  }
  return normalizedQuery
    .split(' ')
    .filter((term) => term.length > 1)
    .some((term) => normalizedName.includes(term));
}

function scoreText(title: string, heading: string, body: string, terms: Map<string, number>) {
  const normalizedTitle = normalize(title);
  const normalizedHeading = normalize(heading);
  const haystack = normalize(`${title} ${heading} ${body}`);
  let score = 0;
  for (const [term, weight] of terms.entries()) {
    if (!haystack.includes(term)) continue;
    if (normalizedTitle.includes(term)) {
      score += 5 * weight;
    } else if (normalizedHeading.includes(term)) {
      score += 3 * weight;
    } else {
      score += weight;
    }
  }
  return score;
}

@Injectable()
export class VaultSearchService {
  constructor(private readonly paths: VaultPathService) {}

  async search(query: string): Promise<VaultSearchResponse> {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) {
      throw new BadRequestException('q is required');
    }
    const indexPath = this.paths.resolveInside(this.paths.config.indexPath);
    if (!existsSync(indexPath)) {
      return { query, matchedConcepts: [], expandedConcepts: [], results: [] };
    }

    const db = openVaultDatabase(this.paths);
    try {
      const concepts = db.prepare('SELECT id, name, aliases_json FROM concepts').all() as ConceptRow[];
      const aliases = db
        .prepare(
          `SELECT aliases.concept_id, aliases.alias, aliases.normalized_alias, concepts.name
           FROM aliases
           INNER JOIN concepts ON concepts.id = aliases.concept_id`,
        )
        .all() as AliasRow[];

      const aliasMatches = aliases
        .filter((alias) => alias.normalized_alias && normalizedQuery.includes(alias.normalized_alias))
        .map((alias) => ({
          id: alias.concept_id,
          name: alias.name,
          matchedBy: 'alias' as const,
          alias: alias.alias,
        }));

      const nameMatches = concepts
        .filter((concept) => {
          const normalizedName = normalize(concept.name);
          return queryMatchesConceptName(normalizedQuery, normalizedName);
        })
        .map((concept) => ({
          id: concept.id,
          name: concept.name,
          matchedBy: 'name' as const,
        }));

      const matchedConcepts = uniqById([...aliasMatches, ...nameMatches]);
      const expandedWeights = this.expandConceptIds(db, matchedConcepts.map((concept) => concept.id));
      const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
      const expandedConcepts = [...expandedWeights.keys()]
        .filter((id) => !matchedConcepts.some((concept) => concept.id === id))
        .map((id) => conceptById.get(id)?.name)
        .filter((name): name is string => Boolean(name));

      const searchTerms = [
        ...normalizedQuery.split(' ').filter((term) => term.length > 1).map((term) => ({ term, weight: 1 })),
        ...matchedConcepts.map((concept) => ({ term: concept.name, weight: 4 })),
        ...matchedConcepts
          .map((concept) => concept.alias)
          .filter((term): term is string => Boolean(term))
          .filter((term) => normalize(term).length > 1)
          .map((term) => ({ term, weight: 4 })),
        ...expandedConcepts.map((term) => ({
          term,
          weight: expandedWeights.get(concepts.find((concept) => concept.name === term)?.id ?? '') ?? 2,
        })),
      ];
      const results = [
        ...this.rankConcepts(db, searchTerms),
        ...this.rankDocuments(db, searchTerms),
        ...this.rankBlocks(db, searchTerms),
      ]
        .sort((left, right) => right.score - left.score)
        .slice(0, 20);
      return {
        query,
        matchedConcepts,
        expandedConcepts,
        results,
      };
    } finally {
      db.close();
    }
  }

  private expandConceptIds(db: any, startIds: string[]) {
    const relations = db
      .prepare('SELECT source_concept_id, target_concept_id, status FROM relations WHERE status != ?')
      .all('rejected') as RelationRow[];
    const seen = new Map<string, number>();
    for (const id of startIds) {
      seen.set(id, 4);
    }
    let frontier = [...startIds];
    for (let depth = 0; depth < 2; depth += 1) {
      const next: string[] = [];
      for (const relation of relations) {
        if (frontier.includes(relation.source_concept_id) && !seen.has(relation.target_concept_id)) {
          seen.set(relation.target_concept_id, relationWeight(relation.status, depth));
          next.push(relation.target_concept_id);
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return seen;
  }

  private rankBlocks(db: any, terms: WeightedTerm[]) {
    const normalizedTerms = weightedTerms(terms);
    if (!normalizedTerms.size) return [];
    const blocks = db
      .prepare(
        `SELECT document_blocks.id, document_blocks.text, document_blocks.heading_path, documents.title, documents.path
         FROM document_blocks
         INNER JOIN documents ON documents.id = document_blocks.document_id`,
      )
      .all() as BlockRow[];

    return blocks
      .map((block) => {
        const baseScore = scoreText(block.title, block.heading_path, block.text, normalizedTerms);
        return {
          type: 'block' as const,
          documentTitle: block.title,
          path: block.path,
          heading: block.heading_path,
          snippet: snippet(block.text),
          score: baseScore > 0 ? baseScore + this.pathBoost(block.path) : 0,
        };
      })
      .filter((result) => result.score > 0)
  }

  private rankDocuments(db: any, terms: WeightedTerm[]) {
    const normalizedTerms = weightedTerms(terms);
    if (!normalizedTerms.size) return [];
    const documents = db
      .prepare(
        `SELECT documents.id, documents.title, documents.path, search_index.body
         FROM documents
         INNER JOIN search_index ON search_index.owner_id = documents.id
         WHERE search_index.owner_type = ?`,
      )
      .all('document') as DocumentRow[];
    return documents
      .map((document) => {
        const baseScore = scoreText(document.title, '', document.body, normalizedTerms);
        return {
          type: 'document' as const,
          documentTitle: document.title,
          path: document.path,
          heading: '',
          snippet: snippet(document.body),
          score: baseScore > 0 ? baseScore + this.pathBoost(document.path) : 0,
        };
      })
      .filter((result) => result.score > 0);
  }

  private rankConcepts(db: any, terms: WeightedTerm[]) {
    const normalizedTerms = weightedTerms(terms);
    if (!normalizedTerms.size) return [];
    const concepts = db
      .prepare('SELECT id, name, path, definition, aliases_json FROM concepts')
      .all() as ConceptResultRow[];
    return concepts
      .map((concept) => {
        const aliases = JSON.parse(concept.aliases_json || '[]') as string[];
        const baseScore = scoreText(concept.name, aliases.join(' '), concept.definition || '', normalizedTerms);
        return {
          type: 'concept' as const,
          documentTitle: concept.name,
          path: concept.path ?? '',
          heading: 'concept',
          snippet: snippet(concept.definition || aliases.join(', ')),
          score: baseScore > 0 ? baseScore + this.pathBoost(concept.path ?? '') : 0,
        };
      })
      .filter((result) => result.score > 0);
  }

  private pathBoost(path: string) {
    if (path.startsWith(`${this.paths.config.noteRoot}/`)) return 30;
    if (path.startsWith(`${this.paths.config.conceptRoot}/`)) return 20;
    if (path.startsWith(`${this.paths.config.sourceRoot}/`)) return 10;
    if (path.startsWith(`${this.paths.config.mapRoot}/`)) return 8;
    return 0;
  }
}
