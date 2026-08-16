import type { SourceReference } from '@/lib/rag/local-search';

export const DOCUMENT_KINDS = ['knowledge', 'rule'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type RuleDocumentSourceMode = 'upload' | 'manual';

export type KnowledgeRuleBinding = {
  id: string;
  ruleId: string;
  documentId: string;
  versionId: string;
  chunkId: string;
  documentTitle: string;
  chunkText: string;
  vectorScore: number;
};

export type KnowledgeRuleLink = {
  id: string;
  ruleId: string;
  linkedRuleId: string;
  linkedRuleDocumentId: string;
  linkedRuleDocumentTitle: string;
  linkedSourceChunkId: string;
  linkedStatement: string;
  vectorScore: number;
};

export type KnowledgeRule = {
  id: string;
  ruleDocumentId: string;
  ruleVersionId: string;
  ruleDocumentTitle: string;
  sourceChunkId: string;
  ordinal: number;
  statement: string;
  evidenceQuote: string;
  evidenceStartOffset: number;
  evidenceEndOffset: number;
  confidence: number;
  enabled: boolean;
  bindings: KnowledgeRuleBinding[];
  links: KnowledgeRuleLink[];
  reachableDocumentCount: number;
};

export type RuleDocumentSummary = {
  documentId: string;
  versionId: string | null;
  ingestionJobId: string | null;
  originalAvailable: boolean;
  title: string;
  originalFilename: string | null;
  sourceType: string;
  sourceMode: RuleDocumentSourceMode;
  manualContent: string | null;
  pendingRevisionStatus?: 'processing' | 'failed';
  pendingRevisionError?: string | null;
  sizeBytes: number;
  enabled: boolean;
  extractionStatus: 'processing' | 'ready' | 'failed';
  extractionError: string | null;
  extractionWarning: string | null;
  extractedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rules: KnowledgeRule[];
};

export type ManualRuleMutationResponse = {
  documentId: string;
  versionId: string;
  jobId: string;
  status: 'processing';
};

export type AppliedRuleReference = {
  ruleId: string;
  ruleDocumentId: string;
  ruleDocumentTitle: string;
  sourceChunkId: string;
  statement: string;
  score: number;
  bindingDocumentIds: string[];
  pathId: string;
  depth: 0 | 1;
  parentRuleId?: string;
};

export type AppliedSemanticNodeReference = {
  nodeId: string;
  nodeKind: 'document' | 'rule';
  documentId?: string;
  ruleId?: string;
};

export type AppliedSemanticLinkReference = {
  semanticLinkId: string;
  semanticPathId: string;
  depth: 1 | 2;
  score: number;
  coverageScore: number;
  leftNode: AppliedSemanticNodeReference;
  rightNode: AppliedSemanticNodeReference;
};

export type RelationAwareSearchResult = {
  evidence: SourceReference[];
  appliedRules: AppliedRuleReference[];
  appliedSemanticLinks?: AppliedSemanticLinkReference[];
  relationMode: 'expanded' | 'content-only' | 'fallback';
};

export type KnowledgeGraphDocumentNode = {
  id: string;
  kind: 'document';
  documentId: string;
  title: string;
  sourceType: string;
  folderId: string | null;
  relationCount: number;
  position: { x: number; y: number };
};

export type KnowledgeGraphRuleNode = {
  id: string;
  kind: 'rule';
  ruleId: string;
  ruleDocumentId: string;
  ruleDocumentTitle: string;
  sourceChunkId: string;
  statement: string;
  relationCount: number;
  position: { x: number; y: number };
};

export type KnowledgeGraphNode = KnowledgeGraphDocumentNode | KnowledgeGraphRuleNode;

export type KnowledgeGraphSemanticEvidence = {
  id: string;
  leftChunkId: string;
  rightChunkId: string;
  leftDocumentId: string;
  rightDocumentId: string;
  leftDocumentTitle: string;
  rightDocumentTitle: string;
  leftText: string;
  rightText: string;
  pairScore: number;
  ordinal: number;
};

export type KnowledgeGraphSemanticEdge = {
  id: string;
  kind: 'semantic-link';
  pairKind: 'document-document' | 'rule-document' | 'rule-rule';
  sourceNodeId: string;
  targetNodeId: string;
  score: number;
  coverageScore: number;
  matchedPairCount: number;
  evidence: KnowledgeGraphSemanticEvidence[];
};

/** @deprecated Read-only compatibility for pre-migration repository tests. */
export type KnowledgeGraphRuleRuleEdge = {
  id: string;
  kind: 'rule-rule';
  sourceNodeId: string;
  targetNodeId: string;
  sourceRuleId: string;
  targetRuleId: string;
  sourceStatement: string;
  targetStatement: string;
  score: number;
};

/** @deprecated Read-only compatibility for the rollback graph model. */
export type KnowledgeGraphRuleDocumentEdge = {
  id: string;
  kind: 'rule-document';
  sourceNodeId: string;
  targetNodeId: string;
  ruleId: string;
  ruleDocumentId: string;
  ruleDocumentTitle: string;
  statement: string;
  documentId: string;
  documentTitle: string;
  score: number;
  anchor: KnowledgeRuleBinding;
};

export type KnowledgeGraphEdge =
  | KnowledgeGraphSemanticEdge
  | KnowledgeGraphRuleRuleEdge
  | KnowledgeGraphRuleDocumentEdge;

export type KnowledgeGraph = {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  truncated: boolean;
};
