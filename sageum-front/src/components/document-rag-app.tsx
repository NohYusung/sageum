'use client';

import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Database,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  HardDriveUpload,
  Library,
  LoaderCircle,
  LogOut,
  MessageSquareText,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { logoutAction } from '@/app/actions';
import { uploadAndProcessDocument } from '@/lib/documents/browser-upload';
import {
  composeExtractiveAnswer,
  searchDocuments,
  type IndexedDocument,
  type SourceReference,
} from '@/lib/rag/local-search';

type View = 'chat' | 'documents' | 'upload';

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  sources?: SourceReference[];
};

type SystemStatus = {
  mode: 'cloud' | 'local-demo';
  providers: {
    supabase: { configured: boolean };
    qdrant: { configured: boolean; collection: string };
    embedding: { configured: boolean; model: string | null };
  };
};

const SUPPORTED_TYPES = [
  { label: 'Markdown', extension: 'MD', ready: true },
  { label: 'HTML', extension: 'HTML', ready: true },
  { label: '텍스트', extension: 'TXT', ready: true },
  { label: 'PDF', extension: 'PDF', ready: false },
  { label: 'Word', extension: 'DOCX', ready: false },
  { label: 'Excel', extension: 'XLSX', ready: false },
];

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    text: '문서 저장소에서 근거를 찾아 답변합니다. 재택근무 규정이나 문서 보안 정책처럼 궁금한 내용을 물어보세요.',
  },
];

function SageumMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 2 29 9v14l-13 7L3 23V9z" fill="currentColor" opacity="0.28" />
      <path d="m16 8.5 7 3.8v7.4l-7 3.8-7-3.8v-7.4z" fill="currentColor" />
      <circle cx="16" cy="16" r="2.4" fill="white" />
    </svg>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function fileIcon(type: IndexedDocument['document']['sourceType']) {
  if (type === 'xlsx') return FileSpreadsheet;
  if (type === 'html' || type === 'markdown') return FileCode2;
  return FileText;
}

export function DocumentRagApp({
  userEmail,
  initialDocuments,
}: {
  userEmail: string;
  initialDocuments: IndexedDocument[];
}) {
  const [view, setView] = useState<View>('chat');
  const [documents, setDocuments] = useState<IndexedDocument[]>(() => initialDocuments);
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [query, setQuery] = useState('');
  const [documentFilter, setDocumentFilter] = useState('');
  const [selectedDocumentId, setSelectedDocumentId] = useState(
    () => initialDocuments[0]?.document.id ?? '',
  );
  const [activeSources, setActiveSources] = useState<SourceReference[]>([]);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const userInitial = userEmail.charAt(0).toLocaleUpperCase('ko-KR') || '?';

  useEffect(() => {
    fetch('/api/system')
      .then((response) => response.json() as Promise<SystemStatus>)
      .then(setSystem)
      .catch(() => setSystem(null));
  }, []);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages]);

  const selectedDocument = useMemo(
    () => documents.find(({ document }) => document.id === selectedDocumentId) ?? documents[0],
    [documents, selectedDocumentId],
  );
  const totalChunks = useMemo(
    () => documents.reduce((sum, document) => sum + document.chunks.length, 0),
    [documents],
  );
  const filteredDocuments = useMemo(() => {
    const term = documentFilter.trim().toLocaleLowerCase('ko-KR');
    if (!term) return documents;
    return documents.filter(({ document }) =>
      `${document.title} ${document.name}`.toLocaleLowerCase('ko-KR').includes(term),
    );
  }, [documentFilter, documents]);
  const SelectedDocumentIcon = selectedDocument ? fileIcon(selectedDocument.document.sourceType) : FileText;

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;
    setUploadBusy(true);
    setUploadMessage(null);

    const results = await Promise.allSettled(
      files.map((file) => uploadAndProcessDocument(file)),
    );

    const succeeded = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const failures = results.flatMap((result) =>
      result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : '파일 처리에 실패했습니다.']
        : [],
    );

    if (succeeded.length) {
      const uploadedIds = new Set(succeeded.map(({ document }) => document.id));
      setDocuments((current) => [
        ...succeeded,
        ...current.filter(({ document }) => !uploadedIds.has(document.id)),
      ]);
      setSelectedDocumentId(succeeded[0].document.id);
      setUploadMessage(`${succeeded.length}개 문서를 Supabase에 저장하고 청크로 분할했습니다.`);
      setView('documents');
    }
    if (failures.length) {
      setUploadMessage(`실패: ${failures.join(' ')}`);
    }
    setUploadBusy(false);
  }

  function handleQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = query.trim();
    if (!question) return;

    const sources = searchDocuments(documents, question);
    const now = Date.now();
    setMessages((current) => [
      ...current,
      { id: `user-${now}`, role: 'user', text: question },
      {
        id: `assistant-${now}`,
        role: 'assistant',
        text: composeExtractiveAnswer(sources),
        sources,
      },
    ]);
    setActiveSources(sources);
    if (sources[0]) setSelectedDocumentId(sources[0].documentId);
    setQuery('');
  }

  function openSource(source: SourceReference) {
    setSelectedDocumentId(source.documentId);
    setView('documents');
  }

  return (
    <div className="rag-shell">
      <aside className="rag-sidebar">
        <button className="rag-brand" type="button" onClick={() => setView('chat')}>
          <SageumMark />
          <span>
            <strong>SAGEUM</strong>
            <small>DOCUMENT INTELLIGENCE</small>
          </span>
        </button>

        <nav className="rag-nav" aria-label="주요 메뉴">
          <button className={view === 'chat' ? 'active' : ''} type="button" onClick={() => setView('chat')}>
            <MessageSquareText size={18} />
            문서에게 질문
          </button>
          <button className={view === 'documents' ? 'active' : ''} type="button" onClick={() => setView('documents')}>
            <Library size={18} />
            문서 저장소
            <span className="nav-count">{documents.length}</span>
          </button>
          <button className={view === 'upload' ? 'active' : ''} type="button" onClick={() => setView('upload')}>
            <HardDriveUpload size={18} />
            문서 추가
          </button>
        </nav>

        <div className="rag-sidebar-summary">
          <span>INDEX STATUS</span>
          <strong>{totalChunks} chunks</strong>
          <div className="provider-row">
            <i className={system?.providers.supabase.configured ? 'connected' : ''} />
            Supabase
            <em>{system?.providers.supabase.configured ? '연결됨' : '대기'}</em>
          </div>
          <div className="provider-row">
            <i className={system?.providers.qdrant.configured ? 'connected' : ''} />
            Qdrant
            <em>{system?.providers.qdrant.configured ? '연결됨' : '대기'}</em>
          </div>
        </div>

        <div className="rag-profile">
          <div className="rag-avatar">{userInitial}</div>
          <div>
            <strong title={userEmail}>{userEmail}</strong>
            <span>{system?.mode === 'cloud' ? 'Cloud mode' : '개인 데모'}</span>
          </div>
          <form action={logoutAction}>
            <button type="submit" aria-label="로그아웃" title="로그아웃">
              <LogOut size={16} />
            </button>
          </form>
        </div>
      </aside>

      <main className="rag-main">
        {view === 'chat' ? (
          <section className="chat-view">
            <header className="rag-topbar">
              <div>
                <span className="eyebrow">GROUNDED ANSWERS</span>
                <h1>문서에게 질문</h1>
              </div>
              <div className="mode-badge">
                <span className={system?.mode === 'cloud' ? 'live-dot' : 'demo-dot'} />
                {system?.mode === 'cloud' ? 'Cloud RAG' : '로컬 검색 검증'}
              </div>
            </header>

            <div className="conversation" ref={conversationRef}>
              <div className="conversation-intro">
                <div className="intro-icon"><Sparkles size={22} /></div>
                <div>
                  <strong>{documents.length}개 문서가 준비되어 있습니다</strong>
                  <span>답변에는 항상 검색된 원문과 문서 위치가 함께 표시됩니다.</span>
                </div>
              </div>

              {messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  <div className="message-avatar">
                    {message.role === 'assistant' ? <Bot size={18} /> : userInitial}
                  </div>
                  <div className="message-content">
                    <span className="message-author">{message.role === 'assistant' ? 'Sageum' : '나'}</span>
                    <p>{message.text}</p>
                    {message.sources?.length ? (
                      <div className="inline-sources">
                        {message.sources.map((source, index) => (
                          <button key={source.chunkId} type="button" onClick={() => openSource(source)}>
                            <span>{index + 1}</span>
                            {source.documentTitle}
                            <ChevronRight size={14} />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            <div className="composer-wrap">
              <form className="composer" onSubmit={handleQuestion}>
                <button type="button" aria-label="문서 첨부" onClick={() => setView('upload')}>
                  <Paperclip size={19} />
                </button>
                <textarea
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="예: 재택근무는 일주일에 몇 번 가능한가요?"
                  rows={1}
                />
                <button className="send-button" type="submit" aria-label="질문 보내기" disabled={!query.trim()}>
                  <Send size={18} />
                </button>
              </form>
              <p>현재는 검색·출처 흐름을 검증하는 추출형 답변 모드입니다.</p>
            </div>
          </section>
        ) : null}

        {view === 'documents' ? (
          <section className="documents-view">
            <header className="rag-topbar">
              <div>
                <span className="eyebrow">KNOWLEDGE BASE</span>
                <h1>문서 저장소</h1>
              </div>
              <button className="primary-action" type="button" onClick={() => setView('upload')}>
                <UploadCloud size={17} />
                문서 추가
              </button>
            </header>

            <div className="document-toolbar">
              <label>
                <Search size={17} />
                <input
                  aria-label="문서명 검색"
                  placeholder="문서명 검색"
                  value={documentFilter}
                  onChange={(event) => setDocumentFilter(event.target.value)}
                />
              </label>
              <span>{documents.length} documents · {totalChunks} chunks</span>
            </div>

            <div className="document-layout">
              <div className="document-list">
                {filteredDocuments.map((item) => {
                  const Icon = fileIcon(item.document.sourceType);
                  return (
                    <button
                      className={selectedDocument?.document.id === item.document.id ? 'selected' : ''}
                      key={item.document.id}
                      type="button"
                      onClick={() => setSelectedDocumentId(item.document.id)}
                    >
                      <span className={`file-icon ${item.document.sourceType}`}><Icon size={20} /></span>
                      <span className="document-name">
                        <strong>{item.document.title}</strong>
                        <small>{item.document.name}</small>
                      </span>
                      <span className="document-meta">
                        <strong>{item.chunks.length} chunks</strong>
                        <small>{formatBytes(item.document.sizeBytes)}</small>
                      </span>
                      {item.status === 'ready' ? (
                        <CheckCircle2 size={17} className="ready-icon" />
                      ) : item.status === 'failed' ? (
                        <XCircle size={17} className="failed-icon" />
                      ) : (
                        <LoaderCircle size={17} className="processing-icon spin" />
                      )}
                    </button>
                  );
                })}
                {!filteredDocuments.length ? (
                  <div className="document-list-empty">
                    <Search size={22} />
                    <strong>일치하는 문서가 없습니다</strong>
                    <span>다른 문서명으로 검색해 보세요.</span>
                  </div>
                ) : null}
              </div>

              {selectedDocument ? (
                <aside className="document-inspector">
                  <span className={`large-file-icon ${selectedDocument.document.sourceType}`}>
                    <SelectedDocumentIcon size={28} />
                  </span>
                  <span className="eyebrow">DOCUMENT DETAIL</span>
                  <h2>{selectedDocument.document.title}</h2>
                  <p>{selectedDocument.document.name}</p>
                  <dl>
                    <div><dt>형식</dt><dd>{selectedDocument.document.sourceType.toUpperCase()}</dd></div>
                    <div><dt>크기</dt><dd>{formatBytes(selectedDocument.document.sizeBytes)}</dd></div>
                    <div><dt>청크</dt><dd>{selectedDocument.chunks.length}</dd></div>
                    <div><dt>인덱싱</dt><dd>{formatDate(selectedDocument.indexedAt)}</dd></div>
                  </dl>
                  <div className="inspector-rule" />
                  <h3>구조화 결과</h3>
                  <div className="structure-list">
                    {selectedDocument.chunks.slice(0, 4).map((chunk) => (
                      <div key={chunk.id}>
                        <span>{chunk.ordinal + 1}</span>
                        <p>
                          <strong>{chunk.headingPath.join(' › ') || '본문'}</strong>
                          <small>{chunk.wordCount} words</small>
                        </p>
                      </div>
                    ))}
                  </div>
                </aside>
              ) : null}
            </div>
          </section>
        ) : null}

        {view === 'upload' ? (
          <section className="upload-view">
            <header className="rag-topbar">
              <div>
                <span className="eyebrow">INGESTION PIPELINE</span>
                <h1>문서 추가</h1>
              </div>
            </header>

            <div className="upload-content">
              <div
                className="dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleFiles(event.dataTransfer.files);
                }}
              >
                {uploadBusy ? <LoaderCircle size={34} className="spin" /> : <UploadCloud size={34} />}
                <h2>{uploadBusy ? '문서를 구조화하는 중입니다' : '문서를 여기에 놓으세요'}</h2>
                <p>원문을 분석하고 300~500단어 단위의 검색 청크로 변환합니다.</p>
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadBusy}>
                  파일 선택
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".md,.markdown,.html,.htm,.txt,.pdf,.docx,.xlsx"
                  onChange={(event) => {
                    if (event.target.files) void handleFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
                <small>Supabase private Storage · 파일당 최대 10MB</small>
              </div>

              {uploadMessage ? (
                <div className={uploadMessage.includes('연결됩니다') || uploadMessage.includes('실패') ? 'upload-notice error' : 'upload-notice'}>
                  {uploadMessage.includes('연결됩니다') || uploadMessage.includes('실패') ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
                  {uploadMessage}
                </div>
              ) : null}

              <div className="format-grid">
                {SUPPORTED_TYPES.map((format) => (
                  <div key={format.extension} className={format.ready ? 'ready' : ''}>
                    <FileText size={18} />
                    <span><strong>{format.label}</strong><small>.{format.extension.toLowerCase()}</small></span>
                    <em>{format.ready ? '사용 가능' : '다음 단계'}</em>
                  </div>
                ))}
              </div>

              <div className="pipeline-card">
                <span><FolderOpen size={19} /> 원본 업로드</span>
                <ChevronRight size={16} />
                <span><FileCode2 size={19} /> 구조 추출</span>
                <ChevronRight size={16} />
                <span><Database size={19} /> 단어 청킹</span>
                <ChevronRight size={16} />
                <span><Cloud size={19} /> Qdrant 색인</span>
              </div>

              <div className="security-note">
                <ShieldCheck size={21} />
                <div>
                  <strong>원본과 검색 인덱스를 분리합니다</strong>
                  <p>원본은 Supabase private Storage, 문서 메타데이터는 PostgreSQL, 검색 벡터는 Qdrant에 저장하는 구조입니다.</p>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </main>

      {view === 'chat' ? (
        <aside className="source-panel">
          <div className="source-panel-header">
            <div>
              <span className="eyebrow">EVIDENCE</span>
              <h2>답변 근거</h2>
            </div>
            <span>{activeSources.length}</span>
          </div>

          {activeSources.length ? (
            <div className="source-list">
              {activeSources.map((source, index) => (
                <button key={source.chunkId} type="button" onClick={() => openSource(source)}>
                  <div className="source-number">{index + 1}</div>
                  <div>
                    <span className="source-score">{Math.round(source.score * 100)}% match</span>
                    <strong>{source.documentTitle}</strong>
                    <small>{source.heading}</small>
                    <p>{source.snippet}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="source-empty">
              <Database size={28} />
              <strong>검색 근거가 여기에 표시됩니다</strong>
              <p>질문하면 관련 청크와 문서 위치를 함께 확인할 수 있습니다.</p>
            </div>
          )}

          <div className="retrieval-policy">
            <ShieldCheck size={17} />
            <div>
              <strong>근거 우선 답변</strong>
              <span>검색 결과가 없으면 답변을 생성하지 않습니다.</span>
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
