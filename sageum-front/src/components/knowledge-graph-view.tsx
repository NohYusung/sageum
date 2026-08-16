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
import { Bot, ChevronRight, FileText, LoaderCircle, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  type KnowledgeGraph,
  type KnowledgeGraphEdge,
  type KnowledgeGraphRuleNode,
} from '@/lib/relations/types';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 74;

function layoutGraph(graph: KnowledgeGraph) {
  const nodes: Node[] = graph.nodes.map((node) => ({
    id: node.id,
    position: node.position,
    data: {
      kind: node.kind,
      label: node.kind === 'document' ? (
        <div className="knowledge-graph-node document">
          <FileText size={16} />
          <span><strong>{node.title}</strong><small>{node.sourceType.toUpperCase()} · 연결 {node.relationCount}</small></span>
        </div>
      ) : (
        <div className="knowledge-graph-node rule">
          <Bot size={16} />
          <span><strong>{node.statement}</strong><small>비즈니스 규칙 · 연결 {node.relationCount}</small></span>
        </div>
      ),
    },
    className: `knowledge-graph-${node.kind}-node`,
    style: { width: NODE_WIDTH, minHeight: NODE_HEIGHT },
  }));
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: edge.kind === 'semantic-link'
      ? edge.pairKind === 'document-document'
        ? '문서 의미 연결'
        : edge.pairKind === 'rule-document'
          ? '규칙·문서 의미 연결'
          : '규칙 의미 연결'
      : edge.kind === 'rule-rule' ? '규칙 연결' : '문서 앵커',
    data: edge,
    type: 'smoothstep',
    className: edge.kind === 'semantic-link'
      ? `knowledge-graph-semantic-${edge.pairKind}-edge`
      : `knowledge-graph-${edge.kind}-edge`,
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
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState({
    'document-document': true,
    'rule-document': true,
    'rule-rule': true,
    isolated: true,
  });
  const filteredGraph = useMemo((): KnowledgeGraph => {
    const filteredEdges = graph.edges.filter((edge) => edge.kind !== 'semantic-link' || visibility[edge.pairKind]);
    if (visibility.isolated) return { ...graph, edges: filteredEdges };
    const connected = new Set(filteredEdges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]));
    return { ...graph, nodes: graph.nodes.filter((node) => connected.has(node.id)), edges: filteredEdges };
  }, [graph, visibility]);
  const laidOut = useMemo(() => layoutGraph(filteredGraph), [filteredGraph]);
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
          setSelectedRuleId(null);
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
  const selectedRule = graph.nodes.find((node): node is KnowledgeGraphRuleNode => (
    node.kind === 'rule' && node.ruleId === selectedRuleId
  )) ?? null;
  const selectedRuleEdges = selectedRule
    ? graph.edges.filter((edge) => (
      edge.kind === 'semantic-link'
        ? edge.sourceNodeId === selectedRule.id || edge.targetNodeId === selectedRule.id
        : edge.kind === 'rule-rule'
        ? edge.sourceRuleId === selectedRule.ruleId || edge.targetRuleId === selectedRule.ruleId
        : edge.ruleId === selectedRule.ruleId
    ))
    : [];
  return (
    <div className="knowledge-graph-shell">
      <div className="knowledge-graph-toolbar">
        <div><strong>통합 의미 관계 그래프</strong><small>문서와 규칙의 의미 유사도 연결 및 고립 노드를 함께 표시합니다.</small></div>
        <div className="knowledge-graph-toggles" aria-label="그래프 연결 표시 필터">
          {([
            ['document-document', '문서↔문서'],
            ['rule-document', '규칙↔문서'],
            ['rule-rule', '규칙↔규칙'],
            ['isolated', '고립 노드'],
          ] as const).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={visibility[key]}
                onChange={(event) => setVisibility((current) => ({ ...current, [key]: event.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>
      {graph.truncated ? <p className="knowledge-graph-warning">그래프 표시 한도를 초과했습니다. 폴더·문서명 필터를 사용해 범위를 줄여 주세요.</p> : null}
      <div className="knowledge-graph-canvas">
        {loading ? <div className="knowledge-graph-state"><LoaderCircle className="spin" /><span>관계를 배치하고 있습니다.</span></div> : null}
        {error ? <div className="knowledge-graph-state error">{error}</div> : null}
        {!loading && !error && !nodes.length ? <div className="knowledge-graph-state">표시할 문서와 규칙이 없습니다.</div> : null}
        {!error && nodes.length ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_event, node) => {
              const graphNode = graph.nodes.find((candidate) => candidate.id === node.id);
              if (!graphNode) return;
              setSelectedEdgeId(null);
              if (graphNode.kind === 'document') {
                setSelectedRuleId(null);
                onOpenDocument(graphNode.documentId);
              } else {
                setSelectedRuleId(graphNode.ruleId);
              }
            }}
            onEdgeClick={(_event, edge) => {
              setSelectedRuleId(null);
              setSelectedEdgeId(edge.id);
            }}
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
      {selectedRule ? (
        <GraphRuleDetails
          rule={selectedRule}
          edges={selectedRuleEdges}
          onClose={() => setSelectedRuleId(null)}
          onOpenEvidence={onOpenEvidence}
        />
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
      <header>
        <div><span>SEMANTIC LINK DETAIL</span><strong>{edge.kind === 'semantic-link' ? ({
          'document-document': '문서 ↔ 문서',
          'rule-document': '규칙 ↔ 문서',
          'rule-rule': '규칙 ↔ 규칙',
        } as const)[edge.pairKind] : edge.kind === 'rule-rule' ? '규칙 ↔ 규칙' : '규칙 ↔ 문서'}</strong></div>
        <button type="button" onClick={onClose} aria-label="관계 상세 닫기"><X size={17} /></button>
      </header>
      {edge.kind === 'semantic-link' ? (
        <article>
          <dl>
            <div><dt>최종 의미 점수</dt><dd>{edge.score.toFixed(3)}</dd></div>
            <div><dt>커버리지</dt><dd>{edge.coverageScore.toFixed(3)}</dd></div>
            <div><dt>대표 청크 쌍</dt><dd>{edge.matchedPairCount}개</dd></div>
          </dl>
          {edge.evidence.map((evidence) => (
            <div className="knowledge-graph-evidence-pair" key={evidence.id}>
              <button type="button" onClick={() => void onOpenEvidence(evidence.leftDocumentId, evidence.leftChunkId)}>
                {evidence.leftDocumentTitle} 원문 <ChevronRight size={13} />
              </button>
              <p>“{evidence.leftText}”</p>
              <button type="button" onClick={() => void onOpenEvidence(evidence.rightDocumentId, evidence.rightChunkId)}>
                {evidence.rightDocumentTitle} 원문 <ChevronRight size={13} />
              </button>
              <p>“{evidence.rightText}”</p>
              <small>청크 쌍 점수 {evidence.pairScore.toFixed(3)}</small>
            </div>
          ))}
        </article>
      ) : edge.kind === 'rule-rule' ? (
        <article>
          <p>{edge.sourceStatement}</p>
          <p>{edge.targetStatement}</p>
          <dl><div><dt>규칙 유사도</dt><dd>{edge.score.toFixed(3)}</dd></div></dl>
        </article>
      ) : (
        <article>
          <p>{edge.statement}</p>
          <button type="button" onClick={() => void onOpenEvidence(edge.anchor.documentId, edge.anchor.chunkId)}>
            앵커 원문 · {edge.documentTitle} <ChevronRight size={13} />
          </button>
          <dl>
            <div><dt>연결을 증명한 청크</dt><dd>“{edge.anchor.chunkText}”</dd></div>
            <div><dt>유사도</dt><dd>{edge.score.toFixed(3)}</dd></div>
          </dl>
        </article>
      )}
    </aside>
  );
}

function GraphRuleDetails({
  rule,
  edges,
  onClose,
  onOpenEvidence,
}: {
  rule: KnowledgeGraphRuleNode;
  edges: KnowledgeGraphEdge[];
  onClose: () => void;
  onOpenEvidence: (documentId: string, chunkId: string) => void | Promise<void>;
}) {
  return (
    <aside className="knowledge-graph-details">
      <header>
        <div><span>RULE DETAIL</span><strong>{rule.statement}</strong></div>
        <button type="button" onClick={onClose} aria-label="규칙 상세 닫기"><X size={17} /></button>
      </header>
      <article>
        <button type="button" onClick={() => void onOpenEvidence(rule.ruleDocumentId, rule.sourceChunkId)}>
          규칙 원문 · {rule.ruleDocumentTitle} <ChevronRight size={13} />
        </button>
        <dl>
          <div><dt>의미 연결</dt><dd>{edges.length}개</dd></div>
          <div><dt>독립 규칙</dt><dd>{edges.length ? '아니오' : '예'}</dd></div>
        </dl>
      </article>
    </aside>
  );
}
