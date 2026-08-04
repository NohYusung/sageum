import { Bot, Database, FileSearch, ShieldCheck } from 'lucide-react';
import { redirect } from 'next/navigation';
import {
  oauthScopeLabels,
  safeOAuthCallbackUrl,
  validOAuthAuthorizationId,
} from '@/lib/auth/oauth-consent';
import { createClient } from '@/lib/supabase/server';

type OAuthConsentPageProps = {
  searchParams: Promise<{ authorization_id?: string; error?: string }>;
};

function ConsentError({ message }: { message: string }) {
  return (
    <main className="auth-shell oauth-shell">
      <section className="auth-story" aria-labelledby="oauth-error-title">
        <div className="auth-brand">
          <span>S</span>
          <div><strong>SAGEUM</strong><small>SECURE AGENT ACCESS</small></div>
        </div>
        <div className="auth-story-copy">
          <span className="eyebrow">OAUTH 2.1 AUTHORIZATION</span>
          <h1 id="oauth-error-title">연결 요청을<br />확인하지 못했습니다.</h1>
          <p>요청이 만료됐거나 OAuth 설정이 완료되지 않았을 수 있습니다. 외부 에이전트에서 연결을 다시 시작해 주세요.</p>
        </div>
      </section>
      <section className="auth-panel" aria-label="OAuth 오류">
        <div className="auth-card">
          <span className="eyebrow">CONNECTION ERROR</span>
          <h2>승인 요청 오류</h2>
          <p className="oauth-error" role="alert">{message}</p>
        </div>
      </section>
    </main>
  );
}

export default async function OAuthConsentPage({ searchParams }: OAuthConsentPageProps) {
  const params = await searchParams;
  const authorizationId = validOAuthAuthorizationId(params.authorization_id);
  if (!authorizationId) return <ConsentError message="올바른 OAuth 승인 식별자가 없습니다." />;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims.sub) {
    redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`);
  }

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    return <ConsentError message="OAuth 승인 요청이 만료됐거나 활성화되지 않았습니다." />;
  }
  if (!('authorization_id' in data)) {
    const callback = safeOAuthCallbackUrl(data.redirect_url);
    if (!callback) return <ConsentError message="등록된 OAuth 콜백 주소가 안전하지 않습니다." />;
    redirect(callback.toString());
  }

  const scopes = oauthScopeLabels(data.scope);
  return (
    <main className="auth-shell oauth-shell">
      <section className="auth-story" aria-labelledby="oauth-title">
        <div className="auth-brand">
          <span>S</span>
          <div><strong>SAGEUM</strong><small>SECURE AGENT ACCESS</small></div>
        </div>
        <div className="auth-story-copy">
          <span className="eyebrow">OAUTH 2.1 AUTHORIZATION</span>
          <h1 id="oauth-title">내 문서 저장소를<br />에이전트와 연결합니다.</h1>
          <p>승인된 에이전트는 현재 계정이 소유한 구조화 문서와 검색 근거만 읽을 수 있습니다.</p>
        </div>
        <div className="auth-features">
          <span><FileSearch size={18} /> 근거 청크 검색</span>
          <span><Database size={18} /> 사용자별 저장소 격리</span>
          <span><ShieldCheck size={18} /> 언제든 연결 해제 가능</span>
        </div>
      </section>

      <section className="auth-panel" aria-label="외부 에이전트 접근 승인">
        <div className="auth-card oauth-consent-card">
          <span className="eyebrow">AGENT ACCESS REQUEST</span>
          <div className="oauth-client-heading">
            <span><Bot size={24} /></span>
            <div>
              <h2>{data.client.name || '외부 MCP 클라이언트'}</h2>
              <p>{data.client.uri || data.redirect_uri}</p>
            </div>
          </div>

          {params.error ? (
            <p className="oauth-error" role="alert">승인 처리에 실패했습니다. 다시 시도해 주세요.</p>
          ) : null}

          <div className="oauth-request-summary">
            <strong>요청하는 접근</strong>
            <ul>
              <li><ShieldCheck size={16} /><span>현재 로그인 계정의 문서만 읽기</span></li>
              <li><FileSearch size={16} /><span>문서·폴더·검색 근거 및 임시 원본 링크 조회</span></li>
              {scopes.map((scope) => (
                <li key={scope.name}><span className="oauth-scope">{scope.name}</span><span>{scope.description}</span></li>
              ))}
            </ul>
          </div>

          <p className="oauth-account">연결 계정 <strong>{data.user.email}</strong></p>
          <form className="oauth-consent-actions" action="/api/oauth/decision" method="post">
            <input type="hidden" name="authorization_id" value={authorizationId} />
            <button className="auth-secondary" type="submit" name="decision" value="deny">거부</button>
            <button className="auth-primary" type="submit" name="decision" value="approve">연결 승인</button>
          </form>
          <small className="auth-privacy"><ShieldCheck size={14} /> Sageum은 OAuth 비밀번호를 외부 에이전트에 전달하지 않습니다.</small>
        </div>
      </section>
    </main>
  );
}
