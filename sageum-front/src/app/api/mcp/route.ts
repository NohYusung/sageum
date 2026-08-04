import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateMcpRequest, isAllowedMcpOrigin } from '@/lib/server/mcp-auth';
import { sageumMcpAuthenticateChallenge } from '@/lib/server/mcp-oauth';
import { createSageumMcpServer } from '@/lib/server/sageum-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function jsonRpcError(request: Request, status: number, message: string) {
  return Response.json({
    jsonrpc: '2.0',
    error: { code: status === 401 ? -32001 : -32000, message },
    id: null,
  }, {
    status,
    headers: status === 401
      ? { 'WWW-Authenticate': sageumMcpAuthenticateChallenge(request) }
      : undefined,
  });
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  return origin ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    Vary: 'Origin',
  } : {};
}

function withResponseHeaders(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  Object.entries(corsHeaders(request)).forEach(([name, value]) => headers.set(name, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function authorize(request: Request) {
  if (!isAllowedMcpOrigin(request)) {
    return { ok: false as const, response: jsonRpcError(request, 403, '허용되지 않은 Origin입니다.') };
  }
  const authentication = await authenticateMcpRequest(request);
  if (!authentication.ok) {
    return {
      ok: false as const,
      response: jsonRpcError(request, authentication.status, authentication.error),
    };
  }
  return authentication;
}

export async function POST(request: Request) {
  const authorization = await authorize(request);
  if (!authorization.ok) return withResponseHeaders(authorization.response, request);

  const server = createSageumMcpServer({
    ownerId: authorization.ownerId,
    accessToken: authorization.accessToken,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, {
      authInfo: authorization.authInfo,
    });
    return withResponseHeaders(response, request);
  } catch (error) {
    console.error('Sageum MCP request failed', error);
    return withResponseHeaders(jsonRpcError(request, 500, 'MCP 요청 처리에 실패했습니다.'), request);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

export async function GET(request: Request) {
  const authorization = await authorize(request);
  if (!authorization.ok) return withResponseHeaders(authorization.response, request);
  return withResponseHeaders(jsonRpcError(request, 405, 'Stateless MCP는 POST 요청만 지원합니다.'), request);
}

export async function DELETE(request: Request) {
  const authorization = await authorize(request);
  if (!authorization.ok) return withResponseHeaders(authorization.response, request);
  return withResponseHeaders(jsonRpcError(request, 405, 'Stateless MCP에는 삭제할 세션이 없습니다.'), request);
}

export async function OPTIONS(request: Request) {
  if (!isAllowedMcpOrigin(request)) return jsonRpcError(request, 403, '허용되지 않은 Origin입니다.');
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
