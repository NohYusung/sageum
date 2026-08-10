'use client';

import { ArrowLeft, LoaderCircle, LogIn, MailCheck, UserPlus } from 'lucide-react';
import { useActionState, useState } from 'react';
import { authenticateAction, type AuthActionState } from './actions';

const INITIAL_STATE: AuthActionState = { status: 'idle', message: '' };

type AuthMode = 'login' | 'signup';

type AuthModeFormProps = {
  mode: AuthMode;
  email: string;
  nextPath: string;
  callbackMessage: string | null;
  onEmailChange: (email: string) => void;
  onModeChange: (mode: AuthMode) => void;
};

function AuthModeForm({
  mode,
  email,
  nextPath,
  callbackMessage,
  onEmailChange,
  onModeChange,
}: AuthModeFormProps) {
  const [state, formAction, pending] = useActionState(authenticateAction, INITIAL_STATE);
  const isSignup = mode === 'signup';

  if (isSignup && state.status === 'confirmation-sent') {
    return (
      <div className="auth-confirmation" role="status">
        <span className="auth-confirmation-icon">
          <MailCheck size={25} />
        </span>
        <div className="auth-mode-heading">
          <h2>받은 편지함을 확인하세요</h2>
          <p>
            <strong>{email}</strong> 주소로 가입 확인 메일을 보냈습니다.
          </p>
        </div>
        <p className="auth-feedback confirmation-sent">{state.message}</p>
        <button className="auth-secondary" type="button" onClick={() => onModeChange('login')}>
          <ArrowLeft size={17} />
          로그인으로 돌아가기
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="auth-mode-heading">
        <h2>{isSignup ? '새 계정 만들기' : '문서 저장소에 로그인'}</h2>
        <p>
          {isSignup
            ? '이메일 인증을 완료하면 개인 문서 공간을 사용할 수 있습니다.'
            : '이메일 계정으로 개인 문서 공간에 접속하세요.'}
        </p>
      </div>

      {!isSignup && callbackMessage ? (
        <p className="auth-callback" role="status">{callbackMessage}</p>
      ) : null}

      <form className="auth-form" action={formAction}>
        <input type="hidden" name="next" value={nextPath} />
        <input type="hidden" name="intent" value={mode} />

        <label>
          <span>이메일</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            required
            autoFocus
          />
        </label>

        <label>
          <span>비밀번호</span>
          <input
            name="password"
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            placeholder="6자 이상 입력"
            minLength={6}
            required
          />
        </label>

        {isSignup ? (
          <label>
            <span>비밀번호 확인</span>
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="비밀번호를 다시 입력"
              minLength={6}
              required
            />
          </label>
        ) : null}

        {state.message ? (
          <p
            className={`auth-feedback ${state.status}`}
            role={state.status === 'error' ? 'alert' : 'status'}
          >
            {state.message}
          </p>
        ) : null}

        <div className="auth-actions">
          <button className="auth-primary" type="submit" disabled={pending}>
            {pending ? (
              <LoaderCircle className="spin" size={17} />
            ) : isSignup ? (
              <UserPlus size={17} />
            ) : (
              <LogIn size={17} />
            )}
            {pending
              ? (isSignup ? '메일 보내는 중' : '로그인 중')
              : (isSignup ? '가입 확인 메일 보내기' : '로그인')}
          </button>
          <button
            className="auth-secondary"
            type="button"
            disabled={pending}
            onClick={() => onModeChange(isSignup ? 'login' : 'signup')}
          >
            {isSignup ? <ArrowLeft size={17} /> : <UserPlus size={17} />}
            {isSignup ? '로그인으로 돌아가기' : '새 계정 만들기'}
          </button>
        </div>
      </form>
    </>
  );
}

export function LoginForm({
  nextPath,
  callbackMessage,
}: {
  nextPath: string;
  callbackMessage: string | null;
}) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');

  return (
    <AuthModeForm
      key={mode}
      mode={mode}
      email={email}
      nextPath={nextPath}
      callbackMessage={callbackMessage}
      onEmailChange={setEmail}
      onModeChange={setMode}
    />
  );
}
