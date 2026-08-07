import type { IndexedDocument, SourceReference } from '@/lib/rag/local-search';

export type DocumentUploadTicket = {
  documentId: string;
  jobId: string;
  versionId: string;
  storagePath: string;
  signedUploadUrl: string;
  uploadToken: string;
  mimeType: string;
};

export type CreateDocumentUploadResponse = {
  upload: DocumentUploadTicket;
};

export type DocumentIngestionStatus =
  | 'queued'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed';

export type DocumentIngestionStage =
  | 'queued'
  | 'uploading'
  | 'parsing'
  | 'ocr'
  | 'chunking'
  | 'indexing'
  | 'ready'
  | 'failed';

export type DocumentIngestionJob = {
  id: string;
  documentId: string | null;
  versionId: string | null;
  retryOfJobId: string | null;
  folderId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentIngestionStatus;
  stage: DocumentIngestionStage;
  attempts: number;
  originalAvailable: boolean;
  cleanupStartedAt: string | null;
  cleanupError: string | null;
  lastError: string | null;
  startedAt: string | null;
  completedAt: string | null;
  workflowRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DocumentIngestionJobResponse = {
  job: DocumentIngestionJob;
};

export type RetryDocumentUploadResponse = {
  upload: DocumentUploadTicket;
};

export type ProcessDocumentResponse = {
  document: IndexedDocument;
};

export type IndexedDocumentResponse = ProcessDocumentResponse;

export type StartDocumentProcessingResponse = {
  jobId: string;
  workflowRunId: string | null;
  started: boolean;
  status: string;
};

export type DocumentProcessingStatus =
  | 'uploaded'
  | 'parsing'
  | 'indexing'
  | 'ready'
  | 'failed';

export type DocumentProcessingStatusResponse = {
  status: DocumentProcessingStatus;
  errorMessage: string | null;
};

export type SearchDocumentsResponse = {
  answer: string;
  sources: SourceReference[];
  mode: 'qdrant';
  answerMode: 'claude-platform-aws' | 'extractive-fallback';
};

export type ApiErrorResponse = {
  error: string;
  code?: string;
};
