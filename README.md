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
- `SAGEUM_CODEX_MODEL`: Codex model. Defaults to `~/.codex/config.toml`'s `model`, then `gpt-5.5`.
- `SAGEUM_CODEX_MODEL_FALLBACKS`: comma-separated fallback list for ChatGPT-account Codex model gating.
- `SAGEUM_CODEX_BASE_URL`: Codex backend URL, default `https://chatgpt.com/backend-api/codex`.
- `SAGEUM_CODEX_ACCESS_TOKEN`: optional direct access token override.
- `SAGEUM_CODEX_AUTH_FILE`: optional Sageum auth store path, default `~/.sageum-agent/auth.json`.
- `CODEX_HOME`: optional Codex CLI home, default `~/.codex`.
- `SAGEUM_WEB_BACKEND`: optional web backend selector. Defaults to `duckduckgo`, a no-key DuckDuckGo HTML search with `r.jina.ai` fallback. Other values: `searxng`, `brave`, `tavily`, `exa`, or `none`.
- `SAGEUM_EXTRACT_READER`: page extraction mode. Defaults to `jina`, which reads pages through `r.jina.ai` first and falls back to direct fetch. Other values: `direct` or `auto`.
- `SAGEUM_SEARXNG_URL`: optional SearXNG base URL.
- `SAGEUM_BRAVE_SEARCH_API_KEY`: optional Brave Search API key.
- `SAGEUM_TAVILY_API_KEY`: optional Tavily Search API key.
- `SAGEUM_EXA_API_KEY`: optional Exa Search API key.

## Commands

```bash
sageum
sageum-agent serve
sageum-agent validate-job < job.json
sageum-agent run-job < job.json
sageum-agent render < curriculum.json
sageum-agent codex-auth-status
```

## Frontend and Backend

- `sageum-front/`: Next.js + React frontend. The UI implements the Sageum prototype as an app screen, not as an iframe.
- `sageum-back/`: NestJS + TypeScript + TypeORM backend. It owns the local durable job table and forwards work to `sageum-agent serve`.
- Default local ports:
  - frontend: `http://localhost:3000`
  - backend: `http://127.0.0.1:4000`
  - agent worker: `http://127.0.0.1:4123`

```bash
# terminal 1
sageum-agent serve

# terminal 2
cd sageum-back
npm install
npm run dev

# terminal 3
cd sageum-front
npm install
npm run dev
```

- Frontend calls `NEXT_PUBLIC_SAGEUM_API_URL`, default `http://127.0.0.1:4000`.
- Backend calls `SAGEUM_AGENT_URL`, default `http://127.0.0.1:4123`.
- Backend stores job rows in `../data/sageum-back.sqlite` by default.

## Interactive Session

```bash
sageum
```

- `sageum>` prompt에 학습 topic을 입력하면 검색, 추출, model 호출, render 단계가 순서대로 출력된다.
- 결과 Markdown은 터미널에 바로 표시된다.
- session 결과 JSON은 `data/local-sessions/`에 저장된다.
- `/status`, `/last`, `/help`, `/quit` 명령을 지원한다.

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
