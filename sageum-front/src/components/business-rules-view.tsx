'use client';

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DocumentRenameDialog } from '@/components/document-rename-dialog';
import { deleteStoredDocument } from '@/lib/documents/browser-delete';
import {
  fetchDocumentIngestionJob,
  reuploadAndProcessDocument,
  retryUploadedDocument,
  uploadAndProcessDocument,
  type DocumentUploadProgress,
} from '@/lib/documents/browser-upload';
import { MAX_MANUAL_RULE_CHARACTERS } from '@/lib/relations/manual-rule';
import type {
  ManualRuleMutationResponse,
  RuleDocumentSummary,
} from '@/lib/relations/types';

const RULE_FILE_ACCEPT = '.md,.markdown,.html,.htm,.txt,.pdf,.docx,.xlsx';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function errorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function BusinessRulesView({
  ruleDocuments,
  onRuleDocumentsChange,
  onRefreshRuleDocuments,
  onOpenEvidence,
}: {
  ruleDocuments: RuleDocumentSummary[];
  onRuleDocumentsChange: (
    updater: (current: RuleDocumentSummary[]) => RuleDocumentSummary[],
  ) => void;
  onRefreshRuleDocuments: () => Promise<boolean>;
  onOpenEvidence: (documentId: string, chunkId: string) => void | Promise<void>;
}) {
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [uploading, setUploading] = useState(false);
  const [manualModal, setManualModal] = useState<{
    mode: 'create' | 'edit';
    documentId: string | null;
    content: string;
  } | null>(null);
  const [savingManual, setSavingManual] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [renameDocument, setRenameDocument] = useState<RuleDocumentSummary | null>(null);
  const [expandedDocuments, setExpandedDocuments] = useState<Set<string>>(() => new Set());
  const replacementInputRef = useRef<HTMLInputElement | null>(null);
  const replacementTargetRef = useRef<{ documentId: string; jobId: string } | null>(null);
  const manualTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const manualTrackingControllersRef = useRef<Set<AbortController>>(new Set());
  const manualModalOpen = manualModal !== null;

  useEffect(() => {
    let active = true;
    void onRefreshRuleDocuments().catch((error) => {
      if (active) {
        setMessage(error instanceof Error ? error.message : '규칙 문서를 새로고침하지 못했습니다.');
      }
    });
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void onRefreshRuleDocuments().catch((error) => {
        if (active) {
          setMessage(error instanceof Error ? error.message : '규칙 문서를 새로고침하지 못했습니다.');
        }
      });
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
      manualTrackingControllersRef.current.forEach((controller) => controller.abort());
      manualTrackingControllersRef.current.clear();
    };
  }, [onRefreshRuleDocuments]);

  const hasProcessingRule = ruleDocuments.some((document) => (
    document.extractionStatus === 'processing'
    || document.pendingRevisionStatus === 'processing'
  ));

  useEffect(() => {
    if (!hasProcessingRule) return;
    let active = true;
    let timer = 0;
    const poll = () => {
      timer = window.setTimeout(() => {
        void onRefreshRuleDocuments()
          .catch((error) => {
            if (active) {
              setMessage(error instanceof Error ? error.message : '규칙 처리 상태를 확인하지 못했습니다.');
            }
          })
          .finally(() => {
            if (active) poll();
          });
      }, 1_000);
    };
    poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [hasProcessingRule, onRefreshRuleDocuments]);

  useEffect(() => {
    if (!manualModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => manualTextareaRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingManual) setManualModal(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [manualModalOpen, savingManual]);

  function markBusy(id: string, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function waitForManualRuleJob(jobId: string, signal: AbortSignal) {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      if (signal.aborted) return false;
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      if (signal.aborted) return false;
      const response = await fetch(`/api/ingestion-jobs/${encodeURIComponent(jobId)}`, {
        cache: 'no-store',
        signal,
      });
      if (!response.ok) throw new Error(await errorMessage(response, '규칙 처리 상태를 확인하지 못했습니다.'));
      const payload = await response.json() as {
        job: { status: string; lastError: string | null };
      };
      if (payload.job.status === 'ready') return true;
      if (payload.job.status === 'failed') {
        throw new Error(payload.job.lastError ?? '직접 입력 규칙 처리에 실패했습니다.');
      }
    }
    throw new Error('규칙 처리가 계속 진행 중입니다. 잠시 후 상태를 다시 확인해 주세요.');
  }

  async function trackManualRule(result: ManualRuleMutationResponse, mode: 'create' | 'edit') {
    const controller = new AbortController();
    manualTrackingControllersRef.current.add(controller);
    await onRefreshRuleDocuments().catch(() => undefined);
    try {
      const completed = await waitForManualRuleJob(result.jobId, controller.signal);
      if (!completed || controller.signal.aborted) return;
      await onRefreshRuleDocuments();
      setMessage(mode === 'create'
        ? '직접 입력 규칙의 추출과 관계 색인을 완료했습니다.'
        : '직접 입력 규칙을 새 버전으로 교체했습니다.');
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage(error instanceof Error ? error.message : '직접 입력 규칙 처리에 실패했습니다.');
      await onRefreshRuleDocuments().catch(() => undefined);
    } finally {
      manualTrackingControllersRef.current.delete(controller);
      if (result.documentId) markBusy(result.documentId, false);
    }
  }

  async function saveManualRule() {
    if (!manualModal) return;
    setSavingManual(true);
    setManualError(null);
    setMessage(null);
    try {
      const isEdit = manualModal.mode === 'edit' && manualModal.documentId;
      const response = await fetch(
        isEdit
          ? `/api/rule-documents/${encodeURIComponent(manualModal.documentId!)}/manual`
          : '/api/rule-documents/manual',
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: manualModal.content }),
        },
      );
      if (!response.ok) {
        throw new Error(await errorMessage(response, '직접 입력 규칙을 저장하지 못했습니다.'));
      }
      const result = await response.json() as ManualRuleMutationResponse;
      markBusy(result.documentId, true);
      const mode = manualModal.mode;
      setManualModal(null);
      setMessage(mode === 'create' ? '직접 입력 규칙을 처리하고 있습니다.' : '수정한 규칙을 처리하고 있습니다.');
      void trackManualRule(result, mode);
    } catch (error) {
      setManualError(error instanceof Error ? error.message : '직접 입력 규칙을 저장하지 못했습니다.');
    } finally {
      setSavingManual(false);
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setMessage(null);
    const discoveredDocumentIds = new Set<string>();
    const refreshWhenCreated = (progress: DocumentUploadProgress) => {
      if (!progress.documentId || discoveredDocumentIds.has(progress.documentId)) return;
      discoveredDocumentIds.add(progress.documentId);
      void onRefreshRuleDocuments().catch(() => undefined);
    };
    const results = await Promise.allSettled(
      Array.from(files).map((file) => (
        uploadAndProcessDocument(file, null, refreshWhenCreated, null, 'rule')
      )),
    );
    const failed = results.filter((result) => result.status === 'rejected');
    await onRefreshRuleDocuments().catch(() => undefined);
    setMessage(failed.length
      ? `${results.length - failed.length}개 완료 · ${failed.length}개 실패`
      : `${results.length}개 규칙 문서의 추출과 관계 색인을 완료했습니다.`);
    setUploading(false);
  }

  async function toggleDocument(document: RuleDocumentSummary) {
    markBusy(document.documentId, true);
    setMessage(null);
    try {
      const response = await fetch(`/api/rule-documents/${encodeURIComponent(document.documentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !document.enabled }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, '규칙 문서 상태를 바꾸지 못했습니다.'));
      onRuleDocumentsChange((current) => current.map((item) => (
        item.documentId === document.documentId ? { ...item, enabled: !item.enabled } : item
      )));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '규칙 문서 상태를 바꾸지 못했습니다.');
    } finally {
      markBusy(document.documentId, false);
    }
  }

  async function toggleRule(documentId: string, ruleId: string, enabled: boolean) {
    markBusy(ruleId, true);
    setMessage(null);
    try {
      const response = await fetch(`/api/knowledge-rules/${encodeURIComponent(ruleId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, '규칙 상태를 바꾸지 못했습니다.'));
      onRuleDocumentsChange((current) => current.map((document) => (
        document.documentId === documentId
          ? { ...document, rules: document.rules.map((rule) => rule.id === ruleId ? { ...rule, enabled } : rule) }
          : document
      )));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '규칙 상태를 바꾸지 못했습니다.');
    } finally {
      markBusy(ruleId, false);
    }
  }

  async function retry(document: RuleDocumentSummary) {
    if (!document.ingestionJobId) return;
    markBusy(document.documentId, true);
    setMessage(null);
    try {
      const job = await fetchDocumentIngestionJob(document.ingestionJobId);
      await retryUploadedDocument(job);
      await onRefreshRuleDocuments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '규칙 문서를 다시 처리하지 못했습니다.');
    } finally {
      markBusy(document.documentId, false);
    }
  }

  async function replaceOriginal(file: File | undefined) {
    const target = replacementTargetRef.current;
    replacementTargetRef.current = null;
    if (!file || !target) return;
    markBusy(target.documentId, true);
    setMessage(null);
    try {
      const job = await fetchDocumentIngestionJob(target.jobId);
      await reuploadAndProcessDocument(job, file);
      await onRefreshRuleDocuments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '규칙 원본을 다시 업로드하지 못했습니다.');
    } finally {
      markBusy(target.documentId, false);
    }
  }

  async function remove(document: RuleDocumentSummary) {
    if (!window.confirm(`“${document.title}” 규칙 문서와 관계 색인을 삭제할까요?`)) return;
    markBusy(document.documentId, true);
    setMessage(null);
    try {
      await deleteStoredDocument(document.documentId);
      onRuleDocumentsChange((current) => (
        current.filter((item) => item.documentId !== document.documentId)
      ));
      await onRefreshRuleDocuments().catch((error) => {
        setMessage(error instanceof Error
          ? `규칙은 삭제했지만 목록 동기화에 실패했습니다. ${error.message}`
          : '규칙은 삭제했지만 목록 동기화에 실패했습니다.');
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '규칙 문서를 삭제하지 못했습니다.');
    } finally {
      markBusy(document.documentId, false);
    }
  }

  return (
    <section className="business-rules-view">
      <header className="rag-topbar">
        <div>
          <span className="eyebrow">RELATION KNOWLEDGE</span>
          <h1>비즈니스 규칙</h1>
        </div>
        <div className="rule-header-actions">
          <button
            className="rule-manual-button"
            type="button"
            onClick={() => {
              setManualError(null);
              setManualModal({ mode: 'create', documentId: null, content: '' });
            }}
          >
            <Plus size={17} /> 직접 입력
          </button>
          <label className="rule-upload-button">
            {uploading ? <LoaderCircle size={17} className="spin" /> : <UploadCloud size={17} />}
            규칙 문서 업로드
            <input
              type="file"
              multiple
              accept={RULE_FILE_ACCEPT}
              disabled={uploading}
              onChange={(event) => {
                void handleUpload(event.target.files);
                event.target.value = '';
              }}
            />
          </label>
        </div>
      </header>
      <div className="business-rules-content">
        <div className="business-rules-intro">
          <strong>일반 문서만으로 파악하기 어려운 비즈니스 정책과 내부 맥락을 등록해 주세요.</strong>
          <span>업무 규칙·예외·조직의 암묵지를 등록하면 Sageum이 관련 문서와 규칙을 찾아 검색과 그래프에 반영합니다.</span>
        </div>
        {message ? <p className="rule-message" role="status">{message}</p> : null}
        <input
          hidden
          ref={replacementInputRef}
          type="file"
          accept={RULE_FILE_ACCEPT}
          onChange={(event) => {
            void replaceOriginal(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <div className="rule-document-list">
          {ruleDocuments.map((document) => {
            const expanded = expandedDocuments.has(document.documentId);
            const busy = busyIds.has(document.documentId);
            const bindingDocuments = new Set(document.rules.flatMap((rule) => rule.bindings.map((binding) => binding.documentId)));
            const linkedRules = new Set(document.rules.flatMap((rule) => rule.links.map((link) => link.linkedRuleId)));
            const reachableDocumentCount = document.rules.reduce(
              (total, rule) => total + rule.reachableDocumentCount,
              0,
            );
            return (
              <article className={`rule-document-card ${document.extractionStatus}`} key={document.documentId}>
                <div className="rule-document-summary">
                  <span className="rule-document-icon">
                    {document.extractionStatus === 'ready'
                      ? <CheckCircle2 size={20} />
                      : document.extractionStatus === 'failed'
                        ? <XCircle size={20} />
                        : <LoaderCircle size={20} className="spin" />}
                  </span>
                  <button
                    className="rule-document-expand"
                    type="button"
                    onClick={() => setExpandedDocuments((current) => {
                      const next = new Set(current);
                      if (expanded) next.delete(document.documentId); else next.add(document.documentId);
                      return next;
                    })}
                  >
                    <span>
                      <strong>{document.title}</strong>
                      <small>
                        {document.sourceMode === 'manual' ? <span className="rule-source-badge">직접 입력</span> : null}
                        {document.originalFilename ?? document.sourceType.toUpperCase()} · {formatBytes(document.sizeBytes)} · 규칙 {document.rules.length}개 · 직접 문서 {bindingDocuments.size}개 · 연결 규칙 {linkedRules.size}개 · 도달 문서 {reachableDocumentCount}개
                      </small>
                    </span>
                    <ChevronDown size={17} className={expanded ? 'expanded' : ''} />
                  </button>
                  <label className="rule-switch">
                    <input
                      type="checkbox"
                      checked={document.enabled}
                      disabled={busy || document.extractionStatus !== 'ready'}
                      onChange={() => void toggleDocument(document)}
                    />
                    <span>{document.enabled ? '활성' : '비활성'}</span>
                  </label>
                  {document.extractionStatus === 'failed' && document.ingestionJobId ? (
                    document.originalAvailable ? (
                      <button type="button" disabled={busy} onClick={() => void retry(document)}>
                        <RefreshCw size={15} /> 다시 처리
                      </button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => {
                        replacementTargetRef.current = {
                          documentId: document.documentId,
                          jobId: document.ingestionJobId!,
                        };
                        replacementInputRef.current?.click();
                      }}>
                        <UploadCloud size={15} /> 원본 재선택
                      </button>
                    )
                  ) : null}
                  {document.sourceMode === 'manual' ? (
                    <button
                      type="button"
                      disabled={busy || document.pendingRevisionStatus === 'processing'}
                      onClick={() => {
                        setManualError(null);
                        setManualModal({
                          mode: 'edit',
                          documentId: document.documentId,
                          content: document.manualContent ?? '',
                        });
                      }}
                    >
                      <Pencil size={15} /> 편집
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRenameDocument(document)}
                    >
                      <Pencil size={15} /> 이름 변경
                    </button>
                  )}
                  <button className="danger" type="button" disabled={busy} onClick={() => void remove(document)}>
                    <Trash2 size={15} /> 삭제
                  </button>
                </div>
                {document.extractionError ? <p className="rule-error">{document.extractionError}</p> : null}
                {document.extractionWarning ? <p className="rule-warning">{document.extractionWarning}</p> : null}
                {document.pendingRevisionStatus === 'processing' ? (
                  <p className="rule-warning"><LoaderCircle size={14} className="spin" /> 수정한 규칙을 검증·색인하고 있습니다. 기존 규칙은 계속 사용됩니다.</p>
                ) : null}
                {document.pendingRevisionStatus === 'failed' ? (
                  <p className="rule-error">수정 실패: {document.pendingRevisionError ?? '새 버전을 처리하지 못했습니다.'} 기존 규칙은 유지됩니다.</p>
                ) : null}
                {expanded ? (
                  <div className="knowledge-rule-list">
                    {document.rules.map((rule) => (
                      <div className={`knowledge-rule-row ${!document.enabled || !rule.enabled ? 'disabled' : ''}`} key={rule.id}>
                        <label className="rule-switch compact">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            disabled={busyIds.has(rule.id)}
                            onChange={(event) => void toggleRule(document.documentId, rule.id, event.target.checked)}
                          />
                          <span>{rule.enabled ? '사용' : '제외'}</span>
                        </label>
                        <div className="knowledge-rule-copy">
                          <p>{rule.statement}</p>
                          <button type="button" onClick={() => void onOpenEvidence(document.documentId, rule.sourceChunkId)}>
                            “{rule.evidenceQuote}” <ChevronRight size={13} />
                          </button>
                          {rule.links.length ? (
                            <div className="knowledge-rule-links">
                              <strong>연결 규칙 {rule.links.length}개</strong>
                              {rule.links.map((link) => (
                                <button
                                  key={link.id}
                                  type="button"
                                  onClick={() => void onOpenEvidence(link.linkedRuleDocumentId, link.linkedSourceChunkId)}
                                >
                                  {link.linkedStatement} · {link.vectorScore.toFixed(3)} · {link.linkedRuleDocumentTitle}
                                  <ChevronRight size={13} />
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <span className="rule-binding-count">
                          직접 {new Set(rule.bindings.map((binding) => binding.documentId)).size} · 규칙 {rule.links.length} · 도달 {rule.reachableDocumentCount}
                        </span>
                      </div>
                    ))}
                    {!document.rules.length ? <p className="rule-list-empty">추출된 유효 규칙이 없습니다.</p> : null}
                  </div>
                ) : null}
              </article>
            );
          })}
          {!ruleDocuments.length && !uploading ? (
            <div className="rule-empty">
              <FileText size={30} />
              <strong>아직 등록된 비즈니스 규칙이 없습니다.</strong>
              <span>문서에 드러나지 않는 정책·예외·내부 맥락을 직접 입력하거나 규칙 문서로 업로드해 주세요.</span>
            </div>
          ) : null}
        </div>
        {renameDocument ? (
          <DocumentRenameDialog
            currentName={renameDocument.originalFilename ?? renameDocument.title}
            documentId={renameDocument.documentId}
            onClose={() => setRenameDocument(null)}
            onRenamed={(result) => {
              const title = result.document.document.title;
              onRuleDocumentsChange((current) => current.map((document) => (
                document.documentId === renameDocument.documentId
                  ? {
                    ...document,
                    title,
                    originalFilename: result.document.document.name,
                  }
                  : document
              )));
              void onRefreshRuleDocuments();
              setMessage(result.indexStatus === 'warning' && result.warning
                ? result.warning
                : '규칙 문서 이름을 변경했습니다.');
            }}
          />
        ) : null}
      </div>
      {manualModal ? (
        <div
          className="manual-rule-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingManual) setManualModal(null);
          }}
        >
          <section
            aria-labelledby="manual-rule-modal-title"
            aria-modal="true"
            className="manual-rule-modal"
            role="dialog"
          >
            <header>
              <div>
                <span className="eyebrow">MANUAL RELATION RULE</span>
                <h2 id="manual-rule-modal-title">
                  {manualModal.mode === 'create' ? '비즈니스 규칙 직접 입력' : '직접 입력 규칙 편집'}
                </h2>
              </div>
              <button
                type="button"
                aria-label="닫기"
                disabled={savingManual}
                onClick={() => setManualModal(null)}
              >
                <X size={20} />
              </button>
            </header>
            <p>일반 문서만으로 파악하기 어려운 정책·예외·내부 맥락을 자연어 규칙으로 한 번에 하나씩 입력해 주세요.</p>
            <label htmlFor="manual-rule-content">규칙 내용</label>
            <textarea
              id="manual-rule-content"
              ref={manualTextareaRef}
              value={manualModal.content}
              maxLength={MAX_MANUAL_RULE_CHARACTERS}
              placeholder="예: 프리미엄 고객의 환불 요청은 우선 검토한다."
              disabled={savingManual}
              onChange={(event) => setManualModal((current) => current
                ? { ...current, content: event.target.value }
                : current)}
            />
            <div className="manual-rule-count">
              <span>입력한 규칙 전체를 임베딩해 관련 문서와 다른 규칙을 의미 기반으로 연결합니다.</span>
              <strong>{manualModal.content.length.toLocaleString()} / {MAX_MANUAL_RULE_CHARACTERS.toLocaleString()}</strong>
            </div>
            {manualError ? <p className="manual-rule-error" role="alert">{manualError}</p> : null}
            <footer>
              <button type="button" disabled={savingManual} onClick={() => setManualModal(null)}>취소</button>
              <button
                className="primary"
                type="button"
                disabled={savingManual || !manualModal.content.trim()}
                onClick={() => void saveManualRule()}
              >
                {savingManual ? <LoaderCircle size={16} className="spin" /> : null}
                {manualModal.mode === 'create' ? '등록하고 처리' : '수정하고 재처리'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
