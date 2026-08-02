import { getProviderConfiguration } from '@/lib/server/env';

export const dynamic = 'force-dynamic';

export function GET() {
  const providers = getProviderConfiguration();
  return Response.json({
    service: 'sageum-rag',
    status: 'ok',
    mode:
      providers.supabase.configured && providers.qdrant.configured && providers.embedding.configured
        ? 'cloud'
        : 'local-demo',
    providers,
  });
}
