import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSageumMcpServer } from './sageum-mcp';

test('Sageum MCP exposes repository reads and permission-gated upload tools', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createSageumMcpServer({
    ownerId: '123e4567-e89b-42d3-a456-426614174010',
    accessToken: 'verified-oauth-access-token',
    clientId: '123e4567-e89b-42d3-a456-426614174011',
    canUpload: false,
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const response = await client.listTools();
    assert.deepEqual(response.tools.map((tool) => tool.name), [
      'search_repository',
      'list_folders',
      'list_documents',
      'get_document',
      'get_chunk',
      'get_original_link',
      'create_upload',
      'complete_upload',
      'get_ingestion_status',
    ]);
    const tools = new Map(response.tools.map((tool) => [tool.name, tool]));
    assert.equal(tools.get('create_upload')?.annotations?.readOnlyHint, false);
    assert.equal(tools.get('complete_upload')?.annotations?.readOnlyHint, false);
    assert.equal(tools.get('get_ingestion_status')?.annotations?.readOnlyHint, true);
    assert.ok(response.tools.every((tool) => tool.annotations?.destructiveHint === false));

    const deniedUpload = await client.callTool({
      name: 'create_upload',
      arguments: {
        name: '운영문서.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2_048,
      },
    });
    assert.equal(deniedUpload.isError, true);
    assert.match(JSON.stringify(deniedUpload.content), /업로드 권한/u);
  } finally {
    await client.close();
    await server.close();
  }
});
