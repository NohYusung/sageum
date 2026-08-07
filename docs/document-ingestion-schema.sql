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
  cleanup_started_at timestamptz,
  cleanup_error text,
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
    check (size_bytes between 0 and 52428800),
  constraint document_ingestion_jobs_status_check
    check (status in ('queued', 'uploading', 'processing', 'ready', 'failed')),
  constraint document_ingestion_jobs_stage_check
    check (stage in ('queued', 'uploading', 'parsing', 'ocr', 'chunking', 'indexing', 'ready', 'failed')),
  constraint document_ingestion_jobs_attempts_check
    check (attempts >= 1)
);

alter table public.document_ingestion_jobs
  add column if not exists processing_token text,
  add column if not exists workflow_run_id text,
  add column if not exists cleanup_started_at timestamptz,
  add column if not exists cleanup_error text;

alter table public.document_ingestion_jobs
  drop constraint if exists document_ingestion_jobs_size_bytes_check;
alter table public.document_ingestion_jobs
  add constraint document_ingestion_jobs_size_bytes_check
  check (size_bytes between 0 and 52428800);

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
  with check (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

drop policy if exists document_ingestion_jobs_owner_update
  on public.document_ingestion_jobs;
create policy document_ingestion_jobs_owner_update
  on public.document_ingestion_jobs
  for update
  to authenticated
  using (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  )
  with check (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

drop policy if exists document_ingestion_jobs_failed_cleanup_delete
  on public.document_ingestion_jobs;
create policy document_ingestion_jobs_failed_cleanup_delete
  on public.document_ingestion_jobs
  for delete
  to authenticated
  using (
    (select auth.uid()) = owner_id
    and status = 'failed'
    and cleanup_started_at is not null
    and document_id is null
    and version_id is null
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

revoke all on table public.document_ingestion_jobs from anon;
revoke all on table public.document_ingestion_jobs from authenticated;
grant select, insert, update, delete on table public.document_ingestion_jobs to authenticated;

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
      and j.cleanup_started_at is null
      and exists (
        select 1
        from public.documents as d
        where d.id = j.document_id
          and d.owner_id = j.owner_id
          and d.deletion_status = 'active'
      )
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
      and j.cleanup_started_at is null
      and not j.original_available
      and j.document_id is not null
      and j.version_id is not null
      and exists (
        select 1
        from public.documents as d
        where d.id = j.document_id
          and d.owner_id = j.owner_id
          and d.deletion_status = 'active'
      )
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

drop function if exists public.request_failed_ingestion_cleanup(uuid);
create function public.request_failed_ingestion_cleanup(p_job_id uuid)
returns table (
  ingestion_job_id uuid,
  document_id uuid,
  deletion_job_id uuid,
  storage_paths text[],
  requires_vector_cleanup boolean,
  cleanup_completed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_job public.document_ingestion_jobs%rowtype;
  v_document_id uuid;
  v_deletion_job_id uuid;
  v_storage_paths text[];
  v_requires_vector_cleanup boolean;
begin
  if v_owner_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select j.*
  into v_job
  from public.document_ingestion_jobs as j
  where j.id = p_job_id
    and j.owner_id = v_owner_id
    and j.status = 'failed'
  for update;

  if not found then
    raise exception 'failed ingestion job not found' using errcode = 'P0002';
  end if;

  if v_job.cleanup_started_at is not null
     and v_job.cleanup_error is null
     and v_job.cleanup_started_at > now() - interval '5 minutes' then
    raise exception 'failed ingestion cleanup is already running' using errcode = 'P0001';
  end if;

  update public.document_ingestion_jobs as j
  set cleanup_started_at = now(),
      cleanup_error = null,
      updated_at = now()
  where j.id = p_job_id
    and j.owner_id = v_owner_id
    and j.status = 'failed';

  if v_job.document_id is null then
    delete from public.document_ingestion_jobs as j
    where j.id = p_job_id
      and j.owner_id = v_owner_id
      and j.status = 'failed'
      and j.document_id is null
      and j.version_id is null;

    if not found then
      raise exception 'failed ingestion job still owns database resources' using errcode = 'P0001';
    end if;

    return query
      select p_job_id, null::uuid, null::uuid, '{}'::text[], false, true;
    return;
  end if;

  update public.documents as d
  set deletion_status = 'deleting',
      updated_at = now()
  where d.id = v_job.document_id
    and d.owner_id = v_owner_id
    and not exists (
      select 1
      from public.document_versions as v
      where v.document_id = d.id
        and v.owner_id = d.owner_id
        and v.status = 'ready'
    )
    and not exists (
      select 1
      from public.document_ingestion_jobs as other_job
      where other_job.document_id = d.id
        and other_job.owner_id = d.owner_id
        and other_job.status = 'ready'
    )
  returning d.id into v_document_id;

  if v_document_id is null then
    raise exception 'document contains ready data or cannot be cleaned' using errcode = 'P0001';
  end if;

  select
    coalesce(array_agg(v.storage_path order by v.created_at), '{}'::text[]),
    coalesce(bool_or(v.metadata ->> 'vectorIndexed' = 'true'), false)
  into v_storage_paths, v_requires_vector_cleanup
  from public.document_versions as v
  where v.document_id = v_document_id
    and v.owner_id = v_owner_id;

  v_requires_vector_cleanup := v_requires_vector_cleanup
    or v_job.stage = 'indexing'
    or exists (
      select 1
      from public.document_chunks as c
      where c.document_id = v_document_id
        and c.owner_id = v_owner_id
    );

  insert into public.document_deletion_jobs as deletion_job (
    document_id,
    owner_id,
    storage_paths,
    requires_vector_cleanup,
    status,
    attempts,
    last_error,
    updated_at
  ) values (
    v_document_id,
    v_owner_id,
    v_storage_paths,
    v_requires_vector_cleanup,
    'processing',
    1,
    null,
    now()
  )
  on conflict on constraint document_deletion_jobs_document_owner_key do update
  set storage_paths = excluded.storage_paths,
      requires_vector_cleanup = excluded.requires_vector_cleanup,
      status = 'processing',
      attempts = deletion_job.attempts + 1,
      last_error = null,
      updated_at = now()
  returning deletion_job.id into v_deletion_job_id;

  return query
    select
      p_job_id,
      v_document_id,
      v_deletion_job_id,
      v_storage_paths,
      v_requires_vector_cleanup,
      false;
end
$$;

drop function if exists public.complete_failed_ingestion_cleanup(uuid, uuid, uuid);
create function public.complete_failed_ingestion_cleanup(
  p_ingestion_job_id uuid,
  p_document_id uuid,
  p_deletion_job_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_claimed_job_id uuid;
  v_deleted_document_id uuid;
  v_deleted_job_id uuid;
begin
  if v_owner_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select j.id
  into v_claimed_job_id
  from public.document_ingestion_jobs as j
  where j.id = p_ingestion_job_id
    and j.owner_id = v_owner_id
    and j.document_id = p_document_id
    and j.status = 'failed'
    and j.cleanup_started_at is not null
  for update;

  if v_claimed_job_id is null then
    raise exception 'failed ingestion cleanup claim not found' using errcode = 'P0002';
  end if;

  delete from public.documents as d
  where d.id = p_document_id
    and d.owner_id = v_owner_id
    and d.deletion_status = 'deleting'
    and exists (
      select 1
      from public.document_deletion_jobs as deletion_job
      where deletion_job.id = p_deletion_job_id
        and deletion_job.document_id = d.id
        and deletion_job.owner_id = d.owner_id
    )
  returning d.id into v_deleted_document_id;

  if v_deleted_document_id is null then
    raise exception 'document deletion job not found' using errcode = 'P0002';
  end if;

  delete from public.document_ingestion_jobs as j
  where j.id = p_ingestion_job_id
    and j.owner_id = v_owner_id
    and j.status = 'failed'
    and j.cleanup_started_at is not null
    and j.document_id is null
    and j.version_id is null
  returning j.id into v_deleted_job_id;

  if v_deleted_job_id is null then
    raise exception 'failed ingestion history was not removed' using errcode = 'P0002';
  end if;
end
$$;

drop function if exists public.mark_failed_ingestion_cleanup(uuid, uuid, text);
create function public.mark_failed_ingestion_cleanup(
  p_ingestion_job_id uuid,
  p_deletion_job_id uuid,
  p_message text
)
returns void
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

  update public.document_ingestion_jobs as j
  set cleanup_error = left(coalesce(nullif(trim(p_message), ''), 'failed ingestion cleanup failed'), 500),
      updated_at = now()
  where j.id = p_ingestion_job_id
    and j.owner_id = v_owner_id
    and j.status = 'failed'
    and j.cleanup_started_at is not null;

  if not found then
    raise exception 'failed ingestion cleanup claim not found' using errcode = 'P0002';
  end if;

  update public.document_deletion_jobs as deletion_job
  set status = 'failed',
      last_error = left(coalesce(nullif(trim(p_message), ''), 'failed ingestion cleanup failed'), 500),
      updated_at = now()
  where deletion_job.id = p_deletion_job_id
    and deletion_job.owner_id = v_owner_id;

  if not found then
    raise exception 'document deletion job not found' using errcode = 'P0002';
  end if;
end
$$;

revoke all on function public.request_failed_ingestion_cleanup(uuid) from public;
revoke all on function public.complete_failed_ingestion_cleanup(uuid, uuid, uuid) from public;
revoke all on function public.mark_failed_ingestion_cleanup(uuid, uuid, text) from public;
grant execute on function public.request_failed_ingestion_cleanup(uuid) to authenticated;
grant execute on function public.complete_failed_ingestion_cleanup(uuid, uuid, uuid) to authenticated;
grant execute on function public.mark_failed_ingestion_cleanup(uuid, uuid, text) to authenticated;
