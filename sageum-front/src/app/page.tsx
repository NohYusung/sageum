import { redirect } from 'next/navigation';
import { DocumentRagApp } from '@/components/document-rag-app';
import {
  listDocumentIngestionJobs,
  listFolders,
  listIndexedDocuments,
} from '@/lib/server/document-repository';
import { listOAuthConnections } from '@/lib/server/oauth-connections';
import { createClient } from '@/lib/supabase/server';

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
  return (
    <DocumentRagApp
      userEmail={userEmail}
      initialDocuments={initialDocuments}
      initialFolders={initialFolders}
      initialIngestionJobs={initialIngestionJobs}
      initialOAuthConnections={initialOAuthConnections.connections}
      initialOAuthConnectionsError={initialOAuthConnections.error}
    />
  );
}
