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
  error?: string | null;
  submittedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

const API_BASE = process.env.NEXT_PUBLIC_SAGEUM_API_URL ?? 'http://127.0.0.1:4000';

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
