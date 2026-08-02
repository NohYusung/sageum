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
  vectorIndex: {
    required: true;
    provider: string;
    model: string;
    dtype: string;
    dimensions: number;
  } | null;
};

export type IndexDocumentVectorsResponse = {
  indexedAt: string;
  vectorCount: number;
};

export type SearchDocumentsResponse = {
  answer: string;
  sources: SourceReference[];
  mode: 'qdrant';
};

export type ApiErrorResponse = {
  error: string;
  code?: string;
};
