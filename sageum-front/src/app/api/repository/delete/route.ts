import type { RepositoryBulkDeleteResponse } from '@/lib/documents/contracts';
import { resolveRepositoryDeletionTargets } from '@/lib/folders/deletion';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { deleteOwnedDocument } from '@/lib/server/owned-document-deletion';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_DIRECT_SELECTION = 1000;
const DELETE_CONCURRENCY = 4;

function parseIds(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) {
    throw new Error(`올바른 ${label} 목록이 필요합니다.`);
  }
  return [...new Set(value as string[])];
}

async function deleteDocumentsWithConcurrency(
  documentIds: string[],
  deleteDocument: (documentId: string) => Promise<void>,
) {
  const results = new Map<string, string | null>();
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(DELETE_CONCURRENCY, documentIds.length) },
    async () => {
      while (nextIndex < documentIds.length) {
        const documentId = documentIds[nextIndex++];
        try {
          await deleteDocument(documentId);
          results.set(documentId, null);
        } catch (error) {
          results.set(
            documentId,
            error instanceof Error ? error.message : '문서 삭제에 실패했습니다.',
          );
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function POST(request: Request) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  let documentIds: string[];
  let folderIds: string[];
  try {
    const body = await request.json() as Record<string, unknown>;
    documentIds = parseIds(body.documentIds, '문서 식별자');
    folderIds = parseIds(body.folderIds, '폴더 식별자');
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '올바른 삭제 요청이 필요합니다.' },
      { status: 400 },
    );
  }

  if (!documentIds.length && !folderIds.length) {
    return Response.json({ error: '삭제할 문서나 폴더를 선택해 주세요.' }, { status: 400 });
  }
  if (documentIds.length + folderIds.length > MAX_DIRECT_SELECTION) {
    return Response.json(
      { error: `한 번에 직접 선택할 수 있는 항목은 ${MAX_DIRECT_SELECTION}개까지입니다.` },
      { status: 400 },
    );
  }

  const [folderResult, documentResult] = await Promise.all([
    context.supabase
      .from('folders')
      .select('id, parent_id')
      .eq('owner_id', context.ownerId),
    context.supabase
      .from('documents')
      .select('id, folder_id')
      .eq('owner_id', context.ownerId),
  ]);
  if (folderResult.error || documentResult.error) {
    console.error('Failed to resolve bulk deletion targets', folderResult.error ?? documentResult.error);
    return Response.json({ error: '삭제 대상을 불러오지 못했습니다.' }, { status: 500 });
  }

  const ownedFolderIds = new Set(folderResult.data.map((folder) => folder.id));
  const ownedDocumentIds = new Set(documentResult.data.map((document) => document.id));
  if (
    folderIds.some((folderId) => !ownedFolderIds.has(folderId))
    || documentIds.some((documentId) => !ownedDocumentIds.has(documentId))
  ) {
    return Response.json(
      { error: '일부 항목을 찾을 수 없거나 삭제 권한이 없습니다.' },
      { status: 404 },
    );
  }

  const targets = resolveRepositoryDeletionTargets({
    documents: documentResult.data.map((document) => ({
      id: document.id,
      folderId: document.folder_id,
    })),
    folders: folderResult.data.map((folder) => ({
      id: folder.id,
      parentId: folder.parent_id,
    })),
    selectedDocumentIds: documentIds,
    selectedFolderIds: folderIds,
  });
  const deletionResults = await deleteDocumentsWithConcurrency(
    targets.documentIds,
    (documentId) => deleteOwnedDocument(context, documentId),
  );
  const deletedDocumentIds = targets.documentIds.filter(
    (documentId) => deletionResults.get(documentId) === null,
  );
  const failures = targets.documentIds.flatMap((documentId) => {
    const message = deletionResults.get(documentId);
    return message ? [{ documentId, message }] : [];
  });

  const failedDocumentIds = new Set(failures.map((failure) => failure.documentId));
  const folderContainsFailure = targets.folderDocumentIds.some((documentId) => (
    failedDocumentIds.has(documentId)
  ));
  let deletedFolderIds: string[] = [];
  let folderError: string | null = null;

  if (targets.rootFolderIds.length && !folderContainsFailure) {
    const { error } = await context.supabase.rpc('delete_folder_trees', {
      p_folder_ids: targets.rootFolderIds,
    });
    if (error) {
      console.error('Failed to delete folder trees', error);
      folderError = '폴더 구조를 삭제하지 못했습니다. 남은 폴더를 다시 선택해 주세요.';
    } else {
      deletedFolderIds = targets.folderIds;
    }
  } else if (targets.rootFolderIds.length) {
    folderError = '폴더 안의 일부 문서 삭제가 실패해 폴더는 유지했습니다.';
  }

  return Response.json({
    deletedDocumentIds,
    deletedFolderIds,
    failures,
    folderError,
  } satisfies RepositoryBulkDeleteResponse, {
    status: failures.length || folderError ? 207 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
