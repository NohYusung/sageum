import { Injectable } from '@nestjs/common';

export type SubmitSageumJobPayload = {
  jobId: string;
  topic: string;
  callbackUrl: string;
  forceRefresh?: boolean;
};

@Injectable()
export class SageumCliClient {
  private readonly baseUrl = process.env.SAGEUM_AGENT_URL ?? 'http://127.0.0.1:4123';
  private readonly timeoutMs = Number(process.env.SAGEUM_AGENT_TIMEOUT_MS ?? 15_000);

  async submitJob(payload: SubmitSageumJobPayload) {
    const url = new URL('/jobs', this.baseUrl);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Sageum agent returned HTTP ${response.status}: ${body}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }
}
