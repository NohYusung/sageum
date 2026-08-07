# Sageum Document Intelligence

다양한 문서를 구조화해 저장하고, 문서 근거를 검색해 답변과 출처를 함께 제공하는 개인용 RAG 문서 저장소입니다.

- 원본과 메타데이터는 Supabase에 저장합니다.
- 한국어 문서 임베딩과 하이브리드 검색은 Qdrant Cloud Inference가 처리합니다.
- 최종 답변은 Claude Platform on AWS가 검색된 근거만 사용해 생성합니다.
- 기본 배포 대상은 Vercel, Supabase, Qdrant Cloud입니다.

## 주요 기능

- Supabase 이메일 인증과 사용자별 문서 격리
- 중첩 가능한 가상 폴더와 문서·폴더 드래그 이동
- 폴더를 지정한 직접 업로드, 로컬 폴더 구조 일괄 가져오기, 하위 폴더 포함 RAG 검색
- MD, TXT, HTML, PDF, DOCX, XLSX 업로드
- Claude Vision 기반 PDF 시각 자료·DOCX/XLSX/HTML 내장 이미지 OCR와 의미 설명
- 형식별 구조 보존
  - PDF: 페이지
  - DOCX: 제목 계층, 문단, 목록, 표
  - XLSX: 시트, 표, 셀 범위
- 400단어 목표, 최대 500단어, 60단어 중첩의 단어 기반 청킹
- Supabase private Storage 원본 보관
- Supabase PostgreSQL 문서·버전·청크 메타데이터 저장
- Qdrant dense + BM25 sparse 하이브리드 검색과 RRF 결합
- `intfloat/multilingual-e5-small` 한국어·다국어 임베딩
- 모든 벡터 검색에 `owner_id` 필터 적용
- Claude Platform on AWS 기반 근거 제한 답변
- Claude가 반환한 인용 ID를 실제 검색 청크와 다시 대조
- 근거가 없거나 유효한 인용이 없으면 답변 생성 거부
- 답변과 함께 문서명, 제목 경로, 페이지, 시트·셀 범위 표시
- Vercel Workflow 기반 비동기 문서 처리와 브라우저 종료 후 자동 재시도
- 실패 작업의 Qdrant 벡터, Supabase 원본·문서 데이터와 처리 이력 일괄 정리
- Supabase OAuth 2.1로 보호된 사용자별 원격 MCP와 9개 저장소 도구
- OAuth 클라이언트별 선택적 문서 업로드 권한과 DB·Storage 직접 쓰기 차단

## 아키텍처

```mermaid
flowchart LR
  U["사용자 브라우저"] -->|"로그인·업로드·질문"| N["Vercel / Next.js"]
  N -->|"signed upload URL"| U
  U -->|"원본 직접 업로드"| S["Supabase private Storage"]
  N -->|"비동기 실행"| W["Vercel Workflow"]
  W -->|"문서·버전·청크"| P["Supabase PostgreSQL"]
  W -->|"원본 다운로드·형식별 파싱"| S
  W -->|"청크 색인"| Q["Qdrant Cloud Inference"]
  Q -->|"dense + BM25 검색 근거"| N
  N -->|"질문 + 제한된 근거"| C["Claude Platform on AWS"]
  N -->|"PDF·내장 이미지 OCR/설명"| C
  C -->|"구조화 답변 + chunkId 인용"| N
  N -->|"답변 + 검증된 출처"| U
  A["외부 MCP 에이전트"] -->|"OAuth 2.1 + Streamable HTTP"| M["/api/mcp"]
  M -->|"OAuth 탐색·사용자 동의"| SA["Supabase Auth"]
  M -->|"owner_id 제한 검색"| Q
  M -->|"문서·폴더·원본 조회"| P
  M -->|"권한 확인·signed upload"| W
```

### 저장 책임

- Supabase Storage
  - 원본 파일을 비공개 `documents` bucket에 저장합니다.
  - Storage 객체명은 한글 원본 파일명 대신 ASCII 안전 버전 키를 사용합니다.
  - 원본 파일명은 PostgreSQL 메타데이터에 보존합니다.
- Supabase PostgreSQL
  - `documents`: 사용자 소유 문서와 최신 버전
  - `folders`: 사용자 가상 폴더와 상위 폴더 관계
  - `document_versions`: Storage 경로, MIME, 처리 상태, 해시
  - `document_chunks`: 청크 본문과 제목·페이지·시트 위치
  - `document_ingestion_jobs`: 영구 처리 이력, 단계, 재시도, Workflow 실행 ID
  - `document_deletion_jobs`: 외부 리소스 삭제 상태와 재시도 정보
  - `mcp_repository_permissions`: 사용자·OAuth 클라이언트별 업로드 허용 여부
  - public 테이블에는 RLS를 적용하고 `owner_id = auth.uid()`를 강제합니다.
- Qdrant
  - 기본 Collection: `document_chunks_qdrant_hybrid_v2`
  - dense vector: `intfloat/multilingual-e5-small`, 384차원
  - sparse vector: `qdrant/bm25`, multilingual tokenizer
  - 검색과 삭제에 사용자·문서·버전 필터를 적용합니다.
- Claude Platform on AWS
  - Qdrant가 검색한 상위 근거만 전달받습니다.
  - 구조화 출력으로 답변, 인용 청크 ID, 근거 부족 여부를 반환합니다.
  - 앱 서버가 모델이 만든 인용 ID를 실제 검색 결과와 다시 검증합니다.

## 처리 흐름

### 문서 업로드

1. 파일 또는 폴더를 선택하고 저장소의 목적지 폴더를 지정합니다.
2. 폴더 업로드는 선택한 폴더를 루트로 삼아 로컬 상위 경로를 버리고, 하위 구조를 가상 폴더로 생성합니다.
3. 로그인 사용자의 파일 확장자, MIME, 크기를 검증합니다.
4. Supabase에 문서와 버전을 만들고 signed upload URL을 발급합니다.
5. 브라우저가 원본을 private Storage에 직접 업로드합니다.
6. Next.js가 파일별 Vercel Workflow를 시작하고 즉시 작업 ID를 반환합니다.
7. Workflow step이 서버 전용 Supabase 권한으로 원본을 내려받아 형식별 구조를 추출합니다.
8. PDF 시각 자료와 DOCX/XLSX/HTML 내장 이미지를 Claude Vision으로 OCR·설명합니다.
9. OCR 결과를 페이지·시트·이미지 위치가 있는 `image` 블록으로 합칩니다.
10. 구조와 위치 경계를 유지하면서 단어 수 기준으로 청킹합니다.
11. PostgreSQL에 청크를 저장하고 Qdrant Cloud Inference로 색인합니다.
12. 처리 단계와 실패 사유를 `document_ingestion_jobs`에 영구 저장하고, 일시 오류는 최대 3회 재시도합니다.
13. 브라우저는 상태만 조회하므로 처리 시작 후 창을 닫아도 서버 작업은 계속됩니다.

### 이미지 OCR

1. PDF는 Claude의 PDF 시각 입력으로 페이지별 스캔·표·차트·구조도를 분석합니다.
2. DOCX는 Mammoth가 복원한 내장 이미지와 제목 경로·미리보기 블록을 연결합니다.
3. XLSX는 Drawing relationship을 따라 이미지의 시트와 시작 셀을 보존합니다.
4. HTML은 업로드 파일 안의 `data:image/*;base64` 이미지만 처리하고 외부 URL은 가져오지 않습니다.
5. 보이는 글자, 이미지 설명, 구성요소 관계와 핵심 사실을 하나의 검색 블록으로 만듭니다.
6. OCR 호출이 실패하면 기존 텍스트 파싱은 유지하고 버전 metadata에 실패 상태를 기록합니다.

### 폴더 관리

1. 폴더 계층은 PostgreSQL의 `folders.parent_id`로 관리합니다.
2. 문서 이동은 `documents.folder_id`만 갱신하고 Storage 원본은 이동하지 않습니다.
3. 폴더 이동은 자기 자신이나 하위 폴더 아래로 들어가는 순환 구조를 거부합니다.
4. 문서·폴더 드래그 이동은 낙관적으로 반영하고 서버 실패 시 원래 위치로 복구합니다.
5. 폴더 범위 질문은 해당 폴더와 모든 하위 폴더의 문서 ID만 Qdrant 필터로 전달합니다.
6. 폴더 이동은 본문이 변하지 않으므로 Qdrant 재임베딩을 수행하지 않습니다.
7. 로컬 폴더 업로드는 같은 부모의 동일 이름 폴더를 재사용하고 누락된 하위 폴더만 추가합니다.

### 질문과 답변

1. 로그인 사용자의 질문을 Qdrant에 전달합니다.
2. Qdrant가 `owner_id`를 강제한 dense + BM25 하이브리드 검색을 수행합니다.
3. 점수순 검색 결과 중 최대 6개, 총 16,000자까지 Claude에 전달합니다.
4. Claude가 검색 근거만 사용해 한국어 답변과 인용 청크 ID를 생성합니다.
5. 서버가 인용 ID를 검색 결과와 대조하고 유효한 출처만 반환합니다.
6. Claude 설정이 없거나 호출이 실패하면 검색 원문 기반 답변으로 fallback합니다.

### 외부 에이전트 MCP

1. 원격 엔드포인트는 `/api/mcp`이며 stateless Streamable HTTP POST를 사용합니다.
2. MCP 보호 리소스 메타데이터가 Supabase OAuth 2.1 Authorization Server를 안내합니다.
3. 외부 에이전트는 브라우저에서 Sageum 로그인과 사용자 동의를 완료하고 Access Token을 발급받습니다.
4. 서버는 JWT 서명·발급자·만료·`client_id`를 검증하고 `sub`를 문서 `owner_id`로 사용합니다.
5. DB 조회는 OAuth Access Token과 RLS를 사용하며 Qdrant에도 검증된 `owner_id` 필터를 강제합니다.
6. `search_repository`는 웹 챗봇과 같은 Qdrant dense + BM25 검색 근거를 반환합니다.
7. `list_folders`, `list_documents`, `get_document`, `get_chunk`, `get_original_link`를 읽기 전용으로 제공합니다.
8. `get_ingestion_status`로 업로드·파싱·OCR·색인 상태와 실패 사유를 조회합니다.
9. 사용자가 클라이언트별 업로드 권한을 켜면 `create_upload`가 2시간 signed URL을 발급하고, 원본 PUT 후 `complete_upload`가 Workflow를 시작합니다.
10. Supabase OAuth가 사용자 정의 scope를 지원하지 않으므로 쓰기 권한은 `owner_id + client_id`로 별도 관리합니다.
11. OAuth 토큰의 Data API·Storage 직접 쓰기는 RLS로 차단하며, 검증된 업로드만 Sageum 서버가 수행합니다.
12. 외부 에이전트가 검색 근거를 직접 판단하며 Sageum의 Claude 답변을 중복 호출하지 않습니다.

### 문서 삭제

1. 삭제 요청과 `document_deletion_jobs` 등록을 하나의 PostgreSQL 트랜잭션으로 처리합니다.
2. 삭제 중인 문서는 즉시 일반 검색과 원본 접근에서 제외합니다.
3. Qdrant 벡터를 `owner_id + document_id` 필터와 strong ordering으로 삭제합니다.
4. Supabase Storage 원본을 삭제합니다. 이미 없는 원본은 삭제 완료 상태로 취급합니다.
5. 마지막 PostgreSQL 트랜잭션이 `documents`를 삭제하고 버전·청크·삭제 작업을 cascade 정리합니다.
6. 외부 삭제가 실패하면 작업을 보존하고 일반 사용자가 화면에서 재시도할 수 있습니다.

### 실패 작업 정리

1. 처리 현황의 실패 카드에서만 `작업 정리`를 제공합니다.
2. DB가 실패 작업을 잠그고 문서를 삭제 중으로 전환해 재시도와 정리가 동시에 실행되지 않게 합니다.
3. Qdrant 벡터와 Supabase Storage 원본을 지운 뒤 문서·버전·청크와 처리 이력을 하나의 DB 트랜잭션에서 삭제합니다.
4. 외부 리소스 정리가 실패하면 처리 이력을 유지하고 `정리 다시 시도`를 제공합니다.

## 기술 스택

- Frontend/API: Next.js 16, React 19, TypeScript
- Auth/Storage/Database: Supabase
- Vector DB/Search: Qdrant Cloud, Qdrant Cloud Inference
- Embedding: `intfloat/multilingual-e5-small`
- Answer model: Claude Haiku 4.5 on Claude Platform on AWS
- Durable jobs: Vercel Workflow DevKit
- Deployment target: Vercel

## 로컬 실행

### 요구 사항

- Node.js 22
- Supabase 프로젝트
- Qdrant Cloud 클러스터와 Cloud Inference 사용 권한
- Claude Platform on AWS workspace와 API key

### 설치

```bash
cd sageum-front
cp .env.example .env.local
npm install
```

`.env.local`에 실제 환경변수를 입력합니다. 이 파일은 Git에 커밋하지 않습니다.

```env
# Browser-safe Supabase configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Server-only Supabase secret
SUPABASE_SECRET_KEY=your-server-secret

# Qdrant Cloud
QDRANT_URL=https://your-cluster.cloud.qdrant.io
QDRANT_API_KEY=your-qdrant-api-key
QDRANT_COLLECTION=document_chunks_qdrant_hybrid_v2
QDRANT_INFERENCE_MODEL=intfloat/multilingual-e5-small
QDRANT_INFERENCE_DIMENSIONS=384
QDRANT_SCORE_THRESHOLD=0.2

# Claude Platform on AWS — Amazon Bedrock와 다른 서비스입니다.
ANTHROPIC_AWS_WORKSPACE_ID=wrkspc_example
AWS_REGION=ap-northeast-2
ANTHROPIC_AWS_API_KEY=your-claude-platform-aws-api-key
CLAUDE_AWS_MODEL=claude-haiku-4-5

# OAuth-protected MCP
SAGEUM_MCP_ALLOWED_ORIGINS=
SAGEUM_MCP_URL=http://localhost:3000/api/mcp
SAGEUM_MCP_ACCESS_TOKEN=
```

- `NEXT_PUBLIC_` 접두사는 브라우저에 공개해도 되는 Supabase 값에만 사용합니다.
- Supabase secret, Qdrant API key, Claude API key는 서버 환경변수로만 저장합니다.
- Claude workspace의 생성 리전과 `AWS_REGION`이 일치해야 합니다.
- `SAGEUM_MCP_ACCESS_TOKEN`은 로컬 스모크 테스트용 단기 OAuth 토큰이며 Vercel에는 설정하지 않습니다.
- MCP의 실제 사용자 범위는 검증된 Supabase OAuth JWT의 `sub`에서 결정됩니다.

### 개발 서버

```bash
npm run dev
```

- 기본 주소: `http://localhost:3000`
- 이메일 계정을 생성하고 로그인한 뒤 문서를 업로드할 수 있습니다.

## 외부 서비스 준비

### Supabase

- 이메일 Auth를 활성화합니다.
- **Authentication > OAuth Server**에서 OAuth 2.1 Server를 활성화합니다.
- Authorization Path는 `/oauth/consent`로 설정합니다.
- 외부 MCP 클라이언트의 자동 연결이 필요하면 Dynamic Client Registration을 활성화합니다.
- OAuth 동의 화면은 Sageum의 `/oauth/consent`가 제공하며 사용자는 연결을 명시적으로 승인하거나 거부합니다.
- `openid` scope를 사용할 경우 JWT Signing Key를 RS256 또는 ES256으로 전환합니다.
- private `documents` Storage bucket을 준비합니다.
- `documents`, `document_versions`, `document_chunks` 테이블과 사용자별 RLS 정책이 필요합니다.
- 삭제 정합성 스키마는 `docs/document-deletion-schema.sql`을 적용합니다.
- 가상 폴더 스키마는 `docs/folder-management-schema.sql`에 기록되어 있습니다.
- 영구 처리 이력과 Workflow 필드는 `docs/document-ingestion-schema.sql`에 기록되어 있습니다.
- MCP 업로드 권한과 OAuth 직접 쓰기 차단은 `docs/mcp-write-permissions-schema.sql`, `docs/mcp-oauth-write-boundary-schema.sql`에 기록되어 있습니다.
- Storage와 데이터베이스의 사용자 소유권은 모두 로그인한 `auth.uid()`를 기준으로 제한합니다.

### Qdrant

- `.env.local`을 설정한 뒤 Collection과 payload index를 준비합니다.

```bash
npm run qdrant:setup
```

- 기존 Collection의 벡터 차원이 384와 다르면 자동으로 삭제하지 않고 오류를 반환합니다.
- 임베딩 모델이나 Collection을 변경하면 기존 문서를 다시 색인해야 합니다.

```bash
npm run qdrant:reindex
```

### Claude Platform on AWS

- AWS Console에서 Claude Platform on AWS를 활성화합니다.
- workspace를 만들고 생성 리전을 확인합니다.
- Claude Platform on AWS의 API keys 화면에서 발급한 실제 키 값을 사용합니다.
- 호출 주체에는 workspace 대상 `aws-external-anthropic:CreateInference` 권한이 필요합니다.
- API key 인증에는 `aws-external-anthropic:CallWithBearerToken` 권한도 필요합니다.

## 검증 명령

```bash
cd sageum-front
npm test
npm run typecheck
npm run build
```

### Qdrant 스모크 테스트

```bash
npm run qdrant:smoke
```

- 임시 문서 청크를 색인합니다.
- 한국어 유사어 질문, 하이브리드 검색, 소유자 필터를 검증합니다.
- 테스트가 끝나면 임시 point를 삭제합니다.

### Claude 스모크 테스트

```bash
npm run claude:smoke
```

- Claude Platform on AWS 인증과 모델 호출을 검증합니다.
- 합성 한국어 근거로 구조화 답변과 정확한 `chunkId` 인용을 확인합니다.
- 실제 사용자 문서나 API 키를 출력하지 않습니다.

### MCP 스모크 테스트

```bash
npm run mcp:smoke
npm run mcp:smoke -- "환경 변수 명세는 무엇인가?"
```

- OAuth로 발급한 단기 Access Token을 `SAGEUM_MCP_ACCESS_TOKEN`에 넣습니다.
- 첫 명령은 OAuth 인증, 프로토콜 연결과 저장소 도구를 확인합니다.
- 질문을 추가하면 실제 Qdrant 저장소 검색까지 확인합니다.
- OAuth 지원 외부 에이전트에는 `https://sageum.vercel.app/api/mcp` URL만 등록하면 브라우저 승인이 시작됩니다.
- 문서 업로드는 `/oauth/connections`에서 해당 클라이언트의 `업로드 허용`을 켠 뒤 `create_upload → PUT → complete_upload → get_ingestion_status` 순서로 실행합니다.

## 배포

- `sageum-front`를 Vercel 프로젝트의 Root Directory로 지정합니다.
- `.env.local`의 값을 Vercel Environment Variables에 각각 등록합니다.
- `NEXT_PUBLIC_SITE_URL`은 실제 Vercel 배포 주소로 설정합니다.
- API 키 세 종류는 반드시 Production/Preview 서버 환경변수로만 등록합니다.
- 배포 후 다음 순서로 확인합니다.
  1. 이메일 로그인
  2. 문서 업로드
  3. Supabase Storage와 데이터베이스 저장
  4. Qdrant 색인
  5. 문서 질문과 Claude 답변
  6. 페이지·시트 위치가 포함된 출처 표시
  7. `/api/mcp` OAuth 브라우저 승인과 저장소 검색
  8. MCP 클라이언트 업로드 권한, signed URL PUT, 백그라운드 처리 상태 조회

## 현재 제한사항

- OCR은 JPEG, PNG, GIF, WebP 내장 이미지를 지원하며 SVG, EMF, WMF는 건너뜁니다.
- HTML의 외부 이미지 URL과 Markdown의 별도 첨부 이미지는 원본 파일에 포함되지 않으므로 OCR하지 않습니다.
- PDF 전체와 이미지 OCR은 Claude Vision 입력 토큰을 사용합니다.
- 각 질문은 독립적으로 검색합니다. 대화 이력을 이용한 후속 질문 재작성은 아직 없습니다.
- 답변은 스트리밍하지 않고 완성된 구조화 결과를 한 번에 반환합니다.
- RAG 정답 세트와 자동 품질 평가는 아직 추가되지 않았습니다.
- 앱은 Supabase Free 플랜의 Storage 상한에 맞춰 파일당 최대 50MB를 허용합니다.

## 프로젝트 구조

```text
sageum/
├── sageum-front/                 # 현재 RAG 제품 경로
│   ├── scripts/                  # Qdrant·Claude setup/smoke/reindex
│   ├── src/app/api/              # 문서 처리·검색 Route Handler
│   ├── src/components/           # 문서 저장소·챗 UI
│   ├── src/lib/rag/              # 파서 공통 타입·청킹·검색 계약
│   ├── src/lib/server/           # Supabase·Qdrant·Claude 서버 로직
│   ├── src/workflows/            # Vercel Workflow 문서 처리 오케스트레이션
│   └── test/fixtures/            # PDF·DOCX·XLSX 테스트 문서
├── docs/                         # 설계 기록
├── sageum-back/                  # 이전 NestJS 실험 코드
└── sageum_agent/                 # 이전 Python·Obsidian 실험 코드
```

## 다음 작업 후보

- 실제 문서 질문·정답 세트와 RAG 품질 평가 자동화
- 대화 이력을 이용한 후속 질문 재작성
- 검색 품질에 따른 reranker 도입 검토
- Vercel 배포 환경 E2E 검증
- 답변 스트리밍

## 라이선스

- [MIT License](LICENSE)
