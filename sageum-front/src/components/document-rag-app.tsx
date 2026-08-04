'use client';

import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cloud,
  Database,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Home,
  HardDriveUpload,
  Library,
  LoaderCircle,
  LogOut,
  MessageSquareText,
  Paperclip,
  Pencil,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import {
  type FormEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { logoutAction } from '@/app/actions';
import { deleteStoredDocument } from '@/lib/documents/browser-delete';
import { uploadAndProcessDocument } from '@/lib/documents/browser-upload';
import {
  createFolder,
  deleteFolder,
  moveDocumentToFolder,
  moveFolder,
  renameFolder,
} from '@/lib/folders/browser';
import {
  canMoveFolder,
  documentsInFolderScope,
  flattenFolderTree,
  folderPath,
} from '@/lib/folders/tree';
import type { Folder as RepositoryFolder } from '@/lib/folders/types';
import type {
  ApiErrorResponse,
  SearchDocumentsResponse,
} from '@/lib/documents/contracts';
import { shouldSubmitChatOnEnter } from '@/lib/rag/chat-keyboard';
import {
  composeExtractiveAnswer,
  searchDocuments,
  type IndexedDocument,
  type SourceReference,
} from '@/lib/rag/local-search';
import type { DocumentChunk } from '@/lib/rag/types';

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
    embedding: {
      configured: boolean;
      provider: string | null;
      model: string | null;
      dimensions: number;
      execution: 'qdrant';
      dtype: string | null;
    };
    generation: {
      configured: boolean;
      provider: 'claude-platform-aws';
      model: string;
      region: string | null;
      auth: 'api-key' | 'sigv4' | null;
    };
  };
};

const SUPPORTED_TYPES = [
  { label: 'Markdown', extension: 'MD', ready: true },
  { label: 'HTML', extension: 'HTML', ready: true },
  { label: '텍스트', extension: 'TXT', ready: true },
  { label: 'PDF', extension: 'PDF', ready: true },
  { label: 'Word', extension: 'DOCX', ready: true },
  { label: 'Excel', extension: 'XLSX', ready: true },
];

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    text: '문서 저장소에서 근거를 찾아 답변합니다. 재택근무 규정이나 문서 보안 정책처럼 궁금한 내용을 물어보세요.',
  },
];

const DOCUMENT_PREVIEW_FRAME_NAME = 'sageum-document-preview';
const DOCUMENT_DRAG_TYPE = 'application/x-sageum-document';
const FOLDER_DRAG_TYPE = 'application/x-sageum-folder';

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

function chunkLocation(location: DocumentChunk['location']) {
  if (location.page !== undefined) return `${location.page}페이지`;
  if (location.sheet) {
    return location.cellRange ? `${location.sheet} · ${location.cellRange}` : location.sheet;
  }
  return null;
}

function sourceLocation(source: SourceReference) {
  if (source.page !== undefined) return `${source.page}페이지`;
  if (source.sheet) return source.cellRange ? `${source.sheet} · ${source.cellRange}` : source.sheet;
  return null;
}

async function searchRepository(
  documents: IndexedDocument[],
  query: string,
  folderId: string | null,
) {
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      folderId,
      topK: 8,
    }),
  });
  const payload = await response.json().catch(() => null) as
    | SearchDocumentsResponse
    | ApiErrorResponse
    | null;

  if (response.ok && payload && 'sources' in payload) {
    return { answer: payload.answer, sources: payload.sources };
  }
  if (
    response.status === 503 &&
    payload &&
    'code' in payload &&
    payload.code === 'VECTOR_SEARCH_NOT_CONFIGURED'
  ) {
    const sources = searchDocuments(documents, query);
    return { answer: composeExtractiveAnswer(sources), sources };
  }
  const message = payload && 'error' in payload
    ? payload.error
    : '문서 검색 요청을 처리하지 못했습니다.';
  throw new Error(message);
}

function fileIcon(type: IndexedDocument['document']['sourceType']) {
  if (type === 'xlsx') return FileSpreadsheet;
  if (type === 'html' || type === 'markdown') return FileCode2;
  return FileText;
}

function documentPreviewUrl(documentId: string, chunk?: DocumentChunk) {
  const base = `/documents/${encodeURIComponent(documentId)}/preview?embedded=1`;
  if (!chunk) return base;
  if (chunk.location.page !== undefined) {
    return `${base}&page=${encodeURIComponent(String(chunk.location.page))}`;
  }
  return `${base}#block-${chunk.focusBlock}`;
}

export function DocumentRagApp({
  userEmail,
  initialDocuments,
  initialFolders,
}: {
  userEmail: string;
  initialDocuments: IndexedDocument[];
  initialFolders: RepositoryFolder[];
}) {
  const [view, setView] = useState<View>('chat');
  const [documents, setDocuments] = useState<IndexedDocument[]>(() => initialDocuments);
  const [folders, setFolders] = useState<RepositoryFolder[]>(() => initialFolders);
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [query, setQuery] = useState('');
  const [documentFilter, setDocumentFilter] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchFolderId, setSearchFolderId] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderActionError, setFolderActionError] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null | 'root'>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState(
    () => initialDocuments[0]?.document.id ?? '',
  );
  const [activeSources, setActiveSources] = useState<SourceReference[]>([]);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [documentActionError, setDocumentActionError] = useState<{
    documentId: string;
    message: string;
  } | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
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

  const folderTree = useMemo(() => flattenFolderTree(folders), [folders]);
  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) ?? null,
    [folders, selectedFolderId],
  );
  const selectedFolderPath = useMemo(
    () => folderPath(folders, selectedFolderId),
    [folders, selectedFolderId],
  );
  const childFolders = useMemo(
    () => folders
      .filter((folder) => folder.parentId === selectedFolderId)
      .toSorted((left, right) => left.sortOrder - right.sortOrder
        || left.name.localeCompare(right.name, 'ko-KR', { numeric: true, sensitivity: 'base' })),
    [folders, selectedFolderId],
  );
  const totalChunks = useMemo(
    () => documents.reduce((sum, document) => sum + document.chunks.length, 0),
    [documents],
  );
  const filteredDocuments = useMemo(() => {
    const term = documentFilter.trim().toLocaleLowerCase('ko-KR');
    const currentDocuments = documentsInFolderScope(documents, folders, selectedFolderId);
    if (!term) return currentDocuments;
    return currentDocuments.filter(({ document }) =>
      `${document.title} ${document.name}`.toLocaleLowerCase('ko-KR').includes(term),
    );
  }, [documentFilter, documents, folders, selectedFolderId]);
  const selectedDocument = useMemo(
    () => filteredDocuments.find(({ document }) => document.id === selectedDocumentId)
      ?? filteredDocuments[0],
    [filteredDocuments, selectedDocumentId],
  );
  const SelectedDocumentIcon = selectedDocument ? fileIcon(selectedDocument.document.sourceType) : FileText;

  async function handleFiles(fileList: FileList | File[], folderId = selectedFolderId) {
    const files = Array.from(fileList);
    if (!files.length) return;
    setUploadBusy(true);
    setUploadMessage(null);

    const results = await Promise.allSettled(
      files.map((file) => uploadAndProcessDocument(file, folderId)),
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
      setSelectedFolderId(folderId);
      setUploadMessage(
        system?.mode === 'cloud'
          ? `${succeeded.length}개 문서를 Supabase에 저장하고 Qdrant에 색인했습니다.`
          : `${succeeded.length}개 문서를 Supabase에 저장하고 청크로 분할했습니다.`,
      );
      setView('documents');
    }
    if (failures.length) {
      setUploadMessage(`실패: ${failures.join(' ')}`);
    }
    setUploadBusy(false);
  }

  function selectFolder(folderId: string | null) {
    setSelectedFolderId(folderId);
    setDocumentFilter('');
    const nextDocument = documents.find(({ document }) => document.folderId === folderId);
    setSelectedDocumentId(nextDocument?.document.id ?? '');
    setFolderActionError(null);
  }

  async function handleCreateFolder() {
    if (folderBusy) return;
    const name = window.prompt(
      selectedFolder ? `“${selectedFolder.name}” 안에 만들 폴더 이름` : '새 폴더 이름',
    );
    if (!name?.trim()) return;
    setFolderBusy(true);
    setFolderActionError(null);
    try {
      const created = await createFolder(name, selectedFolderId);
      setFolders((current) => [...current, created]);
    } catch (error) {
      setFolderActionError(error instanceof Error ? error.message : '폴더를 만들지 못했습니다.');
    } finally {
      setFolderBusy(false);
    }
  }

  async function handleRenameSelectedFolder() {
    if (!selectedFolder || folderBusy) return;
    const name = window.prompt('변경할 폴더 이름', selectedFolder.name);
    if (!name?.trim() || name.trim() === selectedFolder.name) return;
    setFolderBusy(true);
    setFolderActionError(null);
    try {
      const renamed = await renameFolder(selectedFolder.id, name);
      setFolders((current) => current.map((folder) => folder.id === renamed.id ? renamed : folder));
    } catch (error) {
      setFolderActionError(error instanceof Error ? error.message : '폴더 이름을 변경하지 못했습니다.');
    } finally {
      setFolderBusy(false);
    }
  }

  async function handleDeleteSelectedFolder() {
    if (!selectedFolder || folderBusy) return;
    if (!window.confirm(`비어 있는 “${selectedFolder.name}” 폴더를 삭제할까요?`)) return;
    setFolderBusy(true);
    setFolderActionError(null);
    try {
      await deleteFolder(selectedFolder.id);
      const parentId = selectedFolder.parentId;
      setFolders((current) => current.filter((folder) => folder.id !== selectedFolder.id));
      selectFolder(parentId);
      if (searchFolderId === selectedFolder.id) setSearchFolderId('');
    } catch (error) {
      setFolderActionError(error instanceof Error ? error.message : '폴더를 삭제하지 못했습니다.');
    } finally {
      setFolderBusy(false);
    }
  }

  async function handleMoveDocument(documentId: string, folderId: string | null) {
    const previous = documents.find(({ document }) => document.id === documentId)?.document.folderId ?? null;
    if (previous === folderId) return;
    setFolderActionError(null);
    setDocuments((current) => current.map((item) => item.document.id === documentId
      ? { ...item, document: { ...item.document, folderId } }
      : item));
    try {
      await moveDocumentToFolder(documentId, folderId);
    } catch (error) {
      setDocuments((current) => current.map((item) => item.document.id === documentId
        ? { ...item, document: { ...item.document, folderId: previous } }
        : item));
      setFolderActionError(error instanceof Error ? error.message : '문서를 이동하지 못했습니다.');
    }
  }

  async function handleMoveFolder(folderId: string, parentId: string | null) {
    const existing = folders.find((folder) => folder.id === folderId);
    if (!existing || existing.parentId === parentId) return;
    if (!canMoveFolder(folders, folderId, parentId)) {
      setFolderActionError('폴더를 자기 자신이나 하위 폴더로 이동할 수 없습니다.');
      return;
    }
    setFolderActionError(null);
    setFolders((current) => current.map((folder) => folder.id === folderId
      ? { ...folder, parentId }
      : folder));
    try {
      const moved = await moveFolder(folderId, parentId);
      setFolders((current) => current.map((folder) => folder.id === moved.id ? moved : folder));
    } catch (error) {
      setFolders((current) => current.map((folder) => folder.id === folderId ? existing : folder));
      setFolderActionError(error instanceof Error ? error.message : '폴더를 이동하지 못했습니다.');
    }
  }

  function handleFolderDrop(event: DragEvent<HTMLElement>, folderId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    setDragOverFolderId(null);

    if (event.dataTransfer.files.length) {
      setSelectedFolderId(folderId);
      void handleFiles(event.dataTransfer.files, folderId);
      return;
    }
    const documentId = event.dataTransfer.getData(DOCUMENT_DRAG_TYPE);
    if (documentId) {
      void handleMoveDocument(documentId, folderId);
      return;
    }
    const draggedFolderId = event.dataTransfer.getData(FOLDER_DRAG_TYPE);
    if (draggedFolderId) void handleMoveFolder(draggedFolderId, folderId);
  }

  async function handleDeleteDocument(item: IndexedDocument) {
    if (deletingDocumentId) return;
    const isRetry = item.status === 'deleting';
    const confirmed = window.confirm(
      isRetry
        ? `“${item.document.title}” 문서 삭제를 다시 시도할까요?`
        : `“${item.document.title}” 문서와 원본 파일, 검색 벡터를 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.`,
    );
    if (!confirmed) return;

    const documentId = item.document.id;
    setDeletingDocumentId(documentId);
    setDocumentActionError(null);
    try {
      await deleteStoredDocument(documentId);
      const selectedIndex = documents.findIndex(({ document }) => document.id === documentId);
      const remainingDocuments = documents.filter(({ document }) => document.id !== documentId);
      const nextDocument = remainingDocuments[Math.min(selectedIndex, remainingDocuments.length - 1)];
      setDocuments(remainingDocuments);
      setSelectedDocumentId(nextDocument?.document.id ?? '');
      setActiveSources((current) => current.filter((source) => source.documentId !== documentId));
      setMessages((current) => current.map((message) =>
        message.sources
          ? {
            ...message,
            sources: message.sources.filter((source) => source.documentId !== documentId),
          }
          : message));
    } catch (error) {
      setDocuments((current) => current.map((document) =>
        document.document.id === documentId
          ? { ...document, status: 'deleting' }
          : document));
      setDocumentActionError({
        documentId,
        message: error instanceof Error ? error.message : '문서 삭제에 실패했습니다.',
      });
    } finally {
      setDeletingDocumentId(null);
    }
  }

  async function handleQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = query.trim();
    if (!question || searchBusy) return;

    const now = Date.now();
    setQuery('');
    setSearchBusy(true);
    setMessages((current) => [
      ...current,
      { id: `user-${now}`, role: 'user', text: question },
    ]);

    try {
      const scopedDocuments = searchFolderId
        ? documentsInFolderScope(documents, folders, searchFolderId, { recursive: true })
        : documents;
      const result = await searchRepository(scopedDocuments, question, searchFolderId || null);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${now}`,
          role: 'assistant',
          text: result.answer,
          sources: result.sources,
        },
      ]);
      setActiveSources(result.sources);
      if (result.sources[0]) setSelectedDocumentId(result.sources[0].documentId);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${now}`,
          role: 'assistant',
          text: error instanceof Error ? error.message : '문서 검색에 실패했습니다.',
        },
      ]);
      setActiveSources([]);
    } finally {
      setSearchBusy(false);
    }
  }

  function handleQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!shouldSubmitChatOnEnter(
      event.key,
      event.shiftKey,
      event.nativeEvent.isComposing,
    )) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function openSource(source: SourceReference) {
    setSelectedDocumentId(source.documentId);
    const sourceDocument = documents.find(({ document }) => document.id === source.documentId);
    setSelectedFolderId(sourceDocument?.document.folderId ?? null);
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
            <i className={system?.providers.embedding.configured ? 'connected' : ''} />
            Qdrant Inference
            <em>{system?.providers.embedding.configured ? '활성' : '대기'}</em>
          </div>
          <div className="provider-row">
            <i className={system?.providers.qdrant.configured ? 'connected' : ''} />
            Qdrant
            <em>{system?.providers.qdrant.configured ? '연결됨' : '대기'}</em>
          </div>
          <div className="provider-row">
            <i className={system?.providers.generation.configured ? 'connected' : ''} />
            Claude on AWS
            <em>{system?.providers.generation.configured ? '활성' : '대기'}</em>
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
              <label className="chat-search-scope">
                <FolderInput size={14} />
                <span>검색 범위</span>
                <select
                  aria-label="질문 검색 폴더"
                  value={searchFolderId}
                  onChange={(event) => setSearchFolderId(event.target.value)}
                  disabled={searchBusy}
                >
                  <option value="">전체 저장소</option>
                  {folderTree.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {`${'　'.repeat(folder.depth)}${folder.name}`}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </label>
              <form className="composer" onSubmit={handleQuestion}>
                <button type="button" aria-label="문서 첨부" onClick={() => setView('upload')}>
                  <Paperclip size={19} />
                </button>
                <textarea
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={handleQuestionKeyDown}
                  placeholder="예: 재택근무는 일주일에 몇 번 가능한가요?"
                  rows={1}
                  disabled={searchBusy}
                />
                <button
                  className="send-button"
                  type="submit"
                  aria-label="질문 보내기"
                  disabled={!query.trim() || searchBusy}
                >
                  {searchBusy ? <LoaderCircle size={18} className="spin" /> : <Send size={18} />}
                </button>
              </form>
              <p>Qdrant가 근거를 검색하고 Claude Platform on AWS가 답변을 생성합니다.</p>
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
              <nav className="folder-breadcrumb" aria-label="현재 폴더 경로">
                <button type="button" onClick={() => selectFolder(null)}>
                  <Home size={14} /> 내 문서
                </button>
                {selectedFolderPath.map((folder) => (
                  <span key={folder.id}>
                    <ChevronRight size={12} />
                    <button type="button" onClick={() => selectFolder(folder.id)}>{folder.name}</button>
                  </span>
                ))}
              </nav>
              <label className="document-search">
                <Search size={17} />
                <input
                  aria-label="문서명 검색"
                  placeholder="문서명 검색"
                  value={documentFilter}
                  onChange={(event) => setDocumentFilter(event.target.value)}
                />
              </label>
              <span>{filteredDocuments.length} documents · {totalChunks} chunks</span>
            </div>

            <div className="document-layout">
              <aside className="folder-navigation">
                <div className="folder-navigation-heading">
                  <span>FOLDERS</span>
                  <button type="button" onClick={() => void handleCreateFolder()} disabled={folderBusy} title="새 폴더">
                    {folderBusy ? <LoaderCircle size={15} className="spin" /> : <FolderPlus size={15} />}
                  </button>
                </div>
                <button
                  className={`folder-tree-root ${selectedFolderId === null ? 'selected' : ''} ${dragOverFolderId === 'root' ? 'drop-target' : ''}`}
                  type="button"
                  onClick={() => selectFolder(null)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOverFolderId('root');
                  }}
                  onDrop={(event) => handleFolderDrop(event, null)}
                >
                  <Home size={16} />
                  내 문서
                  <small>{documents.filter(({ document }) => !document.folderId).length}</small>
                </button>
                <div className="folder-tree">
                  {folderTree.map((folder) => (
                    <button
                      className={`${selectedFolderId === folder.id ? 'selected' : ''} ${dragOverFolderId === folder.id ? 'drop-target' : ''}`}
                      draggable
                      key={folder.id}
                      type="button"
                      style={{ paddingLeft: `${12 + folder.depth * 16}px` }}
                      onClick={() => selectFolder(folder.id)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.id);
                      }}
                      onDragEnd={() => setDragOverFolderId(null)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDragOverFolderId(folder.id);
                      }}
                      onDrop={(event) => handleFolderDrop(event, folder.id)}
                    >
                      <Folder size={15} />
                      <span>{folder.name}</span>
                      <small>{documents.filter(({ document }) => document.folderId === folder.id).length}</small>
                    </button>
                  ))}
                </div>
                <p>파일과 폴더를 원하는 위치로 드래그하세요.</p>
              </aside>

              <div className="repository-browser">
                <div className="repository-browser-heading">
                  <div>
                    <span className="eyebrow">CURRENT FOLDER</span>
                    <h2>{selectedFolder?.name ?? '내 문서'}</h2>
                  </div>
                  <div className="folder-actions">
                    <button type="button" onClick={() => void handleCreateFolder()} disabled={folderBusy}>
                      <FolderPlus size={14} /> 새 폴더
                    </button>
                    {selectedFolder ? (
                      <>
                        <button type="button" onClick={() => void handleRenameSelectedFolder()} disabled={folderBusy}>
                          <Pencil size={13} /> 이름 변경
                        </button>
                        <button className="danger" type="button" onClick={() => void handleDeleteSelectedFolder()} disabled={folderBusy}>
                          <Trash2 size={13} /> 삭제
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {folderActionError ? <p className="folder-action-error" role="alert">{folderActionError}</p> : null}

                {childFolders.length ? (
                  <div className="folder-grid">
                    {childFolders.map((folder) => (
                      <button
                        className={dragOverFolderId === folder.id ? 'drop-target' : ''}
                        draggable
                        key={folder.id}
                        type="button"
                        onClick={() => selectFolder(folder.id)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.id);
                        }}
                        onDragEnd={() => setDragOverFolderId(null)}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setDragOverFolderId(folder.id);
                        }}
                        onDrop={(event) => handleFolderDrop(event, folder.id)}
                      >
                        <span><Folder size={20} /></span>
                        <strong>{folder.name}</strong>
                        <small>{documents.filter(({ document }) => document.folderId === folder.id).length}개 문서</small>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                ) : null}

                <div
                  className={`document-list ${dragOverFolderId === (selectedFolderId ?? 'root') ? 'drop-target' : ''}`}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes('Files')) return;
                    event.preventDefault();
                    setDragOverFolderId(selectedFolderId ?? 'root');
                  }}
                  onDrop={(event) => handleFolderDrop(event, selectedFolderId)}
                >
                  {filteredDocuments.map((item) => {
                    const Icon = fileIcon(item.document.sourceType);
                    return (
                      <button
                        className={selectedDocument?.document.id === item.document.id ? 'selected' : ''}
                        draggable
                        key={item.document.id}
                        type="button"
                        onClick={() => setSelectedDocumentId(item.document.id)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData(DOCUMENT_DRAG_TYPE, item.document.id);
                        }}
                        onDragEnd={() => setDragOverFolderId(null)}
                      >
                        <span className={`file-icon ${item.document.sourceType}`}><Icon size={20} /></span>
                        <span className="document-name">
                          <strong>{item.document.title}</strong>
                          <small>{item.document.name}</small>
                        </span>
                        <span className="document-meta">
                          <strong>{item.chunks.length} chunks</strong>
                          <small>
                            {item.status === 'deleting' ? '삭제 재시도 필요' : formatBytes(item.document.sizeBytes)}
                          </small>
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
                      <FolderOpen size={24} />
                      <strong>{documentFilter ? '일치하는 문서가 없습니다' : '이 폴더가 비어 있습니다'}</strong>
                      <span>파일을 이 영역이나 왼쪽 폴더로 드래그해 업로드할 수 있습니다.</span>
                    </div>
                  ) : null}
                </div>
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
                  <label className="document-folder-select">
                    <span><FolderInput size={14} /> 저장 위치</span>
                    <select
                      aria-label="문서 이동 폴더"
                      value={selectedDocument.document.folderId ?? ''}
                      onChange={(event) => void handleMoveDocument(
                        selectedDocument.document.id,
                        event.target.value || null,
                      )}
                    >
                      <option value="">내 문서</option>
                      {folderTree.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {`${'　'.repeat(folder.depth)}${folder.name}`}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} />
                  </label>
                  {documentActionError?.documentId === selectedDocument.document.id ? (
                    <p className="document-action-error" role="alert">
                      {documentActionError.message}
                    </p>
                  ) : null}
                  <div className="document-preview-sticky">
                    <div className="document-preview-heading">
                      <h3>
                        {selectedDocument.status === 'deleting' ? '삭제 대기 중' : '원본 미리보기'}
                      </h3>
                      <div className="document-preview-actions">
                        {selectedDocument.status !== 'deleting' ? (
                          <a
                            className="document-download-action"
                            href={`/api/documents/${encodeURIComponent(selectedDocument.document.id)}/original?disposition=attachment`}
                          >
                            <Download size={14} />
                            다운로드
                          </a>
                        ) : null}
                        <button
                          className="document-delete-action"
                          type="button"
                          disabled={deletingDocumentId !== null}
                          onClick={() => handleDeleteDocument(selectedDocument)}
                        >
                          {deletingDocumentId === selectedDocument.document.id ? (
                            <LoaderCircle size={14} className="spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                          {selectedDocument.status === 'deleting' ? '삭제 재시도' : '삭제'}
                        </button>
                      </div>
                    </div>
                    {selectedDocument.status === 'deleting' ? (
                      <div className="document-deletion-pending">
                        <Trash2 size={22} />
                        <strong>검색에서는 이미 제외됐습니다</strong>
                        <span>외부 리소스 정리가 실패했다면 삭제 재시도를 눌러 마무리하세요.</span>
                      </div>
                    ) : (
                      <div className="document-preview-frame">
                        <iframe
                          key={selectedDocument.document.id}
                          name={DOCUMENT_PREVIEW_FRAME_NAME}
                          src={documentPreviewUrl(selectedDocument.document.id)}
                          title={`${selectedDocument.document.title} 원본 미리보기`}
                          sandbox={selectedDocument.document.sourceType === 'pdf' ? undefined : ''}
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}
                  </div>
                  {selectedDocument.status !== 'deleting' ? (
                    <>
                      <div className="inspector-rule" />
                      <div className="structure-heading">
                        <h3>구조화 결과</h3>
                        <span>선택하면 원문 위치로 이동합니다</span>
                      </div>
                      <div className="structure-list">
                        {selectedDocument.chunks.map((chunk) => (
                          <a
                            href={documentPreviewUrl(selectedDocument.document.id, chunk)}
                            key={chunk.id}
                            target={DOCUMENT_PREVIEW_FRAME_NAME}
                          >
                            <span>{chunk.ordinal + 1}</span>
                            <p>
                              <strong>{chunk.headingPath.join(' › ') || '본문'}</strong>
                              <small>
                                {[chunkLocation(chunk.location), `${chunk.wordCount} words`]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </small>
                            </p>
                          </a>
                        ))}
                        {!selectedDocument.chunks.length ? (
                          <p className="structure-list-empty">구조화된 본문 위치가 없습니다.</p>
                        ) : null}
                      </div>
                    </>
                  ) : null}
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
              <label className="upload-folder-select">
                <span><FolderInput size={16} /> 저장할 폴더</span>
                <select
                  value={selectedFolderId ?? ''}
                  onChange={(event) => setSelectedFolderId(event.target.value || null)}
                  disabled={uploadBusy}
                >
                  <option value="">내 문서</option>
                  {folderTree.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {`${'　'.repeat(folder.depth)}${folder.name}`}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </label>
              <div
                className="dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleFiles(event.dataTransfer.files);
                }}
              >
                {uploadBusy ? <LoaderCircle size={34} className="spin" /> : <UploadCloud size={34} />}
                <h2>{uploadBusy ? '문서를 구조화하고 Qdrant에 색인하는 중입니다' : '문서를 여기에 놓으세요'}</h2>
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
                    <small>
                      {[source.heading, sourceLocation(source)].filter(Boolean).join(' · ')}
                    </small>
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
