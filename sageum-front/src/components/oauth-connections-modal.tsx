'use client';

import {
  ArrowLeft,
  Bot,
  BookOpenText,
  Check,
  Clipboard,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
  Terminal,
  Unplug,
  UploadCloud,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  revokeOAuthConnectionFromModal,
  updateOAuthConnectionUploadPermission,
} from '@/app/oauth/connections/modal-actions';
import type { OAuthConnectionSummary } from '@/lib/auth/oauth-connections';
import { oauthScopeLabels } from '@/lib/auth/oauth-consent';
import {
  buildMcpGuideClients,
  MCP_OAUTH_STEPS,
  MCP_TEST_PROMPT,
  MCP_TROUBLESHOOTING,
  type McpGuideClientId,
} from '@/lib/auth/mcp-connection-guide';

type OAuthConnectionsModalProps = {
  initialConnections: OAuthConnectionSummary[];
  initialError: boolean;
  mcpEndpoint: string;
  onClose: () => void;
  open: boolean;
};

type ModalView = 'connections' | 'guide';

type CopyButtonProps = {
  copied: boolean;
  label: string;
  onCopy: () => void;
};

function CopyButton({ copied, label, onCopy }: CopyButtonProps) {
  return (
    <button
      aria-label={`${label} 복사`}
      className="mcp-guide-copy-button"
      type="button"
      onClick={onCopy}
    >
      {copied ? <Check size={14} /> : <Clipboard size={14} />}
      {copied ? '복사됨' : '복사'}
    </button>
  );
}

function grantedAtLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '승인일 정보 없음';
  return `승인일 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(date)}`;
}

export function OAuthConnectionsModal({
  initialConnections,
  initialError,
  mcpEndpoint,
  onClose,
  open,
}: OAuthConnectionsModalProps) {
  const [connections, setConnections] = useState(initialConnections);
  const [modalView, setModalView] = useState<ModalView>('connections');
  const [activeClientId, setActiveClientId] = useState<McpGuideClientId>('codex');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [busyClientId, setBusyClientId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'permission' | 'revoke' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(
    initialError ? 'OAuth 연결 목록을 불러오지 못했습니다. Supabase OAuth Server 설정을 확인해 주세요.' : null,
  );
  const modalRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const busyClientIdRef = useRef<string | null>(null);
  const guideClients = useMemo(() => buildMcpGuideClients(mcpEndpoint), [mcpEndpoint]);
  const activeClient = guideClients.find((client) => client.id === activeClientId)
    ?? guideClients[0];

  useEffect(() => {
    if (!open) return;

    setModalView('connections');
    setActiveClientId('codex');
    setCopiedId(null);
    setCopyError(null);

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

  useEffect(() => () => {
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
  }, []);

  function changeModalView(view: ModalView) {
    setModalView(view);
    setCopiedId(null);
    setCopyError(null);
    window.requestAnimationFrame(() => titleRef.current?.focus());
  }

  async function handleCopy(id: string, value: string) {
    setCopyError(null);
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      setCopiedId(null);
      setCopyError('클립보드에 복사하지 못했습니다. 텍스트를 직접 선택해 복사해 주세요.');
    }
  }

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
          <div className="oauth-connections-modal-heading">
            <span className="eyebrow">
              {modalView === 'connections' ? 'OAUTH CONNECTIONS' : 'MCP CONNECTION GUIDE'}
            </span>
            <div className="oauth-connections-modal-title-row">
              <h2
                id="oauth-connections-modal-title"
                ref={titleRef}
                tabIndex={-1}
              >
                {modalView === 'connections' ? '에이전트 연결 관리' : 'MCP 연결 가이드'}
              </h2>
              <span>
                {modalView === 'connections' ? `${connections.length}개 연결` : activeClient.label}
              </span>
            </div>
            <p>
              {modalView === 'connections'
                ? '내 문서 저장소에 접근하도록 승인한 외부 MCP 클라이언트를 관리합니다.'
                : 'Codex 또는 Claude Code에 Sageum을 등록하고 OAuth 연결을 완료하세요.'}
            </p>
          </div>
          <div className="oauth-connections-modal-header-actions">
            <button
              className="oauth-connections-modal-view-toggle"
              disabled={Boolean(busyClientId)}
              type="button"
              onClick={() => changeModalView(
                modalView === 'connections' ? 'guide' : 'connections',
              )}
            >
              {modalView === 'connections'
                ? <BookOpenText size={16} />
                : <ArrowLeft size={16} />}
              {modalView === 'connections' ? '연결 가이드' : '연결 목록'}
            </button>
            <button
              aria-label="에이전트 연결 관리 닫기"
              className="oauth-connections-modal-close"
              disabled={Boolean(busyClientId)}
              ref={closeRef}
              title="닫기 (Esc)"
              type="button"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </div>
        </header>

        <div className="oauth-connections-modal-body">
          {modalView === 'connections' ? (
            <>
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
                    <p>연결 가이드에서 Sageum Endpoint를 등록하면 승인된 클라이언트가 여기에 표시됩니다.</p>
                  </div>
                )}
              </section>
            </>
          ) : (
            <section className="mcp-connection-guide" aria-label="MCP 클라이언트 연결 가이드">
              <div className="mcp-guide-endpoint">
                <div>
                  <span className="eyebrow">SAGEUM MCP ENDPOINT</span>
                  <strong>클라이언트에 등록할 주소</strong>
                  <p>외부 클라이언트에서는 localhost가 아닌 HTTPS 배포 주소를 사용하세요.</p>
                </div>
                <div className="mcp-guide-endpoint-value">
                  <code>{mcpEndpoint}</code>
                  <CopyButton
                    copied={copiedId === 'endpoint'}
                    label="MCP Endpoint"
                    onCopy={() => void handleCopy('endpoint', mcpEndpoint)}
                  />
                </div>
              </div>

              <p
                className={`mcp-guide-copy-feedback${copyError ? ' is-error' : ''}`}
                role={copyError ? 'alert' : 'status'}
              >
                {copyError ?? (copiedId ? '클립보드에 복사했습니다.' : '')}
              </p>

              <div className="mcp-guide-tabs" aria-label="MCP 클라이언트 선택" role="tablist">
                {guideClients.map((client) => (
                  <button
                    aria-controls={`mcp-guide-panel-${client.id}`}
                    aria-selected={activeClientId === client.id}
                    id={`mcp-guide-tab-${client.id}`}
                    key={client.id}
                    role="tab"
                    tabIndex={activeClientId === client.id ? 0 : -1}
                    type="button"
                    onClick={() => {
                      setActiveClientId(client.id);
                      setCopiedId(null);
                      setCopyError(null);
                    }}
                  >
                    {client.label}
                  </button>
                ))}
              </div>

              <section
                aria-labelledby={`mcp-guide-tab-${activeClient.id}`}
                className="mcp-guide-client-panel"
                id={`mcp-guide-panel-${activeClient.id}`}
                role="tabpanel"
              >
                <div className="mcp-guide-client-heading">
                  <div>
                    <span className="mcp-guide-client-icon"><Terminal size={19} /></span>
                    <div>
                      <h3>{activeClient.label} 연결</h3>
                      <p>{activeClient.description}</p>
                    </div>
                  </div>
                  <a href={activeClient.documentationUrl} rel="noreferrer" target="_blank">
                    공식 문서 <ExternalLink size={13} />
                  </a>
                </div>

                <div className="mcp-guide-command-list">
                  {activeClient.commands.map((command) => (
                    <article key={command.id}>
                      <header>
                        <strong>{command.label}</strong>
                        <CopyButton
                          copied={copiedId === command.id}
                          label={command.label}
                          onCopy={() => void handleCopy(command.id, command.command)}
                        />
                      </header>
                      <pre tabIndex={0}><code>{command.command}</code></pre>
                      <p>{command.description}</p>
                    </article>
                  ))}
                </div>

                <ul className="mcp-guide-notes">
                  {activeClient.notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
              </section>

              <section className="mcp-guide-section">
                <div className="mcp-guide-section-heading">
                  <span className="eyebrow">OAUTH FLOW</span>
                  <h3>승인 순서</h3>
                </div>
                <ol className="mcp-guide-oauth-steps">
                  {MCP_OAUTH_STEPS.map((step, index) => (
                    <li key={step.title}>
                      <span>{index + 1}</span>
                      <div><strong>{step.title}</strong><p>{step.description}</p></div>
                    </li>
                  ))}
                </ol>
              </section>

              <div className="mcp-guide-permission-callout">
                <ShieldCheck size={19} />
                <div>
                  <strong>연결은 기본적으로 읽기 전용입니다.</strong>
                  <p>외부 에이전트가 문서를 등록해야 할 때만 연결 목록에서 해당 클라이언트의 업로드 허용을 켜세요.</p>
                </div>
              </div>

              <section className="mcp-guide-section">
                <div className="mcp-guide-section-heading">
                  <span className="eyebrow">CONNECTION TEST</span>
                  <h3>첫 질문으로 확인</h3>
                </div>
                <div className="mcp-guide-test-prompt">
                  <p>{MCP_TEST_PROMPT}</p>
                  <CopyButton
                    copied={copiedId === 'test-prompt'}
                    label="테스트 질문"
                    onCopy={() => void handleCopy('test-prompt', MCP_TEST_PROMPT)}
                  />
                </div>
              </section>

              <section className="mcp-guide-section">
                <div className="mcp-guide-section-heading">
                  <span className="eyebrow">TROUBLESHOOTING</span>
                  <h3>연결이 되지 않을 때</h3>
                </div>
                <div className="mcp-guide-troubleshooting">
                  {MCP_TROUBLESHOOTING.map((item) => (
                    <details key={item.id}>
                      <summary>{item.title}</summary>
                      <p>{item.description}</p>
                    </details>
                  ))}
                </div>
              </section>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
