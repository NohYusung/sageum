import type { CreateDocumentUploadResponse } from '@/lib/documents/contracts';
import { FolderValidationError, parseFolderId } from '@/lib/folders/validation';
import { DocumentValidationError } from '@/lib/documents/validation';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import {
  createDocumentUpload,
  DocumentUploadInitializationError,
} from '@/lib/server/document-upload';
import { DOCUMENT_KINDS, type DocumentKind } from '@/lib/relations/types';

export const runtime = 'nodejs';

type CreateDocumentBody = {
  name?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  folderId?: unknown;
  retryOfJobId?: unknown;
  documentKind?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function POST(request: Request) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  let body: CreateDocumentBody;
  try {
    body = await request.json() as CreateDocumentBody;
  } catch {
    return Response.json({ error: '올바른 JSON 요청이 필요합니다.' }, { status: 400 });
  }

  try {
    const folderId = parseFolderId(body.folderId, { optional: true });
    const documentKind = body.documentKind === undefined
      ? 'knowledge'
      : typeof body.documentKind === 'string'
        && DOCUMENT_KINDS.includes(body.documentKind as DocumentKind)
        ? body.documentKind as DocumentKind
        : null;
    if (!documentKind) {
      throw new DocumentValidationError('올바른 문서 종류가 필요합니다.');
    }
    if (documentKind === 'rule' && folderId) {
      throw new DocumentValidationError('비즈니스 규칙 문서는 별도 영역에서 관리됩니다.');
    }
    const retryOfJobId = body.retryOfJobId === undefined || body.retryOfJobId === null
      ? null
      : typeof body.retryOfJobId === 'string' && UUID_PATTERN.test(body.retryOfJobId)
        ? body.retryOfJobId
        : null;
    if (body.retryOfJobId !== undefined && body.retryOfJobId !== null && !retryOfJobId) {
      throw new DocumentValidationError('올바른 재시도 작업 식별자가 필요합니다.');
    }

    const upload = await createDocumentUpload(context.supabase, context.ownerId, {
      name: typeof body.name === 'string' ? body.name : '',
      mimeType: typeof body.mimeType === 'string' ? body.mimeType : '',
      sizeBytes: typeof body.sizeBytes === 'number' ? body.sizeBytes : Number.NaN,
      folderId,
      retryOfJobId,
      documentKind,
    });
    const response = { upload } satisfies CreateDocumentUploadResponse;
    return Response.json(response, { status: 201 });
  } catch (error) {
    if (error instanceof DocumentUploadInitializationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof DocumentValidationError || error instanceof FolderValidationError
      ? error.message
      : '파일 정보를 확인해 주세요.';
    return Response.json({ error: message }, { status: 400 });
  }
}
