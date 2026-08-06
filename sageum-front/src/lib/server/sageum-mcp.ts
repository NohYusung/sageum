import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import {
  completeMcpDocumentUpload,
  createMcpDocumentUpload,
  getMcpChunk,
  getMcpDocument,
  getMcpIngestionStatus,
  getMcpOriginalLink,
  listMcpDocuments,
  listMcpFolders,
  searchMcpRepository,
  type McpRepositoryAccess,
} from './mcp-repository';

const UUID = z.string().uuid();

function jsonToolResult(value: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(value, null, 2),
    }],
  };
}

function readOnlyAnnotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

function writeAnnotations({ idempotent = false }: { idempotent?: boolean } = {}) {
  return {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: idempotent,
    openWorldHint: true,
  };
}

export function createSageumMcpServer(access: McpRepositoryAccess) {
  const server = new McpServer({
    name: 'sageum-document-repository',
    version: '1.1.0',
  });

  server.registerTool('search_repository', {
    title: '문서 저장소 검색',
    description: 'Sageum 문서 저장소에서 질문과 관련된 근거 청크를 검색합니다. 답변을 작성할 때 documentTitle, heading, page/sheet와 chunkId를 근거로 인용하세요.',
    inputSchema: {
      query: z.string().trim().min(1).max(2_000).describe('자연어 검색 질문'),
      folderId: UUID.optional().describe('하위 폴더까지 포함할 검색 폴더 ID'),
      documentIds: z.array(UUID).max(20).optional().describe('검색할 문서 ID 목록'),
      topK: z.number().int().min(1).max(20).default(6).describe('반환할 최대 근거 수'),
    },
    annotations: readOnlyAnnotations(),
  }, async ({ query, folderId, documentIds, topK }) => jsonToolResult({
    query,
    evidence: await searchMcpRepository(access, { query, folderId, documentIds, topK }),
  }));

  server.registerTool('list_folders', {
    title: '폴더 목록',
    description: 'Sageum의 가상 폴더 구조를 조회합니다.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
  }, async () => jsonToolResult({ folders: await listMcpFolders(access) }));

  server.registerTool('list_documents', {
    title: '문서 목록',
    description: '루트 또는 특정 폴더에 직접 포함된 활성 문서 목록을 조회합니다.',
    inputSchema: {
      folderId: UUID.optional().describe('생략하면 루트 문서를 조회합니다.'),
    },
    annotations: readOnlyAnnotations(),
  }, async ({ folderId }) => jsonToolResult({
    folderId: folderId ?? null,
    documents: await listMcpDocuments(access, folderId),
  }));

  server.registerTool('get_document', {
    title: '문서 구조 조회',
    description: '문서 메타데이터, 최신 버전, 제목·페이지·시트별 청크 구조를 조회합니다. 전체 본문이 필요하면 get_chunk를 사용하세요.',
    inputSchema: { documentId: UUID },
    annotations: readOnlyAnnotations(),
  }, async ({ documentId }) => jsonToolResult({
    document: await getMcpDocument(access, documentId),
  }));

  server.registerTool('get_chunk', {
    title: '근거 청크 조회',
    description: '검색 결과에서 받은 chunkId의 전체 구조화 본문을 조회합니다.',
    inputSchema: { chunkId: z.string().trim().min(1).max(200) },
    annotations: readOnlyAnnotations(),
  }, async ({ chunkId }) => jsonToolResult({
    chunk: await getMcpChunk(access, chunkId),
  }));

  server.registerTool('get_original_link', {
    title: '원본 문서 링크',
    description: '사람이 원본을 직접 확인할 수 있도록 짧게 만료되는 읽기 전용 Supabase Storage 링크를 발급합니다. URL을 장기 저장하거나 공유하지 마세요.',
    inputSchema: { documentId: UUID },
    annotations: readOnlyAnnotations(),
  }, async ({ documentId }) => jsonToolResult({
    original: await getMcpOriginalLink(access, documentId),
  }));

  server.registerTool('create_upload', {
    title: '문서 업로드 준비',
    description: 'Sageum에 새 문서와 처리 작업을 만들고 2시간 동안 유효한 Supabase signed upload URL을 발급합니다. 반환된 URL에 파일 원본을 HTTP PUT한 뒤 complete_upload를 호출하세요. Sageum에서 해당 OAuth 클라이언트의 업로드 권한을 별도로 허용해야 합니다.',
    inputSchema: {
      name: z.string().trim().min(1).max(1_024).describe('확장자를 포함한 원본 파일명'),
      mimeType: z.string().trim().min(1).max(255).describe('원본 파일의 MIME type'),
      sizeBytes: z.number().int().min(1).max(10 * 1_024 * 1_024).describe('원본 파일 크기(byte)'),
      folderId: UUID.optional().describe('저장할 Sageum 가상 폴더 ID'),
    },
    annotations: writeAnnotations(),
  }, async ({ name, mimeType, sizeBytes, folderId }) => jsonToolResult({
    upload: await createMcpDocumentUpload(access, { name, mimeType, sizeBytes, folderId }),
  }));

  server.registerTool('complete_upload', {
    title: '문서 업로드 완료',
    description: 'create_upload로 받은 signed URL에 원본 PUT이 끝난 후 호출합니다. 브라우저 연결과 독립적인 백그라운드 파싱·OCR·청킹·Qdrant 색인을 시작합니다.',
    inputSchema: {
      documentId: UUID,
      versionId: UUID,
      jobId: UUID,
    },
    annotations: writeAnnotations({ idempotent: true }),
  }, async ({ documentId, versionId, jobId }) => jsonToolResult({
    processing: await completeMcpDocumentUpload(access, { documentId, versionId, jobId }),
  }));

  server.registerTool('get_ingestion_status', {
    title: '문서 처리 상태',
    description: 'create_upload에서 받은 jobId로 업로드 및 백그라운드 색인 진행 상태와 실패 사유를 조회합니다.',
    inputSchema: { jobId: UUID },
    annotations: readOnlyAnnotations(),
  }, async ({ jobId }) => jsonToolResult({
    ingestion: await getMcpIngestionStatus(access, jobId),
  }));

  return server;
}
