'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { validateCredentials, validatePasswordConfirmation } from '@/lib/auth/credentials';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';

export type AuthActionState = {
  status: 'idle' | 'error' | 'confirmation-sent';
  message: string;
};

function authErrorMessage(message: string) {
  const normalized = message.toLocaleLowerCase('en-US');

  if (normalized.includes('invalid login credentials')) {
    return '이메일 또는 비밀번호를 확인해 주세요.';
  }
  if (normalized.includes('email not confirmed')) {
    return '받은 편지함에서 이메일 인증을 먼저 완료해 주세요.';
  }
  if (normalized.includes('user already registered')) {
    return '이미 가입된 이메일입니다. 로그인해 주세요.';
  }
  if (normalized.includes('signup is disabled')) {
    return '현재 새 계정 가입이 비활성화되어 있습니다.';
  }

  return '인증 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
}

async function requestOrigin() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredUrl) return new URL(configuredUrl).origin;

  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http';
  if (!host) return 'http://localhost:3000';
  return new URL(`${protocol}://${host}`).origin;
}

export async function authenticateAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const validation = validateCredentials(formData);
  if (!validation.success) {
    return { status: 'error', message: validation.message };
  }

  const intent = formData.get('intent') === 'signup' ? 'signup' : 'login';
  const next = safeRedirectPath(String(formData.get('next') ?? '/'));
  const supabase = await createClient();

  if (intent === 'signup') {
    const confirmationError = validatePasswordConfirmation(
      validation.data.password,
      String(formData.get('confirmPassword') ?? ''),
    );
    if (confirmationError) return { status: 'error', message: confirmationError };

    const origin = await requestOrigin();
    const { data, error } = await supabase.auth.signUp({
      ...validation.data,
      options: { emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}` },
    });

    if (error) return { status: 'error', message: authErrorMessage(error.message) };
    if (data.session) redirect(next);

    return {
      status: 'confirmation-sent',
      message: '가입 확인 메일을 보냈습니다. 메일의 링크를 열어 가입을 완료해 주세요.',
    };
  }

  const { error } = await supabase.auth.signInWithPassword(validation.data);
  if (error) return { status: 'error', message: authErrorMessage(error.message) };

  redirect(next);
}
