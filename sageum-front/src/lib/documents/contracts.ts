import type { IndexedDocument } from '@/lib/rag/local-search';

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

export type ApiErrorResponse = {
  error: string;
};
