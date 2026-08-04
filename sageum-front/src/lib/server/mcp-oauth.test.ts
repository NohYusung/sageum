import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sageumMcpAuthenticateChallenge,
  sageumMcpProtectedResourceMetadata,
} from './mcp-oauth';

test('MCP protected resource metadata advertises the Supabase OAuth issuer', () => {
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = 'https://sageum.vercel.app';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';

  try {
    const request = new Request('https://preview.example/api/mcp');
    assert.deepEqual(sageumMcpProtectedResourceMetadata(request), {
      resource: 'https://sageum.vercel.app/api/mcp',
      authorization_servers: ['https://example.supabase.co/auth/v1'],
      bearer_methods_supported: ['header'],
      resource_name: 'Sageum 문서 저장소',
    });
    assert.equal(
      sageumMcpAuthenticateChallenge(request),
      'Bearer resource_metadata="https://sageum.vercel.app/.well-known/oauth-protected-resource/api/mcp"',
    );
  } finally {
    if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
    if (previousSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousSupabaseUrl;
  }
});
