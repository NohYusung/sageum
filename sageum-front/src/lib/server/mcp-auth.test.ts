import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authenticateMcpRequest,
  isAllowedMcpOrigin,
  mcpAuthInfoFromClaims,
} from './mcp-auth';

const OWNER_ID = '123e4567-e89b-42d3-a456-426614174010';
const CLIENT_ID = '123e4567-e89b-42d3-a456-426614174011';
const ISSUER = 'https://example.supabase.co/auth/v1';

function validClaims() {
  return {
    sub: OWNER_ID,
    client_id: CLIENT_ID,
    iss: ISSUER,
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1_000) + 3_600,
    scope: 'email profile email',
  };
}

test('MCP OAuth claims derive owner and client IDs from a verified token', () => {
  assert.deepEqual(mcpAuthInfoFromClaims('access-token', validClaims(), ISSUER), {
    token: 'access-token',
    clientId: CLIENT_ID,
    scopes: ['email', 'profile'],
    expiresAt: validClaims().exp,
    extra: { ownerId: OWNER_ID },
  });
});

test('MCP rejects ordinary sessions, foreign issuers, and expired OAuth tokens', () => {
  assert.equal(mcpAuthInfoFromClaims('token', { ...validClaims(), client_id: undefined }, ISSUER), null);
  assert.equal(mcpAuthInfoFromClaims('token', { ...validClaims(), iss: 'https://attacker.test' }, ISSUER), null);
  assert.equal(mcpAuthInfoFromClaims('token', { ...validClaims(), exp: 1 }, ISSUER), null);
});

test('MCP authentication accepts only a verified Supabase OAuth bearer token', async () => {
  const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  try {
    const authenticated = await authenticateMcpRequest(
      new Request('https://sageum.test/api/mcp', {
        headers: { Authorization: 'Bearer oauth-access-token' },
      }),
      async () => validClaims(),
    );
    assert.equal(authenticated.ok, true);
    if (authenticated.ok) {
      assert.equal(authenticated.ownerId, OWNER_ID);
      assert.equal(authenticated.authInfo.clientId, CLIENT_ID);
    }

    const missing = await authenticateMcpRequest(
      new Request('https://sageum.test/api/mcp'),
      async () => validClaims(),
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 401);
  } finally {
    if (previousSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousSupabaseUrl;
  }
});

test('MCP browser origins are restricted while non-browser clients remain allowed', () => {
  assert.equal(isAllowedMcpOrigin(new Request('https://sageum.test/api/mcp')), true);
  assert.equal(isAllowedMcpOrigin(new Request('https://sageum.test/api/mcp', {
    headers: { Origin: 'https://sageum.test' },
  })), true);
  assert.equal(isAllowedMcpOrigin(new Request('https://sageum.test/api/mcp', {
    headers: { Origin: 'https://attacker.test' },
  })), false);
});
