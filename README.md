# Sageum Agent

- Sageum Agent는 학습 topic을 받아 curriculum을 생성하는 backend worker이다.
- 현재 유지되는 표면은 다음으로 제한한다.
  - HTTP job worker
  - Codex OAuth runtime client
  - web search
  - web page extraction
  - curriculum JSON generation
  - Markdown/HTML rendering
  - backend callback delivery

## Runtime Shape

- 백엔드는 durable job table과 S3 저장을 담당한다.
- Sageum Agent는 active job 실행만 담당한다.
- `POST /jobs`는 즉시 `202 Accepted`를 반환한다.
- 작업 결과는 `callbackUrl`로 전송한다.

## Configuration

- `SAGEUM_AGENT_HOST`: HTTP bind host, default `127.0.0.1`.
- `SAGEUM_AGENT_PORT`: HTTP bind port, default `4123`.
- `SAGEUM_CODEX_MODEL`: Codex model.
- `SAGEUM_CODEX_BASE_URL`: Codex backend URL, default `https://chatgpt.com/backend-api/codex`.
- `SAGEUM_CODEX_ACCESS_TOKEN`: optional direct access token override.
- `SAGEUM_CODEX_AUTH_FILE`: optional Sageum auth store path, default `~/.sageum-agent/auth.json`.
- `CODEX_HOME`: optional Codex CLI home, default `~/.codex`.
- `SAGEUM_SEARXNG_URL`: optional SearXNG base URL.
- `BRAVE_SEARCH_API_KEY`: optional Brave Search API key.

## Commands

```bash
sageum-agent serve
sageum-agent validate-job < job.json
sageum-agent run-job < job.json
sageum-agent render < curriculum.json
sageum-agent codex-auth-status
```

## Job Payload

```json
{
  "jobId": "job_123",
  "topic": "vector databases",
  "callbackUrl": "https://api.example.com/agent/jobs/job_123/callback",
  "forceRefresh": false
}
```

## Result Payload

```json
{
  "jobId": "job_123",
  "status": "completed",
  "cacheHit": false,
  "markdown": "# ...",
  "html": "<article class=\"sageum-curriculum\">...</article>",
  "sources": [],
  "error": null
}
```
