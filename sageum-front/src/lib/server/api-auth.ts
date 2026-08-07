import { createClient } from '@/lib/supabase/server';

export type AuthenticatedRequestContext = {
  ownerId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
};

export async function getAuthenticatedRequestContext(): Promise<AuthenticatedRequestContext | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const ownerId = data?.claims.sub;
  if (!ownerId) return null;
  return { ownerId, supabase };
}
