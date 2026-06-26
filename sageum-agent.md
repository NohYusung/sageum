# Sageum Agent 목표

- 이 repo는 Hermes clone에서 출발했지만, 목표는 Hermes 범용 에이전트가 아니다.
- 목표는 Sageum 서비스에 필요한 curriculum generation worker만 남기는 것이다.
- 사용자는 학습하고 싶은 topic을 입력한다.
- 백엔드는 topic을 job으로 저장하고 Sageum Agent에 비동기 실행을 요청한다.
- Sageum Agent는 검색, 본문 추출, 구조화, Markdown/HTML 생성을 수행한 뒤 callback으로 결과를 보낸다.
- 백엔드는 callback 결과를 받아 S3 저장과 frontend delivery를 담당한다.

## 현재 유지 범위

- HTTP worker
- backend job contract
- Codex OAuth runtime client
- web search
- web page extraction
- curriculum JSON generation
- Markdown rendering
- HTML rendering
- callback delivery

## 제거 범위

- Hermes CLI
- Hermes gateway
- desktop/TUI/web UI
- cron
- memory
- skills
- plugin/MCP catalog
- terminal/browser/computer-use tools
- messaging adapters
- multi-provider setup wizard

## 요청 구조

- 백엔드는 `POST /jobs`로 job을 전달한다.
- agent는 요청을 받으면 `202 Accepted`를 즉시 반환한다.
- durable queue는 agent가 아니라 백엔드 job table이 담당한다.
- agent는 process-local active task만 관리한다.
- 작업 완료 또는 실패 시 `callbackUrl`로 결과 payload를 전송한다.

## Job Payload

```json
{
  "jobId": "job_123",
  "topic": "vector databases",
  "callbackUrl": "https://backend.example.com/agent/jobs/job_123/callback",
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

## AI Provider

- 기본 provider는 Codex OAuth이다.
- token은 서버 측에만 존재해야 한다.
- frontend 또는 일반 사용자에게 token을 전달하지 않는다.
- 낮은 비용/낮은 등급 모델을 쓰더라도 rate limit, callback retry, cache 정책은 백엔드에서 별도로 잡아야 한다.

## Web Provider

- `SAGEUM_SEARXNG_URL`이 있으면 SearXNG를 사용한다.
- `BRAVE_SEARCH_API_KEY`가 있으면 Brave Search를 사용한다.
- 둘 다 없으면 검색 결과 없이 model generation만 시도한다.
