import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { listRuleDocuments } from '@/lib/server/knowledge-relations-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  try {
    return Response.json(
      { ruleDocuments: await listRuleDocuments(context.supabase, context.ownerId) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Failed to list rule documents', error);
    return Response.json({ error: '비즈니스 규칙을 불러오지 못했습니다.' }, { status: 500 });
  }
}
