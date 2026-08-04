import type { OAuthProtectedResourceMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { requireServerEnvironment } from './env';

export const SAGEUM_MCP_PATH = '/api/mcp';
export const SAGEUM_MCP_RESOURCE_METADATA_PATH =
  '/.well-known/oauth-protected-resource/api/mcp';

function configuredSiteOrigin() {
  const value = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) return null;
  return new URL(value).origin;
}

export function sageumSiteOrigin(request: Request) {
  return configuredSiteOrigin() ?? new URL(request.url).origin;
}

export function sageumMcpResourceUrl(request: Request) {
  return new URL(SAGEUM_MCP_PATH, sageumSiteOrigin(request));
}

export function sageumMcpResourceMetadataUrl(request: Request) {
  return new URL(SAGEUM_MCP_RESOURCE_METADATA_PATH, sageumSiteOrigin(request));
}

export function supabaseOAuthIssuer() {
  const supabaseUrl = requireServerEnvironment('NEXT_PUBLIC_SUPABASE_URL');
  return new URL('/auth/v1', `${supabaseUrl.replace(/\/$/u, '')}/`).toString().replace(/\/$/u, '');
}

export function sageumMcpProtectedResourceMetadata(
  request: Request,
): OAuthProtectedResourceMetadata {
  return {
    resource: sageumMcpResourceUrl(request).toString(),
    authorization_servers: [supabaseOAuthIssuer()],
    bearer_methods_supported: ['header'],
    resource_name: 'Sageum 문서 저장소',
  };
}

export function sageumMcpAuthenticateChallenge(request: Request) {
  return `Bearer resource_metadata="${sageumMcpResourceMetadataUrl(request).toString()}"`;
}

export function sageumMcpProtectedResourceResponse(request: Request) {
  try {
    return Response.json(sageumMcpProtectedResourceMetadata(request), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    console.error('Sageum MCP OAuth metadata failed', error);
    return Response.json({ error: 'OAuth 메타데이터를 사용할 수 없습니다.' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
