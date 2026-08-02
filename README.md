# Sageum Document Intelligence

- 다양한 사내 문서를 구조화해 저장하고, 질문에 대한 답변과 근거 문서를 함께 보여주는 개인용 RAG 데모입니다.
- 배포 목표는 Vercel + Supabase Free + Qdrant Cloud Free입니다.
- 현재 작업 브랜치는 `feat/rag-document-repository`입니다.

## 현재 구현 범위

- Next.js 16 기반 문서 저장소·챗·업로드 UI
- Markdown, HTML, TXT 브라우저 파싱
- 제목 경로와 원문 위치를 유지하는 구조화 블록
- 400단어 목표, 최대 500단어, 60단어 중첩의 단어 기반 청킹
- 로컬 어휘 검색과 근거 없는 답변 거부
- 답변별 원문 청크와 문서 상세 연결
- Supabase 서버 클라이언트 및 Qdrant 컬렉션 어댑터 골격
- 공급자 설정 상태를 노출하는 `/api/system`

## 다음 구현 범위

- PDF, DOCX, XLSX 서버 파서
- Supabase Auth, private Storage, PostgreSQL 메타데이터 영속화
- 임베딩 공급자와 Qdrant 실제 색인·검색 API
- 검색 결과를 근거로 하는 LLM 답변 스트리밍
- Vercel·Supabase·Qdrant Cloud 환경 연결

## 저장 구조

- Supabase private Storage: 원본 파일
- Supabase PostgreSQL: 문서, 버전, 처리 상태, 청크 메타데이터
- Qdrant: 임베딩 벡터, 검색용 청크 텍스트, 문서·버전 필터 payload
- 브라우저: publishable key만 사용
- Next.js 서버: Supabase secret key, Qdrant API key, 임베딩 API key 사용

상세 설계는 [docs/rag-architecture.md](docs/rag-architecture.md)를 참고합니다.

## 로컬 실행

```bash
cd sageum-front
cp .env.example .env.local
npm install
npm run dev
```

- 공급자 키가 없으면 로컬 검색 검증 모드로 실행됩니다.
- 기본 데모 문서와 직접 업로드한 Markdown, HTML, TXT를 이용해 전체 UI 흐름을 확인할 수 있습니다.
- 공급자 키는 `NEXT_PUBLIC_` 접두사가 없는 서버 환경변수로만 저장합니다.

## 검증

```bash
cd sageum-front
npm test
npm run typecheck
npm run build
```

## 이전 코드

- `sageum-back/`, `sageum_agent/`, Obsidian 관련 파일은 기존 커리큘럼·시맨틱 저장소 실험 코드입니다.
- 새 RAG 제품 경로는 우선 `sageum-front/`에 수직 슬라이스로 구현하고, 동작이 완성된 뒤 이전 런타임을 정리합니다.
