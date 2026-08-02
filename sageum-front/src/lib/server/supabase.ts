import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { requireServerEnvironment } from './env';

let adminClient: SupabaseClient<Database> | null = null;

export function getSupabaseAdminClient() {
  if (adminClient) return adminClient;

  adminClient = createClient<Database>(
    requireServerEnvironment('NEXT_PUBLIC_SUPABASE_URL'),
    requireServerEnvironment('SUPABASE_SECRET_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  return adminClient;
}
