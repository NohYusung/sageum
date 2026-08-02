export type AgentJobStatus = 'queued' | 'submitted' | 'running' | 'completed' | 'failed';

export type CreateAgentJobRequest = {
  topic: string;
  level: string;
  format: string;
  forceRefresh?: boolean;
};

export type AgentSource = {
  title?: string;
  url?: string;
  domain?: string;
  snippet?: string;
  [key: string]: unknown;
};

export type AgentSemanticMetadata = {
  obsidianFrontmatter?: Record<string, unknown> | null;
  concepts?: Array<Record<string, unknown>>;
  mentions?: Array<Record<string, unknown>>;
  relations?: Array<Record<string, unknown>>;
  sourceLinks?: AgentSource[];
  suggestedFilename?: string | null;
};

export type AgentJob = {
  id: string;
  topic: string;
  level: string;
  format: string;
  status: AgentJobStatus;
  callbackUrl?: string | null;
  markdown?: string | null;
  html?: string | null;
  sources?: AgentSource[] | null;
  search?: unknown;
  extract?: unknown;
  rawResult?: unknown;
  semanticMetadata?: AgentSemanticMetadata | null;
  error?: string | null;
  submittedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SaveToVaultRequest = {
  jobId?: string;
  title: string;
  markdown: string;
  concepts?: Array<Record<string, unknown>>;
  mentions?: Array<Record<string, unknown>>;
  relations?: Array<Record<string, unknown>>;
  sources?: AgentSource[];
  options?: {
    createConceptNotes?: boolean;
    overwrite?: boolean;
    targetFolder?: string;
  };
};

export type SaveToVaultResult = {
  documentId: string;
  path: string;
  createdConcepts: string[];
  sidecars: string[];
  index?: VaultIndexStatus;
};

export type VaultIndexStatus = {
  documentCount: number;
  conceptCount: number;
  relationCount: number;
  blockCount: number;
  indexedAt: string | null;
  indexPath: string;
};

export type VaultSearchResult = {
  type: 'block' | 'document' | 'concept';
  documentTitle: string;
  path: string;
  heading: string;
  snippet: string;
  score: number;
};

export type VaultSearchResponse = {
  query: string;
  matchedConcepts: Array<{
    id: string;
    name: string;
    matchedBy: 'alias' | 'name';
    alias?: string;
  }>;
  expandedConcepts: string[];
  results: VaultSearchResult[];
};

export type RelationReviewResult = {
  relationId: string;
  documentId: string;
  status: 'candidate' | 'approved' | 'rejected' | 'stale';
  sidecarPath: string;
};

const API_BASE = process.env.NEXT_PUBLIC_SAGEUM_API_URL ?? 'http://localhost:4000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function createAgentJob(payload: CreateAgentJobRequest) {
  return request<AgentJob>('/agent/jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getAgentJob(jobId: string) {
  return request<AgentJob>(`/agent/jobs/${encodeURIComponent(jobId)}`);
}

export function saveToVault(payload: SaveToVaultRequest) {
  return request<SaveToVaultResult>('/vault/documents', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function indexVault() {
  return request<VaultIndexStatus>('/vault/index', {
    method: 'POST',
  });
}

export function searchVault(query: string) {
  return request<VaultSearchResponse>(`/vault/search?q=${encodeURIComponent(query)}`);
}

export function approveVaultRelation(relationId: string) {
  return request<RelationReviewResult>(`/vault/relations/${encodeURIComponent(relationId)}/approve`, {
    method: 'POST',
  });
}

export function rejectVaultRelation(relationId: string) {
  return request<RelationReviewResult>(`/vault/relations/${encodeURIComponent(relationId)}/reject`, {
    method: 'POST',
  });
}
