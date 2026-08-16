import type { SupabaseClient } from '@supabase/supabase-js';
import { descendantFolderIds } from '@/lib/folders/tree';
import type {
  AppliedRuleReference,
  AppliedSemanticLinkReference,
  RelationAwareSearchResult,
} from '@/lib/relations/types';
import type { SourceReference } from '@/lib/rag/local-search';
import type { Database } from '@/lib/supabase/database.types';
import { getProviderConfiguration } from './env';
import { getQdrantVectorStore, type VectorSearchResult } from './qdrant-store';
import { getQdrantRelationVectorStore } from './relation-vector-store';

type RepositoryClient = SupabaseClient<Database>;
type SemanticNode = Database['public']['Tables']['knowledge_semantic_nodes']['Row'];
type SemanticLink = Database['public']['Tables']['knowledge_semantic_links']['Row'];
type StoredRule = Pick<Database['public']['Tables']['knowledge_rules']['Row'],
  'id' | 'rule_document_id' | 'rule_version_id' | 'source_chunk_id' | 'statement' | 'evidence_quote' | 'enabled'
>;

export type SemanticAwareSearchInput = {
  ownerId: string;
  supabase: RepositoryClient;
  query: string;
  folderId?: string;
  documentIds?: string[];
  topK?: number;
};

type SemanticSearchPath = {
  id: string;
  score: number;
  rootNodeKind: 'document' | 'rule';
  targetDocumentId: string;
  links: SemanticLink[];
  nodes: SemanticNode[];
  rules: StoredRule[];
};

const MAX_SEED_EVIDENCE = 4;
const MAX_EXPANDED_EVIDENCE = 4;
const MAX_PATHS = 2;
export const MIN_SEMANTIC_DOCUMENT_ROOT_SCORE = 0.5;

export function prioritizeSemanticPathCandidates<
  T extends { rootNodeKind: 'document' | 'rule'; score: number },
>(paths: T[]) {
  return paths.toSorted((left, right) => {
    if (left.rootNodeKind !== right.rootNodeKind) {
      return left.rootNodeKind === 'rule' ? -1 : 1;
    }
    return right.score - left.score;
  });
}

export function selectHybridRuleCandidates<
  THit extends { id: string; score: number },
  TRule extends { id: string },
>(hits: THit[], rules: TRule[], scoreThreshold: number, limit = 2) {
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  return hits.flatMap((hit) => {
    if (hit.score < scoreThreshold) return [];
    const rule = ruleById.get(hit.id);
    return rule ? [{ rule, score: hit.score }] : [];
  }).slice(0, limit);
}

export function selectSemanticRootCandidates<T extends { score: number }>(
  ruleRoots: T[],
  documentRoots: T[],
  hasActiveRuleRoots = ruleRoots.length > 0,
) {
  return hasActiveRuleRoots
    ? ruleRoots
    : documentRoots.filter((root) => root.score >= MIN_SEMANTIC_DOCUMENT_ROOT_SCORE);
}

export function filterSeedResultsForSemanticPaths<
  TSeed extends { documentId: string; score: number },
  TPath extends { targetDocumentId: string },
>(seeds: TSeed[], paths: TPath[], hasActiveRuleRoots: boolean) {
  if (!hasActiveRuleRoots || !paths.length) return seeds;
  const pathDocumentIds = new Set(paths.map((path) => path.targetDocumentId));
  return seeds.filter((seed) => (
    seed.score > MIN_SEMANTIC_DOCUMENT_ROOT_SCORE
    || pathDocumentIds.has(seed.documentId)
  ));
}

function contentThreshold() {
  const configured = Number.parseFloat(process.env.QDRANT_SCORE_THRESHOLD?.trim() ?? '0.2');
  return Number.isFinite(configured) && configured >= 0 ? configured : 0.2;
}

function relationRetrievalThreshold() {
  const configured = Number.parseFloat(
    process.env.QDRANT_RELATION_SCORE_THRESHOLD?.trim() ?? '0.35',
  );
  return Number.isFinite(configured) && configured >= 0 ? configured : 0.35;
}

function sourceFromVector(
  result: VectorSearchResult,
  role: 'seed' | 'expanded',
  path?: SemanticSearchPath,
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
    retrievalRole: role,
    ...(path ? {
      expansionKind: 'semantic-link' as const,
      semanticLinkId: path.links.at(-1)?.id,
      semanticPathId: path.id,
      pathId: path.rules.length ? path.id : undefined,
      ruleId: path.rules.at(-1)?.id,
    } : {}),
  };
}

async function resolveScope(input: SemanticAwareSearchInput) {
  let requested = input.documentIds ?? [];
  if (input.folderId) {
    const [folders, documents] = await Promise.all([
      input.supabase.from('folders').select('id,parent_id,name,sort_order,created_at,updated_at').eq('owner_id', input.ownerId),
      input.supabase.from('documents').select('id,folder_id').eq('owner_id', input.ownerId).eq('document_kind', 'knowledge').eq('deletion_status', 'active'),
    ]);
    if (folders.error || documents.error) throw new Error('폴더 검색 범위를 확인하지 못했습니다.');
    const mapped = folders.data.map((folder) => ({
      id: folder.id,
      parentId: folder.parent_id,
      name: folder.name,
      sortOrder: folder.sort_order,
      createdAt: folder.created_at,
      updatedAt: folder.updated_at,
    }));
    if (!mapped.some((folder) => folder.id === input.folderId)) {
      throw new Error('검색할 폴더를 찾을 수 없습니다.');
    }
    const descendants = descendantFolderIds(mapped, input.folderId);
    const inFolder = documents.data
      .filter((document) => document.folder_id && descendants.has(document.folder_id))
      .map((document) => document.id);
    requested = requested.length ? requested.filter((id) => inFolder.includes(id)) : inFolder;
  }
  if (!input.folderId && requested.length) {
    const { data, error } = await input.supabase
      .from('documents')
      .select('id')
      .eq('owner_id', input.ownerId)
      .eq('document_kind', 'knowledge')
      .eq('deletion_status', 'active')
      .in('id', requested);
    if (error) throw new Error('문서 검색 범위를 확인하지 못했습니다.');
    requested = data.map((document) => document.id);
  }
  return requested;
}

async function activeDocuments(
  supabase: RepositoryClient,
  ownerId: string,
  scope: string[],
  hasExplicitScope: boolean,
) {
  let query = supabase
    .from('documents')
    .select('id,latest_version_id')
    .eq('owner_id', ownerId)
    .eq('document_kind', 'knowledge')
    .eq('deletion_status', 'active')
    .not('latest_version_id', 'is', null);
  if (hasExplicitScope) query = query.in('id', scope);
  const { data, error } = await query;
  if (error) throw new Error('활성 문서 범위를 조회하지 못했습니다.');
  return new Map(data.flatMap((document) => document.latest_version_id
    ? [[document.id, document.latest_version_id] as const]
    : []));
}

async function activeRules(
  supabase: RepositoryClient,
  ownerId: string,
  ids: string[],
) {
  if (!ids.length) return [];
  const { data: rules, error: rulesError } = await supabase
    .from('knowledge_rules')
    .select('id,rule_document_id,rule_version_id,source_chunk_id,statement,evidence_quote,enabled')
    .eq('owner_id', ownerId)
    .eq('enabled', true)
    .in('id', [...new Set(ids)]);
  if (rulesError) throw new Error('활성 규칙을 조회하지 못했습니다.');
  const { data: documents, error: documentsError } = await supabase
    .from('rule_documents')
    .select('document_id')
    .eq('owner_id', ownerId)
    .eq('enabled', true)
    .eq('extraction_status', 'ready')
    .in('document_id', [...new Set(rules.map((rule) => rule.rule_document_id))]);
  if (documentsError) throw new Error('활성 규칙 문서를 조회하지 못했습니다.');
  const activeDocumentIds = new Set(documents.map((document) => document.document_id));
  return rules.filter((rule) => activeDocumentIds.has(rule.rule_document_id));
}

async function ruleEvidence(
  supabase: RepositoryClient,
  ownerId: string,
  appliedRules: AppliedRuleReference[],
) {
  if (!appliedRules.length) return [];
  const chunkIds = [...new Set(appliedRules.map((rule) => rule.sourceChunkId))];
  const documentIds = [...new Set(appliedRules.map((rule) => rule.ruleDocumentId))];
  const [chunks, documents] = await Promise.all([
    supabase.from('document_chunks').select('id,document_id,version_id,text,heading_path,page,sheet,cell_range').eq('owner_id', ownerId).in('id', chunkIds),
    supabase.from('documents').select('id,title').eq('owner_id', ownerId).eq('deletion_status', 'active').in('id', documentIds),
  ]);
  if (chunks.error || documents.error) throw new Error('규칙 원문 근거를 조회하지 못했습니다.');
  const documentById = new Map(documents.data.map((document) => [document.id, document]));
  const appliedByChunk = new Map(appliedRules.map((rule) => [rule.sourceChunkId, rule]));
  return chunks.data.flatMap((chunk): SourceReference[] => {
    const applied = appliedByChunk.get(chunk.id);
    const document = documentById.get(chunk.document_id);
    if (!applied || !document) return [];
    applied.ruleDocumentTitle = document.title;
    return [{
      documentId: document.id,
      versionId: chunk.version_id,
      documentTitle: document.title,
      chunkId: chunk.id,
      heading: chunk.heading_path.join(' › ') || '비즈니스 규칙',
      snippet: chunk.text,
      score: applied.score,
      page: chunk.page ?? undefined,
      sheet: chunk.sheet ?? undefined,
      cellRange: chunk.cell_range ?? undefined,
      sourceSpans: [],
      retrievalRole: 'rule',
      ruleId: applied.ruleId,
      pathId: applied.pathId,
    }];
  });
}

function otherNodeId(link: SemanticLink, nodeId: string) {
  return link.left_node_id === nodeId
    ? link.right_node_id
    : link.right_node_id === nodeId
      ? link.left_node_id
      : null;
}

function semanticPaths(
  roots: Array<{ node: SemanticNode; score: number }>,
  nodes: SemanticNode[],
  links: SemanticLink[],
  rulesById: Map<string, StoredRule>,
  activeDocumentIds: Set<string>,
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incident = new Map<string, SemanticLink[]>();
  links.forEach((link) => {
    incident.set(link.left_node_id, [...(incident.get(link.left_node_id) ?? []), link]);
    incident.set(link.right_node_id, [...(incident.get(link.right_node_id) ?? []), link]);
  });
  const paths: SemanticSearchPath[] = [];
  for (const root of roots) {
    for (const firstLink of incident.get(root.node.id) ?? []) {
      const firstId = otherNodeId(firstLink, root.node.id);
      const first = firstId ? nodeById.get(firstId) : null;
      if (!first) continue;
      if (first.node_kind === 'document' && first.document_id && activeDocumentIds.has(first.document_id)) {
        if (root.node.document_id !== first.document_id) {
          paths.push({
            id: `semantic:${root.node.id}:${firstLink.id}`,
            score: (root.score + firstLink.semantic_score) / 2,
            rootNodeKind: root.node.node_kind as 'document' | 'rule',
            targetDocumentId: first.document_id,
            links: [firstLink],
            nodes: [root.node, first],
            rules: [root.node, first].flatMap((node) => node.rule_id && rulesById.has(node.rule_id) ? [rulesById.get(node.rule_id)!] : []),
          });
        }
        continue;
      }
      if (root.node.node_kind !== 'rule' || first.node_kind !== 'rule') continue;
      for (const secondLink of incident.get(first.id) ?? []) {
        const secondId = otherNodeId(secondLink, first.id);
        if (!secondId || secondId === root.node.id) continue;
        const second = nodeById.get(secondId);
        if (second?.node_kind !== 'document' || !second.document_id || !activeDocumentIds.has(second.document_id)) continue;
        paths.push({
          id: `semantic:${root.node.id}:${firstLink.id}:${secondLink.id}`,
          score: (root.score + firstLink.semantic_score + secondLink.semantic_score) / 3,
          rootNodeKind: root.node.node_kind as 'document' | 'rule',
          targetDocumentId: second.document_id,
          links: [firstLink, secondLink],
          nodes: [root.node, first, second],
          rules: [root.node, first].flatMap((node) => node.rule_id && rulesById.has(node.rule_id) ? [rulesById.get(node.rule_id)!] : []),
        });
      }
    }
  }
  return prioritizeSemanticPathCandidates(paths)
    .filter((path, index, all) => all.findIndex((candidate) => (
      candidate.targetDocumentId === path.targetDocumentId
      && candidate.links.map((link) => link.id).join(':') === path.links.map((link) => link.id).join(':')
    )) === index)
    .slice(0, MAX_PATHS);
}

function appliedRulesForSearch(
  rootRules: Array<{ rule: StoredRule; score: number }>,
  successfulPaths: SemanticSearchPath[],
) {
  const byRule = new Map<string, AppliedRuleReference>();
  for (const root of rootRules) {
    const path = successfulPaths.find((candidate) => candidate.rules.some((rule) => rule.id === root.rule.id));
    byRule.set(root.rule.id, {
      ruleId: root.rule.id,
      ruleDocumentId: root.rule.rule_document_id,
      ruleDocumentTitle: '비즈니스 규칙',
      sourceChunkId: root.rule.source_chunk_id,
      statement: root.rule.statement,
      score: root.score,
      bindingDocumentIds: path ? [path.targetDocumentId] : [],
      pathId: path?.id ?? `rule:${root.rule.id}:standalone`,
      depth: 0,
    });
  }
  successfulPaths.forEach((path) => path.rules.forEach((rule, index) => {
    if (byRule.has(rule.id)) return;
    byRule.set(rule.id, {
      ruleId: rule.id,
      ruleDocumentId: rule.rule_document_id,
      ruleDocumentTitle: '비즈니스 규칙',
      sourceChunkId: rule.source_chunk_id,
      statement: rule.statement,
      score: path.score,
      bindingDocumentIds: [path.targetDocumentId],
      pathId: path.id,
      depth: index > 0 ? 1 : 0,
      parentRuleId: index > 0 ? path.rules[index - 1]?.id : undefined,
    });
  }));
  return [...byRule.values()];
}

function appliedLinks(paths: SemanticSearchPath[]): AppliedSemanticLinkReference[] {
  const seen = new Set<string>();
  return paths.flatMap((path) => path.links.flatMap((link, index) => {
    const key = `${path.id}:${link.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const left = path.nodes.find((node) => node.id === link.left_node_id)!;
    const right = path.nodes.find((node) => node.id === link.right_node_id)!;
    const mapNode = (node: SemanticNode) => ({
      nodeId: node.id,
      nodeKind: node.node_kind as 'document' | 'rule',
      documentId: node.document_id ?? undefined,
      ruleId: node.rule_id ?? undefined,
    });
    return [{
      semanticLinkId: link.id,
      semanticPathId: path.id,
      depth: (index + 1) as 1 | 2,
      score: link.semantic_score,
      coverageScore: link.coverage_score,
      leftNode: mapNode(left),
      rightNode: mapNode(right),
    }];
  }));
}

export async function searchUnifiedSemanticRepository(
  input: SemanticAwareSearchInput,
): Promise<RelationAwareSearchResult> {
  const configuration = getProviderConfiguration();
  const vectorStore = getQdrantVectorStore();
  const relationStore = getQdrantRelationVectorStore();
  await vectorStore.ensureCollection(configuration.embedding.dimensions);
  const scope = await resolveScope(input);
  const explicitScope = Boolean(input.folderId || input.documentIds?.length);
  if (explicitScope && !scope.length) {
    return { evidence: [], appliedRules: [], appliedSemanticLinks: [], relationMode: 'content-only' };
  }
  const latestByDocument = await activeDocuments(input.supabase, input.ownerId, scope, explicitScope);
  const topK = Math.min(Math.max(input.topK ?? MAX_SEED_EVIDENCE, 1), 20);
  const [baseSearch, ruleSearch] = await Promise.allSettled([
    vectorStore.query(input.query, input.ownerId, {
      limit: Math.min(topK * 2, 40),
      documentIds: explicitScope ? scope : undefined,
      scoreThreshold: contentThreshold(),
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
  const seeds = baseSearch.value.filter((result) => (
    latestByDocument.get(result.documentId) === result.versionId
  )).slice(0, Math.min(topK, MAX_SEED_EVIDENCE));
  const seedSources = seeds.map((result) => sourceFromVector(result, 'seed'));
  if (ruleSearch.status === 'rejected') {
    console.error('Hybrid rule search fell back to content search', ruleSearch.reason);
    return { evidence: seedSources, appliedRules: [], appliedSemanticLinks: [], relationMode: 'fallback' };
  }

  let rootRules: Array<{ rule: StoredRule; score: number }>;
  try {
    const activeRootRules = await activeRules(
      input.supabase,
      input.ownerId,
      ruleSearch.value.map((hit) => hit.id),
    );
    rootRules = selectHybridRuleCandidates(
      ruleSearch.value,
      activeRootRules,
      relationRetrievalThreshold(),
      2,
    );
  } catch (error) {
    console.error('Active hybrid rules could not be loaded', error);
    return { evidence: seedSources, appliedRules: [], appliedSemanticLinks: [], relationMode: 'fallback' };
  }

  const standaloneApplied = explicitScope ? [] : appliedRulesForSearch(rootRules, []);
  let standaloneEvidence: SourceReference[] = [];
  try {
    standaloneEvidence = await ruleEvidence(input.supabase, input.ownerId, standaloneApplied);
  } catch (error) {
    console.error('Standalone rule evidence could not be loaded', error);
  }

  try {
    const [nodesResult, linksResult] = await Promise.all([
      input.supabase.from('knowledge_semantic_nodes').select('*').eq('owner_id', input.ownerId),
      input.supabase.from('knowledge_semantic_links').select('*').eq('owner_id', input.ownerId).order('semantic_score', { ascending: false }).limit(1000),
    ]);
    if (nodesResult.error || linksResult.error) throw new Error('저장된 공통 의미 링크를 조회하지 못했습니다.');
    const nodes = nodesResult.data;
    const nodeByDocument = new Map(nodes.flatMap((node) => node.document_id ? [[node.document_id, node] as const] : []));
    const nodeByRule = new Map(nodes.flatMap((node) => node.rule_id ? [[node.rule_id, node] as const] : []));
    const documentRootNodes = seeds.flatMap((seed) => {
      const node = nodeByDocument.get(seed.documentId);
      return node ? [{ node, score: seed.score }] : [];
    });
    const ruleRootNodes = rootRules.flatMap(({ rule, score }) => {
      const node = nodeByRule.get(rule.id);
      return node ? [{ node, score }] : [];
    });
    const rootNodes = selectSemanticRootCandidates(
      ruleRootNodes,
      documentRootNodes,
      rootRules.length > 0,
    );
    if (!rootNodes.length) {
      return {
        evidence: [...seedSources, ...standaloneEvidence],
        appliedRules: standaloneApplied,
        appliedSemanticLinks: [],
        relationMode: 'content-only',
      };
    }
    const allRuleIds = nodes.flatMap((node) => node.rule_id ? [node.rule_id] : []);
    const allActiveRules = await activeRules(input.supabase, input.ownerId, allRuleIds);
    const rulesById = new Map(allActiveRules.map((rule) => [rule.id, rule]));
    const paths = semanticPaths(
      rootNodes,
      nodes,
      linksResult.data,
      rulesById,
      new Set(latestByDocument.keys()),
    );
    const pathSearches = await Promise.allSettled(paths.map(async (path) => {
      const context = path.rules.map((rule) => rule.statement).join('\n');
      const results = await vectorStore.query(input.query, input.ownerId, {
        limit: 4,
        documentIds: [path.targetDocumentId],
        scoreThreshold: contentThreshold(),
        embeddingModel: configuration.embedding.model,
        denseQueryText: context ? `${input.query}\n의미 연결 문맥:\n${context}` : input.query,
        sparseQueryText: input.query,
      });
      return {
        path,
        results: results.filter((result) => latestByDocument.get(result.documentId) === result.versionId),
      };
    }));
    pathSearches.forEach((result) => {
      if (result.status === 'rejected') console.error('Semantic-link document search failed', result.reason);
    });
    const successful = pathSearches.flatMap((result) => (
      result.status === 'fulfilled' && result.value.results.length ? [result.value] : []
    ));
    const relevantSeeds = filterSeedResultsForSemanticPaths(
      seeds,
      successful.map(({ path }) => path),
      rootRules.length > 0,
    );
    const relevantSeedSources = relevantSeeds.map((result) => sourceFromVector(result, 'seed'));
    const seedChunkIds = new Set(relevantSeeds.map((seed) => seed.chunkId));
    const expandedByChunk = new Map<string, { result: VectorSearchResult; path: SemanticSearchPath }>();
    successful.forEach(({ path, results }) => results.forEach((result) => {
      if (seedChunkIds.has(result.chunkId)) return;
      const current = expandedByChunk.get(result.chunkId);
      if (!current || result.score > current.result.score) expandedByChunk.set(result.chunkId, { result, path });
    }));
    const expanded = [...expandedByChunk.values()]
      .toSorted((left, right) => right.result.score - left.result.score)
      .slice(0, MAX_EXPANDED_EVIDENCE)
      .map(({ result, path }) => sourceFromVector(result, 'expanded', path));
    const usedPathIds = new Set(expanded.flatMap((source) => source.semanticPathId ? [source.semanticPathId] : []));
    const usedPaths = successful.map(({ path }) => path).filter((path) => usedPathIds.has(path.id));
    const appliedRules = appliedRulesForSearch(
      rootRules,
      usedPaths,
    ).filter((rule) => !explicitScope || usedPaths.some((path) => path.rules.some((candidate) => candidate.id === rule.ruleId)));
    const ruleSources = await ruleEvidence(input.supabase, input.ownerId, appliedRules);
    return {
      evidence: [...relevantSeedSources, ...ruleSources, ...expanded],
      appliedRules,
      appliedSemanticLinks: appliedLinks(usedPaths),
      relationMode: expanded.length ? 'expanded' : 'content-only',
    };
  } catch (error) {
    console.error('Unified semantic expansion fell back to content and standalone rules', error);
    return {
      evidence: [...seedSources, ...standaloneEvidence],
      appliedRules: standaloneApplied,
      appliedSemanticLinks: [],
      relationMode: 'fallback',
    };
  }
}
