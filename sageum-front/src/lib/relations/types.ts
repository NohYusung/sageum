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
};

export type RelationAwareSearchResult = {
  evidence: SourceReference[];
  appliedRules: AppliedRuleReference[];
  relationMode: 'expanded' | 'content-only' | 'fallback';
};

export type KnowledgeGraphNode = {
  id: string;
  title: string;
  sourceType: string;
  folderId: string | null;
  relationCount: number;
  position: { x: number; y: number };
};

export type KnowledgeGraphRuleDetail = AppliedRuleReference & {
  evidenceQuote: string;
  confidence: number;
  bindings: KnowledgeRuleBinding[];
};

export type KnowledgeGraphEdge = {
  id: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  label: string;
  score: number;
  rules: KnowledgeGraphRuleDetail[];
};

export type KnowledgeGraph = {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  truncated: boolean;
};
