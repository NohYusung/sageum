import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DOCUMENT_BUCKET, storageObjectName } from '@/lib/documents/validation';
import {
  manualRuleFilename,
  manualRuleTitle,
  normalizeManualRuleContent,
} from '@/lib/relations/manual-rule';
import type { ManualRuleMutationResponse } from '@/lib/relations/types';
import type { Database, Json } from '@/lib/supabase/database.types';
import { startDocumentIngestionWorkflow } from './document-ingestion-workflow';
import { getSupabaseAdminClient } from './supabase';

type AdminClient = SupabaseClient<Database>;

export class ManualRuleDocumentError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = 'ManualRuleDocumentError';
  }
}

export type ManualRuleArtifact = {
  content: string;
  title: string;
  filename: string;
  bytes: Uint8Array;
};

export function buildManualRuleArtifact(value: unknown): ManualRuleArtifact {
  const content = normalizeManualRuleContent(value);
  return {
    content,
    title: manualRuleTitle(content),
    filename: manualRuleFilename(content),
    bytes: new TextEncoder().encode(content),
  };
}

function versionMetadata(artifact: ManualRuleArtifact): Json {
  return {
    ruleSourceMode: 'manual',
    manualContent: artifact.content,
    manualTitle: artifact.title,
  };
}

async function markManualRuleUploadFailed(
  supabase: AdminClient,
  ownerId: string,
  documentId: string,
  versionId: string,
  jobId: string,
  message: string,
  revision: boolean,
) {
  const failedAt = new Date().toISOString();
  const updates: PromiseLike<unknown>[] = [
    supabase.from('document_versions').update({
      status: 'failed',
      error_message: message.slice(0, 500),
    }).eq('id', versionId).eq('owner_id', ownerId),
    supabase.from('document_ingestion_jobs').update({
      status: 'failed',
      stage: 'failed',
      last_error: message.slice(0, 500),
      completed_at: failedAt,
      updated_at: failedAt,
    }).eq('id', jobId).eq('owner_id', ownerId),
  ];
  if (!revision) {
    updates.push(supabase.from('rule_documents').update({
      extraction_status: 'failed',
      extraction_error: message.slice(0, 500),
      updated_at: failedAt,
    }).eq('document_id', documentId).eq('owner_id', ownerId));
  }
  await Promise.all(updates);
}

async function uploadAndStart(
  supabase: AdminClient,
  ownerId: string,
  documentId: string,
  versionId: string,
  jobId: string,
  storagePath: string,
  artifact: ManualRuleArtifact,
  revision: boolean,
): Promise<ManualRuleMutationResponse> {
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, artifact.bytes, {
      contentType: 'text/markdown',
      upsert: false,
    });
  if (uploadError) {
    await markManualRuleUploadFailed(
      supabase,
      ownerId,
      documentId,
      versionId,
      jobId,
      '직접 입력 규칙 원본을 저장하지 못했습니다.',
      revision,
    );
    throw new ManualRuleDocumentError('직접 입력 규칙 원본을 저장하지 못했습니다.', 502);
  }

  const { error: uploadReadyError } = await supabase
    .from('document_ingestion_jobs')
    .update({ original_available: true, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('owner_id', ownerId);
  if (uploadReadyError) {
    await markManualRuleUploadFailed(
      supabase,
      ownerId,
      documentId,
      versionId,
      jobId,
      '직접 입력 규칙 처리 상태를 갱신하지 못했습니다.',
      revision,
    );
    throw new ManualRuleDocumentError('직접 입력 규칙 처리 상태를 갱신하지 못했습니다.');
  }

  try {
    await startDocumentIngestionWorkflow({ ownerId, documentId, versionId, jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : '직접 입력 규칙 처리를 시작하지 못했습니다.';
    await markManualRuleUploadFailed(
      supabase,
      ownerId,
      documentId,
      versionId,
      jobId,
      message,
      revision,
    );
    throw new ManualRuleDocumentError(message);
  }

  return { documentId, versionId, jobId, status: 'processing' };
}

async function cleanupInitialization(
  supabase: AdminClient,
  ownerId: string,
  documentId: string,
  jobId: string,
) {
  await supabase.from('document_ingestion_jobs').delete().eq('id', jobId).eq('owner_id', ownerId);
  await supabase.from('documents').delete().eq('id', documentId).eq('owner_id', ownerId);
}

export async function createManualRuleDocument(ownerId: string, value: unknown) {
  const artifact = buildManualRuleArtifact(value);
  const supabase = getSupabaseAdminClient();
  const documentId = randomUUID();
  const versionId = randomUUID();
  const jobId = randomUUID();
  const storagePath = `${ownerId}/${documentId}/${versionId}/${storageObjectName(versionId, 'markdown')}`;

  try {
    const { error: documentError } = await supabase.from('documents').insert({
      id: documentId,
      owner_id: ownerId,
      document_kind: 'rule',
      folder_id: null,
      title: artifact.title,
      source_type: 'markdown',
    });
    if (documentError) throw new Error('직접 입력 규칙 문서를 만들지 못했습니다.');

    const { error: ruleDocumentError } = await supabase.from('rule_documents').insert({
      document_id: documentId,
      owner_id: ownerId,
      source_mode: 'manual',
      manual_content: artifact.content,
      extraction_status: 'processing',
    });
    if (ruleDocumentError) throw new Error('직접 입력 규칙 상태를 만들지 못했습니다.');

    const { error: versionError } = await supabase.from('document_versions').insert({
      id: versionId,
      document_id: documentId,
      owner_id: ownerId,
      storage_path: storagePath,
      original_filename: artifact.filename,
      mime_type: 'text/markdown',
      size_bytes: artifact.bytes.byteLength,
      status: 'uploaded',
      metadata: versionMetadata(artifact),
    });
    if (versionError) throw new Error('직접 입력 규칙 버전을 만들지 못했습니다.');

    const { error: jobError } = await supabase.from('document_ingestion_jobs').insert({
      id: jobId,
      owner_id: ownerId,
      document_id: documentId,
      version_id: versionId,
      document_kind: 'rule',
      folder_id: null,
      file_name: artifact.filename,
      mime_type: 'text/markdown',
      size_bytes: artifact.bytes.byteLength,
      status: 'uploading',
      stage: 'uploading',
      original_available: false,
      started_at: new Date().toISOString(),
    });
    if (jobError) throw new Error('직접 입력 규칙 처리 이력을 만들지 못했습니다.');
  } catch (error) {
    await cleanupInitialization(supabase, ownerId, documentId, jobId);
    throw new ManualRuleDocumentError(
      error instanceof Error ? error.message : '직접 입력 규칙을 만들지 못했습니다.',
    );
  }

  return uploadAndStart(
    supabase,
    ownerId,
    documentId,
    versionId,
    jobId,
    storagePath,
    artifact,
    false,
  );
}

export async function reviseManualRuleDocument(
  ownerId: string,
  documentId: string,
  value: unknown,
) {
  const artifact = buildManualRuleArtifact(value);
  const supabase = getSupabaseAdminClient();
  const [{ data: document, error: documentError }, { data: ruleDocument, error: ruleDocumentError }] = await Promise.all([
    supabase.from('documents').select('id,latest_version_id,deletion_status,document_kind')
      .eq('id', documentId).eq('owner_id', ownerId).maybeSingle(),
    supabase.from('rule_documents').select('document_id,source_mode')
      .eq('document_id', documentId).eq('owner_id', ownerId).maybeSingle(),
  ]);
  if (documentError || ruleDocumentError) {
    throw new ManualRuleDocumentError('직접 입력 규칙을 확인하지 못했습니다.');
  }
  if (!document || !ruleDocument) {
    throw new ManualRuleDocumentError('직접 입력 규칙을 찾을 수 없습니다.', 404);
  }
  if (document.document_kind !== 'rule' || ruleDocument.source_mode !== 'manual') {
    throw new ManualRuleDocumentError('직접 입력한 규칙만 수정할 수 있습니다.', 409);
  }
  if (document.deletion_status !== 'active') {
    throw new ManualRuleDocumentError('삭제 중인 규칙은 수정할 수 없습니다.', 409);
  }

  const { data: activeJobs, error: activeJobsError } = await supabase
    .from('document_ingestion_jobs')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('document_id', documentId)
    .in('status', ['queued', 'uploading', 'processing'])
    .limit(1);
  if (activeJobsError) throw new ManualRuleDocumentError('진행 중인 규칙 작업을 확인하지 못했습니다.');
  if (activeJobs.length) {
    throw new ManualRuleDocumentError('이미 이 규칙의 수정 작업이 진행 중입니다.', 409);
  }

  const versionId = randomUUID();
  const jobId = randomUUID();
  const storagePath = `${ownerId}/${documentId}/${versionId}/${storageObjectName(versionId, 'markdown')}`;
  try {
    const { error: versionError } = await supabase.from('document_versions').insert({
      id: versionId,
      document_id: documentId,
      owner_id: ownerId,
      storage_path: storagePath,
      original_filename: artifact.filename,
      mime_type: 'text/markdown',
      size_bytes: artifact.bytes.byteLength,
      status: 'uploaded',
      metadata: versionMetadata(artifact),
    });
    if (versionError) throw new Error('직접 입력 규칙 새 버전을 만들지 못했습니다.');

    const { error: jobError } = await supabase.from('document_ingestion_jobs').insert({
      id: jobId,
      owner_id: ownerId,
      document_id: documentId,
      version_id: versionId,
      document_kind: 'rule',
      folder_id: null,
      file_name: artifact.filename,
      mime_type: 'text/markdown',
      size_bytes: artifact.bytes.byteLength,
      status: 'uploading',
      stage: 'uploading',
      original_available: false,
      started_at: new Date().toISOString(),
    });
    if (jobError) throw new Error('직접 입력 규칙 수정 이력을 만들지 못했습니다.');
  } catch (error) {
    await supabase.from('document_ingestion_jobs').delete().eq('id', jobId).eq('owner_id', ownerId);
    await supabase.from('document_versions').delete().eq('id', versionId).eq('owner_id', ownerId);
    throw new ManualRuleDocumentError(
      error instanceof Error ? error.message : '직접 입력 규칙 수정 작업을 만들지 못했습니다.',
    );
  }

  return uploadAndStart(
    supabase,
    ownerId,
    documentId,
    versionId,
    jobId,
    storagePath,
    artifact,
    true,
  );
}
