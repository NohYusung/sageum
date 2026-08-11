import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMcpGuideClients,
  buildSageumMcpEndpoint,
} from './mcp-connection-guide';

test('사이트 URL의 끝 슬래시와 관계없이 Sageum MCP Endpoint를 한 번만 결합한다', () => {
  assert.equal(
    buildSageumMcpEndpoint('https://sageum.vercel.app'),
    'https://sageum.vercel.app/api/mcp',
  );
  assert.equal(
    buildSageumMcpEndpoint('https://sageum.vercel.app/'),
    'https://sageum.vercel.app/api/mcp',
  );
  assert.equal(
    buildSageumMcpEndpoint('https://sageum.vercel.app/api/mcp/'),
    'https://sageum.vercel.app/api/mcp',
  );
});

test('Codex와 Claude Code 등록 명령이 전달받은 MCP Endpoint를 정확히 사용한다', () => {
  const endpoint = 'https://preview.example/api/mcp';
  const clients = buildMcpGuideClients(endpoint);
  const codex = clients.find((client) => client.id === 'codex');
  const claudeCode = clients.find((client) => client.id === 'claude-code');

  assert.equal(
    codex?.commands.find((command) => command.id === 'codex-add')?.command,
    `codex mcp add sageum --url ${endpoint}`,
  );
  assert.equal(
    claudeCode?.commands.find((command) => command.id === 'claude-add')?.command,
    `claude mcp add --transport http --scope user sageum ${endpoint}`,
  );
});
