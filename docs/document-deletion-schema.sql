-- Sageum document deletion outbox and transaction boundaries.
-- Apply to the Supabase project before deploying the matching application code.

alter table public.documents
  add column if not exists deletion_status text not null default 'active';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_deletion_status_check'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_deletion_status_check
      check (deletion_status in ('active', 'deleting'));
  end if;
end
$$;

create index if not exists documents_owner_deletion_status_idx
  on public.documents (owner_id, deletion_status);

create table if not exists public.document_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  owner_id uuid not null,
  storage_paths text[] not null default '{}'::text[],
  requires_vector_cleanup boolean not null default false,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_deletion_jobs_document_owner_key unique (document_id, owner_id),
  constraint document_deletion_jobs_document_owner_fkey
    foreign key (document_id, owner_id)
    references public.documents (id, owner_id)
    on delete cascade,
  constraint document_deletion_jobs_status_check
    check (status in ('pending', 'processing', 'failed')),
  constraint document_deletion_jobs_attempts_check
    check (attempts >= 0)
);

create index if not exists document_deletion_jobs_status_updated_idx
  on public.document_deletion_jobs (status, updated_at);

alter table public.document_deletion_jobs enable row level security;

drop policy if exists document_deletion_jobs_owner_access
  on public.document_deletion_jobs;
create policy document_deletion_jobs_owner_access
  on public.document_deletion_jobs
  for all
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

grant select, insert, update, delete
  on public.document_deletion_jobs
  to authenticated;

drop function if exists public.request_document_deletion(uuid);
create function public.request_document_deletion(p_document_id uuid)
returns table (
  job_id uuid,
  storage_paths text[],
  requires_vector_cleanup boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_job_id uuid;
  v_storage_paths text[];
  v_requires_vector_cleanup boolean;
begin
  if v_owner_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  update public.documents
  set deletion_status = 'deleting',
      updated_at = now()
  where id = p_document_id
    and owner_id = v_owner_id;

  if not found then
    raise exception 'document not found' using errcode = 'P0002';
  end if;

  select
    coalesce(array_agg(v.storage_path order by v.created_at), '{}'::text[]),
    coalesce(bool_or(v.metadata ->> 'vectorIndexed' = 'true'), false)
  into v_storage_paths, v_requires_vector_cleanup
  from public.document_versions as v
  where v.document_id = p_document_id
    and v.owner_id = v_owner_id;

  insert into public.document_deletion_jobs as j (
    document_id,
    owner_id,
    storage_paths,
    requires_vector_cleanup,
    status,
    attempts,
    last_error,
    updated_at
  ) values (
    p_document_id,
    v_owner_id,
    v_storage_paths,
    v_requires_vector_cleanup,
    'processing',
    1,
    null,
    now()
  )
  on conflict (document_id, owner_id) do update
  set storage_paths = excluded.storage_paths,
      requires_vector_cleanup = excluded.requires_vector_cleanup,
      status = 'processing',
      attempts = j.attempts + 1,
      last_error = null,
      updated_at = now()
  returning j.id into v_job_id;

  return query
    select v_job_id, v_storage_paths, v_requires_vector_cleanup;
end
$$;

create or replace function public.complete_document_deletion(
  p_document_id uuid,
  p_job_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_deleted_id uuid;
begin
  if v_owner_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  delete from public.documents as d
  where d.id = p_document_id
    and d.owner_id = v_owner_id
    and d.deletion_status = 'deleting'
    and exists (
      select 1
      from public.document_deletion_jobs as j
      where j.id = p_job_id
        and j.document_id = d.id
        and j.owner_id = d.owner_id
    )
  returning d.id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'deletion job not found' using errcode = 'P0002';
  end if;
end
$$;

revoke all on function public.request_document_deletion(uuid) from public;
revoke all on function public.complete_document_deletion(uuid, uuid) from public;
grant execute on function public.request_document_deletion(uuid) to authenticated;
grant execute on function public.complete_document_deletion(uuid, uuid) to authenticated;
