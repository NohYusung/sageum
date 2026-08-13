import type { SupabaseClient } from '@supabase/supabase-js';
import { descendantFolderIds } from '@/lib/folders/tree';
import type {
  AppliedRuleReference,
  RelationAwareSearchResult,
} from '@/lib/relations/types';
import type { SourceReference } from '@/lib/rag/local-search';
import type { Database } from '@/lib/supabase/database.types';
import { getProviderConfiguration } from './env';
import { getQdrantRelationVectorStore } from './relation-vector-store';
import { getQdrantVectorStore, type VectorSearchResult } from './qdrant-store';

type RepositoryClient = SupabaseClient<Database>;

export type RelationAwareSearchInput = {
  ownerId: string;
  supabase: RepositoryClient;
  query: string;
  folderId?: string;
  documentIds?: string[];
  topK?: number;
};

type StoredRule = {
  id: string;
  rule_document_id: string;
  rule_version_id: string;
  source_chunk_id: string;
  statement: string;
  evidence_quote: string;
  enabled: boolean;
};

type StoredBinding = {
  rule_id: string;
  document_id: string;
  version_id: string;
  chunk_id: string;
  chunk_text: string;
  vector_score: number;
};

type AppliedCandidate = {
  rule: StoredRule;
  bindings: StoredBinding[];
  seedBindings: StoredBinding[];
  expandedBindings: StoredBinding[];
};

const MAX_SEED_EVIDENCE = 4;
const MAX_EXPANDED_EVIDENCE = 4;
const MAX_APPLIED_RULES = 2;

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

export function groupRuleBindingsForExpansion(
  rules: StoredRule[],
  bindings: StoredBinding[],
  seedDocumentIds: Set<string>,
  activeVersions: Map<string, string>,
) {
  const bindingsByRule = new Map<string, StoredBinding[]>();
  for (const binding of bindings) {
    if (activeVersions.get(binding.document_id) !== binding.version_id) continue;
    bindingsByRule.set(binding.rule_id, [...(bindingsByRule.get(binding.rule_id) ?? []), binding]);
  }
  return rules.flatMap((rule): AppliedCandidate[] => {
    const ruleBindings = bindingsByRule.get(rule.id) ?? [];
    const seedBindings = ruleBindings.filter((binding) => seedDocumentIds.has(binding.document_id));
    const expandedBindings = ruleBindings.filter((binding) => !seedDocumentIds.has(binding.document_id));
    return seedBindings.length && expandedBindings.length
      ? [{ rule, bindings: ruleBindings, seedBindings, expandedBindings }]
      : [];
  });
}

async function loadAppliedRuleCandidates(
  supabase: RepositoryClient,
  ownerId: string,
  relationRuleIds: string[],
  seedDocumentIds: Set<string>,
  scopeDocumentIds: Set<string> | null,
) {
  if (!relationRuleIds.length || !seedDocumentIds.size) return [];
  const [{ data: rules, error: rulesError }, { data: bindings, error: bindingsError }] = await Promise.all([
    supabase
      .from('knowledge_rules')
      .select('id,rule_document_id,rule_version_id,source_chunk_id,statement,evidence_quote,enabled')
      .eq('owner_id', ownerId)
      .eq('enabled', true)
      .in('id', relationRuleIds),
    supabase
      .from('knowledge_rule_bindings')
      .select('rule_id,document_id,version_id,chunk_id,chunk_text,vector_score')
      .eq('owner_id', ownerId)
      .in('rule_id', relationRuleIds),
  ]);
  if (rulesError || bindingsError) throw new Error('활성 규칙 바인딩을 조회하지 못했습니다.');
  const typedRules = rules as unknown as StoredRule[];
  const typedBindings = (bindings as unknown as StoredBinding[]).filter((binding) => (
    !scopeDocumentIds || scopeDocumentIds.has(binding.document_id)
  ));
  const ruleDocumentIds = [...new Set(typedRules.map((rule) => rule.rule_document_id))];
  const { data: ruleDocuments, error: ruleDocumentsError } = await supabase
    .from('rule_documents')
    .select('document_id,enabled,extraction_status')
    .eq('owner_id', ownerId)
    .eq('enabled', true)
    .eq('extraction_status', 'ready')
    .in('document_id', ruleDocumentIds);
  if (ruleDocumentsError) throw new Error('규칙 문서 활성 상태를 확인하지 못했습니다.');
  const activeRuleDocuments = new Set(ruleDocuments.map((document) => document.document_id));
  const activeRules = typedRules.filter((rule) => activeRuleDocuments.has(rule.rule_document_id));
  const activeVersions = await activeLatestDocumentIds(
    supabase,
    ownerId,
    typedBindings.map((binding) => binding.document_id),
  );
  return groupRuleBindingsForExpansion(activeRules, typedBindings, seedDocumentIds, activeVersions);
}

async function ruleSources(
  supabase: RepositoryClient,
  ownerId: string,
  applied: AppliedRuleReference[],
  relationScores: Map<string, number>,
) {
  if (!applied.length) return [];
  const chunkIds = applied.map((rule) => rule.sourceChunkId);
  const documentIds = applied.map((rule) => rule.ruleDocumentId);
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
  const ruleByChunk = new Map(applied.map((rule) => [rule.sourceChunkId, rule]));
  return chunks.flatMap((chunk): SourceReference[] => {
    const rule = ruleByChunk.get(chunk.id);
    const document = documentById.get(chunk.document_id);
    if (!rule || !document) return [];
    return [{
      documentId: document.id,
      versionId: chunk.version_id,
      documentTitle: document.title,
      chunkId: chunk.id,
      heading: chunk.heading_path.join(' › ') || '비즈니스 규칙',
      snippet: chunk.text,
      score: relationScores.get(rule.ruleId) ?? rule.score,
      page: chunk.page ?? undefined,
      sheet: chunk.sheet ?? undefined,
      cellRange: chunk.cell_range ?? undefined,
      sourceSpans: [],
      retrievalRole: 'rule',
      ruleId: rule.ruleId,
    }];
  });
}

async function expandedSources(
  supabase: RepositoryClient,
  ownerId: string,
  candidates: AppliedCandidate[],
) {
  const ruleByChunk = new Map<string, string>();
  const bindings = candidates
    .flatMap((candidate) => candidate.expandedBindings.map((binding) => {
      ruleByChunk.set(binding.chunk_id, candidate.rule.id);
      return binding;
    }))
    .sort((left, right) => right.vector_score - left.vector_score)
    .filter((binding, index, all) => all.findIndex((item) => item.chunk_id === binding.chunk_id) === index)
    .slice(0, MAX_EXPANDED_EVIDENCE);
  if (!bindings.length) return [];
  const documentIds = [...new Set(bindings.map((binding) => binding.document_id))];
  const [{ data: chunks, error: chunksError }, { data: documents, error: documentsError }] = await Promise.all([
    supabase
      .from('document_chunks')
      .select('id,document_id,version_id,text,heading_path,page,sheet,cell_range')
      .eq('owner_id', ownerId)
      .in('id', bindings.map((binding) => binding.chunk_id)),
    supabase
      .from('documents')
      .select('id,title')
      .eq('owner_id', ownerId)
      .eq('document_kind', 'knowledge')
      .eq('deletion_status', 'active')
      .in('id', documentIds),
  ]);
  if (chunksError || documentsError) throw new Error('관계 확장 근거를 조회하지 못했습니다.');
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const titleById = new Map(documents.map((document) => [document.id, document.title]));
  return bindings.flatMap((binding): SourceReference[] => {
    const chunk = chunkById.get(binding.chunk_id);
    if (!chunk) return [];
    return [{
      documentId: binding.document_id,
      versionId: binding.version_id,
      documentTitle: titleById.get(binding.document_id) ?? '문서',
      chunkId: binding.chunk_id,
      heading: chunk.heading_path.join(' › ') || '본문',
      snippet: chunk.text || binding.chunk_text,
      score: binding.vector_score,
      page: chunk.page ?? undefined,
      sheet: chunk.sheet ?? undefined,
      cellRange: chunk.cell_range ?? undefined,
      sourceSpans: [],
      retrievalRole: 'expanded',
      ruleId: ruleByChunk.get(binding.chunk_id),
    }];
  });
}

export async function searchRelationAwareRepository(
  input: RelationAwareSearchInput,
): Promise<RelationAwareSearchResult> {
  const configuration = getProviderConfiguration();
  const vectorStore = getQdrantVectorStore();
  await vectorStore.ensureCollection(configuration.embedding.dimensions);
  const scopedDocumentIds = await resolveKnowledgeDocumentScope(input);
  if ((input.folderId || input.documentIds?.length) && !scopedDocumentIds.length) {
    return { evidence: [], appliedRules: [], relationMode: 'content-only' };
  }
  const topK = Math.min(Math.max(input.topK ?? MAX_SEED_EVIDENCE, 1), 20);
  const baseResults = await vectorStore.query(input.query, input.ownerId, {
    limit: Math.min(topK * 2, 40),
    documentIds: scopedDocumentIds,
    scoreThreshold: contentScoreThreshold(),
    embeddingModel: configuration.embedding.model,
  });
  const activeLatest = await activeLatestDocumentIds(
    input.supabase,
    input.ownerId,
    baseResults.map((result) => result.documentId),
  );
  const seedResults = baseResults.filter((result) => (
    activeLatest.get(result.documentId) === result.versionId
  )).slice(0, Math.min(topK, MAX_SEED_EVIDENCE));
  const seedSources = seedResults.map((result) => sourceReference(result, 'seed'));
  if (!seedResults.length) return { evidence: seedSources, appliedRules: [], relationMode: 'content-only' };

  try {
    const relationStore = getQdrantRelationVectorStore();
    await relationStore.ensureCollection(configuration.embedding.dimensions);
    const relationHits = (await relationStore.query(
      input.query,
      input.ownerId,
      configuration.embedding.model,
      8,
    )).filter((hit) => hit.score >= relationScoreThreshold());
    const relationScores = new Map(relationHits.map((hit) => [hit.id, hit.score]));
    const seedDocumentIds = new Set(seedResults.map((result) => result.documentId));
    const candidates = (await loadAppliedRuleCandidates(
      input.supabase,
      input.ownerId,
      relationHits.map((hit) => hit.id),
      seedDocumentIds,
      scopedDocumentIds.length ? new Set(scopedDocumentIds) : null,
    )).sort((left, right) => (
      (relationScores.get(right.rule.id) ?? 0) - (relationScores.get(left.rule.id) ?? 0)
    )).slice(0, MAX_APPLIED_RULES);
    const appliedRules: AppliedRuleReference[] = candidates.map((candidate) => ({
      ruleId: candidate.rule.id,
      ruleDocumentId: candidate.rule.rule_document_id,
      ruleDocumentTitle: '비즈니스 규칙',
      sourceChunkId: candidate.rule.source_chunk_id,
      statement: candidate.rule.statement,
      score: relationScores.get(candidate.rule.id) ?? 0,
      bindingDocumentIds: [...new Set(candidate.bindings.map((binding) => binding.document_id))],
    }));
    if (!appliedRules.length) {
      return { evidence: seedSources, appliedRules: [], relationMode: 'content-only' };
    }
    const [loadedRuleSources, loadedExpandedSources] = await Promise.all([
      ruleSources(input.supabase, input.ownerId, appliedRules, relationScores),
      expandedSources(input.supabase, input.ownerId, candidates),
    ]);
    const ruleTitleByDocument = new Map(loadedRuleSources.map((source) => [
      source.documentId,
      source.documentTitle,
    ]));
    for (const rule of appliedRules) {
      rule.ruleDocumentTitle = ruleTitleByDocument.get(rule.ruleDocumentId) ?? '비즈니스 규칙';
    }
    return {
      evidence: [...seedSources, ...loadedRuleSources, ...loadedExpandedSources],
      appliedRules,
      relationMode: loadedExpandedSources.length ? 'expanded' : 'content-only',
    };
  } catch (error) {
    console.error('Relation-aware expansion fell back to content-only search', error);
    return { evidence: seedSources, appliedRules: [], relationMode: 'fallback' };
  }
}
