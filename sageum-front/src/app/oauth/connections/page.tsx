import { ArrowLeft, Bot, ShieldCheck, Unplug } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { oauthScopeLabels } from '@/lib/auth/oauth-consent';
import { createClient } from '@/lib/supabase/server';
import { revokeOAuthConnectionAction } from './actions';

type OAuthConnectionsPageProps = {
  searchParams: Promise<{ error?: string; revoked?: string }>;
};

export default async function OAuthConnectionsPage({ searchParams }: OAuthConnectionsPageProps) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims.sub) redirect('/login?next=/oauth/connections');

  const params = await searchParams;
  const { data: grants, error } = await supabase.auth.oauth.listGrants();
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
      {params.error || error ? (
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
              </div>
              <small>승인일 {new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(grant.granted_at))}</small>
            </div>
            <form action={revokeOAuthConnectionAction}>
              <input type="hidden" name="client_id" value={grant.client.id} />
              <button type="submit"><Unplug size={15} /> 연결 해제</button>
            </form>
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
