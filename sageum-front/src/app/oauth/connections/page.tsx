import { ArrowLeft, Bot, ShieldCheck, Unplug, UploadCloud } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { oauthScopeLabels } from '@/lib/auth/oauth-consent';
import { createClient } from '@/lib/supabase/server';
import {
  revokeOAuthConnectionAction,
  setOAuthConnectionUploadPermissionAction,
} from './actions';

type OAuthConnectionsPageProps = {
  searchParams: Promise<{ error?: string; revoked?: string; updated?: string }>;
};

export default async function OAuthConnectionsPage({ searchParams }: OAuthConnectionsPageProps) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims.sub) redirect('/login?next=/oauth/connections');

  const params = await searchParams;
  const [{ data: grants, error }, { data: permissions, error: permissionsError }] = await Promise.all([
    supabase.auth.oauth.listGrants(),
    supabase.from('mcp_repository_permissions').select('client_id,can_upload'),
  ]);
  const uploadClients = new Set(
    permissions?.filter((permission) => permission.can_upload).map((permission) => permission.client_id) ?? [],
  );
  return (
    <main className="oauth-connections-page">
      <header>
        <div>
          <span className="eyebrow">OAUTH CONNECTIONS</span>
          <h1>에이전트 연결 관리</h1>
          <p>내 Sageum 문서 저장소에 접근하도록 승인한 외부 MCP 클라이언트를 관리합니다.</p>
        </div>
        <Link href="/"><ArrowLeft size={16} /> 문서 저장소로</Link>
      </header>

      {params.revoked ? <p className="oauth-notice"><ShieldCheck size={16} /> 연결을 해제했습니다.</p> : null}
      {params.updated ? (
        <p className="oauth-notice"><ShieldCheck size={16} /> MCP 문서 업로드 권한을 변경했습니다.</p>
      ) : null}
      {params.error || error || permissionsError ? (
        <p className="oauth-error" role="alert">OAuth 연결 목록을 처리하지 못했습니다. Supabase OAuth Server 설정을 확인해 주세요.</p>
      ) : null}

      <section className="oauth-connection-list" aria-label="승인된 OAuth 연결">
        {grants?.length ? grants.map((grant) => (
          <article key={grant.client.id}>
            <span className="oauth-connection-icon"><Bot size={22} /></span>
            <div>
              <h2>{grant.client.name || '외부 MCP 클라이언트'}</h2>
              <p>{grant.client.uri || grant.client.id}</p>
              <div className="oauth-connection-scopes">
                {oauthScopeLabels(grant.scopes.join(' ')).map((scope) => (
                  <span key={scope.name}>{scope.name}</span>
                ))}
                <span className={uploadClients.has(grant.client.id) ? 'is-write-enabled' : 'is-write-disabled'}>
                  {uploadClients.has(grant.client.id) ? '문서 업로드 허용' : '읽기 전용'}
                </span>
              </div>
              <small>승인일 {new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(grant.granted_at))}</small>
            </div>
            <div className="oauth-connection-actions">
              <form action={setOAuthConnectionUploadPermissionAction}>
                <input type="hidden" name="client_id" value={grant.client.id} />
                <input
                  type="hidden"
                  name="can_upload"
                  value={uploadClients.has(grant.client.id) ? 'false' : 'true'}
                />
                <button className="oauth-upload-permission" type="submit">
                  <UploadCloud size={15} />
                  {uploadClients.has(grant.client.id) ? '업로드 차단' : '업로드 허용'}
                </button>
              </form>
              <form action={revokeOAuthConnectionAction}>
                <input type="hidden" name="client_id" value={grant.client.id} />
                <button type="submit"><Unplug size={15} /> 연결 해제</button>
              </form>
            </div>
          </article>
        )) : (
          <div className="oauth-empty-state">
            <ShieldCheck size={28} />
            <strong>승인된 에이전트가 없습니다.</strong>
            <p>OAuth를 지원하는 MCP 클라이언트에 Sageum URL을 등록하면 여기에서 연결을 관리할 수 있습니다.</p>
          </div>
        )}
      </section>
    </main>
  );
}
