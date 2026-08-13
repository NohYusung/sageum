import { createClient } from '@supabase/supabase-js';
import { DOCUMENT_BUCKET } from '@/lib/documents/validation';
import { ORIGINAL_PREVIEW_URL_TTL_SECONDS } from '@/lib/documents/original-access';
import type { Database } from '@/lib/supabase/database.types';
import { findOwnedOriginalDocument } from './document-original';
import { createDocumentUpload } from './document-upload';
import { startDocumentIngestionWorkflow } from './document-ingestion-workflow';
import { getProviderConfiguration, requireServerEnvironment } from './env';
import { searchRelationAwareRepository } from './relation-aware-search';
import { getSupabaseAdminClient } from './supabase';

export type McpRepositoryAccess = {
  ownerId: string;
  accessToken: string;
  clientId: string;
  canUpload: boolean;
};

function getMcpSupabaseClient(accessToken: string) {
  return createClient<Database>(
    requireServerEnvironment('NEXT_PUBLIC_SUPABASE_URL'),
    requireServerEnvironment('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}

export type McpRepositorySearchInput = {
  query: string;
  folderId?: string;
  documentIds?: string[];
  topK?: number;
};

export async function searchMcpRepository(access: McpRepositoryAccess, input: McpRepositorySearchInput) {
  const { ownerId } = access;
  const configuration = getProviderConfiguration();
  if (!configuration.qdrant.configured || !configuration.embedding.configured) {
    throw new Error('Qdrant Cloud Inference 환경 설정이 필요합니다.');
  }
  const supabase = getMcpSupabaseClient(access.accessToken);
  const topK = Math.min(Math.max(input.topK ?? 6, 1), 20);
  return searchRelationAwareRepository({
    ownerId,
    supabase,
    query: input.query,
    folderId: input.folderId,
    documentIds: input.documentIds,
    topK,
  });
}

export async function listMcpFolders(access: McpRepositoryAccess) {
  const { data, error } = await getMcpSupabaseClient(access.accessToken)
    .from('folders')
    .select('id,parent_id,name,sort_order,created_at,updated_at')
    .eq('owner_id', access.ownerId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error('폴더 목록을 불러오지 못했습니다.');
  return data.map((folder) => ({
    id: folder.id,
    parentId: folder.parent_id,
    name: folder.name,
    sortOrder: folder.sort_order,
    createdAt: folder.created_at,
    updatedAt: folder.updated_at,
  }));
}

export async function listMcpDocuments(access: McpRepositoryAccess, folderId?: string) {
  let query = getMcpSupabaseClient(access.accessToken)
    .from('documents')
    .select('id,title,source_type,folder_id,latest_version_id,created_at,updated_at,deletion_status')
    .eq('owner_id', access.ownerId)
    .eq('deletion_status', 'active')
    .eq('document_kind', 'knowledge')
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true });
  query = folderId ? query.eq('folder_id', folderId) : query.is('folder_id', null);
  const { data, error } = await query;
  if (error) throw new Error('문서 목록을 불러오지 못했습니다.');
  return data.map((document) => ({
    id: document.id,
    title: document.title,
    sourceType: document.source_type,
    folderId: document.folder_id,
    latestVersionId: document.latest_version_id,
    createdAt: document.created_at,
    updatedAt: document.updated_at,
  }));
}

export async function getMcpDocument(access: McpRepositoryAccess, documentId: string) {
  const supabase = getMcpSupabaseClient(access.accessToken);
  const { ownerId } = access;
  const { data: document, error: documentError } = await supabase
    .from('documents')
    .select('id,title,source_type,folder_id,latest_version_id,created_at,updated_at,deletion_status')
    .eq('owner_id', ownerId)
    .eq('id', documentId)
    .eq('deletion_status', 'active')
    .maybeSingle();
  if (documentError) throw new Error('문서를 조회하지 못했습니다.');
  if (!document?.latest_version_id) return null;

  const [versionResult, chunksResult] = await Promise.all([
    supabase
      .from('document_versions')
      .select('id,original_filename,mime_type,size_bytes,status,metadata,created_at')
      .eq('owner_id', ownerId)
      .eq('id', document.latest_version_id)
      .maybeSingle(),
    supabase
      .from('document_chunks')
      .select('id,ordinal,heading_path,page,sheet,cell_range,word_count,metadata')
      .eq('owner_id', ownerId)
      .eq('version_id', document.latest_version_id)
      .order('ordinal', { ascending: true }),
  ]);
  if (versionResult.error || chunksResult.error) throw new Error('문서 구조를 조회하지 못했습니다.');
  if (!versionResult.data) return null;

  return {
    id: document.id,
    title: document.title,
    sourceType: document.source_type,
    folderId: document.folder_id,
    createdAt: document.created_at,
    updatedAt: document.updated_at,
    version: {
      id: versionResult.data.id,
      originalFilename: versionResult.data.original_filename,
      mimeType: versionResult.data.mime_type,
      sizeBytes: versionResult.data.size_bytes,
      status: versionResult.data.status,
      metadata: versionResult.data.metadata,
      createdAt: versionResult.data.created_at,
    },
    chunks: chunksResult.data.map((chunk) => ({
      id: chunk.id,
      ordinal: chunk.ordinal,
      headingPath: chunk.heading_path,
      page: chunk.page,
      sheet: chunk.sheet,
      cellRange: chunk.cell_range,
      wordCount: chunk.word_count,
      metadata: chunk.metadata,
    })),
  };
}

export async function getMcpChunk(access: McpRepositoryAccess, chunkId: string) {
  const { data, error } = await getMcpSupabaseClient(access.accessToken)
    .from('document_chunks')
    .select('id,document_id,version_id,ordinal,text,word_count,heading_path,page,sheet,cell_range,metadata')
    .eq('owner_id', access.ownerId)
    .eq('id', chunkId)
    .maybeSingle();
  if (error) throw new Error('문서 청크를 조회하지 못했습니다.');
  return data ? {
    id: data.id,
    documentId: data.document_id,
    versionId: data.version_id,
    ordinal: data.ordinal,
    content: data.text,
    wordCount: data.word_count,
    headingPath: data.heading_path,
    page: data.page,
    sheet: data.sheet,
    cellRange: data.cell_range,
    metadata: data.metadata,
  } : null;
}

export async function getMcpOriginalLink(access: McpRepositoryAccess, documentId: string) {
  const supabase = getMcpSupabaseClient(access.accessToken);
  const original = await findOwnedOriginalDocument(supabase, access.ownerId, documentId);
  if (!original) return null;
  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(original.storagePath, ORIGINAL_PREVIEW_URL_TTL_SECONDS);
  if (error || !data.signedUrl) throw new Error('원본 문서 링크를 생성하지 못했습니다.');
  return {
    documentId,
    title: original.title,
    filename: original.originalFilename,
    mimeType: original.mimeType,
    expiresInSeconds: ORIGINAL_PREVIEW_URL_TTL_SECONDS,
    url: data.signedUrl,
  };
}

function requireMcpUploadPermission(access: McpRepositoryAccess) {
  if (!access.canUpload) {
    throw new Error('이 MCP 클라이언트에는 문서 업로드 권한이 없습니다. Sageum의 에이전트 연결 관리에서 업로드 권한을 허용해 주세요.');
  }
}

export type McpCreateUploadInput = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  folderId?: string;
};

export async function createMcpDocumentUpload(
  access: McpRepositoryAccess,
  input: McpCreateUploadInput,
) {
  requireMcpUploadPermission(access);
  const upload = await createDocumentUpload(
    getSupabaseAdminClient(),
    access.ownerId,
    {
      ...input,
      folderId: input.folderId ?? null,
    },
  );
  return {
    documentId: upload.documentId,
    versionId: upload.versionId,
    jobId: upload.jobId,
    method: 'PUT',
    uploadUrl: upload.signedUploadUrl,
    contentType: upload.mimeType,
    expiresInSeconds: 7_200,
    next: '원본 바이트를 uploadUrl에 PUT한 뒤 complete_upload를 호출하세요.',
  };
}

export async function completeMcpDocumentUpload(
  access: McpRepositoryAccess,
  input: { documentId: string; versionId: string; jobId: string },
) {
  requireMcpUploadPermission(access);
  return startDocumentIngestionWorkflow({ ownerId: access.ownerId, ...input });
}

export async function getMcpIngestionStatus(access: McpRepositoryAccess, jobId: string) {
  const { data, error } = await getMcpSupabaseClient(access.accessToken)
    .from('document_ingestion_jobs')
    .select('id,document_id,version_id,file_name,mime_type,size_bytes,status,stage,attempts,original_available,last_error,started_at,completed_at,created_at,updated_at,workflow_run_id')
    .eq('id', jobId)
    .eq('owner_id', access.ownerId)
    .maybeSingle();
  if (error) throw new Error('문서 처리 상태를 조회하지 못했습니다.');
  if (!data) return null;
  return {
    jobId: data.id,
    documentId: data.document_id,
    versionId: data.version_id,
    fileName: data.file_name,
    mimeType: data.mime_type,
    sizeBytes: data.size_bytes,
    status: data.status,
    stage: data.stage,
    attempts: data.attempts,
    originalAvailable: data.original_available,
    lastError: data.last_error,
    workflowRunId: data.workflow_run_id,
    startedAt: data.started_at,
    completedAt: data.completed_at,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}
