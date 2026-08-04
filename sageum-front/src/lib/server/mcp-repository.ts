import { createClient } from '@supabase/supabase-js';
import { descendantFolderIds } from '@/lib/folders/tree';
import { DOCUMENT_BUCKET } from '@/lib/documents/validation';
import { ORIGINAL_PREVIEW_URL_TTL_SECONDS } from '@/lib/documents/original-access';
import type { Database } from '@/lib/supabase/database.types';
import { findOwnedOriginalDocument } from './document-original';
import { getProviderConfiguration, requireServerEnvironment } from './env';
import { getQdrantVectorStore } from './qdrant-store';

export type McpRepositoryAccess = {
  ownerId: string;
  accessToken: string;
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

function scoreThreshold() {
  const value = Number.parseFloat(process.env.QDRANT_SCORE_THRESHOLD?.trim() ?? '0.2');
  return Number.isFinite(value) && value >= 0 ? value : 0.2;
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
  let documentIds = input.documentIds ?? [];

  if (input.folderId) {
    const [foldersResult, documentsResult] = await Promise.all([
      supabase
        .from('folders')
        .select('id,parent_id,name,sort_order,created_at,updated_at')
        .eq('owner_id', ownerId),
      supabase
        .from('documents')
        .select('id,folder_id')
        .eq('owner_id', ownerId)
        .eq('deletion_status', 'active'),
    ]);
    if (foldersResult.error || documentsResult.error) {
      throw new Error('폴더 검색 범위를 확인하지 못했습니다.');
    }
    const folders = foldersResult.data.map((folder) => ({
      id: folder.id,
      parentId: folder.parent_id,
      name: folder.name,
      sortOrder: folder.sort_order,
      createdAt: folder.created_at,
      updatedAt: folder.updated_at,
    }));
    if (!folders.some((folder) => folder.id === input.folderId)) {
      throw new Error('검색할 폴더를 찾을 수 없습니다.');
    }
    const folderIds = descendantFolderIds(folders, input.folderId);
    const scopedDocumentIds = documentsResult.data
      .filter((document) => document.folder_id && folderIds.has(document.folder_id))
      .map((document) => document.id);
    documentIds = documentIds.length
      ? documentIds.filter((documentId) => scopedDocumentIds.includes(documentId))
      : scopedDocumentIds;
    if (!documentIds.length) return [];
  }

  const vectorStore = getQdrantVectorStore();
  await vectorStore.ensureCollection(configuration.embedding.dimensions);
  const topK = Math.min(Math.max(input.topK ?? 6, 1), 20);
  const results = await vectorStore.query(input.query, ownerId, {
    limit: Math.min(topK * 2, 40),
    documentIds,
    scoreThreshold: scoreThreshold(),
    embeddingModel: configuration.embedding.model,
  });
  const resultDocumentIds = [...new Set(results.map((result) => result.documentId).filter(Boolean))];
  if (!resultDocumentIds.length) return [];

  const { data: activeDocuments, error } = await supabase
    .from('documents')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('deletion_status', 'active')
    .in('id', resultDocumentIds);
  if (error) throw new Error('활성 문서 상태를 확인하지 못했습니다.');
  const activeDocumentIds = new Set(activeDocuments.map((document) => document.id));

  return results
    .filter((result) => activeDocumentIds.has(result.documentId))
    .slice(0, topK)
    .map((result) => ({
      documentId: result.documentId,
      versionId: result.versionId,
      chunkId: result.chunkId,
      documentTitle: result.documentTitle || '문서',
      sourceType: result.sourceType,
      heading: result.headingPath.join(' › ') || '본문',
      content: result.text,
      score: result.score,
      page: result.page,
      sheet: result.sheet,
      cellRange: result.cellRange,
      imageIndex: result.imageIndex,
    }));
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
