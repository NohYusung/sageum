import type { DocumentMoveResponse } from '@/lib/folders/contracts';
import { folderDatabaseError } from '@/lib/folders/errors';
import {
  FolderValidationError,
  parseFolderId,
} from '@/lib/folders/validation';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  let documentId: string;
  let folderId: string | null;
  try {
    documentId = parseFolderId((await params).documentId);
    const body = await request.json() as { folderId?: unknown };
    folderId = parseFolderId(body.folderId, { optional: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof FolderValidationError ? error.message : '올바른 문서 이동 요청이 필요합니다.' },
      { status: 400 },
    );
  }

  const { error } = await context.supabase.rpc('move_document', {
    p_document_id: documentId,
    p_folder_id: folderId,
  });
  if (error) {
    console.error('Failed to move document', error);
    return Response.json(
      { error: folderDatabaseError(error, '문서를 이동하지 못했습니다.') },
      { status: error.code === 'P0002' ? 404 : 409 },
    );
  }

  return Response.json({ documentId, folderId } satisfies DocumentMoveResponse);
}
