import type { IndexedDocument, SourceReference } from '@/lib/rag/local-search';

export type DocumentUploadTicket = {
  documentId: string;
  versionId: string;
  storagePath: string;
  uploadToken: string;
  mimeType: string;
};

export type CreateDocumentUploadResponse = {
  upload: DocumentUploadTicket;
};

export type ProcessDocumentResponse = {
  document: IndexedDocument;
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
