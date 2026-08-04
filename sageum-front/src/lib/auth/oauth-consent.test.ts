import assert from 'node:assert/strict';
import test from 'node:test';
import {
  oauthScopeLabels,
  safeOAuthCallbackUrl,
  validOAuthAuthorizationId,
} from './oauth-consent';

test('OAuth authorization IDs are bounded before being sent to Supabase Auth', () => {
  assert.equal(validOAuthAuthorizationId(' authorization_123 '), 'authorization_123');
  assert.equal(validOAuthAuthorizationId('../callback'), null);
  assert.equal(validOAuthAuthorizationId('short'), null);
});

test('OAuth callbacks allow HTTPS and loopback HTTP only', () => {
  assert.equal(safeOAuthCallbackUrl('https://client.example/callback')?.origin, 'https://client.example');
  assert.equal(safeOAuthCallbackUrl('http://127.0.0.1:43110/callback')?.port, '43110');
  assert.equal(safeOAuthCallbackUrl('http://attacker.example/callback'), null);
  assert.equal(safeOAuthCallbackUrl('javascript:alert(1)'), null);
});

test('OAuth scope labels are deduplicated and human readable', () => {
  assert.deepEqual(oauthScopeLabels('email profile email'), [
    { name: 'email', description: '로그인 이메일 확인' },
    { name: 'profile', description: '기본 프로필 정보 확인' },
  ]);
});
