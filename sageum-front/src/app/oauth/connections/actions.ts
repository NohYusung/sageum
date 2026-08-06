'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function revokeOAuthConnectionAction(formData: FormData) {
  const clientId = String(formData.get('client_id') ?? '').trim();
  if (!UUID_PATTERN.test(clientId)) redirect('/oauth/connections?error=invalid-client');

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const ownerId = data?.claims.sub;
  if (!ownerId) redirect('/login?next=/oauth/connections');

  const { error: permissionError } = await supabase
    .from('mcp_repository_permissions')
    .delete()
    .eq('owner_id', ownerId)
    .eq('client_id', clientId);
  if (permissionError) redirect('/oauth/connections?error=permission');

  const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
  if (error) redirect('/oauth/connections?error=revoke');

  revalidatePath('/oauth/connections');
  redirect('/oauth/connections?revoked=1');
}

export async function setOAuthConnectionUploadPermissionAction(formData: FormData) {
  const clientId = String(formData.get('client_id') ?? '').trim();
  if (!UUID_PATTERN.test(clientId)) redirect('/oauth/connections?error=invalid-client');
  const canUpload = formData.get('can_upload') === 'true';

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const ownerId = data?.claims.sub;
  if (!ownerId) redirect('/login?next=/oauth/connections');

  const { data: grants, error: grantsError } = await supabase.auth.oauth.listGrants();
  if (grantsError || !grants?.some((grant) => grant.client.id === clientId)) {
    redirect('/oauth/connections?error=missing-grant');
  }

  const { error } = await supabase
    .from('mcp_repository_permissions')
    .upsert({
      owner_id: ownerId,
      client_id: clientId,
      can_upload: canUpload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,client_id' });
  if (error) redirect('/oauth/connections?error=permission');

  revalidatePath('/oauth/connections');
  redirect(`/oauth/connections?updated=${canUpload ? 'upload-enabled' : 'upload-disabled'}`);
}
