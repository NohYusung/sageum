'use client';

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from '@xyflow/react';
import { ChevronRight, FileText, LoaderCircle, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  type KnowledgeGraph,
  type KnowledgeGraphEdge,
} from '@/lib/relations/types';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 74;

function layoutGraph(graph: KnowledgeGraph) {
  const nodes: Node[] = graph.nodes.map((node) => {
    return {
      id: node.id,
      position: node.position,
      data: {
        label: (
          <div className="knowledge-graph-node">
            <FileText size={16} />
            <span><strong>{node.title}</strong><small>{node.sourceType.toUpperCase()} · 관계 {node.relationCount}</small></span>
          </div>
        ),
      },
      style: { width: NODE_WIDTH, minHeight: NODE_HEIGHT },
    };
  });
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceDocumentId,
    target: edge.targetDocumentId,
    label: edge.label,
    data: edge,
    type: 'smoothstep',
  }));
  return { nodes, edges };
}

export function KnowledgeGraphView({
  folderId,
  documentQuery,
  onOpenDocument,
  onOpenEvidence,
}: {
  folderId: string | null;
  documentQuery: string;
  onOpenDocument: (documentId: string) => void;
  onOpenEvidence: (documentId: string, chunkId: string) => void | Promise<void>;
}) {
  const [graph, setGraph] = useState<KnowledgeGraph>({ nodes: [], edges: [], truncated: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const laidOut = useMemo(() => layoutGraph(graph), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState(laidOut.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(laidOut.edges);

  useEffect(() => {
    setNodes(laidOut.nodes);
    setEdges(laidOut.edges);
  }, [laidOut, setEdges, setNodes]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const params = new URLSearchParams();
    if (folderId) params.set('folderId', folderId);
    if (documentQuery.trim()) params.set('query', documentQuery.trim());
    setLoading(true);
    setError(null);
    fetch(`/api/knowledge-graph?${params.toString()}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as { graph?: KnowledgeGraph; error?: string };
        if (!response.ok || !payload.graph) throw new Error(payload.error ?? '그래프를 불러오지 못했습니다.');
        if (active) {
          setGraph(payload.graph);
          setSelectedEdgeId(null);
        }
      })
      .catch((found) => {
        if (found instanceof DOMException && found.name === 'AbortError') return;
        if (active) setError(found instanceof Error ? found.message : '그래프를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [documentQuery, folderId]);

  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  return (
    <div className="knowledge-graph-shell">
      <div className="knowledge-graph-toolbar">
        <div><strong>문서 관계 그래프</strong><small>같은 규칙 벡터에 의미적으로 연결된 문서를 표시합니다.</small></div>
      </div>
      {graph.truncated ? <p className="knowledge-graph-warning">그래프 표시 한도를 초과했습니다. 폴더·문서명 필터를 사용해 범위를 줄여 주세요.</p> : null}
      <div className="knowledge-graph-canvas">
        {loading ? <div className="knowledge-graph-state"><LoaderCircle className="spin" /><span>관계를 배치하고 있습니다.</span></div> : null}
        {error ? <div className="knowledge-graph-state error">{error}</div> : null}
        {!loading && !error && !nodes.length ? <div className="knowledge-graph-state">표시할 문서가 없습니다.</div> : null}
        {!error && nodes.length ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_event, node) => onOpenDocument(node.id)}
            onEdgeClick={(_event, edge) => setSelectedEdgeId(edge.id)}
            fitView
            minZoom={0.2}
            maxZoom={1.8}
          >
            <Background gap={18} size={1} />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        ) : null}
      </div>
      {selectedEdge ? (
        <GraphEdgeDetails edge={selectedEdge} onClose={() => setSelectedEdgeId(null)} onOpenEvidence={onOpenEvidence} />
      ) : null}
    </div>
  );
}

function GraphEdgeDetails({
  edge,
  onClose,
  onOpenEvidence,
}: {
  edge: KnowledgeGraphEdge;
  onClose: () => void;
  onOpenEvidence: (documentId: string, chunkId: string) => void | Promise<void>;
}) {
  return (
    <aside className="knowledge-graph-details">
      <header><div><span>RELATION DETAIL</span><strong>{edge.label}</strong></div><button type="button" onClick={onClose} aria-label="관계 상세 닫기"><X size={17} /></button></header>
      {edge.rules.map((rule) => (
        <article key={rule.ruleId}>
          <p>{rule.statement}</p>
          <button type="button" onClick={() => void onOpenEvidence(rule.ruleDocumentId, rule.sourceChunkId)}>
            규칙 원문 · {rule.ruleDocumentTitle} <ChevronRight size={13} />
          </button>
          <dl>
            <div><dt>유사 문서 청크</dt><dd>{rule.bindings.map((binding) => (
              <button key={binding.id} type="button" onClick={() => void onOpenEvidence(binding.documentId, binding.chunkId)}>
                {binding.documentTitle}: “{binding.chunkText}” <ChevronRight size={12} />
              </button>
            ))}</dd></div>
            <div><dt>점수</dt><dd>{rule.score.toFixed(3)}</dd></div>
          </dl>
        </article>
      ))}
    </aside>
  );
}
