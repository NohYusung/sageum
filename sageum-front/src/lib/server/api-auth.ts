import { createClient } from '@/lib/supabase/server';

export async function getAuthenticatedRequestContext() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const ownerId = data?.claims.sub;
  if (!ownerId) return null;
  return { ownerId, supabase };
}
