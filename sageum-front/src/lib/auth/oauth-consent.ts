const AUTHORIZATION_ID_PATTERN = /^[a-z0-9_-]{8,256}$/iu;

export function validOAuthAuthorizationId(value: string | null | undefined) {
  const authorizationId = value?.trim() ?? '';
  return AUTHORIZATION_ID_PATTERN.test(authorizationId) ? authorizationId : null;
}

export function safeOAuthCallbackUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return url;
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    return url.protocol === 'http:' && loopbackHosts.has(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: '계정 식별 정보 확인',
  email: '로그인 이메일 확인',
  profile: '기본 프로필 정보 확인',
  phone: '등록된 전화번호 확인',
};

export function oauthScopeLabels(scope: string) {
  const scopes = [...new Set(scope.split(/\s+/u).map((item) => item.trim()).filter(Boolean))];
  return scopes.map((name) => ({
    name,
    description: SCOPE_DESCRIPTIONS[name] ?? `${name} 권한`,
  }));
}
