import { DOCUMENT_BUCKET } from '@/lib/documents/validation';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { getProviderConfiguration } from '@/lib/server/env';
import { getQdrantVectorStore } from '@/lib/server/qdrant-store';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

  const [documentResult, versionsResult] = await Promise.all([
    context.supabase
      .from('documents')
      .select('id')
      .eq('id', documentId)
      .eq('owner_id', context.ownerId)
      .maybeSingle(),
    context.supabase
      .from('document_versions')
      .select('storage_path')
      .eq('document_id', documentId)
      .eq('owner_id', context.ownerId),
  ]);

  if (documentResult.error || versionsResult.error) {
    return Response.json({ error: '문서 삭제 정보를 조회하지 못했습니다.' }, { status: 500 });
  }
  if (!documentResult.data) {
    return Response.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
  }

  const providers = getProviderConfiguration();
  if (providers.embedding.configured !== providers.qdrant.configured) {
    return Response.json(
      { error: '임베딩과 Qdrant 환경 설정을 모두 확인해 주세요.' },
      { status: 503 },
    );
  }

  try {
    if (providers.qdrant.configured) {
      await getQdrantVectorStore().deleteByDocument(context.ownerId, documentId);
    }

    const storagePaths = versionsResult.data.map((version) => version.storage_path);
    if (storagePaths.length) {
      const { error: storageError } = await context.supabase.storage
        .from(DOCUMENT_BUCKET)
        .remove(storagePaths);
      if (storageError) throw new Error('Storage delete failed', { cause: storageError });
    }

    const { error: documentError } = await context.supabase
      .from('documents')
      .delete()
      .eq('id', documentId)
      .eq('owner_id', context.ownerId);
    if (documentError) throw new Error('Document delete failed', { cause: documentError });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Document deletion failed', error);
    return Response.json({ error: '문서를 삭제하지 못했습니다.' }, { status: 502 });
  }
}
