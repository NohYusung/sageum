import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { getIndexedDocument } from '@/lib/server/document-repository';
import { deleteOwnedDocument, OwnedDocumentDeletionError } from '@/lib/server/owned-document-deletion';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { documentId } = await params;
  if (!UUID_PATTERN.test(documentId)) {
    return Response.json({ error: '올바른 문서 식별자가 필요합니다.' }, { status: 400 });
  }
  try {
    const document = await getIndexedDocument(context.supabase, context.ownerId, documentId);
    if (!document) return Response.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
    return Response.json({ document }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to load document', error);
    return Response.json({ error: '문서를 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { documentId } = await params;
  if (!UUID_PATTERN.test(documentId)) {
    return Response.json({ error: '올바른 문서 식별자가 필요합니다.' }, { status: 400 });
  }

  try {
    await deleteOwnedDocument(context, documentId);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Document deletion failed', error);
    const deletionError = error instanceof OwnedDocumentDeletionError ? error : null;
    return Response.json(
      {
        error: deletionError?.message ?? '문서 삭제를 완료하지 못했습니다.',
        code: deletionError?.code,
      },
      { status: deletionError?.status ?? 500 },
    );
  }
}
