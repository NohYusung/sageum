# Sageum Document Intelligence Development Guide

- 답변과 문서는 기본적으로 한국어와 bullet 중심으로 작성한다.
- 저장소의 현재 목적은 문서 저장소와 근거 기반 RAG 챗봇을 구현하는 것이다.
- 새 기능은 다음 제품 경계 안에 둔다.
  - MD, HTML, TXT, PDF, DOCX, XLSX 문서 수집
  - 구조와 위치 정보를 보존하는 정규화
  - 단어 수 기준 청킹과 임베딩
  - Supabase 원본·메타데이터 저장
  - Qdrant 벡터 색인과 사용자별 검색
  - 답변, 인용 청크, 원문 문서를 함께 제공하는 웹 챗봇
- 개인 데모의 기본 배포 대상은 Vercel, Supabase Free, Qdrant Cloud Free다.
- 모든 Supabase public 테이블에 RLS를 적용하고 사용자의 `auth.uid()` 범위를 강제한다.
- Supabase secret key, Qdrant API key, 임베딩 API key는 서버에만 두며 `NEXT_PUBLIC_`으로 노출하지 않는다.
- Qdrant 검색은 반드시 `owner_id` 필터를 사용하고 필터 payload index를 먼저 생성한다.
- 문서 파서는 원문 전체를 한 문자열로만 평탄화하지 않고 제목, 페이지, 시트, 셀 범위 등 출처 위치를 보존한다.
- 검색 근거가 없으면 답변을 꾸며내지 않고 근거 부족을 반환한다.
- 새 도메인 로직에는 단위 테스트를 추가하고, UI 변경은 타입 검사·빌드·브라우저 검증까지 수행한다.
