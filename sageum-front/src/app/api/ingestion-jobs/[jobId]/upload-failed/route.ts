import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { jobId } = await params;
  if (!UUID_PATTERN.test(jobId)) {
    return Response.json({ error: '올바른 처리 작업 식별자가 필요합니다.' }, { status: 400 });
  }

  const { data: job, error: jobError } = await context.supabase
    .from('document_ingestion_jobs')
    .select('id,version_id,status')
    .eq('id', jobId)
    .eq('owner_id', context.ownerId)
    .maybeSingle();
  if (jobError) return Response.json({ error: '문서 처리 이력을 확인하지 못했습니다.' }, { status: 500 });
  if (!job?.version_id) return Response.json({ error: '문서 처리 이력을 찾을 수 없습니다.' }, { status: 404 });
  if (job.status !== 'uploading') return new Response(null, { status: 204 });

  const message = 'Supabase 원본 업로드에 실패했습니다.';
  const failedAt = new Date().toISOString();
  const [versionResult, jobResult] = await Promise.all([
    context.supabase
      .from('document_versions')
      .update({ status: 'failed', error_message: message })
      .eq('id', job.version_id)
      .eq('owner_id', context.ownerId),
    context.supabase
      .from('document_ingestion_jobs')
      .update({
        status: 'failed',
        stage: 'uploading',
        original_available: false,
        last_error: message,
        completed_at: failedAt,
        updated_at: failedAt,
      })
      .eq('id', jobId)
      .eq('owner_id', context.ownerId)
      .eq('status', 'uploading'),
  ]);
  if (versionResult.error || jobResult.error) {
    return Response.json({ error: '원본 업로드 실패 상태를 저장하지 못했습니다.' }, { status: 500 });
  }
  return new Response(null, { status: 204 });
}
