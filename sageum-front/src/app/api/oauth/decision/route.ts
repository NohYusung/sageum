import { NextResponse } from 'next/server';
import {
  safeOAuthCallbackUrl,
  validOAuthAuthorizationId,
} from '@/lib/auth/oauth-consent';
import { createClient } from '@/lib/supabase/server';

function consentErrorRedirect(request: Request, authorizationId: string) {
  const target = new URL('/oauth/consent', request.url);
  target.searchParams.set('authorization_id', authorizationId);
  target.searchParams.set('error', 'decision');
  return NextResponse.redirect(target, 303);
}

export async function POST(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin && origin !== requestOrigin) {
    return Response.json({ error: '허용되지 않은 OAuth 요청입니다.' }, { status: 403 });
  }

  const formData = await request.formData();
  const authorizationId = validOAuthAuthorizationId(String(formData.get('authorization_id') ?? ''));
  const decision = formData.get('decision');
  if (!authorizationId || (decision !== 'approve' && decision !== 'deny')) {
    return Response.json({ error: '올바른 OAuth 승인 정보가 필요합니다.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims.sub) {
    return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const result = decision === 'approve'
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (result.error || !result.data) return consentErrorRedirect(request, authorizationId);

  const callback = safeOAuthCallbackUrl(result.data.redirect_url);
  if (!callback) {
    return Response.json({ error: '등록된 OAuth 콜백 주소가 안전하지 않습니다.' }, { status: 400 });
  }
  return NextResponse.redirect(callback, 303);
}
