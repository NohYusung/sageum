# Sageum Agent Development Guide

- 답변과 문서는 기본적으로 한국어와 bullet 중심으로 작성한다.
- 이 저장소의 목적은 Hermes 범용 에이전트를 유지하는 것이 아니라, Sageum curriculum worker에 필요한 기능만 남기는 것이다.
- 새 기능은 다음 표면 안에 들어와야 한다.
  - backend job contract
  - web search and extraction
  - Codex OAuth model call
  - curriculum generation
  - markdown/html rendering
  - callback delivery
- CLI, gateway, desktop, TUI, cron, memory, skills, plugin, MCP, terminal, browser automation, messaging adapter는 기본적으로 범위 밖이다.
- 백엔드가 durable job table, S3 저장, 사용자 인증, 결제, frontend delivery를 소유한다.
- agent는 장기 queue를 소유하지 않는다. HTTP 요청을 accepted 처리하고, 실행 결과만 callback으로 돌려준다.
- Codex OAuth token은 서버 측에만 둔다. 클라이언트나 frontend로 token을 노출하지 않는다.
