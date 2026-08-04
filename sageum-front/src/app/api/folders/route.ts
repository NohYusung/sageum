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

export async function POST(request: Request) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  let name: string;
  let parentId: string | null;
  try {
    const body = await request.json() as { name?: unknown; parentId?: unknown };
    name = parseFolderName(body.name);
    parentId = parseFolderId(body.parentId, { optional: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof FolderValidationError ? error.message : '올바른 폴더 요청이 필요합니다.' },
      { status: 400 },
    );
  }

  const { data, error } = await context.supabase
    .from('folders')
    .insert({ owner_id: context.ownerId, parent_id: parentId, name })
    .select('*')
    .single();
  if (error) {
    console.error('Failed to create folder', error);
    return Response.json(
      {
        error: error.code === '23503'
          ? '상위 폴더를 찾을 수 없습니다.'
          : folderDatabaseError(error, '폴더를 만들지 못했습니다.'),
      },
      { status: error.code === '23505' ? 409 : error.code === '23503' ? 404 : 400 },
    );
  }

  return Response.json({ folder: mapFolder(data) } satisfies FolderResponse, { status: 201 });
}
