import type { SupabaseClient } from '@supabase/supabase-js';
import { descendantFolderIds } from '@/lib/folders/tree';
import type {
  AppliedRuleReference,
  KnowledgeGraph,
  KnowledgeGraphEdge,
  KnowledgeGraphRuleDetail,
  KnowledgeRule,
  KnowledgeRuleBinding,
  RuleDocumentSummary,
} from '@/lib/relations/types';
import type { Database } from '@/lib/supabase/database.types';
import { dagre } from '@/lib/server/dagre';

type RepositoryClient = SupabaseClient<Database>;

type RuleRow = Database['public']['Tables']['knowledge_rules']['Row'];
type BindingRow = Database['public']['Tables']['knowledge_rule_bindings']['Row'];

const GRAPH_NODE_WIDTH = 220;
const GRAPH_NODE_HEIGHT = 74;

function layoutGraphNodes(
  nodes: Array<Omit<KnowledgeGraph['nodes'][number], 'position'>>,
  edges: KnowledgeGraphEdge[],
): KnowledgeGraph['nodes'] {
  const connectedIds = new Set(edges.flatMap((edge) => [edge.sourceDocumentId, edge.targetDocumentId]));
  const connectedNodes = nodes.filter((node) => connectedIds.has(node.id));
  const isolatedNodes = nodes.filter((node) => !connectedIds.has(node.id));
  const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'LR', nodesep: 38, ranksep: 90, marginx: 30, marginy: 30 });
  for (const node of connectedNodes) {
    layout.setNode(node.id, { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT });
  }
  for (const edge of edges) layout.setEdge(edge.sourceDocumentId, edge.targetDocumentId);
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
  };
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
  const { data: bindings, error: bindingsError } = ruleIds.length
    ? await supabase.from('knowledge_rule_bindings').select('*').eq('owner_id', ownerId).in('rule_id', ruleIds)
    : { data: [], error: null };
  if (bindingsError) throw new Error('규칙 바인딩을 조회하지 못했습니다.');
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
  const rulesByDocument = new Map<string, KnowledgeRule[]>();
  for (const rule of rules) {
    const documentTitle = documents.find((document) => document.id === rule.rule_document_id)?.title
      ?? '비즈니스 규칙';
    rulesByDocument.set(rule.rule_document_id, [
      ...(rulesByDocument.get(rule.rule_document_id) ?? []),
      mapRule(rule, documentTitle, bindingByRule.get(rule.id) ?? []),
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
  const truncatedNodes = documents.length > 250;
  const visibleDocuments = documents.slice(0, 250);
  const visibleDocumentIds = new Set(visibleDocuments.map((document) => document.id));
  if (!visibleDocuments.length) return { nodes: [], edges: [], truncated: truncatedNodes };

  const { data: rules, error: rulesError } = await supabase
    .from('knowledge_rules')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('enabled', true);
  if (rulesError) throw new Error('그래프 규칙을 조회하지 못했습니다.');
  const ruleDocumentIds = [...new Set(rules.map((rule) => rule.rule_document_id))];
  const { data: ruleDocuments, error: ruleDocumentsError } = ruleDocumentIds.length
    ? await supabase
      .from('rule_documents')
      .select('document_id')
      .eq('owner_id', ownerId)
      .eq('enabled', true)
      .eq('extraction_status', 'ready')
      .in('document_id', ruleDocumentIds)
    : { data: [], error: null };
  if (ruleDocumentsError) throw new Error('그래프 규칙 문서 상태를 조회하지 못했습니다.');
  const activeRuleDocumentIds = new Set(ruleDocuments.map((document) => document.document_id));
  const activeRules = rules.filter((rule) => activeRuleDocumentIds.has(rule.rule_document_id));
  const ruleIds = activeRules.map((rule) => rule.id);
  const { data: bindings, error: bindingsError } = ruleIds.length
    ? await supabase
      .from('knowledge_rule_bindings')
      .select('*')
      .eq('owner_id', ownerId)
      .in('rule_id', ruleIds)
      .in('document_id', [...visibleDocumentIds])
    : { data: [], error: null };
  if (bindingsError) throw new Error('그래프 의미 유사도 바인딩을 조회하지 못했습니다.');
  const { data: ruleSourceDocuments, error: ruleSourceDocumentsError } = ruleDocumentIds.length
    ? await supabase.from('documents').select('id,title').eq('owner_id', ownerId).in('id', ruleDocumentIds)
    : { data: [], error: null };
  if (ruleSourceDocumentsError) throw new Error('규칙 문서 제목을 조회하지 못했습니다.');
  const titleById = new Map([
    ...visibleDocuments.map((document) => [document.id, document.title] as const),
    ...ruleSourceDocuments.map((document) => [document.id, document.title] as const),
  ]);
  const bindingsByRule = new Map<string, KnowledgeRuleBinding[]>();
  for (const binding of bindings) {
    bindingsByRule.set(binding.rule_id, [
      ...(bindingsByRule.get(binding.rule_id) ?? []),
      mapBinding(binding, titleById),
    ]);
  }

  const edgeRules = new Map<string, Map<string, KnowledgeGraphRuleDetail>>();
  for (const rule of activeRules) {
    const ruleBindings = bindingsByRule.get(rule.id) ?? [];
    const bindingsByDocument = new Map<string, KnowledgeRuleBinding[]>();
    for (const binding of ruleBindings) {
      if (!visibleDocumentIds.has(binding.documentId)) continue;
      bindingsByDocument.set(binding.documentId, [
        ...(bindingsByDocument.get(binding.documentId) ?? []),
        binding,
      ]);
    }
    const documentIds = [...bindingsByDocument.keys()].sort();
    for (let leftIndex = 0; leftIndex < documentIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < documentIds.length; rightIndex += 1) {
        const sourceDocumentId = documentIds[leftIndex];
        const targetDocumentId = documentIds[rightIndex];
        const pairBindings = [
          ...(bindingsByDocument.get(sourceDocumentId) ?? []),
          ...(bindingsByDocument.get(targetDocumentId) ?? []),
        ];
        const key = `${sourceDocumentId}:${targetDocumentId}`;
        const byRule = edgeRules.get(key) ?? new Map<string, KnowledgeGraphRuleDetail>();
        const applied: AppliedRuleReference = {
          ruleId: rule.id,
          ruleDocumentId: rule.rule_document_id,
          ruleDocumentTitle: titleById.get(rule.rule_document_id) ?? '비즈니스 규칙',
          sourceChunkId: rule.source_chunk_id,
          statement: rule.statement,
          score: Math.min(
            Math.max(...(bindingsByDocument.get(sourceDocumentId) ?? []).map((binding) => binding.vectorScore)),
            Math.max(...(bindingsByDocument.get(targetDocumentId) ?? []).map((binding) => binding.vectorScore)),
          ),
          bindingDocumentIds: [sourceDocumentId, targetDocumentId],
        };
        byRule.set(rule.id, {
          ...applied,
          evidenceQuote: rule.evidence_quote,
          confidence: rule.confidence,
          bindings: pairBindings,
        });
        edgeRules.set(key, byRule);
      }
    }
  }

  const edges: KnowledgeGraphEdge[] = [...edgeRules.entries()].slice(0, 1_000).map(([key, byRule]) => {
    const [sourceDocumentId, targetDocumentId] = key.split(':');
    const edgeRuleList = [...byRule.values()];
    const first = edgeRuleList[0];
    return {
      id: key,
      sourceDocumentId,
      targetDocumentId,
      label: `${first.statement}${edgeRuleList.length > 1 ? ` +${edgeRuleList.length - 1}` : ''}`,
      score: Math.max(...edgeRuleList.map((rule) => rule.score)),
      rules: edgeRuleList,
    };
  });
  const relationCounts = new Map<string, number>();
  for (const edge of edges) {
    relationCounts.set(edge.sourceDocumentId, (relationCounts.get(edge.sourceDocumentId) ?? 0) + 1);
    relationCounts.set(edge.targetDocumentId, (relationCounts.get(edge.targetDocumentId) ?? 0) + 1);
  }
  const nodes = visibleDocuments.map((document) => ({
      id: document.id,
      title: document.title,
      sourceType: document.source_type,
      folderId: document.folder_id,
      relationCount: relationCounts.get(document.id) ?? 0,
    }));
  return {
    nodes: layoutGraphNodes(nodes, edges),
    edges,
    truncated: truncatedNodes || edgeRules.size > 1_000,
  };
}
