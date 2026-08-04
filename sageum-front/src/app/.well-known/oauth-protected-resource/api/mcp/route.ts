import { sageumMcpProtectedResourceResponse } from '@/lib/server/mcp-oauth';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return sageumMcpProtectedResourceResponse(request);
}
