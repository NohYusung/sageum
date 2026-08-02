# Sageum Document Intelligence

- 다양한 사내 문서를 구조화해 저장하고, 질문에 대한 답변과 근거 문서를 함께 보여주는 개인용 RAG 데모입니다.
- 배포 목표는 Vercel + Supabase Free + Qdrant Cloud Free입니다.
- 현재 작업 브랜치는 `feat/rag-document-repository`입니다.

## 현재 구현 범위

- Next.js 16 기반 문서 저장소·챗·업로드 UI
- Supabase 이메일 Auth와 보안 쿠키 세션
- Markdown, HTML, TXT 서버 파싱
- 제목 경로와 원문 위치를 유지하는 구조화 블록
- 400단어 목표, 최대 500단어, 60단어 중첩의 단어 기반 청킹
- 로컬 어휘 검색과 근거 없는 답변 거부
- 답변별 원문 청크와 문서 상세 연결
- Supabase 서버 클라이언트 및 Qdrant 컬렉션 어댑터 골격
- Supabase 문서·버전·청크 스키마, 소유자 RLS, private `documents` bucket
- signed upload URL을 이용한 Storage 직접 업로드
- 문서 처리 API의 구조 추출, SHA-256 해시, 단어 청킹, PostgreSQL 영속화
- 로그인 사용자별 문서와 최신 청크 복원
- 공급자 설정 상태를 노출하는 `/api/system`

## 다음 구현 범위

- PDF, DOCX, XLSX 서버 파서
- 임베딩 공급자와 Qdrant 실제 색인·검색 API
- 검색 결과를 근거로 하는 LLM 답변 스트리밍
- Vercel·Supabase·Qdrant Cloud 환경 연결

## 저장 구조

- Supabase private Storage: 원본 파일
- Supabase PostgreSQL: 문서, 버전, 처리 상태, 청크 메타데이터
- Qdrant: 임베딩 벡터, 검색용 청크 텍스트, 문서·버전 필터 payload
- 브라우저: Supabase publishable key와 경로가 제한된 단기 업로드 토큰만 사용
- Next.js 서버: 사용자 쿠키 세션으로 RLS를 적용하고 Qdrant·임베딩 비밀키는 서버에서만 사용

상세 설계는 [docs/rag-architecture.md](docs/rag-architecture.md)를 참고합니다.

## 로컬 실행

```bash
cd sageum-front
cp .env.example .env.local
npm install
npm run dev
```

- Supabase URL과 publishable key를 설정하고 이메일 계정을 만든 뒤 실행합니다.
- 업로드한 Markdown, HTML, TXT는 private Storage와 PostgreSQL에 영구 저장됩니다.
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
