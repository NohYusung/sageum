import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSageumMcpServer } from './sageum-mcp';

test('Sageum MCP exposes only the intended read-only repository tools', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createSageumMcpServer({
    ownerId: '123e4567-e89b-42d3-a456-426614174010',
    accessToken: 'verified-oauth-access-token',
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
    ]);
    assert.ok(response.tools.every((tool) => tool.annotations?.readOnlyHint === true));
    assert.ok(response.tools.every((tool) => tool.annotations?.destructiveHint === false));
  } finally {
    await client.close();
    await server.close();
  }
});
