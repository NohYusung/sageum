import type { FolderResponse } from '@/lib/folders/contracts';
import { folderDatabaseError } from '@/lib/folders/errors';
import type { Folder } from '@/lib/folders/types';
import {
  FolderValidationError,
  parseFolderId,
  parseFolderName,
} from '@/lib/folders/validation';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';

export const runtime = 'nodejs';

function mapFolder(row: {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}): Folder {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function invalidFolderId(error: unknown) {
  const message = error instanceof FolderValidationError ? error.message : '올바른 폴더 식별자가 필요합니다.';
  return Response.json({ error: message }, { status: 400 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ folderId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  let folderId: string;
  try {
    folderId = parseFolderId((await params).folderId);
  } catch (error) {
    return invalidFolderId(error);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: '올바른 폴더 변경 요청이 필요합니다.' }, { status: 400 });
  }

  const changesName = Object.hasOwn(body, 'name');
  const changesParent = Object.hasOwn(body, 'parentId');
  if (changesName === changesParent) {
    return Response.json({ error: '이름 변경 또는 위치 이동 중 하나만 요청해 주세요.' }, { status: 400 });
  }

  if (changesParent) {
    let parentId: string | null;
    try {
      parentId = parseFolderId(body.parentId, { optional: true });
    } catch (error) {
      return invalidFolderId(error);
    }
    const { error } = await context.supabase.rpc('move_folder', {
      p_folder_id: folderId,
      p_parent_id: parentId,
    });
    if (error) {
      console.error('Failed to move folder', error);
      return Response.json(
        { error: folderDatabaseError(error, '폴더를 이동하지 못했습니다.') },
        { status: error.code === 'P0002' ? 404 : 409 },
      );
    }
  } else {
    let name: string;
    try {
      name = parseFolderName(body.name);
    } catch (error) {
      return Response.json(
        { error: error instanceof FolderValidationError ? error.message : '올바른 폴더 이름이 필요합니다.' },
        { status: 400 },
      );
    }
    const { error } = await context.supabase
      .from('folders')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', folderId)
      .eq('owner_id', context.ownerId);
    if (error) {
      console.error('Failed to rename folder', error);
      return Response.json(
        { error: folderDatabaseError(error, '폴더 이름을 변경하지 못했습니다.') },
        { status: error.code === '23505' ? 409 : 400 },
      );
    }
  }

  const { data, error: selectError } = await context.supabase
    .from('folders')
    .select('*')
    .eq('id', folderId)
    .eq('owner_id', context.ownerId)
    .maybeSingle();
  if (selectError) return Response.json({ error: '폴더 정보를 불러오지 못했습니다.' }, { status: 500 });
  if (!data) return Response.json({ error: '폴더를 찾을 수 없습니다.' }, { status: 404 });
  return Response.json({ folder: mapFolder(data) } satisfies FolderResponse);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ folderId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  let folderId: string;
  try {
    folderId = parseFolderId((await params).folderId);
  } catch (error) {
    return invalidFolderId(error);
  }

  const { data, error } = await context.supabase
    .from('folders')
    .delete()
    .eq('id', folderId)
    .eq('owner_id', context.ownerId)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('Failed to delete folder', error);
    return Response.json(
      { error: folderDatabaseError(error, '폴더를 삭제하지 못했습니다.') },
      { status: error.code === '23503' ? 409 : 400 },
    );
  }
  if (!data) return Response.json({ error: '폴더를 찾을 수 없습니다.' }, { status: 404 });
  return new Response(null, { status: 204 });
}
