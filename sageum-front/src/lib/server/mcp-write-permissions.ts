import { getSupabaseAdminClient } from '@/lib/server/supabase';

export async function canMcpClientUpload(ownerId: string, clientId: string) {
  const { data, error } = await getSupabaseAdminClient()
    .from('mcp_repository_permissions')
    .select('can_upload')
    .eq('owner_id', ownerId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) {
    console.error('Failed to resolve MCP repository write permission', error);
    return false;
  }
  return data?.can_upload === true;
}
