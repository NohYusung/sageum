-- Sageum durable document ingestion history and retry claims.

create table if not exists public.document_ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid references public.documents (id) on delete set null,
  version_id uuid references public.document_versions (id) on delete set null,
  retry_of_job_id uuid references public.document_ingestion_jobs (id) on delete set null,
  folder_id uuid,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  status text not null default 'queued',
  stage text not null default 'queued',
  attempts integer not null default 1,
  original_available boolean not null default false,
  processing_token text,
  workflow_run_id text,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_ingestion_jobs_file_name_check
    check (char_length(file_name) between 1 and 1024),
  constraint document_ingestion_jobs_mime_type_check
    check (char_length(mime_type) between 1 and 255),
  constraint document_ingestion_jobs_size_bytes_check
    check (size_bytes between 0 and 10485760),
  constraint document_ingestion_jobs_status_check
    check (status in ('queued', 'uploading', 'processing', 'ready', 'failed')),
  constraint document_ingestion_jobs_stage_check
    check (stage in ('queued', 'uploading', 'parsing', 'ocr', 'chunking', 'indexing', 'ready', 'failed')),
  constraint document_ingestion_jobs_attempts_check
    check (attempts >= 1)
);

alter table public.document_ingestion_jobs
  add column if not exists processing_token text,
  add column if not exists workflow_run_id text;

create unique index if not exists document_ingestion_jobs_version_unique
  on public.document_ingestion_jobs (version_id)
  where version_id is not null;

create index if not exists document_ingestion_jobs_owner_created_idx
  on public.document_ingestion_jobs (owner_id, created_at desc);

create index if not exists document_ingestion_jobs_owner_status_idx
  on public.document_ingestion_jobs (owner_id, status, updated_at desc);

create index if not exists document_ingestion_jobs_document_idx
  on public.document_ingestion_jobs (document_id)
  where document_id is not null;

create index if not exists document_ingestion_jobs_retry_of_idx
  on public.document_ingestion_jobs (retry_of_job_id)
  where retry_of_job_id is not null;

alter table public.document_ingestion_jobs enable row level security;

drop policy if exists document_ingestion_jobs_owner_select
  on public.document_ingestion_jobs;
create policy document_ingestion_jobs_owner_select
  on public.document_ingestion_jobs
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists document_ingestion_jobs_owner_insert
  on public.document_ingestion_jobs;
create policy document_ingestion_jobs_owner_insert
  on public.document_ingestion_jobs
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists document_ingestion_jobs_owner_update
  on public.document_ingestion_jobs;
create policy document_ingestion_jobs_owner_update
  on public.document_ingestion_jobs
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

revoke all on table public.document_ingestion_jobs from anon;
revoke all on table public.document_ingestion_jobs from authenticated;
grant select, insert, update on table public.document_ingestion_jobs to authenticated;

insert into public.document_ingestion_jobs (
  owner_id,
  document_id,
  version_id,
  folder_id,
  file_name,
  mime_type,
  size_bytes,
  status,
  stage,
  attempts,
  original_available,
  last_error,
  started_at,
  completed_at,
  created_at,
  updated_at
)
select
  v.owner_id,
  v.document_id,
  v.id,
  d.folder_id,
  v.original_filename,
  v.mime_type,
  v.size_bytes,
  case
    when v.status = 'ready' then 'ready'
    when v.status = 'failed' then 'failed'
    when v.status = 'uploaded' then 'uploading'
    else 'processing'
  end,
  case
    when v.status = 'uploaded' then 'uploading'
    else v.status
  end,
  1,
  exists (
    select 1
    from storage.objects as o
    where o.bucket_id = 'documents'
      and o.name = v.storage_path
  ),
  v.error_message,
  case
    when v.metadata ->> 'processingStartedAt' is not null
      then (v.metadata ->> 'processingStartedAt')::timestamptz
    else null
  end,
  case
    when v.status = 'ready' and v.metadata ->> 'processedAt' is not null
      then (v.metadata ->> 'processedAt')::timestamptz
    when v.status = 'failed' then v.created_at
    else null
  end,
  v.created_at,
  coalesce(d.updated_at, v.created_at)
from public.document_versions as v
join public.documents as d
  on d.id = v.document_id
 and d.owner_id = v.owner_id
on conflict (version_id) where version_id is not null do nothing;

drop function if exists public.claim_document_ingestion_processing(uuid, uuid, uuid);
create function public.claim_document_ingestion_processing(
  p_job_id uuid,
  p_document_id uuid,
  p_version_id uuid
)
returns table (
  job_id uuid,
  document_id uuid,
  version_id uuid,
  attempts integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
begin
  if v_owner_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  return query
    update public.document_ingestion_jobs as j
    set status = 'processing',
        stage = 'parsing',
        attempts = case when j.status = 'failed' then j.attempts + 1 else j.attempts end,
        last_error = null,
        started_at = now(),
        completed_at = null,
        updated_at = now()
    where j.id = p_job_id
      and j.owner_id = v_owner_id
      and j.document_id = p_document_id
      and j.version_id = p_version_id
      and (
        j.status = 'uploading'
        or (j.status = 'failed' and j.original_available)
      )
    returning j.id, j.document_id, j.version_id, j.attempts;

  if not found then
    raise exception 'ingestion job cannot be processed' using errcode = 'P0001';
  end if;
end
$$;

drop function if exists public.claim_document_ingestion_reupload(uuid);
create function public.claim_document_ingestion_reupload(p_job_id uuid)
returns table (
  job_id uuid,
  document_id uuid,
  version_id uuid,
  attempts integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
begin
  if v_owner_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  return query
    update public.document_ingestion_jobs as j
    set status = 'uploading',
        stage = 'uploading',
        attempts = j.attempts + 1,
        last_error = null,
        started_at = now(),
        completed_at = null,
        updated_at = now()
    where j.id = p_job_id
      and j.owner_id = v_owner_id
      and j.status = 'failed'
      and not j.original_available
      and j.document_id is not null
      and j.version_id is not null
    returning j.id, j.document_id, j.version_id, j.attempts;

  if not found then
    raise exception 'ingestion job cannot be reuploaded' using errcode = 'P0001';
  end if;
end
$$;

revoke all on function public.claim_document_ingestion_processing(uuid, uuid, uuid) from public;
revoke all on function public.claim_document_ingestion_reupload(uuid) from public;
grant execute on function public.claim_document_ingestion_processing(uuid, uuid, uuid) to authenticated;
grant execute on function public.claim_document_ingestion_reupload(uuid) to authenticated;
