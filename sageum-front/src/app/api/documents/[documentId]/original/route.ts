import {
  ORIGINAL_URL_TTL_SECONDS,
  parseOriginalDisposition,
  signedUrlOptions,
} from '@/lib/documents/original-access';
import { DOCUMENT_BUCKET } from '@/lib/documents/validation';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { findOwnedOriginalDocument } from '@/lib/server/document-original';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { documentId } = await params;
  if (!UUID_PATTERN.test(documentId)) {
    return Response.json({ error: '올바른 문서 식별자가 필요합니다.' }, { status: 400 });
  }

  const disposition = parseOriginalDisposition(new URL(request.url).searchParams.get('disposition'));
  if (!disposition) {
    return Response.json({ error: '올바른 원본 접근 방식이 필요합니다.' }, { status: 400 });
  }

  let original;
  try {
    original = await findOwnedOriginalDocument(context.supabase, context.ownerId, documentId);
  } catch (error) {
    console.error('Failed to find original document', error);
    return Response.json({ error: '원본 문서 정보를 조회하지 못했습니다.' }, { status: 500 });
  }
  if (!original) return Response.json({ error: '원본 문서를 찾을 수 없습니다.' }, { status: 404 });

  const { data: signedOriginal, error: signedOriginalError } = await context.supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(
      original.storagePath,
      ORIGINAL_URL_TTL_SECONDS,
      signedUrlOptions(disposition, original.originalFilename),
    );

  if (signedOriginalError) {
    console.error('Failed to create original document URL', signedOriginalError);
    return Response.json({ error: '원본 문서 URL을 만들지 못했습니다.' }, { status: 502 });
  }

  return new Response(null, {
    status: 307,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      Location: signedOriginal.signedUrl,
      'Referrer-Policy': 'no-referrer',
    },
  });
}
