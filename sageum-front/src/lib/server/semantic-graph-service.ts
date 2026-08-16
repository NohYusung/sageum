import type { SupabaseClient } from '@supabase/supabase-js';
import {
  aggregateSemanticLinkCandidates,
  selectSemanticRepresentativeChunks,
  semanticContentHash,
  semanticNodeId,
  semanticPairScoreFloor,
  semanticPointId,
  type SemanticNodeKind,
  type SemanticNodeSegment,
} from '@/lib/semantic-graph/model';
import type { Database, Json } from '@/lib/supabase/database.types';
import { getProviderConfiguration } from './env';
import { getQdrantSemanticNodeVectorStore } from './semantic-node-vector-store';

type AdminClient = SupabaseClient<Database>;

type SemanticNodeDraft = {
  id: string;
  ownerId: string;
  kind: SemanticNodeKind;
  documentId?: string;
  ruleId?: string;
  ruleDocumentId?: string;
  versionId: string;
  contentHash: string;
  segments: SemanticNodeSegment[];
};

function semanticLinkScoreThreshold() {
  const configured = Number.parseFloat(
    process.env.QDRANT_SEMANTIC_LINK_SCORE_THRESHOLD?.trim() ?? '0.35',
  );
  return Number.isFinite(configured) && configured >= 0 && configured <= 1
    ? configured
    : 0.35;
}

function headingPath(value: Json) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function nodeRow(node: SemanticNodeDraft, embeddingModel: string) {
  return {
    id: node.id,
    node_kind: node.kind,
    document_id: node.documentId ?? null,
    rule_id: node.ruleId ?? null,
    version_id: node.versionId,
    embedding_model: embeddingModel,
    content_hash: node.contentHash,
  };
}

async function replaceNodeGraph(
  supabase: AdminClient,
  node: SemanticNodeDraft,
  links: ReturnType<typeof aggregateSemanticLinkCandidates>,
  embeddingModel: string,
) {
  const { error } = await supabase.rpc('replace_knowledge_semantic_node_graph', {
    p_owner_id: node.ownerId,
    p_node: nodeRow(node, embeddingModel) as unknown as Json,
    p_links: links.map((link) => ({
      id: link.id,
      left_node_id: link.leftNodeId,
      right_node_id: link.rightNodeId,
      semantic_score: link.semanticScore,
      coverage_score: link.coverageScore,
      matched_pair_count: link.matchedPairCount,
      embedding_model: embeddingModel,
    })) as unknown as Json,
    p_evidence: links.flatMap((link) => link.evidence.map((evidence) => ({
      id: evidence.id,
      link_id: evidence.linkId,
      left_chunk_id: evidence.leftChunkId,
      right_chunk_id: evidence.rightChunkId,
      pair_score: evidence.pairScore,
      ordinal: evidence.ordinal,
    }))) as unknown as Json,
  });
  if (error) throw new Error(`공통 의미 링크를 저장하지 못했습니다: ${error.message}`);
}

async function replaceSemanticNodes(supabase: AdminClient, nodes: SemanticNodeDraft[]) {
  if (!nodes.length) return { nodeCount: 0, linkCount: 0 };
  const configuration = getProviderConfiguration();
  const store = getQdrantSemanticNodeVectorStore();
  await store.ensureCollection(configuration.embedding.dimensions);

  for (const node of nodes) {
    await store.replaceNode(node.segments, node.ruleDocumentId);
    await replaceNodeGraph(supabase, node, [], configuration.embedding.model);
  }

  let linkCount = 0;
  for (const node of nodes) {
    const matches = await store.querySimilarSegments(
      node.segments,
      semanticPairScoreFloor(semanticLinkScoreThreshold()),
    );
    const targetIds = [...new Set(matches.map((match) => match.targetNodeId).filter(Boolean))];
    let allowedTargetIds = new Set<string>();
    if (targetIds.length) {
      const { data, error } = await supabase
        .from('knowledge_semantic_nodes')
        .select('id')
        .eq('owner_id', node.ownerId)
        .in('id', targetIds);
      if (error) throw new Error('의미 링크 대상 노드를 검증하지 못했습니다.');
      allowedTargetIds = new Set(data.map((target) => target.id));
    }
    const links = aggregateSemanticLinkCandidates(
      node.id,
      node.segments.length,
      configuration.embedding.model,
      matches.filter((match) => allowedTargetIds.has(match.targetNodeId)),
      semanticLinkScoreThreshold(),
    );
    await replaceNodeGraph(supabase, node, links, configuration.embedding.model);
    linkCount += links.length;
  }
  return { nodeCount: nodes.length, linkCount };
}

export async function refreshKnowledgeDocumentSemanticNode(
  supabase: AdminClient,
  ownerId: string,
  documentId: string,
) {
  const configuration = getProviderConfiguration();
  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id,title,latest_version_id')
    .eq('id', documentId)
    .eq('owner_id', ownerId)
    .eq('document_kind', 'knowledge')
    .eq('deletion_status', 'active')
    .maybeSingle();
  if (documentError || !document?.latest_version_id) {
    throw new Error('공통 의미 노드로 만들 최신 일반 문서를 찾지 못했습니다.');
  }
  const { data: chunks, error: chunksError } = await supabase
    .from('document_chunks')
    .select('id,text,ordinal,heading_path')
    .eq('owner_id', ownerId)
    .eq('version_id', document.latest_version_id)
    .order('ordinal');
  if (chunksError) throw new Error('공통 의미 노드의 문서 청크를 조회하지 못했습니다.');
  const representative = selectSemanticRepresentativeChunks(chunks.map((chunk) => ({
    id: chunk.id,
    text: chunk.text,
    ordinal: chunk.ordinal,
    headingPath: headingPath(chunk.heading_path),
  })));
  if (!representative.length) return { nodeCount: 0, linkCount: 0 };
  const nodeId = semanticNodeId('document', documentId);
  const segments: SemanticNodeSegment[] = representative.map((chunk) => ({
    ...chunk,
    headingPath: [document.title, ...chunk.headingPath],
    pointId: semanticPointId(nodeId, chunk.id),
    ownerId,
    nodeId,
    nodeKind: 'document',
    documentId,
    versionId: document.latest_version_id!,
    embeddingModel: configuration.embedding.model,
    segmentCount: representative.length,
  }));
  return replaceSemanticNodes(supabase, [{
    id: nodeId,
    ownerId,
    kind: 'document',
    documentId,
    versionId: document.latest_version_id,
    contentHash: semanticContentHash(representative),
    segments,
  }]);
}

export async function refreshRuleDocumentSemanticNodes(
  supabase: AdminClient,
  ownerId: string,
  ruleDocumentId: string,
) {
  const configuration = getProviderConfiguration();
  const { data: rules, error } = await supabase
    .from('knowledge_rules')
    .select('id,statement,source_chunk_id,rule_version_id')
    .eq('owner_id', ownerId)
    .eq('rule_document_id', ruleDocumentId)
    .order('ordinal');
  if (error) throw new Error('공통 의미 노드로 만들 규칙을 조회하지 못했습니다.');
  const store = getQdrantSemanticNodeVectorStore();
  await store.deleteByRuleDocument(ownerId, ruleDocumentId);
  const nodes: SemanticNodeDraft[] = rules.map((rule) => {
    const nodeId = semanticNodeId('rule', rule.id);
    const chunk = {
      id: rule.source_chunk_id,
      text: rule.statement,
      ordinal: 0,
      headingPath: [] as string[],
    };
    const segment: SemanticNodeSegment = {
      ...chunk,
      pointId: semanticPointId(nodeId, chunk.id),
      ownerId,
      nodeId,
      nodeKind: 'rule',
      ruleId: rule.id,
      versionId: rule.rule_version_id,
      embeddingModel: configuration.embedding.model,
      segmentCount: 1,
    };
    return {
      id: nodeId,
      ownerId,
      kind: 'rule',
      ruleId: rule.id,
      ruleDocumentId,
      versionId: rule.rule_version_id,
      contentHash: semanticContentHash([chunk]),
      segments: [segment],
    };
  });
  return replaceSemanticNodes(supabase, nodes);
}

export async function removeSemanticVectorsForDocument(
  ownerId: string,
  documentId: string,
  documentKind: 'knowledge' | 'rule',
) {
  const store = getQdrantSemanticNodeVectorStore();
  if (documentKind === 'rule') await store.deleteByRuleDocument(ownerId, documentId);
  else await store.deleteByDocument(ownerId, documentId);
}

export async function rebuildAllSemanticGraph(supabase: AdminClient) {
  const [documentsResult, ruleDocumentsResult] = await Promise.all([
    supabase
      .from('documents')
      .select('id,owner_id')
      .eq('document_kind', 'knowledge')
      .eq('deletion_status', 'active')
      .not('latest_version_id', 'is', null),
    supabase
      .from('rule_documents')
      .select('document_id,owner_id')
      .eq('extraction_status', 'ready'),
  ]);
  if (documentsResult.error || ruleDocumentsResult.error) {
    throw new Error('공통 의미 그래프 전체 재색인 대상을 조회하지 못했습니다.');
  }
  const owners = new Set([
    ...documentsResult.data.map((document) => document.owner_id),
    ...ruleDocumentsResult.data.map((document) => document.owner_id),
  ]);
  let nodeCount = 0;
  let linkCount = 0;
  for (const ownerId of owners) {
    const ownerDocuments = documentsResult.data.filter((document) => document.owner_id === ownerId);
    const ownerRuleDocuments = ruleDocumentsResult.data.filter((document) => document.owner_id === ownerId);
    for (const document of ownerDocuments) {
      const result = await refreshKnowledgeDocumentSemanticNode(supabase, ownerId, document.id);
      nodeCount += result.nodeCount;
      linkCount += result.linkCount;
    }
    for (const document of ownerRuleDocuments) {
      const result = await refreshRuleDocumentSemanticNodes(supabase, ownerId, document.document_id);
      nodeCount += result.nodeCount;
      linkCount += result.linkCount;
    }
    // First pass creates every node. A second pass makes early nodes consider nodes created later.
    for (const document of ownerDocuments) {
      await refreshKnowledgeDocumentSemanticNode(supabase, ownerId, document.id);
    }
    for (const document of ownerRuleDocuments) {
      await refreshRuleDocumentSemanticNodes(supabase, ownerId, document.document_id);
    }
  }
  return { ownerCount: owners.size, nodeCount, linkCount };
}
