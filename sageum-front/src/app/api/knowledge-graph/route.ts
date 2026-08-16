import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { getSemanticKnowledgeGraph } from '@/lib/server/semantic-graph-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get('folderId')?.trim() || undefined;
  const documentQuery = searchParams.get('query')?.trim() || undefined;
  try {
    const graph = await getSemanticKnowledgeGraph(context.supabase, context.ownerId, {
      folderId,
      documentQuery,
    });
    return Response.json({ graph }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '문서 그래프를 불러오지 못했습니다.';
    return Response.json({ error: message }, { status: message.includes('찾을 수 없습니다') ? 404 : 500 });
  }
}
