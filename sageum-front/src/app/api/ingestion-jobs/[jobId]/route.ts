import type { DocumentIngestionJobResponse } from '@/lib/documents/contracts';
import { mapStoredIngestionJob } from '@/lib/documents/ingestion-jobs';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { jobId } = await params;
  if (!UUID_PATTERN.test(jobId)) {
    return Response.json({ error: '올바른 처리 작업 식별자가 필요합니다.' }, { status: 400 });
  }

  const { data: job, error } = await context.supabase
    .from('document_ingestion_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('owner_id', context.ownerId)
    .maybeSingle();

  if (error) {
    return Response.json({ error: '문서 처리 이력을 조회하지 못했습니다.' }, { status: 500 });
  }
  if (!job) return Response.json({ error: '문서 처리 이력을 찾을 수 없습니다.' }, { status: 404 });

  const response = { job: mapStoredIngestionJob(job) } satisfies DocumentIngestionJobResponse;
  return Response.json(response, { headers: { 'Cache-Control': 'no-store' } });
}
