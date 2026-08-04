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
  if (!data?.claims.sub) redirect('/login?next=/oauth/connections');

  const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
  if (error) redirect('/oauth/connections?error=revoke');

  revalidatePath('/oauth/connections');
  redirect('/oauth/connections?revoked=1');
}
