import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findExactTextSpan } from '@/lib/relations/exact-span';
import type { RuleDocumentSourceMode } from '@/lib/relations/types';
import type { DocumentChunk } from '@/lib/rag/types';
import type { Database, Json, TablesInsert } from '@/lib/supabase/database.types';
import {
  extractBusinessRules,
  RULE_EXTRACTION_VERSION,
  type ValidatedExtractedRule,
} from './business-rule-extraction';
import { getProviderConfiguration } from './env';
import { getQdrantRelationVectorStore } from './relation-vector-store';
import { getQdrantVectorStore, type VectorSearchResult } from './qdrant-store';

type AdminClient = SupabaseClient<Database>;

export type PersistableKnowledgeRuleBinding = {
  id: string;
  rule_id: string;
  document_id: string;
  version_id: string;
  chunk_id: string;
  chunk_text: string;
  vector_score: number;
};

export type RuleProcessingResult = {
  ruleCount: number;
  bindingCount: number;
  warning: string | null;
};

export class BusinessRuleProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessRuleProcessingError';
  }
}

const MAX_BINDINGS_PER_RULE = 20;
const BINDING_CANDIDATE_LIMIT = 40;

function bindingScoreThreshold() {
  const value = Number.parseFloat(
    process.env.QDRANT_RULE_BINDING_SCORE_THRESHOLD?.trim() ?? '0.2',
  );
  return Number.isFinite(value) && value >= 0 ? value : 0.2;
}

function activeKnowledgeVersionMap(
  rows: Array<{ id: string; latest_version_id: string | null }>,
) {
  return new Map(rows.flatMap((row) => (
    row.latest_version_id ? [[row.id, row.latest_version_id] as const] : []
  )));
}

export function semanticBindingsFromCandidates(
  rule: Pick<ValidatedExtractedRule, 'id'>,
  candidates: VectorSearchResult[],
  latestVersions: Map<string, string>,
) {
  const seenChunks = new Set<string>();
  const bindings: PersistableKnowledgeRuleBinding[] = [];
  for (const candidate of candidates) {
    if (bindings.length >= MAX_BINDINGS_PER_RULE) break;
    if (seenChunks.has(candidate.chunkId)) continue;
    if (latestVersions.get(candidate.documentId) !== candidate.versionId) continue;
    if (!candidate.text.trim()) continue;
    seenChunks.add(candidate.chunkId);
    bindings.push({
      id: randomUUID(),
      rule_id: rule.id,
      document_id: candidate.documentId,
      version_id: candidate.versionId,
      chunk_id: candidate.chunkId,
      chunk_text: candidate.text,
      vector_score: Math.min(1, Math.max(0, candidate.score)),
    });
  }
  return bindings;
}

async function activeKnowledgeDocuments(
  supabase: AdminClient,
  ownerId: string,
  documentIds?: string[],
) {
  let query = supabase
    .from('documents')
    .select('id,latest_version_id')
    .eq('owner_id', ownerId)
    .eq('document_kind', 'knowledge')
    .eq('deletion_status', 'active')
    .not('latest_version_id', 'is', null);
  if (documentIds?.length) query = query.in('id', documentIds);
  const { data, error } = await query;
  if (error) throw new Error('규칙을 적용할 일반 문서를 조회하지 못했습니다.');
  return activeKnowledgeVersionMap(data);
}

async function queryBindingsForRule(
  ownerId: string,
  rule: ValidatedExtractedRule,
  latestVersions: Map<string, string>,
) {
  if (!latestVersions.size) return [];
  const configuration = getProviderConfiguration();
  const candidates = await getQdrantVectorStore().query(rule.statement, ownerId, {
    embeddingModel: configuration.embedding.model,
    documentIds: [...latestVersions.keys()],
    limit: BINDING_CANDIDATE_LIMIT,
    scoreThreshold: bindingScoreThreshold(),
  });
  return semanticBindingsFromCandidates(rule, candidates, latestVersions);
}

async function buildBindings(
  supabase: AdminClient,
  ownerId: string,
  rules: ValidatedExtractedRule[],
  documentIds?: string[],
) {
  const latestVersions = await activeKnowledgeDocuments(supabase, ownerId, documentIds);
  const bindings: PersistableKnowledgeRuleBinding[] = [];
  for (const rule of rules) {
    bindings.push(...await queryBindingsForRule(ownerId, rule, latestVersions));
  }
  return bindings;
}

function persistableRule(rule: ValidatedExtractedRule, enabled = true) {
  return {
    id: rule.id,
    source_chunk_id: rule.sourceChunkId,
    ordinal: rule.ordinal,
    statement: rule.statement,
    evidence_quote: rule.evidenceQuote,
    evidence_start_offset: rule.evidenceStartOffset,
    evidence_end_offset: rule.evidenceEndOffset,
    confidence: rule.confidence,
    enabled,
    extraction_model: rule.extractionModel,
    extraction_version: rule.extractionVersion,
  };
}

export type BusinessRuleProcessingOptions = {
  sourceMode?: RuleDocumentSourceMode;
  manualContent?: string | null;
  documentTitle?: string;
  documentSourceType?: string;
  preserveExistingOnFailure?: boolean;
};

function manualRule(
  chunks: DocumentChunk[],
  content: string,
  extractionModel: string,
): ValidatedExtractedRule {
  const statement = content.trim();
  const found = chunks.flatMap((chunk) => {
    const span = findExactTextSpan(chunk.text, statement);
    return span ? [{ chunk, span }] : [];
  })[0];
  if (!found) throw new BusinessRuleProcessingError('직접 입력한 규칙을 원문에서 찾지 못했습니다.');
  return {
    id: randomUUID(),
    ordinal: 0,
    sourceChunkId: found.chunk.id,
    statement,
    evidenceQuote: found.span.text,
    evidenceStartOffset: found.span.startOffset,
    evidenceEndOffset: found.span.endOffset,
    confidence: 1,
    extractionModel,
    extractionVersion: `${RULE_EXTRACTION_VERSION}-manual`,
  };
}

function processingWarning(rejectedReasons: string[], bindings: PersistableKnowledgeRuleBinding[]) {
  const messages: string[] = [];
  if (rejectedReasons.length) messages.push(`${rejectedReasons.length}개 규칙 후보 제외`);
  const boundDocuments = new Set(bindings.map((binding) => binding.document_id));
  if (boundDocuments.size < 2) {
    messages.push('현재 일반 문서에서 이 규칙과 유사한 문서를 2개 이상 찾지 못함');
  }
  return messages.length ? messages.join(' · ') : null;
}

async function markRuleDocumentFailed(
  supabase: AdminClient,
  ownerId: string,
  documentId: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : '규칙 추출에 실패했습니다.';
  await supabase.from('rule_documents').upsert({
    document_id: documentId,
    owner_id: ownerId,
    extraction_status: 'failed',
    extraction_error: message.slice(0, 500),
    extraction_warning: null,
    extracted_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'document_id' });
}

export async function processBusinessRuleDocument(
  supabase: AdminClient,
  ownerId: string,
  documentId: string,
  versionId: string,
  chunks: DocumentChunk[],
  options: BusinessRuleProcessingOptions = {},
): Promise<RuleProcessingResult> {
  const configuration = getProviderConfiguration();
  const relationStore = getQdrantRelationVectorStore();
  const sourceMode = options.sourceMode ?? 'upload';
  const preserveExisting = options.preserveExistingOnFailure ?? false;
  let stagedRuleIds: string[] = [];
  try {
    const { data: existingRules, error: existingRulesError } = await supabase
      .from('knowledge_rules')
      .select('id,enabled,ordinal')
      .eq('owner_id', ownerId)
      .eq('rule_document_id', documentId)
      .order('ordinal');
    if (existingRulesError) throw new Error('기존 규칙 상태를 확인하지 못했습니다.');

    if (!preserveExisting) {
      await supabase.from('rule_documents').upsert({
        document_id: documentId,
        owner_id: ownerId,
        source_mode: sourceMode,
        manual_content: sourceMode === 'manual' ? options.manualContent ?? null : null,
        extraction_status: 'processing',
        extraction_error: null,
        extraction_warning: null,
        extracted_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'document_id' });
    }

    const extracted = sourceMode === 'manual'
      ? {
        rules: [manualRule(chunks, options.manualContent ?? '', configuration.embedding.model)],
        rejectedReasons: [] as string[],
      }
      : await extractBusinessRules(chunks);
    if (!extracted.rules.length) {
      throw new BusinessRuleProcessingError('규칙 문서에서 유효한 규칙을 추출하지 못했습니다.');
    }
    const bindings = await buildBindings(supabase, ownerId, extracted.rules);
    const warning = processingWarning(extracted.rejectedReasons, bindings);
    const preservedEnabled = preserveExisting && existingRules.length === 1
      ? existingRules[0].enabled
      : true;

    await relationStore.ensureCollection(configuration.embedding.dimensions);
    const vectorRecords = extracted.rules.map((rule) => ({
      id: rule.id,
      ownerId,
      ruleDocumentId: documentId,
      ruleVersionId: versionId,
      sourceChunkId: rule.sourceChunkId,
      statement: rule.statement,
      embeddingModel: configuration.embedding.model,
    }));
    stagedRuleIds = vectorRecords.map((record) => record.id);
    await relationStore.upsertRecords(vectorRecords);

    const { error } = await supabase.rpc('replace_knowledge_rule_extraction', {
      p_owner_id: ownerId,
      p_rule_document_id: documentId,
      p_rule_version_id: versionId,
      p_rules: extracted.rules.map((rule) => persistableRule(rule, preservedEnabled)) as unknown as Json,
      p_bindings: bindings as unknown as Json,
      p_warning: warning,
      p_source_mode: sourceMode,
      p_manual_content: sourceMode === 'manual' ? options.manualContent ?? null : null,
      p_document_title: options.documentTitle ?? null,
      p_document_source_type: options.documentSourceType ?? null,
      p_preserve_rule_enabled: preserveExisting,
    });
    if (error) throw new Error('검증된 규칙과 의미 유사도 바인딩을 저장하지 못했습니다.');
    try {
      await relationStore.deleteByRuleIds(ownerId, existingRules.map((rule) => rule.id));
    } catch (cleanupError) {
      console.error('Failed to clean replaced relation vectors', cleanupError);
    }
    stagedRuleIds = [];
    return { ruleCount: extracted.rules.length, bindingCount: bindings.length, warning };
  } catch (error) {
    try {
      await relationStore.deleteByRuleIds(ownerId, stagedRuleIds);
    } catch (cleanupError) {
      console.error('Failed to clean staged relation vectors after rule processing failure', cleanupError);
    }
    if (!preserveExisting) await markRuleDocumentFailed(supabase, ownerId, documentId, error);
    throw error;
  }
}

type StoredRule = Pick<TablesInsert<'knowledge_rules'>, 'id' | 'statement'> & {
  id: string;
  statement: string;
};

export async function refreshBindingsForKnowledgeDocument(
  supabase: AdminClient,
  ownerId: string,
  documentId: string,
) {
  const { data: storedRules, error: rulesError } = await supabase
    .from('knowledge_rules')
    .select('id,statement,rule_documents!inner(enabled,extraction_status)')
    .eq('owner_id', ownerId)
    .eq('enabled', true)
    .eq('rule_documents.enabled', true)
    .eq('rule_documents.extraction_status', 'ready');
  if (rulesError) throw new Error('활성 규칙을 조회하지 못했습니다.');
  const rules = storedRules as unknown as StoredRule[];

  const { error: deleteError } = await supabase
    .from('knowledge_rule_bindings')
    .delete()
    .eq('owner_id', ownerId)
    .eq('document_id', documentId);
  if (deleteError) throw new Error('이전 규칙 바인딩을 정리하지 못했습니다.');
  if (!rules.length) return { bindingCount: 0 };

  const shapedRules = rules.map((rule, ordinal): ValidatedExtractedRule => ({
    id: rule.id,
    ordinal,
    sourceChunkId: '',
    statement: rule.statement,
    evidenceQuote: '',
    confidence: 1,
    evidenceStartOffset: 0,
    evidenceEndOffset: 1,
    extractionModel: '',
    extractionVersion: '',
  }));
  const bindings = await buildBindings(supabase, ownerId, shapedRules, [documentId]);
  if (bindings.length) {
    const rows: TablesInsert<'knowledge_rule_bindings'>[] = bindings.map((binding) => ({
      ...binding,
      owner_id: ownerId,
    }));
    const { error: insertError } = await supabase.from('knowledge_rule_bindings').insert(rows);
    if (insertError) throw new Error('증분 규칙 바인딩을 저장하지 못했습니다.');
  }
  return { bindingCount: bindings.length };
}

export async function rebuildAllSemanticRuleBindings(supabase: AdminClient) {
  const { data: storedRules, error } = await supabase
    .from('knowledge_rules')
    .select('id,owner_id,rule_document_id,rule_version_id,source_chunk_id,ordinal,statement');
  if (error) throw new Error('재색인할 비즈니스 규칙을 조회하지 못했습니다.');
  const rulesByOwner = new Map<string, typeof storedRules>();
  for (const rule of storedRules) {
    rulesByOwner.set(rule.owner_id, [...(rulesByOwner.get(rule.owner_id) ?? []), rule]);
  }

  const configuration = getProviderConfiguration();
  const relationStore = getQdrantRelationVectorStore();
  await relationStore.ensureCollection(configuration.embedding.dimensions);
  let bindingCount = 0;
  for (const [ownerId, ownerRules] of rulesByOwner) {
    const shapedRules = ownerRules.map((rule): ValidatedExtractedRule => ({
      id: rule.id,
      ordinal: rule.ordinal,
      sourceChunkId: rule.source_chunk_id,
      statement: rule.statement,
      evidenceQuote: rule.statement,
      evidenceStartOffset: 0,
      evidenceEndOffset: Math.max(rule.statement.length, 1),
      confidence: 1,
      extractionModel: configuration.embedding.model,
      extractionVersion: RULE_EXTRACTION_VERSION,
    }));
    const bindings = await buildBindings(supabase, ownerId, shapedRules);
    const { error: deleteError } = await supabase
      .from('knowledge_rule_bindings')
      .delete()
      .eq('owner_id', ownerId);
    if (deleteError) throw new Error('기존 의미 바인딩을 정리하지 못했습니다.');
    if (bindings.length) {
      const rows: TablesInsert<'knowledge_rule_bindings'>[] = bindings.map((binding) => ({
        ...binding,
        owner_id: ownerId,
      }));
      const { error: insertError } = await supabase.from('knowledge_rule_bindings').insert(rows);
      if (insertError) throw new Error('새 의미 바인딩을 저장하지 못했습니다.');
    }
    await relationStore.upsertRecords(ownerRules.map((rule) => ({
      id: rule.id,
      ownerId,
      ruleDocumentId: rule.rule_document_id,
      ruleVersionId: rule.rule_version_id,
      sourceChunkId: rule.source_chunk_id,
      statement: rule.statement,
      embeddingModel: configuration.embedding.model,
    })));
    bindingCount += bindings.length;
  }
  return { ownerCount: rulesByOwner.size, ruleCount: storedRules.length, bindingCount };
}
