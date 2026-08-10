import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCredentials, validatePasswordConfirmation } from './credentials';
import { safeRedirectPath } from './redirect';

function form(email: string, password: string) {
  const data = new FormData();
  data.set('email', email);
  data.set('password', password);
  return data;
}

test('로그인 이메일을 정규화한다', () => {
  assert.deepEqual(validateCredentials(form(' Demo@Example.com ', 'secret12')), {
    success: true,
    data: { email: 'demo@example.com', password: 'secret12' },
  });
});

test('잘못된 이메일과 짧은 비밀번호를 거부한다', () => {
  assert.equal(validateCredentials(form('invalid', 'secret12')).success, false);
  assert.equal(validateCredentials(form('demo@example.com', '12345')).success, false);
});

test('회원가입 비밀번호 확인이 일치해야 한다', () => {
  assert.equal(validatePasswordConfirmation('secret12', ''), '비밀번호 확인을 입력해 주세요.');
  assert.equal(
    validatePasswordConfirmation('secret12', 'different'),
    '비밀번호가 서로 일치하지 않습니다.',
  );
  assert.equal(validatePasswordConfirmation('secret12', 'secret12'), null);
});

test('내부 경로만 로그인 후 이동 경로로 허용한다', () => {
  assert.equal(safeRedirectPath('/documents?tab=ready'), '/documents?tab=ready');
  assert.equal(safeRedirectPath('https://example.com'), '/');
  assert.equal(safeRedirectPath('//example.com'), '/');
});
