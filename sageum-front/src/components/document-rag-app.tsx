'use client';

import {
  ArrowDownAZ,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
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
  Link2,
  ListChecks,
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
  X,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import {
  type CSSProperties,
  type FormEvent,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { logoutAction } from '@/app/actions';
import { deleteStoredDocument } from '@/lib/documents/browser-delete';
import {
  fetchDocumentIngestionJob,
  reuploadAndProcessDocument,
  retryUploadedDocument,
  uploadAndProcessDocument,
  type DocumentUploadProgress,
  type DocumentUploadStage,
} from '@/lib/documents/browser-upload';
import {
  sortRepositoryDocuments,
  sortRepositoryFolders,
  type DocumentSort,
} from '@/lib/documents/repository-sort';
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
  DocumentIngestionJob,
  DocumentIngestionStatus,
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

type View = 'chat' | 'documents' | 'upload' | 'upload-status';
type InspectorResizeStart = {
  pointerId: number;
  clientX: number;
  width: number;
  maxWidth: number;
};

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  sources?: SourceReference[];
};

type UploadJob = Omit<DocumentIngestionJob, 'id' | 'stage'> & {
  id: string;
  jobId: string | null;
  stage: DocumentUploadStage;
};
type UploadJobFilter = 'all' | 'running' | 'ready' | 'failed';
const UPLOAD_PAGE_SIZES = [10, 30, 50] as const;
type UploadPageSize = (typeof UPLOAD_PAGE_SIZES)[number];

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
const SOURCE_PREVIEW_FRAME_NAME = 'sageum-source-preview';
const DOCUMENT_DRAG_TYPE = 'application/x-sageum-document';
const FOLDER_DRAG_TYPE = 'application/x-sageum-folder';
const DOCUMENT_INSPECTOR_WIDTH_KEY = 'sageum:document-inspector-width';
const DOCUMENT_INSPECTOR_DEFAULT_WIDTH = 560;
const DOCUMENT_INSPECTOR_MIN_WIDTH = 400;
const DOCUMENT_INSPECTOR_MAX_VIEWPORT_RATIO = 0.74;
const UPLOAD_STEPS = ['원본 업로드', '구조 추출', '벡터 색인', '완료'] as const;

const UPLOAD_STAGE_LABELS: Record<UploadJob['stage'], string> = {
  queued: '처리 대기 중',
  creating: '업로드 준비 중',
  uploading: 'Supabase 원본 업로드 중',
  parsing: '문서 구조 추출 중',
  ocr: '문서 이미지 OCR 중',
  chunking: '검색 청크 생성 중',
  indexing: 'Qdrant 벡터 색인 중',
  ready: '문서 등록 완료',
  failed: '처리 실패',
};

function uploadStageStep(stage: UploadJob['stage']) {
  if (stage === 'parsing' || stage === 'ocr' || stage === 'chunking') return 1;
  if (stage === 'indexing') return 2;
  if (stage === 'ready') return 3;
  return 0;
}

function uploadJobFromRecord(job: DocumentIngestionJob): UploadJob {
  return { ...job, id: job.id, jobId: job.id };
}

function uploadJobStatusForStage(stage: DocumentUploadStage): DocumentIngestionStatus {
  if (stage === 'ready') return 'ready';
  if (stage === 'failed') return 'failed';
  if (stage === 'uploading') return 'uploading';
  if (stage === 'queued' || stage === 'creating') return 'queued';
  return 'processing';
}

function uploadJobClass(job: UploadJob) {
  return job.status === 'ready' || job.status === 'failed' ? job.status : 'running';
}

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
  if (location.imageIndex !== undefined) return `이미지 ${location.imageIndex}`;
  return null;
}

function sourceLocation(source: SourceReference) {
  if (source.page !== undefined) return `${source.page}페이지`;
  if (source.sheet) return source.cellRange ? `${source.sheet} · ${source.cellRange}` : source.sheet;
  if (source.imageIndex !== undefined) return `이미지 ${source.imageIndex}`;
  return null;
}

function chunkRangeLabel(chunk: DocumentChunk) {
  const first = chunk.sourceSpans[0];
  const last = chunk.sourceSpans.at(-1);
  if (!first || !last) {
    return chunk.blockStart === chunk.blockEnd
      ? `범위 · 블록 ${chunk.blockStart + 1}`
      : `범위 · 블록 ${chunk.blockStart + 1}–${chunk.blockEnd + 1}`;
  }
  if (first.blockIndex === last.blockIndex) {
    return `범위 · 블록 ${first.blockIndex + 1}:${first.startOffset}–${last.endOffset}`;
  }
  return `범위 · 블록 ${first.blockIndex + 1}:${first.startOffset} → ${last.blockIndex + 1}:${last.endOffset}`;
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function documentPreviewUrl(documentId: string, chunk?: DocumentChunk) {
  const params = new URLSearchParams({ embedded: '1' });
  if (chunk) params.set('chunk', chunk.id);
  if (chunk?.location.page !== undefined) params.set('page', String(chunk.location.page));
  const base = `/documents/${encodeURIComponent(documentId)}/preview?${params.toString()}`;
  if (!chunk) return base;
  if (chunk.location.page !== undefined) return base;
  return `${base}#block-${chunk.focusBlock}`;
}

function DocumentInspector({
  item,
  folderTree,
  expandedStructureChunkId,
  deletingDocumentId,
  documentActionError,
  frameName,
  modal = false,
  onClose,
  onMoveDocument,
  onDeleteDocument,
  onExpandStructure,
}: {
  item: IndexedDocument;
  folderTree: ReturnType<typeof flattenFolderTree>;
  expandedStructureChunkId: string | null;
  deletingDocumentId: string | null;
  documentActionError: string | null;
  frameName: string;
  modal?: boolean;
  onClose?: () => void;
  onMoveDocument: (documentId: string, folderId: string | null) => void | Promise<void>;
  onDeleteDocument: (item: IndexedDocument) => void | Promise<void>;
  onExpandStructure: (chunkId: string) => void;
}) {
  const DocumentIcon = fileIcon(item.document.sourceType);
  const previewChunk = item.chunks.find((chunk) => chunk.id === expandedStructureChunkId);
  const snippetPrefix = modal ? 'modal-structure-snippet' : 'structure-snippet';

  return (
    <aside className={`document-inspector${modal ? ' document-inspector-modal' : ''}`}>
      {onClose ? (
        <button
          aria-label="문서 상세 패널 닫기"
          className="document-inspector-close"
          title="문서 상세 닫기"
          type="button"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      ) : null}
      <span className={`large-file-icon ${item.document.sourceType}`}>
        <DocumentIcon size={28} />
      </span>
      <span className="eyebrow">DOCUMENT DETAIL</span>
      <h2>{item.document.title}</h2>
      <p>{item.document.name}</p>
      <dl>
        <div><dt>형식</dt><dd>{item.document.sourceType.toUpperCase()}</dd></div>
        <div><dt>크기</dt><dd>{formatBytes(item.document.sizeBytes)}</dd></div>
        <div><dt>청크</dt><dd>{item.chunks.length}</dd></div>
        <div><dt>인덱싱</dt><dd>{formatDate(item.indexedAt)}</dd></div>
      </dl>
      <label className="document-folder-select">
        <span><FolderInput size={14} /> 저장 위치</span>
        <select
          aria-label="문서 이동 폴더"
          value={item.document.folderId ?? ''}
          onChange={(event) => void onMoveDocument(
            item.document.id,
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
      {documentActionError ? (
        <p className="document-action-error" role="alert">{documentActionError}</p>
      ) : null}
      <div className="document-preview-sticky">
        <div className="document-preview-heading">
          <h3>{item.status === 'deleting' ? '삭제 대기 중' : '원본 미리보기'}</h3>
          <div className="document-preview-actions">
            {item.status !== 'deleting' ? (
              <a
                className="document-download-action"
                href={`/api/documents/${encodeURIComponent(item.document.id)}/original?disposition=attachment`}
              >
                <Download size={14} />
                다운로드
              </a>
            ) : null}
            <button
              className="document-delete-action"
              type="button"
              disabled={deletingDocumentId !== null}
              onClick={() => void onDeleteDocument(item)}
            >
              {deletingDocumentId === item.document.id ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Trash2 size={14} />
              )}
              {item.status === 'deleting' ? '삭제 재시도' : '삭제'}
            </button>
          </div>
        </div>
        {item.status === 'deleting' ? (
          <div className="document-deletion-pending">
            <Trash2 size={22} />
            <strong>검색에서는 이미 제외됐습니다</strong>
            <span>외부 리소스 정리가 실패했다면 삭제 재시도를 눌러 마무리하세요.</span>
          </div>
        ) : (
          <div className="document-preview-frame">
            <iframe
              key={`${item.document.id}:${previewChunk?.id ?? 'default'}`}
              name={frameName}
              src={documentPreviewUrl(item.document.id, previewChunk)}
              title={`${item.document.title} 원본 미리보기`}
              sandbox={item.document.sourceType === 'pdf' ? undefined : ''}
              referrerPolicy="no-referrer"
            />
          </div>
        )}
      </div>
      {item.status !== 'deleting' ? (
        <>
          <div className="inspector-rule" />
          <div className="structure-heading">
            <h3>구조화 결과</h3>
            <span>선택하면 원문 위치로 이동합니다</span>
          </div>
          <div className="structure-list">
            {item.chunks.map((chunk) => {
              const expanded = expandedStructureChunkId === chunk.id;
              const snippetId = `${snippetPrefix}-${chunk.ordinal}`;
              return (
                <a
                  aria-controls={snippetId}
                  aria-expanded={expanded}
                  href={documentPreviewUrl(item.document.id, chunk)}
                  key={chunk.id}
                  onClick={() => onExpandStructure(chunk.id)}
                  target={frameName}
                >
                  <span>{chunk.ordinal + 1}</span>
                  <div className="structure-list-content">
                    <p>
                      <strong>{chunk.headingPath.join(' › ') || '본문'}</strong>
                      <small>
                        {[chunkLocation(chunk.location), `${chunk.wordCount} words`]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                      <small className="structure-range">{chunkRangeLabel(chunk)}</small>
                    </p>
                    {expanded ? (
                      <p className="structure-snippet" id={snippetId}>{chunk.text}</p>
                    ) : null}
                  </div>
                </a>
              );
            })}
            {!item.chunks.length ? (
              <p className="structure-list-empty">구조화된 본문 위치가 없습니다.</p>
            ) : null}
          </div>
        </>
      ) : null}
    </aside>
  );
}

export function DocumentRagApp({
  userEmail,
  initialDocuments,
  initialFolders,
  initialIngestionJobs,
}: {
  userEmail: string;
  initialDocuments: IndexedDocument[];
  initialFolders: RepositoryFolder[];
  initialIngestionJobs: DocumentIngestionJob[];
}) {
  const [view, setView] = useState<View>('chat');
  const [documents, setDocuments] = useState<IndexedDocument[]>(() => initialDocuments);
  const [folders, setFolders] = useState<RepositoryFolder[]>(() => initialFolders);
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [query, setQuery] = useState('');
  const [documentFilter, setDocumentFilter] = useState('');
  const [documentSort, setDocumentSort] = useState<DocumentSort>('name');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchFolderId, setSearchFolderId] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderActionError, setFolderActionError] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null | 'root'>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [expandedStructureChunkId, setExpandedStructureChunkId] = useState<string | null>(null);
  const [sourcePreview, setSourcePreview] = useState<SourceReference | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState(DOCUMENT_INSPECTOR_DEFAULT_WIDTH);
  const [inspectorMaxWidth, setInspectorMaxWidth] = useState(DOCUMENT_INSPECTOR_DEFAULT_WIDTH);
  const [inspectorResizeStart, setInspectorResizeStart] = useState<InspectorResizeStart | null>(null);
  const [activeSources, setActiveSources] = useState<SourceReference[]>([]);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>(() => (
    initialIngestionJobs.map(uploadJobFromRecord)
  ));
  const [uploadJobFilter, setUploadJobFilter] = useState<UploadJobFilter>('all');
  const [uploadPageSize, setUploadPageSize] = useState<UploadPageSize>(10);
  const [uploadPage, setUploadPage] = useState(1);
  const [retryingUploadJobId, setRetryingUploadJobId] = useState<string | null>(null);
  const [retryFileJobId, setRetryFileJobId] = useState<string | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [documentActionError, setDocumentActionError] = useState<{
    documentId: string;
    message: string;
  } | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const retryFileInputRef = useRef<HTMLInputElement | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const documentLayoutRef = useRef<HTMLDivElement | null>(null);
  const sourceModalRef = useRef<HTMLElement | null>(null);
  const sourceModalCloseRef = useRef<HTMLButtonElement | null>(null);
  const sourceModalTriggerRef = useRef<HTMLElement | null>(null);
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

  useEffect(() => {
    if (!sourcePreview) return;
    const trigger = sourceModalTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSourcePreview(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const modal = sourceModalRef.current;
      if (!modal) return;
      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])',
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
    const focusFrame = window.requestAnimationFrame(() => sourceModalCloseRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [sourcePreview]);

  useEffect(() => {
    if (view !== 'documents') return;
    const updateWidth = () => {
      const { maxWidth } = inspectorWidthBounds();
      setInspectorMaxWidth(maxWidth);
      setInspectorWidth((current) => clamp(
        current,
        DOCUMENT_INSPECTOR_MIN_WIDTH,
        maxWidth,
      ));
    };
    const savedWidth = Number.parseInt(
      window.localStorage.getItem(DOCUMENT_INSPECTOR_WIDTH_KEY) ?? '',
      10,
    );
    const { maxWidth } = inspectorWidthBounds();
    setInspectorMaxWidth(maxWidth);
    setInspectorWidth(clamp(
      Number.isFinite(savedWidth) ? savedWidth : DOCUMENT_INSPECTOR_DEFAULT_WIDTH,
      DOCUMENT_INSPECTOR_MIN_WIDTH,
      maxWidth,
    ));
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [view]);

  useEffect(() => {
    if (!inspectorResizeStart) return;
    document.body.classList.add('resizing-document-inspector');
    return () => document.body.classList.remove('resizing-document-inspector');
  }, [inspectorResizeStart]);

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
    () => folders.filter((folder) => folder.parentId === selectedFolderId),
    [folders, selectedFolderId],
  );
  const filteredChildFolders = useMemo(() => {
    const term = documentFilter.trim().toLocaleLowerCase('ko-KR');
    const matchingFolders = term
      ? childFolders.filter((folder) => folder.name.toLocaleLowerCase('ko-KR').includes(term))
      : childFolders;
    return sortRepositoryFolders(matchingFolders, documentSort);
  }, [childFolders, documentFilter, documentSort]);
  const folderContentCounts = useMemo(() => {
    const counts = new Map<string | null, { folders: number; documents: number }>();
    const countFor = (folderId: string | null) => {
      const existing = counts.get(folderId);
      if (existing) return existing;
      const created = { folders: 0, documents: 0 };
      counts.set(folderId, created);
      return created;
    };
    folders.forEach((folder) => {
      countFor(folder.parentId).folders += 1;
    });
    documents.forEach(({ document }) => {
      countFor(document.folderId ?? null).documents += 1;
    });
    return counts;
  }, [documents, folders]);
  const totalChunks = useMemo(
    () => documents.reduce((sum, document) => sum + document.chunks.length, 0),
    [documents],
  );
  const uploadJobSummary = useMemo(() => ({
    running: uploadJobs.filter((job) => !['ready', 'failed'].includes(job.status)).length,
    ready: uploadJobs.filter((job) => job.status === 'ready').length,
    failed: uploadJobs.filter((job) => job.status === 'failed').length,
  }), [uploadJobs]);
  const filteredUploadJobs = useMemo(() => {
    if (uploadJobFilter === 'all') return uploadJobs;
    if (uploadJobFilter === 'running') {
      return uploadJobs.filter((job) => !['ready', 'failed'].includes(job.status));
    }
    return uploadJobs.filter((job) => job.status === uploadJobFilter);
  }, [uploadJobFilter, uploadJobs]);
  const uploadPageCount = Math.max(1, Math.ceil(filteredUploadJobs.length / uploadPageSize));
  const currentUploadPage = Math.min(uploadPage, uploadPageCount);
  const uploadPageStart = (currentUploadPage - 1) * uploadPageSize;
  const paginatedUploadJobs = filteredUploadJobs.slice(
    uploadPageStart,
    uploadPageStart + uploadPageSize,
  );
  const filteredDocuments = useMemo(() => {
    const term = documentFilter.trim().toLocaleLowerCase('ko-KR');
    const currentDocuments = documentsInFolderScope(documents, folders, selectedFolderId);
    const matchingDocuments = term
      ? currentDocuments.filter(({ document }) =>
        `${document.title} ${document.name}`.toLocaleLowerCase('ko-KR').includes(term))
      : currentDocuments;
    return sortRepositoryDocuments(matchingDocuments, documentSort);
  }, [documentFilter, documentSort, documents, folders, selectedFolderId]);
  const filteredChunkCount = useMemo(
    () => filteredDocuments.reduce((sum, document) => sum + document.chunks.length, 0),
    [filteredDocuments],
  );
  const selectedDocument = useMemo(
    () => filteredDocuments.find(({ document }) => document.id === selectedDocumentId),
    [filteredDocuments, selectedDocumentId],
  );
  const sourcePreviewDocument = sourcePreview
    ? documents.find(({ document }) => document.id === sourcePreview.documentId)
    : undefined;

  function inspectorWidthBounds() {
    const layoutWidth = documentLayoutRef.current?.getBoundingClientRect().width
      ?? Math.max(window.innerWidth - 248, 0);
    return {
      maxWidth: Math.max(
        DOCUMENT_INSPECTOR_MIN_WIDTH,
        Math.min(
          Math.floor(window.innerWidth * DOCUMENT_INSPECTOR_MAX_VIEWPORT_RATIO),
          layoutWidth,
        ),
      ),
    };
  }

  function inspectorWidthFromPointer(clientX: number, start: InspectorResizeStart) {
    return clamp(
      start.width + start.clientX - clientX,
      DOCUMENT_INSPECTOR_MIN_WIDTH,
      start.maxWidth,
    );
  }

  function handleInspectorResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setInspectorResizeStart({
      pointerId: event.pointerId,
      clientX: event.clientX,
      width: inspectorWidth,
      maxWidth: inspectorWidthBounds().maxWidth,
    });
  }

  function handleInspectorResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!inspectorResizeStart || event.pointerId !== inspectorResizeStart.pointerId) return;
    setInspectorWidth(inspectorWidthFromPointer(event.clientX, inspectorResizeStart));
  }

  function handleInspectorResizeEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!inspectorResizeStart || event.pointerId !== inspectorResizeStart.pointerId) return;
    const nextWidth = inspectorWidthFromPointer(event.clientX, inspectorResizeStart);
    setInspectorWidth(nextWidth);
    setInspectorResizeStart(null);
    window.localStorage.setItem(DOCUMENT_INSPECTOR_WIDTH_KEY, String(nextWidth));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleInspectorResizeCancel(event: ReactPointerEvent<HTMLDivElement>) {
    setInspectorResizeStart(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resetInspectorWidth() {
    const nextWidth = clamp(
      DOCUMENT_INSPECTOR_DEFAULT_WIDTH,
      DOCUMENT_INSPECTOR_MIN_WIDTH,
      inspectorWidthBounds().maxWidth,
    );
    setInspectorWidth(nextWidth);
    window.localStorage.setItem(DOCUMENT_INSPECTOR_WIDTH_KEY, String(nextWidth));
  }

  function handleInspectorResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const { maxWidth } = inspectorWidthBounds();
    let nextWidth = inspectorWidth;
    if (event.key === 'ArrowLeft') nextWidth += 32;
    else if (event.key === 'ArrowRight') nextWidth -= 32;
    else if (event.key === 'Home') nextWidth = DOCUMENT_INSPECTOR_MIN_WIDTH;
    else if (event.key === 'End') nextWidth = maxWidth;
    else return;
    event.preventDefault();
    nextWidth = clamp(nextWidth, DOCUMENT_INSPECTOR_MIN_WIDTH, maxWidth);
    setInspectorWidth(nextWidth);
    window.localStorage.setItem(DOCUMENT_INSPECTOR_WIDTH_KEY, String(nextWidth));
  }

  function updateUploadJob(jobId: string, patch: Partial<UploadJob>) {
    setUploadJobs((current) => current.map((job) => (
      job.id === jobId ? { ...job, ...patch } : job
    )));
  }

  function applyUploadProgress(clientJobId: string, progress: DocumentUploadProgress) {
    updateUploadJob(clientJobId, {
      stage: progress.stage,
      status: uploadJobStatusForStage(progress.stage),
      ...(progress.jobId ? { jobId: progress.jobId } : {}),
      ...(progress.documentId ? { documentId: progress.documentId } : {}),
      ...(progress.versionId ? { versionId: progress.versionId } : {}),
      lastError: null,
      updatedAt: new Date().toISOString(),
    });
  }

  async function syncUploadJob(clientJobId: string, persistedJobId: string) {
    const persisted = await fetchDocumentIngestionJob(persistedJobId);
    setUploadJobs((current) => current.map((job) => (
      job.id === clientJobId
        ? { ...uploadJobFromRecord(persisted), id: clientJobId }
        : job
    )));
    return persisted;
  }

  function storeProcessedDocument(document: IndexedDocument) {
    setDocuments((current) => [
      document,
      ...current.filter(({ document: currentDocument }) => (
        currentDocument.id !== document.document.id
      )),
    ]);
  }

  function openUploadedDocument(documentId: string) {
    const uploaded = documents.find(({ document }) => document.id === documentId);
    if (!uploaded) return;
    setSelectedFolderId(uploaded.document.folderId ?? null);
    setSelectedDocumentId(documentId);
    setView('documents');
  }

  async function handleFiles(
    fileList: FileList | File[],
    folderId = selectedFolderId,
    retryOfJobId: string | null = null,
  ) {
    const files = Array.from(fileList);
    if (!files.length) return;
    const jobs = files.map((file) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      return {
        id,
        file,
        progress: {
          id,
          jobId: null,
          documentId: null,
          versionId: null,
          retryOfJobId,
          folderId,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          stage: 'queued',
          status: 'queued',
          attempts: 1,
          originalAvailable: false,
          lastError: null,
          startedAt: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        } satisfies UploadJob,
      };
    });
    setUploadJobs((current) => [...jobs.map(({ progress }) => progress), ...current]);
    setUploadBusy(true);
    setUploadMessage(null);
    setView('upload-status');

    const results = await Promise.allSettled(
      jobs.map(async ({ id, file }) => {
        let persistedJobId: string | null = null;
        try {
          const document = await uploadAndProcessDocument(
            file,
            folderId,
            (progress: DocumentUploadProgress) => {
              if (progress.jobId) persistedJobId = progress.jobId;
              applyUploadProgress(id, progress);
            },
            retryOfJobId,
          );
          storeProcessedDocument(document);
          if (persistedJobId) await syncUploadJob(id, persistedJobId);
          return document;
        } catch (error) {
          const message = error instanceof Error ? error.message : '파일 처리에 실패했습니다.';
          if (persistedJobId) {
            await syncUploadJob(id, persistedJobId).catch(() => updateUploadJob(id, {
              status: 'failed',
              lastError: message,
              completedAt: new Date().toISOString(),
            }));
          } else {
            updateUploadJob(id, {
              status: 'failed',
              stage: 'failed',
              lastError: message,
              completedAt: new Date().toISOString(),
            });
          }
          throw error;
        }
      }),
    );

    const succeeded = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const failures = results.flatMap((result) =>
      result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : '파일 처리에 실패했습니다.']
        : [],
    );

    if (succeeded.length) {
      setSelectedFolderId(folderId);
      setUploadMessage(
        system?.mode === 'cloud'
          ? `${succeeded.length}개 문서를 Supabase에 저장하고 Qdrant에 색인했습니다.`
          : `${succeeded.length}개 문서를 Supabase에 저장하고 청크로 분할했습니다.`,
      );
    }
    if (failures.length) {
      setUploadMessage(`실패: ${failures.join(' ')}`);
    }
    setUploadBusy(false);
  }

  async function retryPersistentUploadJob(job: UploadJob, file?: File) {
    if (!job.jobId || job.stage === 'creating') return;
    const persistedJob: DocumentIngestionJob = {
      id: job.jobId,
      documentId: job.documentId,
      versionId: job.versionId,
      retryOfJobId: job.retryOfJobId,
      folderId: job.folderId,
      fileName: job.fileName,
      mimeType: job.mimeType,
      sizeBytes: job.sizeBytes,
      status: job.status,
      stage: job.stage,
      attempts: job.attempts,
      originalAvailable: job.originalAvailable,
      lastError: job.lastError,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };

    setRetryingUploadJobId(job.id);
    setUploadMessage(null);
    updateUploadJob(job.id, {
      status: file ? 'uploading' : 'processing',
      stage: file ? 'uploading' : 'parsing',
      attempts: job.attempts + 1,
      lastError: null,
      completedAt: null,
    });

    try {
      const document = file
        ? await reuploadAndProcessDocument(
            persistedJob,
            file,
            (progress) => applyUploadProgress(job.id, progress),
          )
        : await retryUploadedDocument(
            persistedJob,
            (progress) => applyUploadProgress(job.id, progress),
          );
      storeProcessedDocument(document);
      await syncUploadJob(job.id, job.jobId);
      setUploadMessage('문서를 다시 처리하고 검색 인덱스를 갱신했습니다.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '문서 재시도에 실패했습니다.';
      await syncUploadJob(job.id, job.jobId).catch(() => updateUploadJob(job.id, {
        status: 'failed',
        lastError: message,
        completedAt: new Date().toISOString(),
      }));
      setUploadMessage(`실패: ${message}`);
    } finally {
      setRetryingUploadJobId(null);
    }
  }

  function handleRetryUploadJob(job: UploadJob) {
    if (retryingUploadJobId) return;
    if (job.originalAvailable && job.documentId && job.versionId) {
      void retryPersistentUploadJob(job);
      return;
    }
    setRetryFileJobId(job.id);
    retryFileInputRef.current?.click();
  }

  function handleRetryFile(file: File) {
    const job = uploadJobs.find((candidate) => candidate.id === retryFileJobId);
    setRetryFileJobId(null);
    if (!job) return;
    if (job.jobId && job.documentId && job.versionId && !job.originalAvailable) {
      void retryPersistentUploadJob(job, file);
      return;
    }
    void handleFiles([file], job.folderId, job.jobId);
  }

  function selectFolder(folderId: string | null) {
    setSelectedFolderId(folderId);
    setDocumentFilter('');
    setSelectedDocumentId('');
    setExpandedStructureChunkId(null);
    setFolderActionError(null);
  }

  function closeDocumentInspector() {
    setSelectedDocumentId('');
    setExpandedStructureChunkId(null);
    setDocumentActionError(null);
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
      setSourcePreview((current) => current?.documentId === documentId ? null : current);
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
    sourceModalTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setExpandedStructureChunkId(source.chunkId);
    setSourcePreview(source);
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
          <button
            className={view === 'upload-status' ? 'active' : ''}
            type="button"
            onClick={() => setView('upload-status')}
          >
            <ListChecks size={18} />
            처리 현황
            {uploadJobs.length ? <span className="nav-count">{uploadJobs.length}</span> : null}
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
          <Link href="/oauth/connections" aria-label="에이전트 연결 관리" title="에이전트 연결 관리">
            <Link2 size={16} />
          </Link>
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
              <span>
                {filteredChildFolders.length} folders · {filteredDocuments.length} files ·{' '}
                {filteredChunkCount} chunks
              </span>
            </div>

            <div
              className={`document-layout ${selectedDocument ? 'has-inspector' : 'no-inspector'}${
                inspectorResizeStart ? ' resizing' : ''
              }`}
              ref={documentLayoutRef}
              style={{
                '--document-inspector-width': `${inspectorWidth}px`,
              } as CSSProperties}
            >
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
                  <small title="현재 위치의 폴더와 문서 수">
                    {(folderContentCounts.get(null)?.folders ?? 0)
                      + (folderContentCounts.get(null)?.documents ?? 0)}
                  </small>
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
                      <small title="이 폴더에 직접 포함된 폴더와 문서 수">
                        {(folderContentCounts.get(folder.id)?.folders ?? 0)
                          + (folderContentCounts.get(folder.id)?.documents ?? 0)}
                      </small>
                    </button>
                  ))}
                </div>
                <p>파일과 폴더를 원하는 위치로 드래그하세요.</p>
              </aside>

              <div className="repository-browser">
                <div className="repository-browser-heading">
                  <div>
                    <span className="eyebrow">FOLDER PATH</span>
                    <nav className="repository-breadcrumb" aria-label="문서 목록 현재 경로">
                      {selectedFolderId === null ? (
                        <span className="current" aria-current="page">
                          <Home size={17} /> 내 문서
                        </span>
                      ) : (
                        <button type="button" onClick={() => selectFolder(null)}>
                          <Home size={17} /> 내 문서
                        </button>
                      )}
                      {selectedFolderPath.map((folder, index) => {
                        const isCurrent = index === selectedFolderPath.length - 1;
                        return (
                          <span className="repository-breadcrumb-segment" key={folder.id}>
                            <ChevronRight size={15} aria-hidden="true" />
                            {isCurrent ? (
                              <span className="current" aria-current="page">{folder.name}</span>
                            ) : (
                              <button type="button" onClick={() => selectFolder(folder.id)}>
                                {folder.name}
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </nav>
                    <p className="repository-location-summary">
                      하위 폴더 {childFolders.length}개 · 파일{' '}
                      {folderContentCounts.get(selectedFolderId)?.documents ?? 0}개
                    </p>
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

                <div className="repository-explorer-toolbar">
                  <div>
                    <strong>항목</strong>
                    <small>
                      {documentFilter
                        ? '현재 폴더의 검색 결과'
                        : '폴더와 파일을 한 목록에서 탐색합니다'}
                    </small>
                  </div>
                  <span>{filteredChildFolders.length + filteredDocuments.length}개</span>
                  <label className="document-sort-select">
                    <ArrowDownAZ size={14} />
                    <span>정렬</span>
                    <select
                      aria-label="폴더와 파일 정렬 기준"
                      value={documentSort}
                      onChange={(event) => setDocumentSort(event.target.value as DocumentSort)}
                    >
                      <option value="name">이름순</option>
                      <option value="recent">최근 수정순</option>
                      <option value="type">종류순</option>
                    </select>
                    <ChevronDown size={13} />
                  </label>
                </div>

                <div
                  className={`repository-entry-list ${dragOverFolderId === (selectedFolderId ?? 'root') ? 'drop-target' : ''}`}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes('Files')) return;
                    event.preventDefault();
                    setDragOverFolderId(selectedFolderId ?? 'root');
                  }}
                  onDrop={(event) => handleFolderDrop(event, selectedFolderId)}
                >
                  <div className="repository-entry-header" aria-hidden="true">
                    <span>이름</span>
                    <span className="repository-entry-kind">종류</span>
                    <span className="repository-entry-size">크기 / 항목</span>
                    <span className="repository-entry-date">수정일</span>
                    <span />
                  </div>
                  {filteredChildFolders.map((folder) => {
                    const counts = folderContentCounts.get(folder.id);
                    const itemCount = (counts?.folders ?? 0) + (counts?.documents ?? 0);
                    return (
                      <button
                        aria-label={`${folder.name} 폴더 열기`}
                        className={`repository-entry-row folder-entry ${dragOverFolderId === folder.id ? 'drop-target' : ''}`}
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
                        <span className="repository-entry-name">
                          <span className="repository-entry-icon folder"><Folder size={19} /></span>
                          <span><strong>{folder.name}</strong><small>폴더</small></span>
                        </span>
                        <span className="repository-entry-kind">폴더</span>
                        <span className="repository-entry-size">{itemCount}개 항목</span>
                        <span className="repository-entry-date">{formatDate(folder.updatedAt)}</span>
                        <ChevronRight size={15} className="repository-entry-action" />
                      </button>
                    );
                  })}
                  {filteredDocuments.map((item) => {
                    const Icon = fileIcon(item.document.sourceType);
                    return (
                      <button
                        className={`repository-entry-row document-entry${
                          selectedDocument?.document.id === item.document.id ? ' selected' : ''
                        }`}
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
                        <span className="repository-entry-name">
                          <span className={`repository-entry-icon ${item.document.sourceType}`}>
                            <Icon size={19} />
                          </span>
                          <span>
                            <strong>{item.document.title}</strong>
                            <small>{item.document.name}</small>
                          </span>
                        </span>
                        <span className="repository-entry-kind">
                          {item.document.sourceType.toUpperCase()} · {item.chunks.length} chunks
                        </span>
                        <span className="repository-entry-size">{formatBytes(item.document.sizeBytes)}</span>
                        <span className="repository-entry-date">{formatDate(item.indexedAt)}</span>
                        {item.status === 'ready' ? (
                          <CheckCircle2 size={16} className="ready-icon repository-entry-action" />
                        ) : item.status === 'failed' ? (
                          <XCircle size={16} className="failed-icon repository-entry-action" />
                        ) : (
                          <LoaderCircle size={16} className="processing-icon spin repository-entry-action" />
                        )}
                      </button>
                    );
                  })}
                  {!filteredChildFolders.length && !filteredDocuments.length ? (
                    <div className="document-list-empty">
                      <FolderOpen size={24} />
                      <strong>{documentFilter ? '일치하는 항목이 없습니다' : '이 폴더가 비어 있습니다'}</strong>
                      <span>파일을 이 영역이나 왼쪽 폴더로 드래그해 업로드할 수 있습니다.</span>
                    </div>
                  ) : null}
                </div>
              </div>

              {selectedDocument ? (
                <div
                  aria-label="문서 상세 패널 너비 조절"
                  aria-orientation="vertical"
                  aria-valuemax={Math.round(inspectorMaxWidth)}
                  aria-valuemin={DOCUMENT_INSPECTOR_MIN_WIDTH}
                  aria-valuenow={Math.round(inspectorWidth)}
                  className="document-inspector-resizer"
                  role="separator"
                  tabIndex={0}
                  title="드래그하거나 방향키로 크기를 조절합니다. 더블 클릭하면 초기화됩니다."
                  onDoubleClick={resetInspectorWidth}
                  onKeyDown={handleInspectorResizeKeyDown}
                  onPointerCancel={handleInspectorResizeCancel}
                  onPointerDown={handleInspectorResizeStart}
                  onPointerMove={handleInspectorResizeMove}
                  onPointerUp={handleInspectorResizeEnd}
                />
              ) : null}

              {selectedDocument ? (
                <DocumentInspector
                  item={selectedDocument}
                  folderTree={folderTree}
                  expandedStructureChunkId={expandedStructureChunkId}
                  deletingDocumentId={deletingDocumentId}
                  documentActionError={
                    documentActionError?.documentId === selectedDocument.document.id
                      ? documentActionError.message
                      : null
                  }
                  frameName={DOCUMENT_PREVIEW_FRAME_NAME}
                  onClose={closeDocumentInspector}
                  onMoveDocument={handleMoveDocument}
                  onDeleteDocument={handleDeleteDocument}
                  onExpandStructure={setExpandedStructureChunkId}
                />
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

        {view === 'upload-status' ? (
          <section className="upload-status-view">
            <header className="rag-topbar">
              <div>
                <span className="eyebrow">INGESTION ACTIVITY</span>
                <h1>처리 현황</h1>
              </div>
              <button className="primary-action" type="button" onClick={() => setView('upload')}>
                <UploadCloud size={17} />
                문서 추가
              </button>
            </header>

            <div className="upload-status-content">
              <section className="upload-status-summary" aria-label="처리 상태 필터">
                {([
                  ['all', '전체', uploadJobs.length],
                  ['running', '진행 중', uploadJobSummary.running],
                  ['ready', '완료', uploadJobSummary.ready],
                  ['failed', '실패', uploadJobSummary.failed],
                ] as const).map(([filter, label, count]) => (
                  <button
                    aria-pressed={uploadJobFilter === filter}
                    className={`${filter}${uploadJobFilter === filter ? ' active' : ''}`}
                    key={filter}
                    type="button"
                    onClick={() => {
                      setUploadJobFilter(filter);
                      setUploadPage(1);
                    }}
                  >
                    <span>{label}</span>
                    <strong>{count}</strong>
                  </button>
                ))}
              </section>

              <div className="upload-status-heading">
                <div>
                  <span className="eyebrow">FILES</span>
                  <h2>파일별 처리 단계</h2>
                  <p>현재 계정에서 등록한 전체 업로드 이력과 재시도 상태입니다.</p>
                </div>
                <span className="upload-history-count">
                  {uploadJobFilter === 'all'
                    ? `총 ${uploadJobs.length}건`
                    : `${filteredUploadJobs.length} / ${uploadJobs.length}건`}
                </span>
              </div>

              {uploadMessage ? (
                <div
                  className={uploadMessage.includes('실패') ? 'upload-notice error' : 'upload-notice'}
                  role="status"
                >
                  {uploadMessage.includes('실패') ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
                  {uploadMessage}
                </div>
              ) : null}

              <div className="upload-job-list" aria-live="polite">
                {paginatedUploadJobs.map((job) => {
                  const currentStep = uploadStageStep(job.stage);
                  const jobClass = uploadJobClass(job);
                  return (
                    <article className={`upload-job ${jobClass}`} key={job.id}>
                      <div className="upload-job-file">
                        <span className="upload-job-icon">
                          {job.status === 'failed' ? (
                            <XCircle size={20} />
                          ) : job.status === 'ready' ? (
                            <CheckCircle2 size={20} />
                          ) : (
                            <LoaderCircle size={20} className="spin" />
                          )}
                        </span>
                        <div>
                          <strong title={job.fileName}>{job.fileName}</strong>
                          <span>
                            {formatBytes(job.sizeBytes)} · {formatDate(job.createdAt)} · {job.attempts}회 시도
                            {!job.documentId ? ' · 문서 삭제됨' : ''}
                          </span>
                        </div>
                        <em>
                          {job.status === 'failed'
                            ? `실패 · ${UPLOAD_STAGE_LABELS[job.stage]}`
                            : UPLOAD_STAGE_LABELS[job.stage]}
                        </em>
                      </div>

                      <ol className="upload-job-steps" aria-label={`${job.fileName} 처리 단계`}>
                        {UPLOAD_STEPS.map((step, index) => {
                          const stepState = job.status === 'failed' && index === currentStep
                            ? 'failed'
                            : job.status === 'ready' || index < currentStep
                              ? 'done'
                              : index === currentStep
                                ? 'active'
                                : 'pending';
                          return (
                            <li className={stepState} key={step}>
                              <i aria-hidden="true" />
                              <span>{step}</span>
                            </li>
                          );
                        })}
                      </ol>

                      {job.lastError ? <p className="upload-job-error">{job.lastError}</p> : null}
                      <div className="upload-job-actions">
                        {job.status === 'failed' ? (
                          <button
                            className="upload-job-retry"
                            type="button"
                            disabled={retryingUploadJobId !== null}
                            onClick={() => handleRetryUploadJob(job)}
                          >
                            {retryingUploadJobId === job.id ? (
                              <LoaderCircle size={14} className="spin" />
                            ) : (
                              <UploadCloud size={14} />
                            )}
                            {job.originalAvailable && job.documentId && job.versionId
                              ? '다시 처리'
                              : '파일 선택 후 재시도'}
                          </button>
                        ) : null}
                        {job.status === 'ready' && job.documentId ? (
                          <button
                            className="upload-job-open"
                            type="button"
                            onClick={() => openUploadedDocument(job.documentId!)}
                          >
                            문서 열기
                            <ChevronRight size={14} />
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
                {!uploadJobs.length ? (
                  <div className="upload-job-empty">
                    <ListChecks size={28} />
                    <strong>아직 처리 내역이 없습니다</strong>
                    <span>문서를 추가하면 파일별 진행 단계가 여기에 표시됩니다.</span>
                    <button type="button" onClick={() => setView('upload')}>문서 추가하기</button>
                  </div>
                ) : null}
                {uploadJobs.length && !filteredUploadJobs.length ? (
                  <div className="upload-job-empty upload-job-filter-empty">
                    <ListChecks size={28} />
                    <strong>해당 상태의 처리 이력이 없습니다</strong>
                    <span>다른 상태를 선택하거나 전체 이력으로 돌아가세요.</span>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadJobFilter('all');
                        setUploadPage(1);
                      }}
                    >
                      전체 이력 보기
                    </button>
                  </div>
                ) : null}
              </div>
              {filteredUploadJobs.length ? (
                <nav className="upload-pagination" aria-label="처리 이력 페이지">
                  <div className="upload-pagination-meta">
                    <label className="upload-page-size">
                      <span>페이지당</span>
                      <select
                        aria-label="페이지당 처리 이력 개수"
                        value={uploadPageSize}
                        onChange={(event) => {
                          setUploadPageSize(Number(event.target.value) as UploadPageSize);
                          setUploadPage(1);
                        }}
                      >
                        {UPLOAD_PAGE_SIZES.map((size) => (
                          <option key={size} value={size}>{size}개</option>
                        ))}
                      </select>
                      <ChevronDown size={13} aria-hidden="true" />
                    </label>
                    <span>
                      {uploadPageStart + 1}–{Math.min(
                        uploadPageStart + uploadPageSize,
                        filteredUploadJobs.length,
                      )} / {filteredUploadJobs.length}건
                    </span>
                  </div>
                  <div className="upload-pagination-controls">
                    <button
                      aria-label="이전 페이지"
                      type="button"
                      disabled={currentUploadPage === 1}
                      onClick={() => setUploadPage(currentUploadPage - 1)}
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <strong>{currentUploadPage} / {uploadPageCount}</strong>
                    <button
                      aria-label="다음 페이지"
                      type="button"
                      disabled={currentUploadPage === uploadPageCount}
                      onClick={() => setUploadPage(currentUploadPage + 1)}
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </nav>
              ) : null}
              <input
                className="retry-upload-input"
                ref={retryFileInputRef}
                type="file"
                accept=".md,.markdown,.html,.htm,.txt,.pdf,.docx,.xlsx"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handleRetryFile(file);
                  event.target.value = '';
                }}
              />
            </div>
          </section>
        ) : null}
      </main>

      {sourcePreview && sourcePreviewDocument ? (
        <div
          className="source-document-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSourcePreview(null);
          }}
        >
          <section
            aria-labelledby="source-document-modal-title"
            aria-modal="true"
            className="source-document-modal"
            ref={sourceModalRef}
            role="dialog"
          >
            <header className="source-document-modal-header">
              <div>
                <span className="eyebrow">ANSWER EVIDENCE</span>
                <strong id="source-document-modal-title">{sourcePreviewDocument.document.title}</strong>
                <small>
                  {[sourcePreview.heading, sourceLocation(sourcePreview)].filter(Boolean).join(' · ')}
                </small>
              </div>
              <button
                aria-label="근거 문서 닫기"
                ref={sourceModalCloseRef}
                title="채팅으로 돌아가기 (Esc)"
                type="button"
                onClick={() => setSourcePreview(null)}
              >
                <X size={20} />
              </button>
            </header>
            <DocumentInspector
              modal
              item={sourcePreviewDocument}
              folderTree={folderTree}
              expandedStructureChunkId={expandedStructureChunkId}
              deletingDocumentId={deletingDocumentId}
              documentActionError={
                documentActionError?.documentId === sourcePreviewDocument.document.id
                  ? documentActionError.message
                  : null
              }
              frameName={SOURCE_PREVIEW_FRAME_NAME}
              onMoveDocument={handleMoveDocument}
              onDeleteDocument={handleDeleteDocument}
              onExpandStructure={setExpandedStructureChunkId}
            />
          </section>
        </div>
      ) : null}

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
