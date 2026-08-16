import type { RenameDocumentResponse } from '@/lib/documents/contracts';
import {
  DocumentValidationError,
  validateRenamedDocumentFilename,
} from '@/lib/documents/validation';
import type { IndexedDocument } from '@/lib/rag/local-search';
import type { AuthenticatedRequestContext } from './api-auth';
import { getIndexedDocument } from './document-repository';
import { getProviderConfiguration } from './env';
import { getQdrantVectorStore } from './qdrant-store';
import { refreshKnowledgeDocumentSemanticNode } from './semantic-graph-service';
import { getSupabaseAdminClient } from './supabase';

export class DocumentRenameError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = 'DocumentRenameError';
  }
}

function renamedDocument(document: IndexedDocument, name: string): IndexedDocument {
  return {
    ...document,
    document: {
      ...document.document,
      name,
      title: name,
    },
  };
}

async function assertUploadedDocument(
  context: AuthenticatedRequestContext,
  document: IndexedDocument,
) {
  if (document.document.documentKind !== 'rule') return;
  const { data, error } = await context.supabase
    .from('rule_documents')
    .select('source_mode')
    .eq('document_id', document.document.id)
    .eq('owner_id', context.ownerId)
    .maybeSingle();
  if (error) throw new DocumentRenameError('규칙 문서 유형을 확인하지 못했습니다.');
  if (data?.source_mode === 'manual') {
    throw new DocumentRenameError('직접 입력 규칙은 규칙 편집 기능을 사용해 주세요.', 409);
  }
}

async function refreshKnowledgeIndexes(
  context: AuthenticatedRequestContext,
  document: IndexedDocument,
) {
  if (document.document.documentKind !== 'knowledge'
    || document.status !== 'ready'
    || !document.chunks.length) return [];

  const configuration = getProviderConfiguration();
  if (!configuration.embedding.configured || !configuration.qdrant.configured) {
    return ['문서 이름은 변경했지만 Qdrant 검색 색인을 갱신할 수 없습니다. 환경 설정을 확인해 주세요.'];
  }

  const vectorStore = getQdrantVectorStore();
  const results = await Promise.allSettled([
    (async () => {
      await vectorStore.ensureCollection(configuration.embedding.dimensions);
      await vectorStore.upsert(document.chunks.map((chunk) => ({
        chunk,
        ownerId: context.ownerId,
        sourceType: document.document.sourceType,
        documentTitle: document.document.title,
        embeddingModel: configuration.embedding.model,
      })));
    })(),
    (async () => refreshKnowledgeDocumentSemanticNode(
      getSupabaseAdminClient(),
      context.ownerId,
      document.document.id,
    ))(),
  ]);

  return results.flatMap((result, index) => result.status === 'rejected'
    ? [index === 0
      ? '문서 이름은 변경했지만 Qdrant 검색 색인 갱신에 실패했습니다. 같은 이름으로 다시 저장해 재시도해 주세요.'
      : '문서 이름은 변경했지만 의미 그래프 갱신에 실패했습니다. 같은 이름으로 다시 저장해 재시도해 주세요.']
    : []);
}

export async function renameOwnedDocument(
  context: AuthenticatedRequestContext,
  documentId: string,
  value: unknown,
): Promise<RenameDocumentResponse> {
  const current = await getIndexedDocument(context.supabase, context.ownerId, documentId);
  if (!current || current.status === 'deleting') {
    throw new DocumentRenameError('문서를 찾을 수 없습니다.', 404);
  }
  await assertUploadedDocument(context, current);

  let name: string;
  try {
    name = validateRenamedDocumentFilename(current.document.name, value);
  } catch (error) {
    if (error instanceof DocumentValidationError) {
      throw new DocumentRenameError(error.message, 400);
    }
    throw error;
  }

  const { error } = await context.supabase.rpc('rename_document', {
    p_document_id: documentId,
    p_original_filename: name,
  });
  if (error) {
    if (error.code === 'P0002') throw new DocumentRenameError('문서를 찾을 수 없습니다.', 404);
    if (error.code === '23514' || error.code === '22023') {
      throw new DocumentRenameError('파일명과 확장자를 확인해 주세요.', 400);
    }
    if (error.code === '42501') throw new DocumentRenameError('문서 이름을 변경할 권한이 없습니다.', 403);
    throw new DocumentRenameError('문서 제목과 파일명을 변경하지 못했습니다.');
  }

  const document = renamedDocument(current, name);
  const warnings = await refreshKnowledgeIndexes(context, document);
  return warnings.length
    ? { document, indexStatus: 'warning', warning: warnings.join(' ') }
    : { document, indexStatus: 'ready' };
}
