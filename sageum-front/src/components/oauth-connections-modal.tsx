'use client';

import {
  Bot,
  LoaderCircle,
  ShieldCheck,
  Unplug,
  UploadCloud,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  revokeOAuthConnectionFromModal,
  updateOAuthConnectionUploadPermission,
} from '@/app/oauth/connections/modal-actions';
import type { OAuthConnectionSummary } from '@/lib/auth/oauth-connections';
import { oauthScopeLabels } from '@/lib/auth/oauth-consent';

type OAuthConnectionsModalProps = {
  initialConnections: OAuthConnectionSummary[];
  initialError: boolean;
  onClose: () => void;
  open: boolean;
};

function grantedAtLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '승인일 정보 없음';
  return `승인일 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(date)}`;
}

export function OAuthConnectionsModal({
  initialConnections,
  initialError,
  onClose,
  open,
}: OAuthConnectionsModalProps) {
  const [connections, setConnections] = useState(initialConnections);
  const [busyClientId, setBusyClientId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'permission' | 'revoke' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(
    initialError ? 'OAuth 연결 목록을 불러오지 못했습니다. Supabase OAuth Server 설정을 확인해 주세요.' : null,
  );
  const modalRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const busyClientIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !busyClientIdRef.current) {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const modal = modalRef.current;
      if (!modal) return;
      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open]);

  async function handlePermissionChange(connection: OAuthConnectionSummary) {
    busyClientIdRef.current = connection.clientId;
    setBusyClientId(connection.clientId);
    setBusyAction('permission');
    setActionError(null);
    setNotice(null);
    try {
      const canUpload = !connection.canUpload;
      const result = await updateOAuthConnectionUploadPermission(connection.clientId, canUpload);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setConnections((current) => current.map((item) => (
        item.clientId === connection.clientId ? { ...item, canUpload } : item
      )));
      setNotice(canUpload ? 'MCP 문서 업로드를 허용했습니다.' : 'MCP 문서 업로드를 차단했습니다.');
    } catch {
      setActionError('문서 업로드 권한을 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      busyClientIdRef.current = null;
      setBusyClientId(null);
      setBusyAction(null);
    }
  }

  async function handleRevoke(connection: OAuthConnectionSummary) {
    busyClientIdRef.current = connection.clientId;
    setBusyClientId(connection.clientId);
    setBusyAction('revoke');
    setActionError(null);
    setNotice(null);
    try {
      const result = await revokeOAuthConnectionFromModal(connection.clientId);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setConnections((current) => current.filter((item) => item.clientId !== connection.clientId));
      setNotice(`${connection.clientName} 연결을 해제했습니다.`);
    } catch {
      setActionError('에이전트 연결을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      busyClientIdRef.current = null;
      setBusyClientId(null);
      setBusyAction(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="oauth-connections-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busyClientId) onClose();
      }}
    >
      <section
        aria-busy={Boolean(busyClientId)}
        aria-labelledby="oauth-connections-modal-title"
        aria-modal="true"
        className="oauth-connections-modal"
        ref={modalRef}
        role="dialog"
      >
        <header className="oauth-connections-modal-header">
          <div>
            <span className="eyebrow">OAUTH CONNECTIONS</span>
            <div className="oauth-connections-modal-title-row">
              <h2 id="oauth-connections-modal-title">에이전트 연결 관리</h2>
              <span>{connections.length}개 연결</span>
            </div>
            <p>내 문서 저장소에 접근하도록 승인한 외부 MCP 클라이언트를 관리합니다.</p>
          </div>
          <button
            aria-label="에이전트 연결 관리 닫기"
            disabled={Boolean(busyClientId)}
            ref={closeRef}
            title="닫기 (Esc)"
            type="button"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>

        <div className="oauth-connections-modal-body">
          {notice ? <p className="oauth-notice"><ShieldCheck size={16} /> {notice}</p> : null}
          {actionError ? <p className="oauth-error" role="alert">{actionError}</p> : null}

          <section className="oauth-connection-list" aria-label="승인된 OAuth 연결">
            {connections.length ? connections.map((connection) => {
              const busy = busyClientId === connection.clientId;
              return (
                <article key={connection.clientId}>
                  <span className="oauth-connection-icon"><Bot size={22} /></span>
                  <div>
                    <h2>{connection.clientName}</h2>
                    <p>{connection.clientUri}</p>
                    <div className="oauth-connection-scopes">
                      {oauthScopeLabels(connection.scopes.join(' ')).map((scope) => (
                        <span key={scope.name}>{scope.name}</span>
                      ))}
                      <span className={connection.canUpload ? 'is-write-enabled' : 'is-write-disabled'}>
                        {connection.canUpload ? '문서 업로드 허용' : '읽기 전용'}
                      </span>
                    </div>
                    <small>{grantedAtLabel(connection.grantedAt)}</small>
                  </div>
                  <div className="oauth-connection-actions">
                    <button
                      className="oauth-upload-permission"
                      disabled={Boolean(busyClientId)}
                      type="button"
                      onClick={() => void handlePermissionChange(connection)}
                    >
                      {busy && busyAction === 'permission'
                        ? <LoaderCircle className="spin" size={15} />
                        : <UploadCloud size={15} />}
                      {connection.canUpload ? '업로드 차단' : '업로드 허용'}
                    </button>
                    <button
                      disabled={Boolean(busyClientId)}
                      type="button"
                      onClick={() => void handleRevoke(connection)}
                    >
                      {busy && busyAction === 'revoke'
                        ? <LoaderCircle className="spin" size={15} />
                        : <Unplug size={15} />}
                      연결 해제
                    </button>
                  </div>
                </article>
              );
            }) : (
              <div className="oauth-empty-state">
                <ShieldCheck size={28} />
                <strong>승인된 에이전트가 없습니다.</strong>
                <p>OAuth를 지원하는 MCP 클라이언트에 Sageum URL을 등록하면 여기에서 연결을 관리할 수 있습니다.</p>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
