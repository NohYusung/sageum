'use client';

import { LoaderCircle, X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { RenameDocumentResponse } from '@/lib/documents/contracts';
import {
  renameStoredDocument,
  splitDocumentFilename,
} from '@/lib/documents/browser-rename';

export function DocumentRenameDialog({
  documentId,
  currentName,
  onClose,
  onRenamed,
}: {
  documentId: string;
  currentName: string;
  onClose: () => void;
  onRenamed: (result: RenameDocumentResponse) => void;
}) {
  const initial = splitDocumentFilename(currentName);
  const [basename, setBasename] = useState(initial.basename);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) onCloseRef.current();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedBasename = basename.trim();
    if (!normalizedBasename) {
      setError('확장자를 제외한 파일명을 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await renameStoredDocument(
        documentId,
        `${normalizedBasename}${initial.extension}`,
      );
      onRenamed(result);
      onClose();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : '문서 이름을 변경하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="document-rename-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        aria-labelledby="document-rename-title"
        aria-modal="true"
        className="document-rename-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span className="eyebrow">DOCUMENT NAME</span>
            <h2 id="document-rename-title">문서 이름 변경</h2>
          </div>
          <button aria-label="이름 변경 닫기" disabled={busy} type="button" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="document-rename-basename">파일명</label>
          <div className="document-rename-input">
            <input
              id="document-rename-basename"
              ref={inputRef}
              maxLength={Math.max(1, 1024 - initial.extension.length)}
              value={basename}
              onChange={(event) => setBasename(event.target.value)}
            />
            <span>{initial.extension}</span>
          </div>
          <p>문서 제목과 다운로드 파일명이 함께 변경됩니다. 확장자는 유지됩니다.</p>
          {error ? <p className="document-rename-error" role="alert">{error}</p> : null}
          <div className="document-rename-actions">
            <button disabled={busy} type="button" onClick={onClose}>취소</button>
            <button className="primary" disabled={busy} type="submit">
              {busy ? <LoaderCircle size={15} className="spin" /> : null}
              {busy ? '저장 중' : '변경 저장'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
