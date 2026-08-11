import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { DocumentRagApp } from '@/components/document-rag-app';
import { buildSageumMcpEndpoint } from '@/lib/auth/mcp-connection-guide';
import {
  listDocumentIngestionJobs,
  listFolders,
  listIndexedDocuments,
} from '@/lib/server/document-repository';
import { listOAuthConnections } from '@/lib/server/oauth-connections';
import { createClient } from '@/lib/supabase/server';

async function currentSiteUrl() {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredSiteUrl) return configuredSiteUrl;

  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http';
  return host ? `${protocol}://${host}` : 'http://localhost:3000';
}

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) redirect('/login');

  const [
    initialDocuments,
    initialFolders,
    initialIngestionJobs,
    initialOAuthConnections,
  ] = await Promise.all([
    listIndexedDocuments(supabase, claims.sub),
    listFolders(supabase, claims.sub),
    listDocumentIngestionJobs(supabase, claims.sub),
    listOAuthConnections(supabase, claims.sub),
  ]);
  const userEmail = typeof claims.email === 'string' ? claims.email : '로그인 사용자';
  const mcpEndpoint = buildSageumMcpEndpoint(await currentSiteUrl());
  return (
    <DocumentRagApp
      userEmail={userEmail}
      initialDocuments={initialDocuments}
      initialFolders={initialFolders}
      initialIngestionJobs={initialIngestionJobs}
      initialOAuthConnections={initialOAuthConnections.connections}
      initialOAuthConnectionsError={initialOAuthConnections.error}
      mcpEndpoint={mcpEndpoint}
    />
  );
}
