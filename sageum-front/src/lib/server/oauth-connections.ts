import type { OAuthConnectionsState } from '@/lib/auth/oauth-connections';
import { createClient } from '@/lib/supabase/server';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export async function listOAuthConnections(
  supabase: ServerSupabaseClient,
  ownerId: string,
): Promise<OAuthConnectionsState> {
  const [{ data: grants, error: grantsError }, { data: permissions, error: permissionsError }] = (
    await Promise.all([
      supabase.auth.oauth.listGrants(),
      supabase
        .from('mcp_repository_permissions')
        .select('client_id,can_upload')
        .eq('owner_id', ownerId),
    ])
  );

  if (grantsError || permissionsError) {
    console.error('Failed to load OAuth connections', grantsError ?? permissionsError);
    return { connections: [], error: true };
  }

  const uploadClients = new Set(
    permissions
      ?.filter((permission) => permission.can_upload)
      .map((permission) => permission.client_id) ?? [],
  );
  return {
    connections: grants?.map((grant) => ({
      clientId: grant.client.id,
      clientName: grant.client.name || '외부 MCP 클라이언트',
      clientUri: grant.client.uri || grant.client.id,
      scopes: grant.scopes,
      canUpload: uploadClients.has(grant.client.id),
      grantedAt: String(grant.granted_at),
    })) ?? [],
    error: false,
  };
}
