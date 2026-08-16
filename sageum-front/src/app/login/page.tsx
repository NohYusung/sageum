import { BookOpenText, Network, ShieldCheck } from 'lucide-react';
import { redirect } from 'next/navigation';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';
import { LoginForm } from './login-form';

type LoginPageProps = {
  searchParams: Promise<{ next?: string; confirmed?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (claims) redirect('/');

  const params = await searchParams;
  const nextPath = safeRedirectPath(params.next);
  const callbackMessage = params.confirmed
    ? '이메일 인증이 완료되었습니다. 이제 로그인해 주세요.'
    : params.error
      ? '이메일 인증 링크가 만료되었거나 올바르지 않습니다.'
      : null;

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span>S</span>
          <div>
            <strong>SAGEUM</strong>
            <small>DOCUMENT INTELLIGENCE</small>
          </div>
        </div>

        <div className="auth-story-copy">
          <span className="eyebrow">SCATTERED DOCUMENTS, CONNECTED KNOWLEDGE</span>
          <h1 className="auth-brand-title" id="auth-title">
            <span className="auth-title-line">흩어진 문서를 모아,</span>
            <span className="auth-title-line">가치 있는 지식으로.</span>
          </h1>
          <p>모래 속 사금처럼 곳곳에 흩어진 문서를 모아 의미로 연결하고, 질문하면 원문 근거와 함께 답하는 개인용 RAG 저장소입니다.</p>
        </div>

        <div className="auth-features">
          <span><BookOpenText size={18} /> 흩어진 문서 수집·구조화</span>
          <span><Network size={18} /> 의미 기반 지식 연결</span>
          <span><ShieldCheck size={18} /> 근거가 확인되는 답변</span>
        </div>
      </section>

      <section className="auth-panel" aria-label="계정 인증">
        <div className="auth-card">
          <span className="eyebrow">MEMBER ACCESS</span>
          <LoginForm nextPath={nextPath} callbackMessage={callbackMessage} />
          <small className="auth-privacy"><ShieldCheck size={14} /> 세션은 보안 쿠키로만 유지됩니다.</small>
        </div>
      </section>
    </main>
  );
}
