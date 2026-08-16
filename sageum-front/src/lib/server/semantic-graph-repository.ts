import type { SupabaseClient } from '@supabase/supabase-js';
import { descendantFolderIds } from '@/lib/folders/tree';
import type {
  KnowledgeGraph,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
} from '@/lib/relations/types';
import type { Database } from '@/lib/supabase/database.types';
import { dagre } from './dagre';

type RepositoryClient = SupabaseClient<Database>;
type SemanticNodeRow = Database['public']['Tables']['knowledge_semantic_nodes']['Row'];

const NODE_WIDTH = 220;
const NODE_HEIGHT = 74;

type WithoutPosition<T> = T extends unknown ? Omit<T, 'position'> : never;
type UnpositionedNode = WithoutPosition<KnowledgeGraphNode>;

function layoutNodes(nodes: UnpositionedNode[], edges: KnowledgeGraphEdge[]): KnowledgeGraphNode[] {
  const connectedIds = new Set(edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]));
  const connected = nodes.filter((node) => connectedIds.has(node.id));
  const isolated = nodes.filter((node) => !connectedIds.has(node.id));
  const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'LR', nodesep: 38, ranksep: 90, marginx: 30, marginy: 30 });
  connected.forEach((node) => layout.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((edge) => layout.setEdge(edge.sourceNodeId, edge.targetNodeId));
  dagre.layout(layout);
  const laidOut = connected.map((node) => {
    const position = layout.node(node.id);
    return {
      ...node,
      position: { x: position.x - NODE_WIDTH / 2, y: position.y - NODE_HEIGHT / 2 },
    };
  });
  const connectedBottom = laidOut.reduce(
    (bottom, node) => Math.max(bottom, node.position.y + NODE_HEIGHT),
    0,
  );
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(isolated.length))));
  const top = laidOut.length ? connectedBottom + 90 : 30;
  return [
    ...laidOut,
    ...isolated.map((node, index) => ({
      ...node,
      position: {
        x: 30 + (index % columns) * (NODE_WIDTH + 42),
        y: top + Math.floor(index / columns) * (NODE_HEIGHT + 34),
      },
    })),
  ];
}

async function scopedFolderIds(
  supabase: RepositoryClient,
  ownerId: string,
  folderId: string,
) {
  const { data, error } = await supabase
    .from('folders')
    .select('id,parent_id,name,sort_order,created_at,updated_at')
    .eq('owner_id', ownerId);
  if (error) throw new Error('그래프 폴더 범위를 조회하지 못했습니다.');
  const folders = data.map((folder) => ({
    id: folder.id,
    parentId: folder.parent_id,
    name: folder.name,
    sortOrder: folder.sort_order,
    createdAt: folder.created_at,
    updatedAt: folder.updated_at,
  }));
  if (!folders.some((folder) => folder.id === folderId)) {
    throw new Error('그래프 폴더를 찾을 수 없습니다.');
  }
  return descendantFolderIds(folders, folderId);
}

function graphNodeId(
  kind: 'document' | 'rule',
  sourceId: string,
  semanticBySource: Map<string, SemanticNodeRow>,
) {
  return semanticBySource.get(`${kind}:${sourceId}`)?.id ?? `${kind}:${sourceId}`;
}

export async function getSemanticKnowledgeGraph(
  supabase: RepositoryClient,
  ownerId: string,
  options: { folderId?: string; documentQuery?: string } = {},
): Promise<KnowledgeGraph> {
  const folderIds = options.folderId
    ? await scopedFolderIds(supabase, ownerId, options.folderId)
    : null;
  let documentsQuery = supabase
    .from('documents')
    .select('id,title,source_type,folder_id')
    .eq('owner_id', ownerId)
    .eq('document_kind', 'knowledge')
    .eq('deletion_status', 'active')
    .order('title');
  if (folderIds) documentsQuery = documentsQuery.in('folder_id', [...folderIds]);
  if (options.documentQuery?.trim()) {
    documentsQuery = documentsQuery.ilike(
      'title',
      `%${options.documentQuery.trim().replaceAll('%', '\\%')}%`,
    );
  }
  const [documentsResult, rulesResult, ruleDocumentsResult, semanticNodesResult, linksResult] = await Promise.all([
    documentsQuery.limit(251),
    supabase.from('knowledge_rules').select('*').eq('owner_id', ownerId).eq('enabled', true),
    supabase.from('rule_documents').select('document_id').eq('owner_id', ownerId).eq('enabled', true).eq('extraction_status', 'ready'),
    supabase.from('knowledge_semantic_nodes').select('*').eq('owner_id', ownerId),
    supabase.from('knowledge_semantic_links').select('*').eq('owner_id', ownerId).order('semantic_score', { ascending: false }).limit(1001),
  ]);
  if (
    documentsResult.error || rulesResult.error || ruleDocumentsResult.error
    || semanticNodesResult.error || linksResult.error
  ) throw new Error('통합 의미 그래프 데이터를 조회하지 못했습니다.');

  const documents = documentsResult.data.slice(0, 250);
  const activeRuleDocuments = new Set(ruleDocumentsResult.data.map((row) => row.document_id));
  const activeRules = rulesResult.data.filter((rule) => activeRuleDocuments.has(rule.rule_document_id));
  const semanticNodes = semanticNodesResult.data;
  const semanticBySource = new Map<string, SemanticNodeRow>();
  semanticNodes.forEach((node) => {
    if (node.node_kind === 'document' && node.document_id) {
      semanticBySource.set(`document:${node.document_id}`, node);
    } else if (node.node_kind === 'rule' && node.rule_id) {
      semanticBySource.set(`rule:${node.rule_id}`, node);
    }
  });
  const semanticById = new Map(semanticNodes.map((node) => [node.id, node]));
  const activeDocumentIds = new Set(documents.map((document) => document.id));
  const activeRuleIds = new Set(activeRules.map((rule) => rule.id));
  const scoped = Boolean(options.folderId || options.documentQuery?.trim());

  const eligibleLinks = linksResult.data.filter((link) => {
    const left = semanticById.get(link.left_node_id);
    const right = semanticById.get(link.right_node_id);
    if (!left || !right) return false;
    const active = (node: SemanticNodeRow) => node.node_kind === 'document'
      ? Boolean(node.document_id && activeDocumentIds.has(node.document_id))
      : Boolean(node.rule_id && activeRuleIds.has(node.rule_id));
    return active(left) && active(right);
  });

  const includedRuleIds = new Set<string>();
  if (!scoped) activeRules.forEach((rule) => includedRuleIds.add(rule.id));
  else {
    const visibleDocumentNodeIds = new Set(documents.flatMap((document) => {
      const node = semanticBySource.get(`document:${document.id}`);
      return node ? [node.id] : [];
    }));
    const directlyLinkedRuleNodeIds = new Set<string>();
    eligibleLinks.forEach((link) => {
      if (visibleDocumentNodeIds.has(link.left_node_id)) directlyLinkedRuleNodeIds.add(link.right_node_id);
      if (visibleDocumentNodeIds.has(link.right_node_id)) directlyLinkedRuleNodeIds.add(link.left_node_id);
    });
    const oneHopRuleNodeIds = new Set(directlyLinkedRuleNodeIds);
    eligibleLinks.forEach((link) => {
      if (directlyLinkedRuleNodeIds.has(link.left_node_id)) oneHopRuleNodeIds.add(link.right_node_id);
      if (directlyLinkedRuleNodeIds.has(link.right_node_id)) oneHopRuleNodeIds.add(link.left_node_id);
    });
    oneHopRuleNodeIds.forEach((nodeId) => {
      const node = semanticById.get(nodeId);
      if (node?.node_kind === 'rule' && node.rule_id && activeRuleIds.has(node.rule_id)) {
        includedRuleIds.add(node.rule_id);
      }
    });
  }

  const includedRules = activeRules.filter((rule) => includedRuleIds.has(rule.id));
  const includedSemanticNodeIds = new Set([
    ...documents.map((document) => graphNodeId('document', document.id, semanticBySource)),
    ...includedRules.map((rule) => graphNodeId('rule', rule.id, semanticBySource)),
  ]);
  const visibleLinks = eligibleLinks.filter((link) => (
    includedSemanticNodeIds.has(link.left_node_id)
    && includedSemanticNodeIds.has(link.right_node_id)
  )).slice(0, 1_000);
  const linkIds = visibleLinks.map((link) => link.id);
  const { data: evidenceRows, error: evidenceError } = linkIds.length
    ? await supabase
      .from('knowledge_semantic_link_evidence')
      .select('*')
      .eq('owner_id', ownerId)
      .in('link_id', linkIds)
      .order('ordinal')
    : { data: [], error: null };
  if (evidenceError) throw new Error('의미 링크의 대표 청크 근거를 조회하지 못했습니다.');
  const chunkIds = [...new Set(evidenceRows.flatMap((evidence) => [evidence.left_chunk_id, evidence.right_chunk_id]))];
  const { data: chunks, error: chunksError } = chunkIds.length
    ? await supabase.from('document_chunks').select('id,document_id,text').eq('owner_id', ownerId).in('id', chunkIds)
    : { data: [], error: null };
  if (chunksError) throw new Error('의미 링크의 원문 청크를 조회하지 못했습니다.');
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const sourceDocumentIds = [...new Set(includedRules.map((rule) => rule.rule_document_id))];
  const { data: sourceDocuments, error: sourceDocumentsError } = sourceDocumentIds.length
    ? await supabase.from('documents').select('id,title').eq('owner_id', ownerId).in('id', sourceDocumentIds)
    : { data: [], error: null };
  if (sourceDocumentsError) throw new Error('규칙 원문 제목을 조회하지 못했습니다.');
  const titleByDocumentId = new Map([
    ...documents.map((document) => [document.id, document.title] as const),
    ...sourceDocuments.map((document) => [document.id, document.title] as const),
  ]);
  const evidenceByLink = new Map<string, typeof evidenceRows>();
  evidenceRows.forEach((evidence) => evidenceByLink.set(evidence.link_id, [
    ...(evidenceByLink.get(evidence.link_id) ?? []),
    evidence,
  ]));
  const edges: KnowledgeGraphEdge[] = visibleLinks.map((link) => {
    const leftNode = semanticById.get(link.left_node_id)!;
    const rightNode = semanticById.get(link.right_node_id)!;
    const pairKind = leftNode.node_kind === rightNode.node_kind
      ? `${leftNode.node_kind}-${rightNode.node_kind}` as 'document-document' | 'rule-rule'
      : 'rule-document' as const;
    return {
      id: link.id,
      kind: 'semantic-link' as const,
      pairKind,
      sourceNodeId: link.left_node_id,
      targetNodeId: link.right_node_id,
      score: link.semantic_score,
      coverageScore: link.coverage_score,
      matchedPairCount: link.matched_pair_count,
      evidence: (evidenceByLink.get(link.id) ?? []).flatMap((evidence) => {
        const left = chunkById.get(evidence.left_chunk_id);
        const right = chunkById.get(evidence.right_chunk_id);
        if (!left || !right) return [];
        return [{
          id: evidence.id,
          leftChunkId: left.id,
          rightChunkId: right.id,
          leftDocumentId: left.document_id,
          rightDocumentId: right.document_id,
          leftDocumentTitle: titleByDocumentId.get(left.document_id) ?? '문서',
          rightDocumentTitle: titleByDocumentId.get(right.document_id) ?? '문서',
          leftText: left.text,
          rightText: right.text,
          pairScore: evidence.pair_score,
          ordinal: evidence.ordinal,
        }];
      }),
    };
  });
  const relationCounts = new Map<string, number>();
  edges.forEach((edge) => {
    relationCounts.set(edge.sourceNodeId, (relationCounts.get(edge.sourceNodeId) ?? 0) + 1);
    relationCounts.set(edge.targetNodeId, (relationCounts.get(edge.targetNodeId) ?? 0) + 1);
  });
  const unpositioned: UnpositionedNode[] = [
    ...documents.map((document) => {
      const id = graphNodeId('document', document.id, semanticBySource);
      return {
        id,
        kind: 'document' as const,
        documentId: document.id,
        title: document.title,
        sourceType: document.source_type,
        folderId: document.folder_id,
        relationCount: relationCounts.get(id) ?? 0,
      };
    }),
    ...includedRules.map((rule) => {
      const id = graphNodeId('rule', rule.id, semanticBySource);
      return {
        id,
        kind: 'rule' as const,
        ruleId: rule.id,
        ruleDocumentId: rule.rule_document_id,
        ruleDocumentTitle: titleByDocumentId.get(rule.rule_document_id) ?? '비즈니스 규칙',
        sourceChunkId: rule.source_chunk_id,
        statement: rule.statement,
        relationCount: relationCounts.get(id) ?? 0,
      };
    }),
  ];
  const truncatedNodes = unpositioned.length > 250;
  const limitedNodes = unpositioned.slice(0, 250);
  const limitedIds = new Set(limitedNodes.map((node) => node.id));
  const limitedEdges = edges.filter((edge) => (
    limitedIds.has(edge.sourceNodeId) && limitedIds.has(edge.targetNodeId)
  ));
  return {
    nodes: layoutNodes(limitedNodes, limitedEdges),
    edges: limitedEdges,
    truncated: documentsResult.data.length > 250 || truncatedNodes || linksResult.data.length > 1_000,
  };
}
