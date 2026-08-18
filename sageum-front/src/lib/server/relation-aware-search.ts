import type { SupabaseClient } from '@supabase/supabase-js';
import { descendantFolderIds } from '@/lib/folders/tree';
import type {
  AppliedRuleReference,
  RelationAwareSearchResult,
} from '@/lib/relations/types';
import type { SearchProgressEvent } from '@/lib/documents/contracts';
import type { SourceReference } from '@/lib/rag/local-search';
import type { Database } from '@/lib/supabase/database.types';
import { getProviderConfiguration } from './env';
import { getQdrantRelationVectorStore, type RelationVectorSearchResult } from './relation-vector-store';
import { getQdrantVectorStore, type VectorSearchResult } from './qdrant-store';
import { searchUnifiedSemanticRepository } from './semantic-aware-repository-search';

type RepositoryClient = SupabaseClient<Database>;

export type RelationAwareSearchInput = {
  ownerId: string;
  supabase: RepositoryClient;
  query: string;
  folderId?: string;
  documentIds?: string[];
  topK?: number;
  onProgress?: (event: SearchProgressEvent) => void;
};

export type StoredRule = {
  id: string;
  rule_document_id: string;
  rule_version_id: string;
  source_chunk_id: string;
  statement: string;
  evidence_quote: string;
  enabled: boolean;
};

export type StoredBinding = {
  rule_id: string;
  document_id: string;
  version_id: string;
  chunk_id: string;
  chunk_text: string;
  vector_score: number;
};

export type StoredRuleLink = {
  id: string;
  left_rule_id: string;
  right_rule_id: string;
  vector_score: number;
};

export type RuleSearchPath = {
  id: string;
  score: number;
  rootRule: StoredRule;
  linkedRule?: StoredRule;
  linkScore?: number;
  documentIds: string[];
};

type DynamicPathResult = {
  path: RuleSearchPath;
  results: VectorSearchResult[];
};

const MAX_SEED_EVIDENCE = 4;
const MAX_EXPANDED_EVIDENCE = 4;
const MAX_ROOT_RULES = 2;
const MAX_RULE_PATHS = 2;
const MAX_PATH_EVIDENCE = 4;

function contentScoreThreshold() {
  const value = Number.parseFloat(process.env.QDRANT_SCORE_THRESHOLD?.trim() ?? '0.2');
  return Number.isFinite(value) && value >= 0 ? value : 0.2;
}

function relationScoreThreshold() {
  const value = Number.parseFloat(
    process.env.QDRANT_RELATION_SCORE_THRESHOLD?.trim() ?? '0.35',
  );
  return Number.isFinite(value) && value >= 0 ? value : 0.35;
}

function sourceReference(
  result: VectorSearchResult,
  retrievalRole: SourceReference['retrievalRole'],
  ruleId?: string,
  pathId?: string,
): SourceReference {
  return {
    documentId: result.documentId,
    versionId: result.versionId,
    documentTitle: result.documentTitle || '문서',
    chunkId: result.chunkId,
    heading: result.headingPath.join(' › ') || '본문',
    snippet: result.text,
    score: result.score,
    page: result.page,
    sheet: result.sheet,
    cellRange: result.cellRange,
    imageIndex: result.imageIndex,
    sourceSpans: result.sourceSpans,
    retrievalRole,
    ruleId,
    pathId,
  };
}

export async function resolveKnowledgeDocumentScope(
  input: Pick<RelationAwareSearchInput, 'ownerId' | 'supabase' | 'folderId' | 'documentIds'>,
) {
  const { ownerId, supabase } = input;
  let requestedDocumentIds = input.documentIds ?? [];
  let folderDocumentIds: string[] | null = null;
  if (input.folderId) {
    const [foldersResult, documentsResult] = await Promise.all([
      supabase.from('folders').select('id,parent_id,name,sort_order,created_at,updated_at').eq('owner_id', ownerId),
      supabase
        .from('documents')
        .select('id,folder_id')
        .eq('owner_id', ownerId)
        .eq('document_kind', 'knowledge')
        .eq('deletion_status', 'active'),
    ]);
    if (foldersResult.error || documentsResult.error) {
      throw new Error('폴더 검색 범위를 확인하지 못했습니다.');
    }
    const folders = foldersResult.data.map((folder) => ({
      id: folder.id,
      parentId: folder.parent_id,
      name: folder.name,
      sortOrder: folder.sort_order,
      createdAt: folder.created_at,
      updatedAt: folder.updated_at,
    }));
    if (!folders.some((folder) => folder.id === input.folderId)) {
      throw new Error('검색할 폴더를 찾을 수 없습니다.');
    }
    const folderIds = descendantFolderIds(folders, input.folderId);
    folderDocumentIds = documentsResult.data
      .filter((document) => document.folder_id && folderIds.has(document.folder_id))
      .map((document) => document.id);
    requestedDocumentIds = requestedDocumentIds.length
      ? requestedDocumentIds.filter((id) => folderDocumentIds?.includes(id))
      : folderDocumentIds;
  }

  if (!input.folderId && requestedDocumentIds.length) {
    const { data, error } = await supabase
      .from('documents')
      .select('id')
      .eq('owner_id', ownerId)
      .eq('document_kind', 'knowledge')
      .eq('deletion_status', 'active')
      .in('id', requestedDocumentIds);
    if (error) throw new Error('문서 검색 범위를 확인하지 못했습니다.');
    requestedDocumentIds = data.map((document) => document.id);
  }
  return requestedDocumentIds;
}

async function activeLatestDocumentIds(
  supabase: RepositoryClient,
  ownerId: string,
  documentIds: string[],
) {
  if (!documentIds.length) return new Map<string, string>();
  const { data, error } = await supabase
    .from('documents')
    .select('id,latest_version_id')
    .eq('owner_id', ownerId)
    .eq('document_kind', 'knowledge')
    .eq('deletion_status', 'active')
    .in('id', [...new Set(documentIds)]);
  if (error) throw new Error('활성 문서 상태를 확인하지 못했습니다.');
  return new Map(data.flatMap((row) => (
    row.latest_version_id ? [[row.id, row.latest_version_id] as const] : []
  )));
}

async function loadActiveRules(
  supabase: RepositoryClient,
  ownerId: string,
  ruleIds: string[],
) {
  if (!ruleIds.length) return [];
  const { data: rules, error: rulesError } = await supabase
    .from('knowledge_rules')
    .select('id,rule_document_id,rule_version_id,source_chunk_id,statement,evidence_quote,enabled')
    .eq('owner_id', ownerId)
    .eq('enabled', true)
    .in('id', [...new Set(ruleIds)]);
  if (rulesError) throw new Error('활성 규칙을 조회하지 못했습니다.');
  const typedRules = rules as unknown as StoredRule[];
  const documentIds = [...new Set(typedRules.map((rule) => rule.rule_document_id))];
  const { data: ruleDocuments, error: documentsError } = await supabase
    .from('rule_documents')
    .select('document_id')
    .eq('owner_id', ownerId)
    .eq('enabled', true)
    .eq('extraction_status', 'ready')
    .in('document_id', documentIds);
  if (documentsError) throw new Error('규칙 문서 활성 상태를 확인하지 못했습니다.');
  const activeDocumentIds = new Set(ruleDocuments.map((document) => document.document_id));
  return typedRules.filter((rule) => activeDocumentIds.has(rule.rule_document_id));
}

async function loadRuleLinks(
  supabase: RepositoryClient,
  ownerId: string,
  ruleIds: string[],
) {
  if (!ruleIds.length) return [];
  const uniqueIds = [...new Set(ruleIds)];
  const [left, right] = await Promise.all([
    supabase
      .from('knowledge_rule_links')
      .select('id,left_rule_id,right_rule_id,vector_score')
      .eq('owner_id', ownerId)
      .in('left_rule_id', uniqueIds),
    supabase
      .from('knowledge_rule_links')
      .select('id,left_rule_id,right_rule_id,vector_score')
      .eq('owner_id', ownerId)
      .in('right_rule_id', uniqueIds),
  ]);
  if (left.error || right.error) throw new Error('저장된 규칙 연결을 조회하지 못했습니다.');
  const byId = new Map<string, StoredRuleLink>();
  [...left.data, ...right.data].forEach((link) => byId.set(link.id, link));
  return [...byId.values()];
}

async function loadRuleBindings(
  supabase: RepositoryClient,
  ownerId: string,
  ruleIds: string[],
  scopeDocumentIds: Set<string> | null,
) {
  if (!ruleIds.length) return [];
  const { data, error } = await supabase
    .from('knowledge_rule_bindings')
    .select('rule_id,document_id,version_id,chunk_id,chunk_text,vector_score')
    .eq('owner_id', ownerId)
    .in('rule_id', [...new Set(ruleIds)]);
  if (error) throw new Error('규칙의 문서 앵커를 조회하지 못했습니다.');
  const scoped = (data as unknown as StoredBinding[]).filter((binding) => (
    !scopeDocumentIds || scopeDocumentIds.has(binding.document_id)
  ));
  const activeVersions = await activeLatestDocumentIds(
    supabase,
    ownerId,
    scoped.map((binding) => binding.document_id),
  );
  return scoped.filter((binding) => activeVersions.get(binding.document_id) === binding.version_id);
}

export function buildRuleSearchPaths(
  roots: Array<{ rule: StoredRule; score: number }>,
  linkedRules: StoredRule[],
  links: StoredRuleLink[],
  bindings: StoredBinding[],
) {
  const ruleById = new Map([...roots.map(({ rule }) => rule), ...linkedRules].map((rule) => [rule.id, rule]));
  const documentsByRule = new Map<string, Set<string>>();
  bindings.forEach((binding) => {
    const documents = documentsByRule.get(binding.rule_id) ?? new Set<string>();
    documents.add(binding.document_id);
    documentsByRule.set(binding.rule_id, documents);
  });
  const paths: RuleSearchPath[] = [];
  for (const root of roots) {
    const rootDocuments = documentsByRule.get(root.rule.id) ?? new Set<string>();
    if (rootDocuments.size) {
      paths.push({
        id: `${root.rule.id}:direct`,
        score: root.score,
        rootRule: root.rule,
        documentIds: [...rootDocuments],
      });
    }
    for (const link of links) {
      const linkedRuleId = link.left_rule_id === root.rule.id
        ? link.right_rule_id
        : link.right_rule_id === root.rule.id
          ? link.left_rule_id
          : null;
      if (!linkedRuleId || linkedRuleId === root.rule.id) continue;
      const linkedRule = ruleById.get(linkedRuleId);
      if (!linkedRule) continue;
      const linkedDocuments = documentsByRule.get(linkedRuleId) ?? new Set<string>();
      const documentIds = [...new Set([...rootDocuments, ...linkedDocuments])];
      if (!documentIds.length) continue;
      paths.push({
        id: `${root.rule.id}:${linkedRuleId}`,
        score: (root.score + link.vector_score) / 2,
        rootRule: root.rule,
        linkedRule,
        linkScore: link.vector_score,
        documentIds,
      });
    }
  }
  return paths
    .sort((left, right) => right.score - left.score)
    .filter((path, index, all) => all.findIndex((candidate) => candidate.id === path.id) === index)
    .slice(0, MAX_RULE_PATHS);
}

async function ruleSources(
  supabase: RepositoryClient,
  ownerId: string,
  applied: AppliedRuleReference[],
) {
  if (!applied.length) return [];
  const chunkIds = [...new Set(applied.map((rule) => rule.sourceChunkId))];
  const documentIds = [...new Set(applied.map((rule) => rule.ruleDocumentId))];
  const [{ data: chunks, error: chunksError }, { data: documents, error: documentsError }] = await Promise.all([
    supabase
      .from('document_chunks')
      .select('id,document_id,version_id,text,heading_path,page,sheet,cell_range')
      .eq('owner_id', ownerId)
      .in('id', chunkIds),
    supabase
      .from('documents')
      .select('id,title')
      .eq('owner_id', ownerId)
      .eq('document_kind', 'rule')
      .eq('deletion_status', 'active')
      .in('id', documentIds),
  ]);
  if (chunksError || documentsError) throw new Error('규칙 원문 근거를 조회하지 못했습니다.');
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const appliedByChunk = new Map(applied.map((rule) => [rule.sourceChunkId, rule]));
  return chunks.flatMap((chunk): SourceReference[] => {
    const rule = appliedByChunk.get(chunk.id);
    const document = documentById.get(chunk.document_id);
    if (!rule || !document) return [];
    return [{
      documentId: document.id,
      versionId: chunk.version_id,
      documentTitle: document.title,
      chunkId: chunk.id,
      heading: chunk.heading_path.join(' › ') || '비즈니스 규칙',
      snippet: chunk.text,
      score: rule.score,
      page: chunk.page ?? undefined,
      sheet: chunk.sheet ?? undefined,
      cellRange: chunk.cell_range ?? undefined,
      sourceSpans: [],
      retrievalRole: 'rule',
      ruleId: rule.ruleId,
      pathId: rule.pathId,
    }];
  });
}

function standaloneAppliedRules(
  roots: Array<{ rule: StoredRule; score: number }>,
) {
  return roots.map(({ rule, score }): AppliedRuleReference => ({
    ruleId: rule.id,
    ruleDocumentId: rule.rule_document_id,
    ruleDocumentTitle: '비즈니스 규칙',
    sourceChunkId: rule.source_chunk_id,
    statement: rule.statement,
    score,
    bindingDocumentIds: [],
    pathId: `rule:${rule.id}:standalone`,
    depth: 0,
  }));
}

function appliedRulesFromPaths(paths: RuleSearchPath[]) {
  return paths.flatMap((path): AppliedRuleReference[] => {
    const root: AppliedRuleReference = {
      ruleId: path.rootRule.id,
      ruleDocumentId: path.rootRule.rule_document_id,
      ruleDocumentTitle: '비즈니스 규칙',
      sourceChunkId: path.rootRule.source_chunk_id,
      statement: path.rootRule.statement,
      score: path.score,
      bindingDocumentIds: path.documentIds,
      pathId: path.id,
      depth: 0,
    };
    if (!path.linkedRule) return [root];
    return [root, {
      ruleId: path.linkedRule.id,
      ruleDocumentId: path.linkedRule.rule_document_id,
      ruleDocumentTitle: '비즈니스 규칙',
      sourceChunkId: path.linkedRule.source_chunk_id,
      statement: path.linkedRule.statement,
      score: path.linkScore ?? path.score,
      bindingDocumentIds: path.documentIds,
      pathId: path.id,
      depth: 1,
      parentRuleId: path.rootRule.id,
    }];
  });
}

export function appliedRulesForRulePaths(
  roots: Array<{ rule: StoredRule; score: number }>,
  paths: RuleSearchPath[],
  includeStandalone = true,
) {
  const pathRuleIds = new Set(paths.flatMap((path) => [
    path.rootRule.id,
    ...(path.linkedRule ? [path.linkedRule.id] : []),
  ]));
  return [
    ...appliedRulesFromPaths(paths),
    ...(includeStandalone
      ? standaloneAppliedRules(roots).filter((rule) => !pathRuleIds.has(rule.ruleId))
      : []),
  ];
}

async function loadRuleEvidence(
  supabase: RepositoryClient,
  ownerId: string,
  appliedRules: AppliedRuleReference[],
) {
  const sources = await ruleSources(supabase, ownerId, appliedRules);
  const titleByDocument = new Map(sources.map((source) => [
    source.documentId,
    source.documentTitle,
  ]));
  appliedRules.forEach((rule) => {
    rule.ruleDocumentTitle = titleByDocument.get(rule.ruleDocumentId) ?? '비즈니스 규칙';
  });
  return sources;
}

export function mergeExpandedResults(
  pathResults: DynamicPathResult[],
  seedChunkIds: Set<string>,
) {
  const best = new Map<string, {
    result: VectorSearchResult;
    ruleId: string;
    pathId: string;
  }>();
  for (const { path, results } of pathResults) {
    const ruleId = path.linkedRule?.id ?? path.rootRule.id;
    for (const result of results) {
      if (seedChunkIds.has(result.chunkId)) continue;
      const current = best.get(result.chunkId);
      if (!current || result.score > current.result.score) {
        best.set(result.chunkId, { result, ruleId, pathId: path.id });
      }
    }
  }
  return [...best.values()]
    .sort((left, right) => right.result.score - left.result.score)
    .slice(0, MAX_EXPANDED_EVIDENCE)
    .map(({ result, ruleId, pathId }) => sourceReference(result, 'expanded', ruleId, pathId));
}

export function filterSeedResultsForPaths(
  seedResults: VectorSearchResult[],
  pathResults: DynamicPathResult[],
) {
  const pathDocumentIds = new Set(pathResults.flatMap(({ path }) => path.documentIds));
  return seedResults.filter((result) => (
    result.score > 0.5 || pathDocumentIds.has(result.documentId)
  ));
}

function relationHitsByActiveRule(
  hits: RelationVectorSearchResult[],
  rules: StoredRule[],
) {
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  return hits.flatMap((hit) => {
    const rule = ruleById.get(hit.id);
    return rule ? [{ rule, score: hit.score }] : [];
  }).slice(0, MAX_ROOT_RULES);
}

async function searchLegacyRelationAwareRepository(
  input: RelationAwareSearchInput,
): Promise<RelationAwareSearchResult> {
  const configuration = getProviderConfiguration();
  const vectorStore = getQdrantVectorStore();
  await vectorStore.ensureCollection(configuration.embedding.dimensions);
  const scopedDocumentIds = await resolveKnowledgeDocumentScope(input);
  const hasExplicitScope = Boolean(input.folderId || input.documentIds?.length);
  if (hasExplicitScope && !scopedDocumentIds.length) {
    return { evidence: [], appliedRules: [], relationMode: 'content-only' };
  }
  const topK = Math.min(Math.max(input.topK ?? MAX_SEED_EVIDENCE, 1), 20);
  const relationStore = getQdrantRelationVectorStore();
  const [baseSearch, relationSearch] = await Promise.allSettled([
    vectorStore.query(input.query, input.ownerId, {
      limit: Math.min(topK * 2, 40),
      documentIds: scopedDocumentIds,
      scoreThreshold: contentScoreThreshold(),
      embeddingModel: configuration.embedding.model,
    }),
    (async () => {
      await relationStore.ensureCollection(configuration.embedding.dimensions);
      return relationStore.query(
        input.query,
        input.ownerId,
        configuration.embedding.model,
        8,
      );
    })(),
  ]);
  if (baseSearch.status === 'rejected') throw baseSearch.reason;
  const activeLatest = await activeLatestDocumentIds(
    input.supabase,
    input.ownerId,
    baseSearch.value.map((result) => result.documentId),
  );
  const seedResults = baseSearch.value.filter((result) => (
    activeLatest.get(result.documentId) === result.versionId
  )).slice(0, Math.min(topK, MAX_SEED_EVIDENCE));
  const seedSources = seedResults.map((result) => sourceReference(result, 'seed'));
  if (relationSearch.status === 'rejected') {
    console.error('Relation-aware root search fell back to content-only search', relationSearch.reason);
    return { evidence: seedSources, appliedRules: [], relationMode: 'fallback' };
  }

  try {
    const relationHits = relationSearch.value.filter((hit) => hit.score >= relationScoreThreshold());
    if (!relationHits.length) {
      return { evidence: seedSources, appliedRules: [], relationMode: 'content-only' };
    }
    const activeRootRules = await loadActiveRules(
      input.supabase,
      input.ownerId,
      relationHits.map((hit) => hit.id),
    );
    const roots = relationHitsByActiveRule(relationHits, activeRootRules);
    if (!roots.length) {
      return { evidence: seedSources, appliedRules: [], relationMode: 'content-only' };
    }
    const standaloneApplied = appliedRulesForRulePaths(roots, [], !hasExplicitScope);
    const standaloneEvidence = await loadRuleEvidence(
      input.supabase,
      input.ownerId,
      standaloneApplied,
    );

    try {
      const links = await loadRuleLinks(input.supabase, input.ownerId, roots.map(({ rule }) => rule.id));
      const rootRuleIds = new Set(roots.map(({ rule }) => rule.id));
      const linkedRuleIds = [...new Set(links.flatMap((link) => [link.left_rule_id, link.right_rule_id]))]
        .filter((ruleId) => !rootRuleIds.has(ruleId));
      const linkedRules = await loadActiveRules(input.supabase, input.ownerId, linkedRuleIds);
      const allRuleIds = [...rootRuleIds, ...linkedRules.map((rule) => rule.id)];
      const bindings = await loadRuleBindings(
        input.supabase,
        input.ownerId,
        allRuleIds,
        hasExplicitScope ? new Set(scopedDocumentIds) : null,
      );
      const paths = buildRuleSearchPaths(roots, linkedRules, links, bindings);
      if (!paths.length) {
        return {
          evidence: [...seedSources, ...standaloneEvidence],
          appliedRules: standaloneApplied,
          relationMode: 'content-only',
        };
      }
      const pathSearches = await Promise.allSettled(paths.map(async (path): Promise<DynamicPathResult> => {
        const ruleContext = [path.rootRule.statement, path.linkedRule?.statement].filter(Boolean).join('\n');
        const results = await vectorStore.query(input.query, input.ownerId, {
          limit: MAX_PATH_EVIDENCE,
          documentIds: path.documentIds,
          scoreThreshold: contentScoreThreshold(),
          embeddingModel: configuration.embedding.model,
          denseQueryText: `${input.query}\n연결 규칙:\n${ruleContext}`,
          sparseQueryText: input.query,
        });
        const latest = await activeLatestDocumentIds(
          input.supabase,
          input.ownerId,
          path.documentIds,
        );
        return {
          path,
          results: results.filter((result) => latest.get(result.documentId) === result.versionId),
        };
      }));
      pathSearches.forEach((result) => {
        if (result.status === 'rejected') {
          console.error('Relation-aware document path search failed', result.reason);
        }
      });
      const successfulPaths = pathSearches.flatMap((result) => (
        result.status === 'fulfilled' && result.value.results.length ? [result.value] : []
      ));
      if (!successfulPaths.length) {
        return {
          evidence: [...seedSources, ...standaloneEvidence],
          appliedRules: standaloneApplied,
          relationMode: 'content-only',
        };
      }
      const relevantSeedResults = filterSeedResultsForPaths(seedResults, successfulPaths);
      const relevantSeedSources = relevantSeedResults.map((result) => sourceReference(result, 'seed'));
      const expanded = mergeExpandedResults(
        successfulPaths,
        new Set(relevantSeedResults.map((result) => result.chunkId)),
      );
      if (!expanded.length) {
        return {
          evidence: [...relevantSeedSources, ...standaloneEvidence],
          appliedRules: standaloneApplied,
          relationMode: 'content-only',
        };
      }
      const appliedRules = appliedRulesForRulePaths(
        roots,
        successfulPaths.map(({ path }) => path),
        !hasExplicitScope,
      );
      const loadedRuleSources = await loadRuleEvidence(input.supabase, input.ownerId, appliedRules);
      return {
        evidence: [...relevantSeedSources, ...loadedRuleSources, ...expanded],
        appliedRules,
        relationMode: 'expanded',
      };
    } catch (error) {
      console.error('Relation-aware document expansion fell back to standalone rules', error);
      return {
        evidence: [...seedSources, ...standaloneEvidence],
        appliedRules: standaloneApplied,
        relationMode: 'content-only',
      };
    }
  } catch (error) {
    console.error('Relation-aware expansion fell back to content-only search', error);
    return { evidence: seedSources, appliedRules: [], relationMode: 'fallback' };
  }
}

export async function searchRelationAwareRepository(
  input: RelationAwareSearchInput,
): Promise<RelationAwareSearchResult> {
  return searchUnifiedSemanticRepository(input);
}
