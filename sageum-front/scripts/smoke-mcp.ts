import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const token = process.env.SAGEUM_MCP_ACCESS_TOKEN?.trim();
const endpoint = process.env.SAGEUM_MCP_URL?.trim() || 'http://localhost:3000/api/mcp';
if (!token) throw new Error('OAuth로 발급한 SAGEUM_MCP_ACCESS_TOKEN 환경변수가 필요합니다.');

const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({ name: 'sageum-mcp-smoke', version: '1.0.0' });

function isTextContentBlock(value: unknown): value is { type: 'text'; text: string } {
  return (
    typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'text'
    && 'text' in value
    && typeof value.text === 'string'
  );
}

async function main() {
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const expected = [
      'search_repository',
      'list_folders',
      'list_documents',
      'get_document',
      'get_chunk',
      'get_original_link',
      'create_upload',
      'complete_upload',
      'get_ingestion_status',
    ];
    const names = tools.map((tool) => tool.name);
    if (expected.some((name) => !names.includes(name))) {
      throw new Error(`필수 MCP 도구가 없습니다: ${expected.filter((name) => !names.includes(name)).join(', ')}`);
    }
    console.log(`MCP 연결 성공: ${endpoint}`);
    console.log(`저장소 도구 ${tools.length}개 확인: ${names.join(', ')}`);

    const question = process.argv.slice(2).join(' ').trim();
    if (question) {
      const result = await client.callTool({
        name: 'search_repository',
        arguments: { query: question, topK: 3 },
      });
      const content: unknown[] = Array.isArray(result.content) ? result.content : [];
      const text = content.find(isTextContentBlock);
      const payload = text ? JSON.parse(text.text) as { evidence?: unknown[] } : null;
      console.log(`검색 스모크 성공: 근거 ${payload?.evidence?.length ?? 0}개`);
    }
  } finally {
    await client.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
