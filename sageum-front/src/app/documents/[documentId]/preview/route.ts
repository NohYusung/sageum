import { ORIGINAL_PREVIEW_URL_TTL_SECONDS } from '@/lib/documents/original-access';
import { DOCUMENT_BUCKET, validateDocumentMetadata } from '@/lib/documents/validation';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { findOwnedOriginalDocument } from '@/lib/server/document-original';
import {
  buildDocumentPreviewPage,
  renderDocumentPreview,
  type DocumentPreview,
} from '@/lib/server/document-preview';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function previewError(message: string, status: number) {
  return new Response(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>원본 미리보기 오류</title><style>body{display:grid;min-height:100vh;margin:0;place-items:center;background:#f4f3ed;color:#17211d;font-family:system-ui,sans-serif}.card{max-width:440px;padding:32px;border:1px solid #d4d6cc;border-radius:12px;background:#fff;text-align:center}.card a{color:#29483b;font-weight:700}</style></head><body><main class="card"><h1>미리보기를 열지 못했습니다</h1><p>${message}</p><a href="/">문서 저장소로 돌아가기</a></main></body></html>`,
    {
      status,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'",
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return previewError('로그인이 필요합니다.', 401);

  const { documentId } = await params;
  if (!UUID_PATTERN.test(documentId)) {
    return previewError('올바른 문서 식별자가 필요합니다.', 400);
  }

  let original;
  try {
    original = await findOwnedOriginalDocument(context.supabase, context.ownerId, documentId);
  } catch (error) {
    console.error('Failed to find document for preview', error);
    return previewError('원본 문서 정보를 조회하지 못했습니다.', 500);
  }
  if (!original) return previewError('원본 문서를 찾을 수 없습니다.', 404);

  let preview: DocumentPreview;
  try {
    const metadata = validateDocumentMetadata({
      name: original.originalFilename,
      mimeType: original.mimeType,
      sizeBytes: original.sizeBytes,
    });

    if (metadata.sourceType === 'pdf') {
      const { data, error } = await context.supabase.storage
        .from(DOCUMENT_BUCKET)
        .createSignedUrl(original.storagePath, ORIGINAL_PREVIEW_URL_TTL_SECONDS);
      if (error) throw new Error('PDF signed URL creation failed', { cause: error });
      preview = { kind: 'pdf', signedUrl: data.signedUrl };
    } else {
      const { data, error } = await context.supabase.storage
        .from(DOCUMENT_BUCKET)
        .download(original.storagePath);
      if (error) throw new Error('Original download for preview failed', { cause: error });
      const bytes = new Uint8Array(await data.arrayBuffer());
      preview = {
        kind: 'sandbox',
        sourceHtml: await renderDocumentPreview(bytes, {
          name: original.originalFilename,
          mimeType: original.mimeType,
          sizeBytes: original.sizeBytes,
        }),
      };
    }
  } catch (error) {
    console.error('Failed to render document preview', error);
    return previewError('이 문서는 브라우저 미리보기로 변환하지 못했습니다. 원본 다운로드를 이용해 주세요.', 422);
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.searchParams.get('embedded') === '1') {
    if (preview.kind === 'pdf') {
      const requestedPage = Number(requestUrl.searchParams.get('page'));
      const signedUrl = new URL(preview.signedUrl);
      if (Number.isInteger(requestedPage) && requestedPage > 0) {
        signedUrl.hash = `page=${requestedPage}`;
      }
      return new Response(null, {
        status: 307,
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
          Location: signedUrl.toString(),
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    return new Response(preview.sourceHtml, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Security-Policy': "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
        'Content-Type': 'text/html; charset=utf-8',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const page = buildDocumentPreviewPage({
    documentId,
    title: original.title,
    filename: original.originalFilename,
    preview,
  });
  return new Response(page.html, {
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Security-Policy': page.contentSecurityPolicy,
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
