import type { SupabaseClient } from '@supabase/supabase-js';
import { descendantFolderIds } from '@/lib/folders/tree';
import { selectOneHopRuleGraph } from '@/lib/relations/graph';
import type {
  KnowledgeGraph,
  KnowledgeGraphEdge,
  KnowledgeRule,
  KnowledgeRuleBinding,
  KnowledgeRuleLink,
  RuleDocumentSummary,
} from '@/lib/relations/types';
import type { Database } from '@/lib/supabase/database.types';
import { dagre } from '@/lib/server/dagre';

type RepositoryClient = SupabaseClient<Database>;

type RuleRow = Database['public']['Tables']['knowledge_rules']['Row'];
type BindingRow = Database['public']['Tables']['knowledge_rule_bindings']['Row'];
type LinkRow = Database['public']['Tables']['knowledge_rule_links']['Row'];

const GRAPH_NODE_WIDTH = 220;
const GRAPH_NODE_HEIGHT = 74;

type WithoutPosition<T> = T extends unknown ? Omit<T, 'position'> : never;
type UnpositionedGraphNode = WithoutPosition<KnowledgeGraph['nodes'][number]>;

function layoutGraphNodes(
  nodes: UnpositionedGraphNode[],
  edges: KnowledgeGraphEdge[],
): KnowledgeGraph['nodes'] {
  const connectedIds = new Set(edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]));
  const connectedNodes = nodes.filter((node) => connectedIds.has(node.id));
  const isolatedNodes = nodes.filter((node) => !connectedIds.has(node.id));
  const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'LR', nodesep: 38, ranksep: 90, marginx: 30, marginy: 30 });
  for (const node of connectedNodes) {
    layout.setNode(node.id, { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT });
  }
  for (const edge of edges) layout.setEdge(edge.sourceNodeId, edge.targetNodeId);
  dagre.layout(layout);
  const connected = connectedNodes.map((node) => {
    const position = layout.node(node.id);
    return {
      ...node,
      position: {
        x: position.x - GRAPH_NODE_WIDTH / 2,
        y: position.y - GRAPH_NODE_HEIGHT / 2,
      },
    };
  });
  const connectedBottom = connected.reduce(
    (bottom, node) => Math.max(bottom, node.position.y + GRAPH_NODE_HEIGHT),
    0,
  );
  const gridColumns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(isolatedNodes.length))));
  const isolatedTop = connected.length ? connectedBottom + 90 : 30;
  const isolated = isolatedNodes.map((node, index) => ({
    ...node,
    position: {
      x: 30 + (index % gridColumns) * (GRAPH_NODE_WIDTH + 42),
      y: isolatedTop + Math.floor(index / gridColumns) * (GRAPH_NODE_HEIGHT + 34),
    },
  }));
  return [...connected, ...isolated];
}

function mapBinding(
  row: BindingRow,
  documentTitleById: Map<string, string>,
): KnowledgeRuleBinding {
  return {
    id: row.id,
    ruleId: row.rule_id,
    documentId: row.document_id,
    versionId: row.version_id,
    chunkId: row.chunk_id,
    documentTitle: documentTitleById.get(row.document_id) ?? '문서',
    chunkText: row.chunk_text,
    vectorScore: row.vector_score,
  };
}

function mapRule(
  row: RuleRow,
  ruleDocumentTitle: string,
  bindings: KnowledgeRuleBinding[],
  links: KnowledgeRuleLink[],
  reachableDocumentCount: number,
): KnowledgeRule {
  return {
    id: row.id,
    ruleDocumentId: row.rule_document_id,
    ruleVersionId: row.rule_version_id,
    ruleDocumentTitle,
    sourceChunkId: row.source_chunk_id,
    ordinal: row.ordinal,
    statement: row.statement,
    evidenceQuote: row.evidence_quote,
    evidenceStartOffset: row.evidence_start_offset,
    evidenceEndOffset: row.evidence_end_offset,
    confidence: row.confidence,
    enabled: row.enabled,
    bindings,
    links,
    reachableDocumentCount,
  };
}

async function loadSemanticRuleRelations(
  supabase: RepositoryClient,
  ownerId: string,
  rules: RuleRow[],
  ruleDocumentTitles: Map<string, string>,
) {
  const ruleIds = new Set(rules.map((rule) => rule.id));
  const [{ data: nodes, error: nodesError }, { data: links, error: linksError }] = await Promise.all([
    supabase.from('knowledge_semantic_nodes').select('*').eq('owner_id', ownerId),
    supabase.from('knowledge_semantic_links').select('*').eq('owner_id', ownerId),
  ]);
  if (nodesError || linksError) throw new Error('공통 의미 규칙 연결을 조회하지 못했습니다.');
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ruleNodeByRuleId = new Map(nodes.flatMap((node) => (
    node.node_kind === 'rule' && node.rule_id && ruleIds.has(node.rule_id)
      ? [[node.rule_id, node] as const]
      : []
  )));
  const relevantLinks = links.filter((link) => {
    const left = nodeById.get(link.left_node_id);
    const right = nodeById.get(link.right_node_id);
    return Boolean(left?.rule_id && ruleIds.has(left.rule_id) || right?.rule_id && ruleIds.has(right.rule_id));
  });
  const linkIds = relevantLinks.map((link) => link.id);
  const { data: evidence, error: evidenceError } = linkIds.length
    ? await supabase.from('knowledge_semantic_link_evidence').select('*').eq('owner_id', ownerId).in('link_id', linkIds).order('ordinal')
    : { data: [], error: null };
  if (evidenceError) throw new Error('공통 의미 규칙 연결 근거를 조회하지 못했습니다.');
  const chunkIds = [...new Set(evidence.flatMap((row) => [row.left_chunk_id, row.right_chunk_id]))];
  const { data: chunks, error: chunksError } = chunkIds.length
    ? await supabase.from('document_chunks').select('id,document_id,version_id,text').eq('owner_id', ownerId).in('id', chunkIds)
    : { data: [], error: null };
  if (chunksError) throw new Error('공통 의미 규칙 연결 청크를 조회하지 못했습니다.');
  const documentIds = [...new Set(nodes.flatMap((node) => node.document_id ? [node.document_id] : []))];
  const { data: knowledgeDocuments, error: documentsError } = documentIds.length
    ? await supabase.from('documents').select('id,title').eq('owner_id', ownerId).in('id', documentIds)
    : { data: [], error: null };
  if (documentsError) throw new Error('공통 의미 연결 문서 제목을 조회하지 못했습니다.');
  const titleByDocument = new Map(knowledgeDocuments.map((document) => [document.id, document.title]));
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const evidenceByLink = new Map<string, typeof evidence>();
  evidence.forEach((row) => evidenceByLink.set(row.link_id, [...(evidenceByLink.get(row.link_id) ?? []), row]));
  const bindingsByRule = new Map<string, KnowledgeRuleBinding[]>();
  const linksByRule = new Map<string, KnowledgeRuleLink[]>();
  const directDocumentsByRule = new Map<string, Set<string>>();
  for (const link of relevantLinks) {
    const left = nodeById.get(link.left_node_id);
    const right = nodeById.get(link.right_node_id);
    if (!left || !right) continue;
    for (const [ruleNode, targetNode] of [[left, right], [right, left]] as const) {
      if (ruleNode.node_kind !== 'rule' || !ruleNode.rule_id || !ruleIds.has(ruleNode.rule_id)) continue;
      if (targetNode.node_kind === 'document' && targetNode.document_id) {
        const linkEvidence = (evidenceByLink.get(link.id) ?? [])[0];
        const targetChunkId = targetNode.id === link.left_node_id
          ? linkEvidence?.left_chunk_id
          : linkEvidence?.right_chunk_id;
        const targetChunk = targetChunkId ? chunkById.get(targetChunkId) : null;
        if (!targetChunk) continue;
        bindingsByRule.set(ruleNode.rule_id, [...(bindingsByRule.get(ruleNode.rule_id) ?? []), {
          id: link.id,
          ruleId: ruleNode.rule_id,
          documentId: targetNode.document_id,
          versionId: targetChunk.version_id,
          chunkId: targetChunk.id,
          documentTitle: titleByDocument.get(targetNode.document_id) ?? '문서',
          chunkText: targetChunk.text,
          vectorScore: link.semantic_score,
        }]);
        const documents = directDocumentsByRule.get(ruleNode.rule_id) ?? new Set<string>();
        documents.add(targetNode.document_id);
        directDocumentsByRule.set(ruleNode.rule_id, documents);
      } else if (targetNode.node_kind === 'rule' && targetNode.rule_id && ruleIds.has(targetNode.rule_id)) {
        const linked = rules.find((rule) => rule.id === targetNode.rule_id);
        if (!linked) continue;
        linksByRule.set(ruleNode.rule_id, [...(linksByRule.get(ruleNode.rule_id) ?? []), {
          id: link.id,
          ruleId: ruleNode.rule_id,
          linkedRuleId: linked.id,
          linkedRuleDocumentId: linked.rule_document_id,
          linkedRuleDocumentTitle: ruleDocumentTitles.get(linked.rule_document_id) ?? '비즈니스 규칙',
          linkedSourceChunkId: linked.source_chunk_id,
          linkedStatement: linked.statement,
          vectorScore: link.semantic_score,
        }]);
      }
    }
  }
  const reachableByRule = new Map<string, number>();
  linksByRule.forEach((linked, ruleId) => {
    const reached = new Set<string>();
    linked.forEach((link) => directDocumentsByRule.get(link.linkedRuleId)?.forEach((id) => reached.add(id)));
    reachableByRule.set(ruleId, reached.size);
  });
  return { ruleNodeByRuleId, bindingsByRule, linksByRule, reachableByRule };
}

export async function listRuleDocuments(
  supabase: RepositoryClient,
  ownerId: string,
): Promise<RuleDocumentSummary[]> {
  const { data: documents, error: documentsError } = await supabase
    .from('documents')
    .select('id,title,source_type,latest_version_id,created_at,updated_at')
    .eq('owner_id', ownerId)
    .eq('document_kind', 'rule')
    .eq('deletion_status', 'active')
    .order('updated_at', { ascending: false });
  if (documentsError) throw new Error('규칙 문서 목록을 조회하지 못했습니다.');
  if (!documents.length) return [];
  const documentIds = documents.map((document) => document.id);
  const versionIds = documents.flatMap((document) => (
    document.latest_version_id ? [document.latest_version_id] : []
  ));
  const [ruleDocumentsResult, rulesResult, versionsResult, ingestionJobsResult] = await Promise.all([
    supabase.from('rule_documents').select('*').eq('owner_id', ownerId).in('document_id', documentIds),
    supabase.from('knowledge_rules').select('*').eq('owner_id', ownerId).in('rule_document_id', documentIds).order('ordinal'),
    versionIds.length
      ? supabase.from('document_versions').select('id,original_filename,size_bytes').eq('owner_id', ownerId).in('id', versionIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('document_ingestion_jobs')
      .select('id,document_id,version_id,status,original_available,last_error,created_at')
      .eq('owner_id', ownerId)
      .eq('document_kind', 'rule')
      .in('document_id', documentIds)
      .order('created_at', { ascending: false }),
  ]);
  if (
    ruleDocumentsResult.error || rulesResult.error || versionsResult.error
    || ingestionJobsResult.error
  ) {
    throw new Error('규칙 추출 결과를 조회하지 못했습니다.');
  }
  const rules = rulesResult.data;
  const ruleIds = rules.map((rule) => rule.id);
  const [bindingsResult, leftLinksResult, rightLinksResult] = ruleIds.length
    ? await Promise.all([
      supabase.from('knowledge_rule_bindings').select('*').eq('owner_id', ownerId).in('rule_id', ruleIds),
      supabase.from('knowledge_rule_links').select('*').eq('owner_id', ownerId).in('left_rule_id', ruleIds),
      supabase.from('knowledge_rule_links').select('*').eq('owner_id', ownerId).in('right_rule_id', ruleIds),
    ])
    : [
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ];
  if (bindingsResult.error || leftLinksResult.error || rightLinksResult.error) {
    throw new Error('규칙의 문서 앵커와 규칙 연결을 조회하지 못했습니다.');
  }
  const bindings = bindingsResult.data;
  const linksById = new Map<string, LinkRow>();
  [...leftLinksResult.data, ...rightLinksResult.data].forEach((link) => linksById.set(link.id, link));
  const links = [...linksById.values()];
  const boundDocumentIds = [...new Set(bindings.map((binding) => binding.document_id))];
  const { data: boundDocuments, error: boundDocumentsError } = boundDocumentIds.length
    ? await supabase.from('documents').select('id,title').eq('owner_id', ownerId).in('id', boundDocumentIds)
    : { data: [], error: null };
  if (boundDocumentsError) throw new Error('바인딩 문서 이름을 조회하지 못했습니다.');

  const extractionByDocument = new Map(ruleDocumentsResult.data.map((row) => [row.document_id, row]));
  const versionById = new Map(versionsResult.data.map((row) => [row.id, row]));
  const ingestionByDocument = new Map<string, typeof ingestionJobsResult.data[number]>();
  for (const job of ingestionJobsResult.data) {
    if (job.document_id && !ingestionByDocument.has(job.document_id)) {
      ingestionByDocument.set(job.document_id, job);
    }
  }
  const documentTitleById = new Map(boundDocuments.map((row) => [row.id, row.title]));
  const bindingByRule = new Map<string, KnowledgeRuleBinding[]>();
  for (const binding of bindings) {
    bindingByRule.set(binding.rule_id, [
      ...(bindingByRule.get(binding.rule_id) ?? []),
      mapBinding(binding, documentTitleById),
    ]);
  }
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const sourceRuleDocumentTitleById = new Map(documents.map((document) => [document.id, document.title]));
  const linksByRule = new Map<string, KnowledgeRuleLink[]>();
  const reachableDocumentsByRule = new Map<string, Set<string>>();
  for (const link of links) {
    for (const [ruleId, linkedRuleId] of [
      [link.left_rule_id, link.right_rule_id],
      [link.right_rule_id, link.left_rule_id],
    ] as const) {
      const linkedRule = ruleById.get(linkedRuleId);
      if (!linkedRule) continue;
      linksByRule.set(ruleId, [
        ...(linksByRule.get(ruleId) ?? []),
        {
          id: link.id,
          ruleId,
          linkedRuleId,
          linkedRuleDocumentId: linkedRule.rule_document_id,
          linkedRuleDocumentTitle: sourceRuleDocumentTitleById.get(linkedRule.rule_document_id)
            ?? '비즈니스 규칙',
          linkedSourceChunkId: linkedRule.source_chunk_id,
          linkedStatement: linkedRule.statement,
          vectorScore: link.vector_score,
        },
      ]);
      const reachable = reachableDocumentsByRule.get(ruleId) ?? new Set<string>();
      (bindingByRule.get(linkedRuleId) ?? []).forEach((binding) => reachable.add(binding.documentId));
      reachableDocumentsByRule.set(ruleId, reachable);
    }
  }
  const semanticRelations = await loadSemanticRuleRelations(
    supabase,
    ownerId,
    rules,
    sourceRuleDocumentTitleById,
  );
  const rulesByDocument = new Map<string, KnowledgeRule[]>();
  for (const rule of rules) {
    const documentTitle = documents.find((document) => document.id === rule.rule_document_id)?.title
      ?? '비즈니스 규칙';
    rulesByDocument.set(rule.rule_document_id, [
      ...(rulesByDocument.get(rule.rule_document_id) ?? []),
      mapRule(
        rule,
        documentTitle,
        semanticRelations.ruleNodeByRuleId.has(rule.id)
          ? semanticRelations.bindingsByRule.get(rule.id) ?? []
          : bindingByRule.get(rule.id) ?? [],
        (semanticRelations.ruleNodeByRuleId.has(rule.id)
          ? semanticRelations.linksByRule.get(rule.id) ?? []
          : linksByRule.get(rule.id) ?? []).sort((left, right) => right.vectorScore - left.vectorScore),
        semanticRelations.ruleNodeByRuleId.has(rule.id)
          ? semanticRelations.reachableByRule.get(rule.id) ?? 0
          : reachableDocumentsByRule.get(rule.id)?.size ?? 0,
      ),
    ]);
  }
  return documents.map((document) => {
    const extraction = extractionByDocument.get(document.id);
    const version = document.latest_version_id ? versionById.get(document.latest_version_id) : null;
    const ingestion = ingestionByDocument.get(document.id);
    const sourceMode = extraction?.source_mode === 'manual' ? 'manual' : 'upload';
    const pendingRevision = sourceMode === 'manual'
      && Boolean(document.latest_version_id)
      && ingestion?.version_id !== document.latest_version_id
      ? ingestion
      : null;
    return {
      documentId: document.id,
      versionId: document.latest_version_id,
      ingestionJobId: ingestion?.id ?? null,
      originalAvailable: ingestion?.original_available ?? false,
      title: document.title,
      originalFilename: version?.original_filename ?? null,
      sourceType: document.source_type,
      sourceMode,
      manualContent: sourceMode === 'manual' ? extraction?.manual_content ?? null : null,
      ...(pendingRevision?.status === 'failed'
        ? {
          pendingRevisionStatus: 'failed' as const,
          pendingRevisionError: pendingRevision.last_error,
        }
        : pendingRevision && ['queued', 'uploading', 'processing'].includes(pendingRevision.status)
          ? {
            pendingRevisionStatus: 'processing' as const,
            pendingRevisionError: null,
          }
          : {}),
      sizeBytes: version?.size_bytes ?? 0,
      enabled: extraction?.enabled ?? true,
      extractionStatus: extraction?.extraction_status === 'ready'
        ? 'ready'
        : extraction?.extraction_status === 'failed'
          ? 'failed'
          : 'processing',
      extractionError: extraction?.extraction_error ?? null,
      extractionWarning: extraction?.extraction_warning ?? null,
      extractedAt: extraction?.extracted_at ?? null,
      createdAt: document.created_at,
      updatedAt: document.updated_at,
      rules: rulesByDocument.get(document.id) ?? [],
    };
  });
}

async function graphFolderDocumentIds(
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

export async function getKnowledgeGraph(
  supabase: RepositoryClient,
  ownerId: string,
  options: { folderId?: string; documentQuery?: string } = {},
): Promise<KnowledgeGraph> {
  const folderIds = options.folderId
    ? await graphFolderDocumentIds(supabase, ownerId, options.folderId)
    : null;
  let documentQuery = supabase
    .from('documents')
    .select('id,title,source_type,folder_id')
    .eq('owner_id', ownerId)
    .eq('document_kind', 'knowledge')
    .eq('deletion_status', 'active')
    .order('title', { ascending: true });
  if (folderIds) documentQuery = documentQuery.in('folder_id', [...folderIds]);
  if (options.documentQuery?.trim()) {
    documentQuery = documentQuery.ilike('title', `%${options.documentQuery.trim().replaceAll('%', '\\%')}%`);
  }
  const { data: documents, error: documentsError } = await documentQuery.limit(251);
  if (documentsError) throw new Error('그래프 문서를 조회하지 못했습니다.');
  const truncatedDocuments = documents.length > 250;
  const visibleDocuments = documents.slice(0, 250);
  const visibleDocumentIds = new Set(visibleDocuments.map((document) => document.id));
  if (!visibleDocuments.length) return { nodes: [], edges: [], truncated: truncatedDocuments };

  const [{ data: rules, error: rulesError }, { data: ruleDocuments, error: ruleDocumentsError }] = await Promise.all([
    supabase.from('knowledge_rules').select('*').eq('owner_id', ownerId).eq('enabled', true),
    supabase
      .from('rule_documents')
      .select('document_id')
      .eq('owner_id', ownerId)
      .eq('enabled', true)
      .eq('extraction_status', 'ready'),
  ]);
  if (rulesError || ruleDocumentsError) throw new Error('그래프 규칙을 조회하지 못했습니다.');
  const activeRuleDocumentIds = new Set(ruleDocuments.map((document) => document.document_id));
  const activeRules = rules.filter((rule) => activeRuleDocumentIds.has(rule.rule_document_id));
  const activeRuleIds = activeRules.map((rule) => rule.id);
  const [bindingsResult, linksResult] = activeRuleIds.length
    ? await Promise.all([
      supabase
        .from('knowledge_rule_bindings')
        .select('*')
        .eq('owner_id', ownerId)
        .in('rule_id', activeRuleIds)
        .in('document_id', [...visibleDocumentIds]),
      supabase
        .from('knowledge_rule_links')
        .select('*')
        .eq('owner_id', ownerId),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (bindingsResult.error || linksResult.error) {
    throw new Error('그래프의 규칙 연결과 문서 앵커를 조회하지 못했습니다.');
  }
  const bindings = bindingsResult.data;
  const directlyVisibleRuleIds = new Set(bindings.map((binding) => binding.rule_id));
  const { includedRuleIds, visibleLinks } = selectOneHopRuleGraph(
    linksResult.data,
    directlyVisibleRuleIds,
  );
  const includedRules = activeRules.filter((rule) => includedRuleIds.has(rule.id));
  const ruleDocumentIds = [...new Set(includedRules.map((rule) => rule.rule_document_id))];
  const { data: ruleSourceDocuments, error: ruleSourceDocumentsError } = ruleDocumentIds.length
    ? await supabase.from('documents').select('id,title').eq('owner_id', ownerId).in('id', ruleDocumentIds)
    : { data: [], error: null };
  if (ruleSourceDocumentsError) throw new Error('규칙 문서 제목을 조회하지 못했습니다.');
  const titleById = new Map([
    ...visibleDocuments.map((document) => [document.id, document.title] as const),
    ...ruleSourceDocuments.map((document) => [document.id, document.title] as const),
  ]);
  const ruleById = new Map(includedRules.map((rule) => [rule.id, rule]));
  const allEdges: KnowledgeGraphEdge[] = [
    ...bindings.flatMap((binding): KnowledgeGraphEdge[] => {
      const rule = ruleById.get(binding.rule_id);
      if (!rule) return [];
      return [{
        id: `rule-document:${binding.id}`,
        kind: 'rule-document',
        sourceNodeId: `rule:${rule.id}`,
        targetNodeId: `document:${binding.document_id}`,
        ruleId: rule.id,
        ruleDocumentId: rule.rule_document_id,
        ruleDocumentTitle: titleById.get(rule.rule_document_id) ?? '비즈니스 규칙',
        statement: rule.statement,
        documentId: binding.document_id,
        documentTitle: titleById.get(binding.document_id) ?? '문서',
        score: binding.vector_score,
        anchor: mapBinding(binding, titleById),
      }];
    }),
    ...visibleLinks.flatMap((link): KnowledgeGraphEdge[] => {
      const leftRule = ruleById.get(link.left_rule_id);
      const rightRule = ruleById.get(link.right_rule_id);
      if (!leftRule || !rightRule) return [];
      return [{
        id: `rule-rule:${link.id}`,
        kind: 'rule-rule',
        sourceNodeId: `rule:${leftRule.id}`,
        targetNodeId: `rule:${rightRule.id}`,
        sourceRuleId: leftRule.id,
        targetRuleId: rightRule.id,
        sourceStatement: leftRule.statement,
        targetStatement: rightRule.statement,
        score: link.vector_score,
      }];
    }),
  ];
  const relationCounts = new Map<string, number>();
  allEdges.forEach((edge) => {
    relationCounts.set(edge.sourceNodeId, (relationCounts.get(edge.sourceNodeId) ?? 0) + 1);
    relationCounts.set(edge.targetNodeId, (relationCounts.get(edge.targetNodeId) ?? 0) + 1);
  });
  const documentNodes = visibleDocuments.flatMap((document) => {
    const relationCount = relationCounts.get(`document:${document.id}`) ?? 0;
    if (!relationCount) return [];
    return [{
      id: `document:${document.id}`,
      kind: 'document' as const,
      documentId: document.id,
      title: document.title,
      sourceType: document.source_type,
      folderId: document.folder_id,
      relationCount,
    }];
  });
  const ruleNodes = includedRules.map((rule) => ({
    id: `rule:${rule.id}`,
    kind: 'rule' as const,
    ruleId: rule.id,
    ruleDocumentId: rule.rule_document_id,
    ruleDocumentTitle: titleById.get(rule.rule_document_id) ?? '비즈니스 규칙',
    sourceChunkId: rule.source_chunk_id,
    statement: rule.statement,
    relationCount: relationCounts.get(`rule:${rule.id}`) ?? 0,
  }));
  const combinedNodes = [...documentNodes, ...ruleNodes];
  const truncatedNodes = combinedNodes.length > 250;
  const limitedNodes = combinedNodes.slice(0, 250);
  const limitedNodeIds = new Set(limitedNodes.map((node) => node.id));
  const edges = allEdges.filter((edge) => (
    limitedNodeIds.has(edge.sourceNodeId) && limitedNodeIds.has(edge.targetNodeId)
  )).slice(0, 1_000);
  return {
    nodes: layoutGraphNodes(limitedNodes, edges),
    edges,
    truncated: truncatedDocuments || truncatedNodes || allEdges.length > 1_000,
  };
}
