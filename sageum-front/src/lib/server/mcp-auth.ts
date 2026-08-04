import { createClient } from '@supabase/supabase-js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Database } from '@/lib/supabase/database.types';
import { requireServerEnvironment } from './env';
import { supabaseOAuthIssuer } from './mcp-oauth';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type McpTokenVerifier = (token: string) => Promise<Record<string, unknown> | null>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/iu.exec(authorization);
  return match?.[1]?.trim() || null;
}

function audienceIncludesAuthenticated(value: unknown) {
  if (value === 'authenticated') return true;
  return Array.isArray(value) && value.includes('authenticated');
}

function tokenScopes(value: unknown) {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(/\s+/u).map((scope) => scope.trim()).filter(Boolean))];
}

export function mcpAuthInfoFromClaims(
  token: string,
  claims: Record<string, unknown>,
  expectedIssuer = supabaseOAuthIssuer(),
): AuthInfo | null {
  const ownerId = typeof claims.sub === 'string' ? claims.sub : '';
  const clientId = typeof claims.client_id === 'string' ? claims.client_id : '';
  const issuer = typeof claims.iss === 'string' ? claims.iss.replace(/\/$/u, '') : '';
  const expiresAt = typeof claims.exp === 'number' ? claims.exp : undefined;

  if (
    !UUID_PATTERN.test(ownerId)
    || !UUID_PATTERN.test(clientId)
    || issuer !== expectedIssuer.replace(/\/$/u, '')
    || claims.role !== 'authenticated'
    || !audienceIncludesAuthenticated(claims.aud)
    || !expiresAt
    || expiresAt <= Math.floor(Date.now() / 1_000)
  ) {
    return null;
  }

  return {
    token,
    clientId,
    scopes: tokenScopes(claims.scope),
    expiresAt,
    extra: { ownerId },
  };
}

async function verifySupabaseMcpToken(token: string) {
  const supabase = createClient<Database>(
    requireServerEnvironment('NEXT_PUBLIC_SUPABASE_URL'),
    requireServerEnvironment('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data || !isRecord(data.claims)) return null;
  return data.claims;
}

export async function authenticateMcpRequest(
  request: Request,
  verifyToken: McpTokenVerifier = verifySupabaseMcpToken,
) {
  const token = bearerToken(request);
  if (!token) {
    return { ok: false as const, status: 401, error: 'OAuth Access Token이 필요합니다.' };
  }

  try {
    const claims = await verifyToken(token);
    const authInfo = claims ? mcpAuthInfoFromClaims(token, claims) : null;
    if (!authInfo) {
      return { ok: false as const, status: 401, error: '유효한 Sageum OAuth 토큰이 필요합니다.' };
    }
    const ownerId = authInfo.extra?.ownerId;
    if (typeof ownerId !== 'string') {
      return { ok: false as const, status: 401, error: 'OAuth 사용자 정보를 확인하지 못했습니다.' };
    }
    return { ok: true as const, ownerId, accessToken: token, authInfo };
  } catch (error) {
    console.error('Sageum MCP OAuth verification failed', error);
    return { ok: false as const, status: 503, error: 'Sageum OAuth 검증을 사용할 수 없습니다.' };
  }
}

export function isAllowedMcpOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const requestOrigin = new URL(request.url).origin;
  const configured = process.env.SAGEUM_MCP_ALLOWED_ORIGINS
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  return origin === requestOrigin || configured.includes(origin);
}
