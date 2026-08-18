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
  List,
  Link2,
  ListChecks,
  LoaderCircle,
  LogOut,
  MessageSquareText,
  Network,
  Paperclip,
  PanelLeftClose,
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
import {
  type CSSProperties,
  type FormEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { logoutAction } from '@/app/actions';
import { OAuthConnectionsModal } from '@/components/oauth-connections-modal';
import { BusinessRulesView } from '@/components/business-rules-view';
import { DocumentRenameDialog } from '@/components/document-rename-dialog';
import { KnowledgeGraphView } from '@/components/knowledge-graph-view';
import type { OAuthConnectionSummary } from '@/lib/auth/oauth-connections';
import {
  cleanupFailedIngestionJob,
  deleteRepositoryItems,
  deleteStoredDocument,
} from '@/lib/documents/browser-delete';
import {
  DOCUMENT_STRUCTURE_PANE_DEFAULT_WIDTH,
  DOCUMENT_STRUCTURE_PANE_MIN_WIDTH,
  documentStructurePaneWidthBounds,
  isDocumentComparisonNarrow,
  resolveDocumentStructurePaneWidth,
} from '@/lib/documents/inspector-layout';
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
  SEARCH_PROGRESS_PRESENTATION,
  isSearchProgressForward,
  searchRepository,
} from '@/lib/documents/browser-search';
import {
  createFolder,
  moveDocumentToFolder,
  moveFolder,
  renameFolder,
} from '@/lib/folders/browser';
import { resolveRepositoryDeletionTargets } from '@/lib/folders/deletion';
import {
  canMoveFolder,
  documentsInFolderScope,
  flattenFolderTree,
  folderPath,
} from '@/lib/folders/tree';
import {
  buildFolderUploadPlan,
  ensureFolderUploadTree,
  folderUploadEntriesFromDrop,
  folderUploadPathKey,
  type FolderUploadEntry,
} from '@/lib/folders/folder-upload';
import type { Folder as RepositoryFolder } from '@/lib/folders/types';
import type {
  DocumentIngestionJob,
  DocumentIngestionStatus,
  RenameDocumentResponse,
  SearchProgressEvent,
  SearchProgressStage,
} from '@/lib/documents/contracts';
import { canResumeDocumentIngestion } from '@/lib/documents/ingestion-jobs';
import { shouldSubmitChatOnEnter } from '@/lib/rag/chat-keyboard';
import {
  type IndexedDocument,
  type SourceReference,
} from '@/lib/rag/local-search';
import type { DocumentChunk } from '@/lib/rag/types';
import type { RuleDocumentSummary } from '@/lib/relations/types';
import {
  createRuleDocumentsRefreshGate,
  fetchRuleDocuments,
} from '@/lib/relations/rule-document-sync';

type View = 'chat' | 'documents' | 'rules' | 'upload' | 'upload-status';
type DocumentViewMode = 'list' | 'graph';
type InspectorResizeStart = {
  pointerId: number;
  clientX: number;
  width: number;
  maxWidth: number;
};
type ComparisonResizeStart = InspectorResizeStart & {
  minWidth: number;
};
type ComparisonMobileTab = 'structure' | 'preview';

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  sources?: SourceReference[];
  progress?: {
    stage: SearchProgressStage;
    message: string;
    detail?: string;
    startedAt: number;
  };
};

type UploadJob = Omit<DocumentIngestionJob, 'id' | 'stage'> & {
  id: string;
  jobId: string | null;
  stage: DocumentUploadStage;
};
type DocumentUploadEntry = {
  file: File;
  folderId: string | null;
};
type UploadPresentationOptions = {
  openStatus?: boolean;
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
const DOCUMENT_STRUCTURE_PANE_WIDTH_KEY = 'sageum:document-structure-pane-width';
const SIDEBAR_COLLAPSED_KEY = 'sageum:sidebar-collapsed';
const DOCUMENT_INSPECTOR_DEFAULT_WIDTH = 760;
const DOCUMENT_INSPECTOR_MIN_WIDTH = 400;
const DOCUMENT_INSPECTOR_MAX_VIEWPORT_RATIO = 0.74;
const UPLOAD_STEPS = ['원본 업로드', '구조 추출', '벡터 색인', '완료'] as const;
const SUPPORTED_FILE_ACCEPT = '.md,.markdown,.html,.htm,.txt,.pdf,.docx,.xlsx';

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

function retrievalRoleLabel(
  role: SourceReference['retrievalRole'],
  expansionKind?: SourceReference['expansionKind'],
) {
  if (role === 'rule') return '관계 규칙';
  if (role === 'expanded') return expansionKind === 'semantic-link' ? '연관 근거' : '확장 근거';
  return '직접 근거';
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

function fileIcon(type: IndexedDocument['document']['sourceType']) {
  if (type === 'xlsx') return FileSpreadsheet;
  if (type === 'html' || type === 'markdown') return FileCode2;
  return FileText;
}

function SearchProgressTimeline({
  detail,
  message,
  now,
  stage,
  startedAt,
}: {
  detail?: string;
  message: string;
  now: number;
  stage: SearchProgressStage;
  startedAt: number;
}) {
  const activeIndex = SEARCH_PROGRESS_PRESENTATION.findIndex((step) => step.stage === stage);
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  return (
    <div className="search-progress-card" role="status" aria-live="polite">
      <div className="search-progress-head">
        <strong>{message}</strong>
        <span aria-hidden="true">경과 {elapsedSeconds}초</span>
      </div>
      {detail ? <p>{detail}</p> : null}
      <ol className="search-progress-steps">
        {SEARCH_PROGRESS_PRESENTATION.map((step, index) => {
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending';
          return (
            <li className={state} key={step.stage}>
              <span className="search-progress-icon" aria-hidden="true">
                {state === 'done' ? <CheckCircle2 size={15} /> : null}
                {state === 'active' ? <LoaderCircle className="spin" size={15} /> : null}
              </span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
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

function DocumentPreviewSection({
  item,
  previewChunk,
  deletingDocumentId,
  frameName,
  onDeleteDocument,
}: {
  item: IndexedDocument;
  previewChunk?: DocumentChunk;
  deletingDocumentId: string | null;
  frameName: string;
  onDeleteDocument: (item: IndexedDocument) => void | Promise<void>;
}) {
  return (
    <>
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
    </>
  );
}

function DocumentStructureSection({
  item,
  expandedStructureChunkId,
  snippetPrefix,
  frameName,
  onSelect,
}: {
  item: IndexedDocument;
  expandedStructureChunkId: string | null;
  snippetPrefix: string;
  frameName: string;
  onSelect: (chunkId: string) => void;
}) {
  return (
    <>
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
              onClick={() => onSelect(chunk.id)}
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
  );
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
  onRenameDocument,
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
  onRenameDocument: (result: RenameDocumentResponse) => void;
  onDeleteDocument: (item: IndexedDocument) => void | Promise<void>;
  onExpandStructure: (chunkId: string) => void;
}) {
  const DocumentIcon = fileIcon(item.document.sourceType);
  const previewChunk = item.chunks.find((chunk) => chunk.id === expandedStructureChunkId);
  const snippetPrefix = modal ? 'modal-structure-snippet' : 'structure-snippet';
  const [renameOpen, setRenameOpen] = useState(false);
  const comparisonRef = useRef<HTMLDivElement>(null);
  const requestedStructurePaneWidthRef = useRef(DOCUMENT_STRUCTURE_PANE_DEFAULT_WIDTH);
  const [structurePaneWidth, setStructurePaneWidth] = useState(
    DOCUMENT_STRUCTURE_PANE_DEFAULT_WIDTH,
  );
  const [structurePaneMaximum, setStructurePaneMaximum] = useState(
    DOCUMENT_STRUCTURE_PANE_DEFAULT_WIDTH,
  );
  const [comparisonNarrow, setComparisonNarrow] = useState(false);
  const [comparisonMobileTab, setComparisonMobileTab] = useState<ComparisonMobileTab>('preview');
  const [comparisonResizeStart, setComparisonResizeStart] = useState<ComparisonResizeStart | null>(
    null,
  );
  const structurePaneId = `document-structure-pane-${item.document.id}`;
  const previewPaneId = `document-preview-pane-${item.document.id}`;

  useEffect(() => {
    setComparisonMobileTab('preview');
  }, [item.document.id]);

  useEffect(() => {
    if (modal || item.status === 'deleting') return;
    const comparison = comparisonRef.current;
    if (!comparison) return;
    const savedWidth = Number.parseInt(
      window.localStorage.getItem(DOCUMENT_STRUCTURE_PANE_WIDTH_KEY) ?? '',
      10,
    );
    requestedStructurePaneWidthRef.current = Number.isFinite(savedWidth)
      ? savedWidth
      : DOCUMENT_STRUCTURE_PANE_DEFAULT_WIDTH;
    const updateWidth = (width: number) => {
      const { maximum } = documentStructurePaneWidthBounds(width);
      setComparisonNarrow(isDocumentComparisonNarrow(width));
      setStructurePaneMaximum(maximum);
      setStructurePaneWidth(resolveDocumentStructurePaneWidth(
        width,
        requestedStructurePaneWidthRef.current,
      ));
    };
    updateWidth(comparison.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(comparison);
    return () => observer.disconnect();
  }, [item.status, modal]);

  useEffect(() => {
    if (!comparisonResizeStart) return;
    document.body.classList.add('resizing-document-comparison');
    return () => document.body.classList.remove('resizing-document-comparison');
  }, [comparisonResizeStart]);

  function comparisonWidthBounds() {
    const width = comparisonRef.current?.getBoundingClientRect().width ?? 0;
    return documentStructurePaneWidthBounds(width);
  }

  function comparisonWidthFromPointer(clientX: number, start: ComparisonResizeStart) {
    return clamp(
      start.width + clientX - start.clientX,
      start.minWidth,
      start.maxWidth,
    );
  }

  function handleComparisonResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const { minimum, maximum } = comparisonWidthBounds();
    event.currentTarget.setPointerCapture(event.pointerId);
    setComparisonResizeStart({
      pointerId: event.pointerId,
      clientX: event.clientX,
      width: structurePaneWidth,
      minWidth: minimum,
      maxWidth: maximum,
    });
  }

  function handleComparisonResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!comparisonResizeStart || event.pointerId !== comparisonResizeStart.pointerId) return;
    const nextWidth = comparisonWidthFromPointer(event.clientX, comparisonResizeStart);
    requestedStructurePaneWidthRef.current = nextWidth;
    setStructurePaneWidth(nextWidth);
  }

  function handleComparisonResizeEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!comparisonResizeStart || event.pointerId !== comparisonResizeStart.pointerId) return;
    const nextWidth = comparisonWidthFromPointer(event.clientX, comparisonResizeStart);
    requestedStructurePaneWidthRef.current = nextWidth;
    setStructurePaneWidth(nextWidth);
    setComparisonResizeStart(null);
    window.localStorage.setItem(DOCUMENT_STRUCTURE_PANE_WIDTH_KEY, String(nextWidth));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleComparisonResizeCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (!comparisonResizeStart || event.pointerId !== comparisonResizeStart.pointerId) return;
    requestedStructurePaneWidthRef.current = comparisonResizeStart.width;
    setStructurePaneWidth(comparisonResizeStart.width);
    setComparisonResizeStart(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resetComparisonWidth() {
    const comparisonWidth = comparisonRef.current?.getBoundingClientRect().width ?? 0;
    const nextWidth = resolveDocumentStructurePaneWidth(
      comparisonWidth,
      DOCUMENT_STRUCTURE_PANE_DEFAULT_WIDTH,
    );
    requestedStructurePaneWidthRef.current = nextWidth;
    setStructurePaneWidth(nextWidth);
    window.localStorage.setItem(DOCUMENT_STRUCTURE_PANE_WIDTH_KEY, String(nextWidth));
  }

  function handleComparisonResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const { minimum, maximum } = comparisonWidthBounds();
    let nextWidth = structurePaneWidth;
    if (event.key === 'ArrowLeft') nextWidth -= 24;
    else if (event.key === 'ArrowRight') nextWidth += 24;
    else if (event.key === 'Home') nextWidth = minimum;
    else if (event.key === 'End') nextWidth = maximum;
    else return;
    event.preventDefault();
    nextWidth = clamp(nextWidth, minimum, maximum);
    requestedStructurePaneWidthRef.current = nextWidth;
    setStructurePaneWidth(nextWidth);
    window.localStorage.setItem(DOCUMENT_STRUCTURE_PANE_WIDTH_KEY, String(nextWidth));
  }

  function handleStructureSelect(chunkId: string) {
    onExpandStructure(chunkId);
    if (comparisonNarrow) setComparisonMobileTab('preview');
  }

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
      <div className="document-inspector-summary">
        <span className={`large-file-icon ${item.document.sourceType}`}>
          <DocumentIcon size={28} />
        </span>
        <span className="eyebrow">DOCUMENT DETAIL</span>
        <div className="document-inspector-title">
          <h2>{item.document.title}</h2>
          {item.status !== 'deleting' ? (
            <button
              aria-label={`${item.document.title} 이름 변경`}
              title="문서 이름 변경"
              type="button"
              onClick={() => setRenameOpen(true)}
            >
              <Pencil size={15} />
            </button>
          ) : null}
        </div>
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
      </div>
      {modal || item.status === 'deleting' ? (
        <>
          <div className="document-preview-sticky">
            <DocumentPreviewSection
              item={item}
              previewChunk={previewChunk}
              deletingDocumentId={deletingDocumentId}
              frameName={frameName}
              onDeleteDocument={onDeleteDocument}
            />
          </div>
          {item.status !== 'deleting' ? (
            <>
              <div className="inspector-rule" />
              <DocumentStructureSection
                item={item}
                expandedStructureChunkId={expandedStructureChunkId}
                snippetPrefix={snippetPrefix}
                frameName={frameName}
                onSelect={onExpandStructure}
              />
            </>
          ) : null}
        </>
      ) : (
        <>
          {comparisonNarrow ? (
            <div aria-label="문서 비교 화면" className="document-comparison-tabs" role="tablist">
              <button
                aria-controls={structurePaneId}
                aria-selected={comparisonMobileTab === 'structure'}
                id={`${structurePaneId}-tab`}
                role="tab"
                type="button"
                onClick={() => setComparisonMobileTab('structure')}
              >
                구조화 결과
              </button>
              <button
                aria-controls={previewPaneId}
                aria-selected={comparisonMobileTab === 'preview'}
                id={`${previewPaneId}-tab`}
                role="tab"
                type="button"
                onClick={() => setComparisonMobileTab('preview')}
              >
                원본 미리보기
              </button>
            </div>
          ) : null}
          <div
            className={`document-comparison${comparisonNarrow ? ' narrow' : ''}`}
            ref={comparisonRef}
            style={{
              '--document-structure-pane-width': `${structurePaneWidth}px`,
            } as CSSProperties}
          >
            <section
              aria-labelledby={comparisonNarrow ? `${structurePaneId}-tab` : undefined}
              className="document-comparison-structure"
              hidden={comparisonNarrow && comparisonMobileTab !== 'structure'}
              id={structurePaneId}
              role={comparisonNarrow ? 'tabpanel' : undefined}
            >
              <DocumentStructureSection
                item={item}
                expandedStructureChunkId={expandedStructureChunkId}
                snippetPrefix={snippetPrefix}
                frameName={frameName}
                onSelect={handleStructureSelect}
              />
            </section>
            {!comparisonNarrow ? (
              <div
                aria-label="구조화 결과 영역 너비 조절"
                aria-orientation="vertical"
                aria-valuemax={Math.round(structurePaneMaximum)}
                aria-valuemin={DOCUMENT_STRUCTURE_PANE_MIN_WIDTH}
                aria-valuenow={Math.round(structurePaneWidth)}
                className="document-comparison-resizer"
                role="separator"
                tabIndex={0}
                title="드래그하거나 방향키로 크기를 조절합니다. 더블 클릭하면 초기화됩니다."
                onDoubleClick={resetComparisonWidth}
                onKeyDown={handleComparisonResizeKeyDown}
                onPointerCancel={handleComparisonResizeCancel}
                onPointerDown={handleComparisonResizeStart}
                onPointerMove={handleComparisonResizeMove}
                onPointerUp={handleComparisonResizeEnd}
              />
            ) : null}
            <section
              aria-labelledby={comparisonNarrow ? `${previewPaneId}-tab` : undefined}
              className="document-comparison-preview"
              hidden={comparisonNarrow && comparisonMobileTab !== 'preview'}
              id={previewPaneId}
              role={comparisonNarrow ? 'tabpanel' : undefined}
            >
              <DocumentPreviewSection
                item={item}
                previewChunk={previewChunk}
                deletingDocumentId={deletingDocumentId}
                frameName={frameName}
                onDeleteDocument={onDeleteDocument}
              />
            </section>
          </div>
        </>
      )}
      {renameOpen ? (
        <DocumentRenameDialog
          currentName={item.document.name}
          documentId={item.document.id}
          onClose={() => setRenameOpen(false)}
          onRenamed={onRenameDocument}
        />
      ) : null}
    </aside>
  );
}

export function DocumentRagApp({
  userEmail,
  initialDocuments,
  initialFolders,
  initialIngestionJobs,
  initialOAuthConnections,
  initialOAuthConnectionsError,
  initialRuleDocuments,
  mcpEndpoint,
}: {
  userEmail: string;
  initialDocuments: IndexedDocument[];
  initialFolders: RepositoryFolder[];
  initialIngestionJobs: DocumentIngestionJob[];
  initialOAuthConnections: OAuthConnectionSummary[];
  initialOAuthConnectionsError: boolean;
  initialRuleDocuments: RuleDocumentSummary[];
  mcpEndpoint: string;
}) {
  const [view, setView] = useState<View>('chat');
  const [documentViewMode, setDocumentViewMode] = useState<DocumentViewMode>('list');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPreferenceReady, setSidebarPreferenceReady] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [oauthConnectionsModalOpen, setOAuthConnectionsModalOpen] = useState(false);
  const [documents, setDocuments] = useState<IndexedDocument[]>(() => initialDocuments);
  const [folders, setFolders] = useState<RepositoryFolder[]>(() => initialFolders);
  const [ruleDocuments, setRuleDocuments] = useState<RuleDocumentSummary[]>(
    () => initialRuleDocuments,
  );
  const [ruleDocumentsRefreshGate] = useState(createRuleDocumentsRefreshGate);
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
  const [selectedRepositoryDocumentIds, setSelectedRepositoryDocumentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedRepositoryFolderIds, setSelectedRepositoryFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [repositoryDeleteConfirmationOpen, setRepositoryDeleteConfirmationOpen] = useState(false);
  const [repositoryDeleteBusy, setRepositoryDeleteBusy] = useState(false);
  const [repositoryDeleteError, setRepositoryDeleteError] = useState<string | null>(null);
  const [expandedStructureChunkId, setExpandedStructureChunkId] = useState<string | null>(null);
  const [sourcePreview, setSourcePreview] = useState<SourceReference | null>(null);
  const [externalPreviewDocument, setExternalPreviewDocument] = useState<IndexedDocument | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState(DOCUMENT_INSPECTOR_DEFAULT_WIDTH);
  const [inspectorMaxWidth, setInspectorMaxWidth] = useState(DOCUMENT_INSPECTOR_DEFAULT_WIDTH);
  const [inspectorResizeStart, setInspectorResizeStart] = useState<InspectorResizeStart | null>(null);
  const [activeSources, setActiveSources] = useState<SourceReference[]>([]);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [repositoryUploadFeedbackVisible, setRepositoryUploadFeedbackVisible] = useState(false);
  const [repositoryUploadMenuOpen, setRepositoryUploadMenuOpen] = useState(false);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>(() => (
    initialIngestionJobs.map(uploadJobFromRecord)
  ));
  const [uploadJobFilter, setUploadJobFilter] = useState<UploadJobFilter>('all');
  const [uploadPageSize, setUploadPageSize] = useState<UploadPageSize>(10);
  const [uploadPage, setUploadPage] = useState(1);
  const [retryingUploadJobIds, setRetryingUploadJobIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [cleaningUploadJobIds, setCleaningUploadJobIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [retryFileJobId, setRetryFileJobId] = useState<string | null>(null);
  const [uploadRecoveryNow, setUploadRecoveryNow] = useState(() => Date.now());
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [documentActionError, setDocumentActionError] = useState<{
    documentId: string;
    message: string;
  } | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchProgressNow, setSearchProgressNow] = useState(() => Date.now());
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const repositoryFileInputRef = useRef<HTMLInputElement | null>(null);
  const repositoryFolderInputRef = useRef<HTMLInputElement | null>(null);
  const repositoryUploadMenuRef = useRef<HTMLDivElement | null>(null);
  const retryFileInputRef = useRef<HTMLInputElement | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const documentLayoutRef = useRef<HTMLDivElement | null>(null);
  const sourceModalRef = useRef<HTMLElement | null>(null);
  const sourceModalCloseRef = useRef<HTMLButtonElement | null>(null);
  const sourceModalTriggerRef = useRef<HTMLElement | null>(null);
  const repositorySelectAllRef = useRef<HTMLInputElement | null>(null);
  const repositoryDeleteModalRef = useRef<HTMLElement | null>(null);
  const repositoryDeleteCancelRef = useRef<HTMLButtonElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const profileMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const profileMenuFirstItemRef = useRef<HTMLButtonElement | null>(null);
  const retryingUploadJobIdsRef = useRef<Set<string>>(new Set());
  const cleaningUploadJobIdsRef = useRef<Set<string>>(new Set());
  const userInitial = userEmail.charAt(0).toLocaleUpperCase('ko-KR') || '?';
  const updateRuleDocuments = useCallback((
    updater: (current: RuleDocumentSummary[]) => RuleDocumentSummary[],
  ) => {
    ruleDocumentsRefreshGate.invalidate();
    setRuleDocuments(updater);
  }, [ruleDocumentsRefreshGate]);
  const refreshRuleDocuments = useCallback(async () => {
    const requestId = ruleDocumentsRefreshGate.begin();
    const refreshed = await fetchRuleDocuments();
    if (!ruleDocumentsRefreshGate.isCurrent(requestId)) return false;
    setRuleDocuments(refreshed);
    return true;
  }, [ruleDocumentsRefreshGate]);
  const closeOAuthConnectionsModal = useCallback(() => {
    setOAuthConnectionsModalOpen(false);
    window.requestAnimationFrame(() => profileMenuTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true');
    setSidebarPreferenceReady(true);
  }, []);

  useEffect(() => {
    fetch('/api/system')
      .then((response) => response.json() as Promise<SystemStatus>)
      .then(setSystem)
      .catch(() => setSystem(null));
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;

    const focusFrame = window.requestAnimationFrame(() => {
      profileMenuFirstItemRef.current?.focus();
    });
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && profileMenuRef.current?.contains(event.target)) return;
      setProfileMenuOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setProfileMenuOpen(false);
      profileMenuTriggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!repositoryUploadMenuOpen) return;

    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Node
        && repositoryUploadMenuRef.current?.contains(event.target)
      ) return;
      setRepositoryUploadMenuOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setRepositoryUploadMenuOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [repositoryUploadMenuOpen]);

  useEffect(() => {
    if (view !== 'upload-status') return;
    const hasPendingWorkflowStart = uploadJobs.some((job) => (
      job.status === 'uploading' && !job.workflowRunId
    ));
    if (!hasPendingWorkflowStart) return;

    setUploadRecoveryNow(Date.now());
    const timer = window.setInterval(() => setUploadRecoveryNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [uploadJobs, view]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!searchBusy) return;
    setSearchProgressNow(Date.now());
    const timer = window.setInterval(() => setSearchProgressNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [searchBusy]);

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
    if (!repositoryDeleteConfirmationOpen) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !repositoryDeleteBusy) {
        setRepositoryDeleteConfirmationOpen(false);
        setRepositoryDeleteError(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const modal = repositoryDeleteModalRef.current;
      if (!modal) return;
      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    const focusFrame = window.requestAnimationFrame(() => repositoryDeleteCancelRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [repositoryDeleteBusy, repositoryDeleteConfirmationOpen]);

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
  const visibleRepositoryDocumentIds = useMemo(
    () => filteredDocuments.map(({ document }) => document.id),
    [filteredDocuments],
  );
  const visibleRepositoryFolderIds = useMemo(
    () => filteredChildFolders.map((folder) => folder.id),
    [filteredChildFolders],
  );
  const visibleRepositoryEntryCount = visibleRepositoryDocumentIds.length
    + visibleRepositoryFolderIds.length;
  const selectedVisibleRepositoryEntryCount = visibleRepositoryDocumentIds.filter(
    (documentId) => selectedRepositoryDocumentIds.has(documentId),
  ).length + visibleRepositoryFolderIds.filter(
    (folderId) => selectedRepositoryFolderIds.has(folderId),
  ).length;
  const repositoryDeletionTargets = useMemo(() => resolveRepositoryDeletionTargets({
    documents: documents.map(({ document }) => ({
      id: document.id,
      folderId: document.folderId ?? null,
    })),
    folders,
    selectedDocumentIds: selectedRepositoryDocumentIds,
    selectedFolderIds: selectedRepositoryFolderIds,
  }), [documents, folders, selectedRepositoryDocumentIds, selectedRepositoryFolderIds]);
  const selectedRepositoryEntryCount = selectedRepositoryDocumentIds.size
    + selectedRepositoryFolderIds.size;
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
      ?? (externalPreviewDocument?.document.id === sourcePreview.documentId
        ? externalPreviewDocument
        : undefined)
    : undefined;

  useEffect(() => {
    if (!repositorySelectAllRef.current) return;
    repositorySelectAllRef.current.indeterminate = selectedVisibleRepositoryEntryCount > 0
      && selectedVisibleRepositoryEntryCount < visibleRepositoryEntryCount;
  }, [selectedVisibleRepositoryEntryCount, visibleRepositoryEntryCount]);

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

  async function handleUploadEntries(
    entries: DocumentUploadEntry[],
    selectedFolderAfterUpload: string | null,
    retryOfJobId: string | null = null,
    options: UploadPresentationOptions = {},
  ) {
    if (!entries.length) return;
    const openStatus = options.openStatus ?? true;
    const jobs = entries.map(({ file, folderId }) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      return {
        id,
        file,
        folderId,
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
          documentKind: 'knowledge',
          stage: 'queued',
          status: 'queued',
          attempts: 1,
          originalAvailable: false,
          cleanupStartedAt: null,
          cleanupError: null,
          lastError: null,
          startedAt: null,
          completedAt: null,
          workflowRunId: null,
          createdAt: now,
          updatedAt: now,
        } satisfies UploadJob,
      };
    });
    setUploadJobs((current) => [...jobs.map(({ progress }) => progress), ...current]);
    setUploadBusy(true);
    setUploadMessage(null);
    setRepositoryUploadFeedbackVisible(!openStatus);
    if (openStatus) setView('upload-status');

    const results = await Promise.allSettled(
      jobs.map(async ({ id, file, folderId }) => {
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
      if (openStatus) setSelectedFolderId(selectedFolderAfterUpload);
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

  async function handleFiles(
    fileList: FileList | File[],
    folderId = selectedFolderId,
    retryOfJobId: string | null = null,
    options: UploadPresentationOptions = {},
  ) {
    const files = Array.from(fileList);
    return handleUploadEntries(
      files.map((file) => ({ file, folderId })),
      folderId,
      retryOfJobId,
      options,
    );
  }

  async function handleFolderFiles(
    entries: FolderUploadEntry[],
    destinationFolderId = selectedFolderId,
    options: UploadPresentationOptions = {},
  ) {
    if (uploadBusy) return;
    const openStatus = options.openStatus ?? true;
    setRepositoryUploadFeedbackVisible(!openStatus);
    if (!entries.length) {
      setUploadMessage('실패: 선택한 폴더에 업로드할 파일이 없습니다.');
      return;
    }
    setUploadBusy(true);
    setUploadMessage(null);
    try {
      const plan = buildFolderUploadPlan(entries);
      const ensured = await ensureFolderUploadTree({
        plan,
        destinationFolderId,
        existingFolders: folders,
        create: createFolder,
      });
      setFolders(ensured.folders);
      await handleUploadEntries(
        plan.files.map(({ file, directoryPath }) => {
          const folderId = ensured.folderIdsByPath.get(folderUploadPathKey(directoryPath));
          if (!folderId) throw new Error(`${directoryPath.join('/')} 폴더를 찾을 수 없습니다.`);
          return { file, folderId };
        }),
        ensured.rootFolderId,
        null,
        options,
      );
    } catch (error) {
      setUploadBusy(false);
      setUploadMessage(
        `실패: ${error instanceof Error ? error.message : '폴더를 업로드하지 못했습니다.'}`,
      );
    }
  }

  async function handleUploadDrop(dataTransfer: DataTransfer) {
    const files = Array.from(dataTransfer.files);
    try {
      const folderEntries = await folderUploadEntriesFromDrop(dataTransfer);
      if (folderEntries) {
        await handleFolderFiles(folderEntries);
        return;
      }
      await handleFiles(files);
    } catch (error) {
      setUploadBusy(false);
      setUploadMessage(
        `실패: ${error instanceof Error ? error.message : '폴더를 읽지 못했습니다.'}`,
      );
    }
  }

  async function retryPersistentUploadJob(job: UploadJob, file?: File) {
    if (
      !job.jobId
      || job.stage === 'creating'
      || retryingUploadJobIdsRef.current.has(job.id)
    ) return;
    const persistedJob: DocumentIngestionJob = {
      id: job.jobId,
      documentId: job.documentId,
      versionId: job.versionId,
      retryOfJobId: job.retryOfJobId,
      folderId: job.folderId,
      fileName: job.fileName,
      mimeType: job.mimeType,
      sizeBytes: job.sizeBytes,
      documentKind: job.documentKind,
      status: job.status,
      stage: job.stage,
      attempts: job.attempts,
      originalAvailable: job.originalAvailable,
      cleanupStartedAt: job.cleanupStartedAt,
      cleanupError: job.cleanupError,
      lastError: job.lastError,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      workflowRunId: job.workflowRunId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };

    retryingUploadJobIdsRef.current.add(job.id);
    setRetryingUploadJobIds(new Set(retryingUploadJobIdsRef.current));
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
      retryingUploadJobIdsRef.current.delete(job.id);
      setRetryingUploadJobIds(new Set(retryingUploadJobIdsRef.current));
    }
  }

  function handleRetryUploadJob(job: UploadJob) {
    if (
      retryingUploadJobIdsRef.current.has(job.id)
      || cleaningUploadJobIdsRef.current.has(job.id)
      || job.cleanupStartedAt
    ) return;
    if (
      canResumeDocumentIngestion(job)
      || job.originalAvailable && job.documentId && job.versionId
    ) {
      void retryPersistentUploadJob(job);
      return;
    }
    setRetryFileJobId(job.id);
    retryFileInputRef.current?.click();
  }

  function handleRetryFile(file: File) {
    const job = uploadJobs.find((candidate) => candidate.id === retryFileJobId);
    setRetryFileJobId(null);
    if (!job || job.cleanupStartedAt) return;
    if (job.jobId && job.documentId && job.versionId && !job.originalAvailable) {
      void retryPersistentUploadJob(job, file);
      return;
    }
    void handleFiles([file], job.folderId, job.jobId);
  }

  async function handleCleanupUploadJob(job: UploadJob) {
    if (
      job.status !== 'failed'
      || retryingUploadJobIdsRef.current.has(job.id)
      || cleaningUploadJobIdsRef.current.has(job.id)
    ) return;

    const confirmed = window.confirm(
      `“${job.fileName}” 실패 작업을 정리할까요? 생성된 원본, 문서 데이터, 검색 벡터와 처리 이력이 모두 삭제되며 되돌릴 수 없습니다.`,
    );
    if (!confirmed) return;

    cleaningUploadJobIdsRef.current.add(job.id);
    setCleaningUploadJobIds(new Set(cleaningUploadJobIdsRef.current));
    setUploadMessage(null);

    try {
      if (job.jobId) await cleanupFailedIngestionJob(job.jobId);
      setUploadJobs((current) => current.filter((candidate) => candidate.id !== job.id));
      if (job.documentId) {
        setDocuments((current) => current.filter(
          ({ document }) => document.id !== job.documentId,
        ));
      }
      setUploadMessage('작업 이력과 처리 중 생성된 데이터를 정리했습니다.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '실패 작업 정리에 실패했습니다.';
      const cleanupStartedAt = new Date().toISOString();
      if (job.jobId) {
        await syncUploadJob(job.id, job.jobId).catch(() => updateUploadJob(job.id, {
          cleanupStartedAt,
          cleanupError: message,
          updatedAt: cleanupStartedAt,
        }));
      } else {
        updateUploadJob(job.id, {
          cleanupStartedAt,
          cleanupError: message,
          updatedAt: cleanupStartedAt,
        });
      }
      setUploadMessage(`정리 실패: ${message}`);
    } finally {
      cleaningUploadJobIdsRef.current.delete(job.id);
      setCleaningUploadJobIds(new Set(cleaningUploadJobIdsRef.current));
    }
  }

  function selectFolder(folderId: string | null) {
    setSelectedFolderId(folderId);
    setDocumentFilter('');
    setSelectedDocumentId('');
    setSelectedRepositoryDocumentIds(new Set());
    setSelectedRepositoryFolderIds(new Set());
    setRepositoryDeleteConfirmationOpen(false);
    setRepositoryDeleteError(null);
    setExpandedStructureChunkId(null);
    setFolderActionError(null);
  }

  function toggleRepositoryDocumentSelection(documentId: string, checked: boolean) {
    setSelectedRepositoryDocumentIds((current) => {
      const next = new Set(current);
      if (checked) next.add(documentId);
      else next.delete(documentId);
      return next;
    });
  }

  function toggleRepositoryFolderSelection(folderId: string, checked: boolean) {
    setSelectedRepositoryFolderIds((current) => {
      const next = new Set(current);
      if (checked) next.add(folderId);
      else next.delete(folderId);
      return next;
    });
  }

  function toggleVisibleRepositorySelection(checked: boolean) {
    setSelectedRepositoryDocumentIds((current) => {
      const next = new Set(current);
      visibleRepositoryDocumentIds.forEach((documentId) => {
        if (checked) next.add(documentId);
        else next.delete(documentId);
      });
      return next;
    });
    setSelectedRepositoryFolderIds((current) => {
      const next = new Set(current);
      visibleRepositoryFolderIds.forEach((folderId) => {
        if (checked) next.add(folderId);
        else next.delete(folderId);
      });
      return next;
    });
  }

  function openRepositoryDeleteConfirmation() {
    if (!selectedRepositoryEntryCount || repositoryDeleteBusy) return;
    setFolderActionError(null);
    setRepositoryDeleteError(null);
    setRepositoryDeleteConfirmationOpen(true);
  }

  function closeRepositoryDeleteConfirmation() {
    if (repositoryDeleteBusy) return;
    setRepositoryDeleteConfirmationOpen(false);
    setRepositoryDeleteError(null);
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

  function handleDeleteSelectedFolder() {
    if (!selectedFolder || folderBusy || repositoryDeleteBusy) return;
    setSelectedRepositoryDocumentIds(new Set());
    setSelectedRepositoryFolderIds(new Set([selectedFolder.id]));
    setFolderActionError(null);
    setRepositoryDeleteError(null);
    setRepositoryDeleteConfirmationOpen(true);
  }

  async function handleBulkRepositoryDelete() {
    if (!selectedRepositoryEntryCount || repositoryDeleteBusy) return;
    setRepositoryDeleteBusy(true);
    setRepositoryDeleteError(null);
    setFolderActionError(null);

    try {
      const result = await deleteRepositoryItems({
        documentIds: [...selectedRepositoryDocumentIds],
        folderIds: [...selectedRepositoryFolderIds],
      });
      const deletedDocumentIds = new Set(result.deletedDocumentIds);
      const deletedFolderIds = new Set(result.deletedFolderIds);

      if (deletedDocumentIds.size) {
        setDocuments((current) => current.filter(({ document }) => (
          !deletedDocumentIds.has(document.id)
        )));
        setSelectedDocumentId((current) => deletedDocumentIds.has(current) ? '' : current);
        setSourcePreview((current) => (
          current && deletedDocumentIds.has(current.documentId) ? null : current
        ));
        setActiveSources((current) => current.filter((source) => (
          !deletedDocumentIds.has(source.documentId)
        )));
        setMessages((current) => current.map((message) =>
          message.sources
            ? {
              ...message,
              sources: message.sources.filter((source) => (
                !deletedDocumentIds.has(source.documentId)
              )),
            }
            : message));
        setDocumentActionError((current) => (
          current && deletedDocumentIds.has(current.documentId) ? null : current
        ));
      }

      if (deletedFolderIds.size) {
        const currentPath = folderPath(folders, selectedFolderId);
        const nextFolderId = selectedFolderId && deletedFolderIds.has(selectedFolderId)
          ? [...currentPath].reverse().find((folder) => !deletedFolderIds.has(folder.id))?.id ?? null
          : selectedFolderId;
        setFolders((current) => current.filter((folder) => !deletedFolderIds.has(folder.id)));
        if (nextFolderId !== selectedFolderId) {
          setSelectedFolderId(nextFolderId);
          setDocumentFilter('');
          setSelectedDocumentId('');
          setExpandedStructureChunkId(null);
        }
        if (searchFolderId && deletedFolderIds.has(searchFolderId)) setSearchFolderId('');
      }

      setSelectedRepositoryDocumentIds((current) => new Set(
        [...current].filter((documentId) => !deletedDocumentIds.has(documentId)),
      ));
      setSelectedRepositoryFolderIds((current) => new Set(
        [...current].filter((folderId) => !deletedFolderIds.has(folderId)),
      ));
      setRepositoryDeleteConfirmationOpen(false);

      const messages = [];
      if (result.failures.length) {
        messages.push(`${result.failures.length}개 문서는 삭제하지 못했습니다.`);
      }
      if (result.folderError) messages.push(result.folderError);
      setFolderActionError(messages.length ? messages.join(' ') : null);
    } catch (error) {
      setRepositoryDeleteError(
        error instanceof Error ? error.message : '선택한 항목을 삭제하지 못했습니다.',
      );
    } finally {
      setRepositoryDeleteBusy(false);
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

  async function handleFolderDrop(event: DragEvent<HTMLElement>, folderId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    setDragOverFolderId(null);

    if (event.dataTransfer.types.includes('Files')) {
      const dataTransfer = event.dataTransfer;
      setRepositoryUploadFeedbackVisible(true);
      try {
        const folderEntries = await folderUploadEntriesFromDrop(dataTransfer);
        if (folderEntries) {
          await handleFolderFiles(folderEntries, folderId, { openStatus: false });
          return;
        }
        if (!dataTransfer.files.length) {
          throw new Error('업로드할 파일을 읽지 못했습니다.');
        }
        await handleFiles(dataTransfer.files, folderId, null, { openStatus: false });
      } catch (error) {
        setUploadBusy(false);
        setUploadMessage(
          `실패: ${error instanceof Error ? error.message : '파일을 업로드하지 못했습니다.'}`,
        );
      }
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

  function handleDocumentRenamed(result: RenameDocumentResponse) {
    const renamed = result.document;
    const documentId = renamed.document.id;
    const title = renamed.document.title;
    setDocuments((current) => current.map((item) => (
      item.document.id === documentId ? renamed : item
    )));
    setExternalPreviewDocument((current) => (
      current?.document.id === documentId ? renamed : current
    ));
    setSourcePreview((current) => current?.documentId === documentId
      ? { ...current, documentTitle: title }
      : current);
    setActiveSources((current) => current.map((source) => source.documentId === documentId
      ? { ...source, documentTitle: title }
      : source));
    setMessages((current) => current.map((message) => message.sources
      ? {
        ...message,
        sources: message.sources.map((source) => source.documentId === documentId
          ? { ...source, documentTitle: title }
          : source),
      }
      : message));
    updateRuleDocuments((current) => current.map((document) => document.documentId === documentId
      ? { ...document, title, originalFilename: renamed.document.name }
      : document));
    void refreshRuleDocuments();
    setDocumentActionError(result.indexStatus === 'warning' && result.warning
      ? { documentId, message: result.warning }
      : null);
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
      setSelectedRepositoryDocumentIds((current) => {
        const next = new Set(current);
        next.delete(documentId);
        return next;
      });
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
    const assistantMessageId = `assistant-${now}`;
    setQuery('');
    setSearchBusy(true);
    setSearchProgressNow(now);
    setMessages((current) => [
      ...current,
      { id: `user-${now}`, role: 'user', text: question },
      {
        id: assistantMessageId,
        role: 'assistant',
        text: '',
        progress: {
          stage: 'preparing',
          message: '검색 요청과 범위를 확인하고 있습니다.',
          startedAt: now,
        },
      },
    ]);
    setActiveSources([]);

    const updateProgress = (progress: SearchProgressEvent) => {
      setMessages((current) => current.map((message) => (
        message.id === assistantMessageId
          && message.progress
          && isSearchProgressForward(message.progress.stage, progress.stage)
          ? {
              ...message,
              progress: {
                stage: progress.stage,
                message: progress.message,
                detail: progress.detail,
                startedAt: message.progress.startedAt,
              },
            }
          : message
      )));
    };

    try {
      const scopedDocuments = searchFolderId
        ? documentsInFolderScope(documents, folders, searchFolderId, { recursive: true })
        : documents;
      const result = await searchRepository({
        documents: scopedDocuments,
        query: question,
        folderId: searchFolderId || null,
        onProgress: updateProgress,
      });
      setMessages((current) => current.map((message) => (
        message.id === assistantMessageId
          ? {
              id: assistantMessageId,
              role: 'assistant',
              text: result.answer,
              sources: result.sources,
            }
          : message
      )));
      setActiveSources(result.sources);
      if (result.sources[0]) setSelectedDocumentId(result.sources[0].documentId);
    } catch (error) {
      setMessages((current) => current.map((message) => (
        message.id === assistantMessageId
          ? {
              id: assistantMessageId,
              role: 'assistant',
              text: error instanceof Error ? error.message : '문서 검색에 실패했습니다.',
            }
          : message
      )));
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

  async function loadExternalPreviewDocument(documentId: string) {
    const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null) as {
      document?: IndexedDocument;
      error?: string;
    } | null;
    if (!response.ok || !payload?.document) {
      throw new Error(payload?.error ?? '근거 문서를 불러오지 못했습니다.');
    }
    setExternalPreviewDocument(payload.document);
    return payload.document;
  }

  async function openSource(source: SourceReference) {
    sourceModalTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (!documents.some(({ document }) => document.id === source.documentId)) {
      try {
        await loadExternalPreviewDocument(source.documentId);
      } catch (error) {
        setDocumentActionError({
          documentId: source.documentId,
          message: error instanceof Error ? error.message : '근거 문서를 불러오지 못했습니다.',
        });
        return;
      }
    }
    setExpandedStructureChunkId(source.chunkId);
    setSourcePreview(source);
  }

  async function openDocumentEvidence(documentId: string, chunkId: string) {
    const known = documents.find(({ document }) => document.id === documentId)
      ?? (externalPreviewDocument?.document.id === documentId ? externalPreviewDocument : null)
      ?? await loadExternalPreviewDocument(documentId);
    const chunk = known.chunks.find((item) => item.id === chunkId);
    if (!chunk) throw new Error('문서에서 정확한 근거 청크를 찾지 못했습니다.');
    await openSource({
      documentId,
      versionId: known.document.versionId,
      documentTitle: known.document.title,
      chunkId,
      heading: chunk.headingPath.join(' › ') || '본문',
      snippet: chunk.text,
      score: 1,
      page: chunk.location.page,
      sheet: chunk.location.sheet,
      cellRange: chunk.location.cellRange,
      imageIndex: chunk.location.imageIndex,
      sourceSpans: chunk.sourceSpans,
      retrievalRole: known.document.documentKind === 'rule' ? 'rule' : 'expanded',
    });
  }

  function openGraphDocument(documentId: string) {
    const item = documents.find(({ document }) => document.id === documentId);
    if (!item) return;
    setSelectedFolderId(item.document.folderId ?? null);
    setDocumentFilter('');
    setSelectedDocumentId(documentId);
  }

  function setSidebarCollapsedPreference(collapsed: boolean) {
    setProfileMenuOpen(false);
    setSidebarCollapsed(collapsed);
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }

  function handleSidebarBackgroundClick(event: ReactMouseEvent<HTMLElement>) {
    if (!sidebarCollapsed || event.target !== event.currentTarget) return;
    setSidebarCollapsedPreference(false);
  }

  return (
    <div
      className={`rag-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}${
        sidebarPreferenceReady ? ' sidebar-preference-ready' : ''
      }`}
    >
      <aside
        className="rag-sidebar"
        id="sageum-primary-sidebar"
        onClick={handleSidebarBackgroundClick}
      >
        <div className="rag-sidebar-header">
          <button
            aria-label={sidebarCollapsed ? '사이드바 펼치기' : 'Sageum 홈'}
            className="rag-brand"
            title={sidebarCollapsed ? '사이드바 펼치기' : undefined}
            type="button"
            onClick={() => {
              if (sidebarCollapsed) {
                setSidebarCollapsedPreference(false);
                return;
              }
              setView('chat');
            }}
          >
            <SageumMark />
            <span>
              <strong>SAGEUM</strong>
              <small>DOCUMENT INTELLIGENCE</small>
            </span>
          </button>
          {!sidebarCollapsed ? (
            <button
              aria-controls="sageum-primary-sidebar"
              aria-expanded={true}
              aria-label="사이드바 접기"
              className="rag-sidebar-toggle"
              title="사이드바 접기"
              type="button"
              onClick={() => setSidebarCollapsedPreference(true)}
            >
              <PanelLeftClose size={16} />
            </button>
          ) : null}
        </div>

        <nav className="rag-nav" aria-label="주요 메뉴">
          <button
            aria-label="문서에게 질문"
            className={view === 'chat' ? 'active' : ''}
            data-tooltip="문서에게 질문"
            type="button"
            onClick={() => setView('chat')}
          >
            <MessageSquareText size={18} />
            <span className="rag-nav-label">문서에게 질문</span>
          </button>
          <button
            aria-label="문서 저장소"
            className={view === 'documents' ? 'active' : ''}
            data-tooltip="문서 저장소"
            type="button"
            onClick={() => setView('documents')}
          >
            <Library size={18} />
            <span className="rag-nav-label">문서 저장소</span>
            <span className="nav-count">{documents.length}</span>
          </button>
          <button
            aria-label="비즈니스 규칙"
            className={view === 'rules' ? 'active' : ''}
            data-tooltip="비즈니스 규칙"
            type="button"
            onClick={() => setView('rules')}
          >
            <Network size={18} />
            <span className="rag-nav-label">비즈니스 규칙</span>
          </button>
          <button
            aria-label="문서 추가"
            className={view === 'upload' ? 'active' : ''}
            data-tooltip="문서 추가"
            type="button"
            onClick={() => setView('upload')}
          >
            <HardDriveUpload size={18} />
            <span className="rag-nav-label">문서 추가</span>
          </button>
          <button
            aria-label="처리 현황"
            className={view === 'upload-status' ? 'active' : ''}
            data-tooltip="처리 현황"
            type="button"
            onClick={() => setView('upload-status')}
          >
            <ListChecks size={18} />
            <span className="rag-nav-label">처리 현황</span>
            {uploadJobs.length ? <span className="nav-count">{uploadJobs.length}</span> : null}
          </button>
        </nav>

        <div className="rag-profile" ref={profileMenuRef}>
          {profileMenuOpen ? (
            <div className="rag-profile-popover" role="dialog" aria-label="프로필 메뉴">
              <div className="rag-profile-popover-head">
                <span>ACCOUNT</span>
                <strong title={userEmail}>{userEmail}</strong>
              </div>
              <div className="rag-profile-status">
                <div className="rag-profile-status-head">
                  <span>INDEX STATUS</span>
                  <strong>{totalChunks} chunks</strong>
                </div>
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
              <button
                ref={profileMenuFirstItemRef}
                type="button"
                onClick={() => {
                  setProfileMenuOpen(false);
                  setOAuthConnectionsModalOpen(true);
                }}
              >
                <span className="rag-profile-action-icon"><Link2 size={16} /></span>
                <span className="rag-profile-action-copy">
                  <strong>에이전트 연결</strong>
                  <small>외부 에이전트와 MCP 연결 관리</small>
                </span>
                <ChevronRight size={15} />
              </button>
              <form action={logoutAction}>
                <button type="submit">
                  <span className="rag-profile-action-icon"><LogOut size={16} /></span>
                  <span className="rag-profile-action-copy">
                    <strong>로그아웃</strong>
                    <small>현재 계정에서 안전하게 나가기</small>
                  </span>
                </button>
              </form>
            </div>
          ) : null}

          <button
            ref={profileMenuTriggerRef}
            className="rag-profile-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={profileMenuOpen}
            onClick={() => setProfileMenuOpen((open) => !open)}
          >
            <span className="rag-avatar">{userInitial}</span>
            <span className="rag-profile-copy">
              <strong title={userEmail}>{userEmail}</strong>
              <span>{system?.mode === 'cloud' ? 'Cloud mode' : '개인 데모'}</span>
            </span>
            <ChevronDown className="rag-profile-chevron" size={16} />
          </button>
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
                    {message.progress ? (
                      <SearchProgressTimeline
                        detail={message.progress.detail}
                        message={message.progress.message}
                        now={searchProgressNow}
                        stage={message.progress.stage}
                        startedAt={message.progress.startedAt}
                      />
                    ) : (
                      <p>{message.text}</p>
                    )}
                    {message.sources?.length ? (
                      <div className="inline-sources">
                        {message.sources.map((source, index) => (
                          <button key={`${source.retrievalRole ?? 'seed'}:${source.chunkId}`} type="button" onClick={() => void openSource(source)}>
                            <span>{index + 1}</span>
                            <small className={`retrieval-role-badge ${source.retrievalRole ?? 'seed'}`}>
                              {retrievalRoleLabel(source.retrievalRole, source.expansionKind)}
                            </small>
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
              <div className="document-view-switch" role="group" aria-label="문서 저장소 보기 방식">
                <button
                  className={documentViewMode === 'list' ? 'active' : ''}
                  type="button"
                  onClick={() => setDocumentViewMode('list')}
                >
                  <List size={16} /> 목록
                </button>
                <button
                  className={documentViewMode === 'graph' ? 'active' : ''}
                  type="button"
                  onClick={() => setDocumentViewMode('graph')}
                >
                  <Network size={16} /> 그래프
                </button>
              </div>
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
                    <div className="repository-upload-menu" ref={repositoryUploadMenuRef}>
                      <button
                        aria-expanded={repositoryUploadMenuOpen}
                        aria-haspopup="menu"
                        className="repository-upload-action"
                        type="button"
                        onClick={() => setRepositoryUploadMenuOpen((open) => !open)}
                        disabled={uploadBusy}
                        title={`${selectedFolder?.name ?? '내 문서'}에 업로드`}
                      >
                        {uploadBusy ? <LoaderCircle size={14} className="spin" /> : <HardDriveUpload size={14} />}
                        업로드
                        <ChevronDown size={13} />
                      </button>
                      {repositoryUploadMenuOpen ? (
                        <div className="repository-upload-popover" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setRepositoryUploadMenuOpen(false);
                              repositoryFileInputRef.current?.click();
                            }}
                          >
                            <HardDriveUpload size={15} />
                            <span><strong>파일 선택</strong><small>한 개 또는 여러 파일</small></span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setRepositoryUploadMenuOpen(false);
                              repositoryFolderInputRef.current?.click();
                            }}
                          >
                            <FolderInput size={15} />
                            <span><strong>폴더 전체</strong><small>하위 구조를 유지해 업로드</small></span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <button type="button" onClick={() => void handleCreateFolder()} disabled={folderBusy}>
                      <FolderPlus size={14} /> 새 폴더
                    </button>
                    {selectedFolder ? (
                      <>
                        <button type="button" onClick={() => void handleRenameSelectedFolder()} disabled={folderBusy}>
                          <Pencil size={13} /> 이름 변경
                        </button>
                        <button className="danger" type="button" onClick={handleDeleteSelectedFolder} disabled={folderBusy || repositoryDeleteBusy}>
                          <Trash2 size={13} /> 삭제
                        </button>
                      </>
                    ) : null}
                    <input
                      className="repository-upload-input"
                      ref={repositoryFileInputRef}
                      type="file"
                      multiple
                      accept={SUPPORTED_FILE_ACCEPT}
                      aria-label="현재 폴더에 업로드할 파일 선택"
                      onChange={(event) => {
                        if (event.target.files) {
                          void handleFiles(event.target.files, selectedFolderId, null, {
                            openStatus: false,
                          });
                        }
                        event.target.value = '';
                      }}
                    />
                    <input
                      className="repository-upload-input"
                      ref={(input) => {
                        repositoryFolderInputRef.current = input;
                        input?.setAttribute('webkitdirectory', '');
                      }}
                      type="file"
                      multiple
                      accept={SUPPORTED_FILE_ACCEPT}
                      aria-label="현재 폴더에 업로드할 폴더 선택"
                      onChange={(event) => {
                        if (event.target.files) {
                          void handleFolderFiles(
                            Array.from(event.target.files).map((file) => ({
                              file,
                              relativePath: file.webkitRelativePath,
                            })),
                            selectedFolderId,
                            { openStatus: false },
                          );
                        }
                        event.target.value = '';
                      }}
                    />
                  </div>
                </div>

                {folderActionError ? <p className="folder-action-error" role="alert">{folderActionError}</p> : null}
                {repositoryUploadFeedbackVisible && (uploadBusy || uploadMessage) ? (
                  <div
                    className={`repository-upload-notice${
                      uploadMessage?.includes('실패') ? ' error' : ''
                    }`}
                    role={uploadMessage?.includes('실패') ? 'alert' : 'status'}
                  >
                    {uploadBusy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : uploadMessage?.includes('실패') ? (
                      <XCircle size={16} />
                    ) : (
                      <CheckCircle2 size={16} />
                    )}
                    <span>
                      {uploadBusy
                        ? `${selectedFolder?.name ?? '내 문서'}에 문서를 업로드하고 있습니다.`
                        : uploadMessage}
                    </span>
                    <button type="button" onClick={() => setView('upload-status')}>처리 현황</button>
                    {!uploadBusy ? (
                      <button
                        className="icon-only"
                        type="button"
                        aria-label="업로드 알림 닫기"
                        onClick={() => setRepositoryUploadFeedbackVisible(false)}
                      >
                        <X size={14} />
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {documentViewMode === 'list' ? (
                  <>
                <div className="repository-explorer-toolbar">
                  <div>
                    <strong>항목</strong>
                    <small>
                      {documentFilter
                        ? '현재 폴더의 검색 결과'
                        : '폴더와 파일을 한 목록에서 탐색합니다'}
                    </small>
                  </div>
                  <button
                    className="repository-bulk-delete-button"
                    type="button"
                    disabled={!selectedRepositoryEntryCount || repositoryDeleteBusy}
                    onClick={openRepositoryDeleteConfirmation}
                  >
                    {repositoryDeleteBusy ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}
                    선택 삭제{selectedRepositoryEntryCount ? ` ${selectedRepositoryEntryCount}` : ''}
                  </button>
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
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    setDragOverFolderId(null);
                  }}
                  onDrop={(event) => void handleFolderDrop(event, selectedFolderId)}
                >
                  <div className="repository-entry-header">
                    <label className="repository-selection-checkbox">
                      <input
                        aria-label="현재 목록 전체 선택"
                        checked={visibleRepositoryEntryCount > 0
                          && selectedVisibleRepositoryEntryCount === visibleRepositoryEntryCount}
                        disabled={!visibleRepositoryEntryCount || repositoryDeleteBusy}
                        ref={repositorySelectAllRef}
                        type="checkbox"
                        onChange={(event) => toggleVisibleRepositorySelection(event.target.checked)}
                      />
                    </label>
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
                      <div
                        className={`repository-entry-row folder-entry ${dragOverFolderId === folder.id ? 'drop-target' : ''}`}
                        key={folder.id}
                      >
                        <label className="repository-selection-checkbox">
                          <input
                            aria-label={`${folder.name} 폴더 선택`}
                            checked={selectedRepositoryFolderIds.has(folder.id)}
                            disabled={repositoryDeleteBusy}
                            type="checkbox"
                            onChange={(event) => toggleRepositoryFolderSelection(
                              folder.id,
                              event.target.checked,
                            )}
                          />
                        </label>
                        <button
                          aria-label={`${folder.name} 폴더 열기`}
                          className="repository-entry-open"
                          draggable
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
                      </div>
                    );
                  })}
                  {filteredDocuments.map((item) => {
                    const Icon = fileIcon(item.document.sourceType);
                    return (
                      <div
                        className={`repository-entry-row document-entry${
                          selectedDocument?.document.id === item.document.id ? ' selected' : ''
                        }`}
                        key={item.document.id}
                      >
                        <label className="repository-selection-checkbox">
                          <input
                            aria-label={`${item.document.title} 문서 선택`}
                            checked={selectedRepositoryDocumentIds.has(item.document.id)}
                            disabled={repositoryDeleteBusy}
                            type="checkbox"
                            onChange={(event) => toggleRepositoryDocumentSelection(
                              item.document.id,
                              event.target.checked,
                            )}
                          />
                        </label>
                        <button
                          className="repository-entry-open"
                          draggable
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
                      </div>
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
                  </>
                ) : (
                  <KnowledgeGraphView
                    folderId={selectedFolderId}
                    documentQuery={documentFilter}
                    onOpenDocument={openGraphDocument}
                    onOpenEvidence={openDocumentEvidence}
                  />
                )}
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
                  onRenameDocument={handleDocumentRenamed}
                  onDeleteDocument={handleDeleteDocument}
                  onExpandStructure={setExpandedStructureChunkId}
                />
              ) : null}
            </div>
          </section>
        ) : null}

        {view === 'rules' ? (
          <BusinessRulesView
            ruleDocuments={ruleDocuments}
            onRuleDocumentsChange={updateRuleDocuments}
            onRefreshRuleDocuments={refreshRuleDocuments}
            onOpenEvidence={openDocumentEvidence}
          />
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
                  void handleUploadDrop(event.dataTransfer);
                }}
              >
                {uploadBusy ? <LoaderCircle size={34} className="spin" /> : <UploadCloud size={34} />}
                <h2>{uploadBusy ? '문서를 구조화하고 Qdrant에 색인하는 중입니다' : '문서를 여기에 놓으세요'}</h2>
                <p>파일 또는 폴더를 올리면 폴더 구조를 보존하고 검색 청크로 변환합니다.</p>
                <div className="upload-picker-actions">
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadBusy}>
                    파일 선택
                  </button>
                  <button type="button" onClick={() => folderInputRef.current?.click()} disabled={uploadBusy}>
                    <FolderInput size={15} /> 폴더 선택
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={SUPPORTED_FILE_ACCEPT}
                  onChange={(event) => {
                    if (event.target.files) void handleFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
                <input
                  ref={(input) => {
                    folderInputRef.current = input;
                    input?.setAttribute('webkitdirectory', '');
                  }}
                  type="file"
                  multiple
                  accept={SUPPORTED_FILE_ACCEPT}
                  aria-label="업로드할 폴더 선택"
                  onChange={(event) => {
                    if (event.target.files) {
                      void handleFolderFiles(Array.from(event.target.files).map((file) => ({
                        file,
                        relativePath: file.webkitRelativePath,
                      })));
                    }
                    event.target.value = '';
                  }}
                />
                <small>선택 폴더부터 저장 · 로컬 상위 경로 제외 · 파일당 최대 50MB</small>
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
                  const canResume = canResumeDocumentIngestion(job, uploadRecoveryNow);
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
                      {job.cleanupError ? (
                        <p className="upload-job-cleanup-error">
                          정리 실패: {job.cleanupError}
                        </p>
                      ) : null}
                      <div className="upload-job-actions">
                        {(job.status === 'failed' && !job.cleanupStartedAt) || canResume ? (
                          <button
                            className="upload-job-retry"
                            type="button"
                            disabled={
                              retryingUploadJobIds.has(job.id)
                              || cleaningUploadJobIds.has(job.id)
                            }
                            onClick={() => handleRetryUploadJob(job)}
                          >
                            {retryingUploadJobIds.has(job.id) ? (
                              <LoaderCircle size={14} className="spin" />
                            ) : (
                              <UploadCloud size={14} />
                            )}
                            {canResume
                              ? '처리 재개'
                              : job.originalAvailable && job.documentId && job.versionId
                                ? '다시 처리'
                                : '파일 선택 후 재시도'}
                          </button>
                        ) : null}
                        {job.status === 'failed' ? (
                          <button
                            className="upload-job-cleanup"
                            type="button"
                            disabled={
                              retryingUploadJobIds.has(job.id)
                              || cleaningUploadJobIds.has(job.id)
                            }
                            onClick={() => void handleCleanupUploadJob(job)}
                          >
                            {cleaningUploadJobIds.has(job.id) ? (
                              <LoaderCircle size={14} className="spin" />
                            ) : (
                              <Trash2 size={14} />
                            )}
                            {cleaningUploadJobIds.has(job.id)
                              ? '정리 중'
                              : job.cleanupStartedAt
                                ? '정리 다시 시도'
                                : '작업 정리'}
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

      <OAuthConnectionsModal
        initialConnections={initialOAuthConnections}
        initialError={initialOAuthConnectionsError}
        mcpEndpoint={mcpEndpoint}
        onClose={closeOAuthConnectionsModal}
        open={oauthConnectionsModalOpen}
      />

      {repositoryDeleteConfirmationOpen ? (
        <div
          className="repository-delete-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeRepositoryDeleteConfirmation();
          }}
        >
          <section
            aria-busy={repositoryDeleteBusy}
            aria-labelledby="repository-delete-modal-title"
            aria-modal="true"
            className="repository-delete-modal"
            ref={repositoryDeleteModalRef}
            role="dialog"
          >
            <div className="repository-delete-modal-icon"><Trash2 size={22} /></div>
            <span className="eyebrow">PERMANENT DELETE</span>
            <h2 id="repository-delete-modal-title">선택한 항목을 삭제할까요?</h2>
            <p>
              원본 파일, 구조화 데이터와 Qdrant 검색 벡터가 함께 삭제되며 되돌릴 수 없습니다.
            </p>
            <dl className="repository-delete-summary">
              <div>
                <dt>선택</dt>
                <dd>{selectedRepositoryEntryCount}개 항목</dd>
              </div>
              <div>
                <dt>삭제될 폴더</dt>
                <dd>{repositoryDeletionTargets.folderIds.length}개</dd>
              </div>
              <div>
                <dt>삭제될 문서</dt>
                <dd>{repositoryDeletionTargets.documentIds.length}개</dd>
              </div>
            </dl>
            {repositoryDeletionTargets.folderIds.length ? (
              <p className="repository-delete-folder-warning">
                선택한 폴더의 모든 하위 폴더와 문서도 삭제 대상에 포함됩니다.
              </p>
            ) : null}
            {repositoryDeleteError ? (
              <p className="repository-delete-modal-error" role="alert">{repositoryDeleteError}</p>
            ) : null}
            <div className="repository-delete-modal-actions">
              <button
                ref={repositoryDeleteCancelRef}
                type="button"
                disabled={repositoryDeleteBusy}
                onClick={closeRepositoryDeleteConfirmation}
              >
                취소
              </button>
              <button
                className="danger"
                type="button"
                disabled={repositoryDeleteBusy}
                onClick={() => void handleBulkRepositoryDelete()}
              >
                {repositoryDeleteBusy ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}
                {repositoryDeleteBusy ? '삭제 중' : '영구 삭제'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

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
              onRenameDocument={handleDocumentRenamed}
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
                <button key={`${source.retrievalRole ?? 'seed'}:${source.chunkId}`} type="button" onClick={() => void openSource(source)}>
                  <div className="source-number">{index + 1}</div>
                  <div>
                    <span className={`retrieval-role-badge ${source.retrievalRole ?? 'seed'}`}>
                      {retrievalRoleLabel(source.retrievalRole, source.expansionKind)}
                    </span>
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
