import type { IndexedDocument, SourceReference } from '@/lib/rag/local-search';
import type { AppliedRuleReference, DocumentKind } from '@/lib/relations/types';

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
  documentKind: DocumentKind;
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
  appliedRules: AppliedRuleReference[];
  relationMode: 'expanded' | 'content-only' | 'fallback';
};

export type ApiErrorResponse = {
  error: string;
  code?: string;
};

export type RepositoryBulkDeleteFailure = {
  documentId: string;
  message: string;
};

export type RepositoryBulkDeleteResponse = {
  deletedDocumentIds: string[];
  deletedFolderIds: string[];
  failures: RepositoryBulkDeleteFailure[];
  folderError: string | null;
};
