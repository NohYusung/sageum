import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ruleId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { ruleId } = await params;
  if (!UUID_PATTERN.test(ruleId)) {
    return Response.json({ error: '올바른 규칙 식별자가 필요합니다.' }, { status: 400 });
  }
  const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== 'boolean') {
    return Response.json({ error: 'enabled 불리언 값이 필요합니다.' }, { status: 400 });
  }
  const { data, error } = await getSupabaseAdminClient()
    .from('knowledge_rules')
    .update({ enabled: body.enabled, updated_at: new Date().toISOString() })
    .eq('id', ruleId)
    .eq('owner_id', context.ownerId)
    .select('id,enabled')
    .maybeSingle();
  if (error) return Response.json({ error: '규칙 상태를 변경하지 못했습니다.' }, { status: 500 });
  if (!data) return Response.json({ error: '규칙을 찾을 수 없습니다.' }, { status: 404 });
  return Response.json({ rule: data });
}
