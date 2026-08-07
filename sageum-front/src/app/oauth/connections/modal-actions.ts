'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type OAuthConnectionModalActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateOAuthConnectionUploadPermission(
  clientId: string,
  canUpload: boolean,
): Promise<OAuthConnectionModalActionResult> {
  if (!UUID_PATTERN.test(clientId)) return { ok: false, error: '올바른 에이전트 연결 정보가 아닙니다.' };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const ownerId = data?.claims.sub;
  if (!ownerId) return { ok: false, error: '로그인이 필요합니다.' };

  const { data: grants, error: grantsError } = await supabase.auth.oauth.listGrants();
  if (grantsError || !grants?.some((grant) => grant.client.id === clientId)) {
    return { ok: false, error: '승인된 에이전트 연결을 찾지 못했습니다.' };
  }

  const { error } = await supabase
    .from('mcp_repository_permissions')
    .upsert({
      owner_id: ownerId,
      client_id: clientId,
      can_upload: canUpload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,client_id' });
  if (error) return { ok: false, error: '문서 업로드 권한을 변경하지 못했습니다.' };

  revalidatePath('/');
  revalidatePath('/oauth/connections');
  return { ok: true };
}

export async function revokeOAuthConnectionFromModal(
  clientId: string,
): Promise<OAuthConnectionModalActionResult> {
  if (!UUID_PATTERN.test(clientId)) return { ok: false, error: '올바른 에이전트 연결 정보가 아닙니다.' };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const ownerId = data?.claims.sub;
  if (!ownerId) return { ok: false, error: '로그인이 필요합니다.' };

  const { error: permissionError } = await supabase
    .from('mcp_repository_permissions')
    .delete()
    .eq('owner_id', ownerId)
    .eq('client_id', clientId);
  if (permissionError) return { ok: false, error: '에이전트 권한 정보를 삭제하지 못했습니다.' };

  const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
  if (error) return { ok: false, error: '에이전트 연결을 해제하지 못했습니다.' };

  revalidatePath('/');
  revalidatePath('/oauth/connections');
  return { ok: true };
}
