import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicPath } from './proxy';

test('MCP endpoint bypasses session auth and applies its own bearer auth', () => {
  assert.equal(isPublicPath('/api/mcp'), true);
  assert.equal(isPublicPath('/api/mcp/'), true);
  assert.equal(isPublicPath('/.well-known/oauth-protected-resource'), true);
  assert.equal(isPublicPath('/.well-known/oauth-protected-resource/api/mcp'), true);
  assert.equal(isPublicPath('/api/documents'), false);
});
