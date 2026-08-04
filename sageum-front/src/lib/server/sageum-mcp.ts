import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import {
  getMcpChunk,
  getMcpDocument,
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

export function createSageumMcpServer(access: McpRepositoryAccess) {
  const server = new McpServer({
    name: 'sageum-document-repository',
    version: '1.0.0',
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

  return server;
}
