import type {
  DocumentProcessingStatus,
  DocumentProcessingStatusResponse,
  StartDocumentProcessingResponse,
} from '@/lib/documents/contracts';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import { startDocumentIngestionWorkflow } from '@/lib/server/document-ingestion-workflow';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const PROCESSING_STATUSES = new Set<DocumentProcessingStatus>([
  'uploaded',
  'parsing',
  'indexing',
  'ready',
  'failed',
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { documentId } = await params;
  const versionId = new URL(request.url).searchParams.get('versionId') ?? '';
  if (!UUID_PATTERN.test(documentId) || !UUID_PATTERN.test(versionId)) {
    return Response.json({ error: '올바른 문서 식별자가 필요합니다.' }, { status: 400 });
  }

  const { data: version, error } = await context.supabase
    .from('document_versions')
    .select('status,error_message')
    .eq('id', versionId)
    .eq('document_id', documentId)
    .eq('owner_id', context.ownerId)
    .maybeSingle();
  if (error) {
    return Response.json({ error: '문서 처리 상태를 조회하지 못했습니다.' }, { status: 500 });
  }
  if (!version) return Response.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });

  const status = PROCESSING_STATUSES.has(version.status as DocumentProcessingStatus)
    ? version.status as DocumentProcessingStatus
    : 'uploaded';
  const response = { status, errorMessage: version.error_message } satisfies DocumentProcessingStatusResponse;
  return Response.json(response, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { documentId } = await params;
  let versionId = '';
  let jobId = '';
  try {
    const body = await request.json() as { versionId?: unknown; jobId?: unknown };
    versionId = typeof body.versionId === 'string' ? body.versionId : '';
    jobId = typeof body.jobId === 'string' ? body.jobId : '';
  } catch {
    return Response.json({ error: '올바른 JSON 요청이 필요합니다.' }, { status: 400 });
  }

  if (!UUID_PATTERN.test(documentId) || !UUID_PATTERN.test(versionId) || !UUID_PATTERN.test(jobId)) {
    return Response.json({ error: '올바른 문서 식별자가 필요합니다.' }, { status: 400 });
  }

  try {
    const result = await startDocumentIngestionWorkflow({
      ownerId: context.ownerId,
      documentId,
      versionId,
      jobId,
    });
    const response = result satisfies StartDocumentProcessingResponse;
    return Response.json(response, { status: result.started ? 202 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '문서 처리 작업을 시작하지 못했습니다.';
    const status = message.includes('찾을 수 없') ? 404 : message.includes('상태') || message.includes('다시') ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
