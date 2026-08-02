'use client';

import { LoaderCircle, LogIn, UserPlus } from 'lucide-react';
import { useActionState } from 'react';
import { authenticateAction, type AuthActionState } from './actions';

const INITIAL_STATE: AuthActionState = { status: 'idle', message: '' };

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, pending] = useActionState(authenticateAction, INITIAL_STATE);

  return (
    <form className="auth-form" action={formAction}>
      <input type="hidden" name="next" value={nextPath} />

      <label>
        <span>이메일</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          autoFocus
        />
      </label>

      <label>
        <span>비밀번호</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="6자 이상 입력"
          minLength={6}
          required
        />
      </label>

      {state.message ? (
        <p className={`auth-feedback ${state.status}`} role={state.status === 'error' ? 'alert' : 'status'}>
          {state.message}
        </p>
      ) : null}

      <div className="auth-actions">
        <button className="auth-primary" type="submit" name="intent" value="login" disabled={pending}>
          {pending ? <LoaderCircle className="spin" size={17} /> : <LogIn size={17} />}
          로그인
        </button>
        <button className="auth-secondary" type="submit" name="intent" value="signup" disabled={pending}>
          <UserPlus size={17} />
          새 계정 만들기
        </button>
      </div>
    </form>
  );
}
