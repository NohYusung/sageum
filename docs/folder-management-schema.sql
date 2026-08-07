-- Sageum virtual folder management
-- Storage objects remain at owner/document/version paths. Only logical relationships move.

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid,
  name text not null,
  sort_order bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint folders_name_length_check check (char_length(name) between 1 and 200),
  constraint folders_name_trimmed_check check (name = btrim(name)),
  constraint folders_name_separator_check check (position('/' in name) = 0),
  constraint folders_id_owner_unique unique (id, owner_id),
  constraint folders_parent_owner_fkey
    foreign key (parent_id, owner_id)
    references public.folders(id, owner_id)
    on delete restrict
);

create unique index if not exists folders_root_name_unique
  on public.folders (owner_id, lower(name))
  where parent_id is null;

create unique index if not exists folders_child_name_unique
  on public.folders (owner_id, parent_id, lower(name))
  where parent_id is not null;

create index if not exists folders_owner_parent_sort_idx
  on public.folders (owner_id, parent_id, sort_order, lower(name));

create index if not exists folders_parent_owner_fkey_idx
  on public.folders (parent_id, owner_id);

alter table public.documents
  add column if not exists folder_id uuid,
  add column if not exists sort_order bigint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_folder_owner_fkey'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_folder_owner_fkey
      foreign key (folder_id, owner_id)
      references public.folders(id, owner_id)
      on delete restrict;
  end if;
end
$$;

create index if not exists documents_owner_folder_sort_idx
  on public.documents (owner_id, folder_id, sort_order, updated_at desc);

create index if not exists documents_folder_owner_fkey_idx
  on public.documents (folder_id, owner_id);

alter table public.folders enable row level security;

drop policy if exists "folders_select_own" on public.folders;
create policy "folders_select_own"
  on public.folders
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "folders_insert_own" on public.folders;
create policy "folders_insert_own"
  on public.folders
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "folders_update_own" on public.folders;
create policy "folders_update_own"
  on public.folders
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "folders_delete_own" on public.folders;
create policy "folders_delete_own"
  on public.folders
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.folders from anon;
grant select, insert, update, delete on public.folders to authenticated;

create or replace function public.move_folder(
  p_folder_id uuid,
  p_parent_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
begin
  if v_owner_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  perform 1
  from public.folders as folder
  where folder.id = p_folder_id
    and folder.owner_id = v_owner_id;
  if not found then
    raise exception 'folder not found' using errcode = 'P0002';
  end if;

  if p_parent_id = p_folder_id then
    raise exception 'folder cannot contain itself' using errcode = '23514';
  end if;

  if p_parent_id is not null then
    perform 1
    from public.folders as parent
    where parent.id = p_parent_id
      and parent.owner_id = v_owner_id;
    if not found then
      raise exception 'parent folder not found' using errcode = 'P0002';
    end if;

    if exists (
      with recursive descendants as (
        select child.id
        from public.folders as child
        where child.parent_id = p_folder_id
          and child.owner_id = v_owner_id
        union all
        select child.id
        from public.folders as child
        join descendants on child.parent_id = descendants.id
        where child.owner_id = v_owner_id
      )
      select 1 from descendants where id = p_parent_id
    ) then
      raise exception 'folder cannot move below its descendant' using errcode = '23514';
    end if;
  end if;

  update public.folders
  set parent_id = p_parent_id,
      sort_order = 0,
      updated_at = now()
  where id = p_folder_id
    and owner_id = v_owner_id;
end
$$;

create or replace function public.move_document(
  p_document_id uuid,
  p_folder_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
begin
  if v_owner_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if p_folder_id is not null then
    perform 1
    from public.folders as folder
    where folder.id = p_folder_id
      and folder.owner_id = v_owner_id;
    if not found then
      raise exception 'folder not found' using errcode = 'P0002';
    end if;
  end if;

  update public.documents
  set folder_id = p_folder_id,
      sort_order = 0,
      updated_at = now()
  where id = p_document_id
    and owner_id = v_owner_id;

  if not found then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
end
$$;

revoke all on function public.move_folder(uuid, uuid) from public, anon;
revoke all on function public.move_document(uuid, uuid) from public, anon;
grant execute on function public.move_folder(uuid, uuid) to authenticated;
grant execute on function public.move_document(uuid, uuid) to authenticated;

drop function if exists public.delete_folder_trees(uuid[]);
create function public.delete_folder_trees(p_folder_ids uuid[])
returns uuid[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_target_ids uuid[];
  v_deleted_count integer;
  v_passes integer := 0;
begin
  if v_owner_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if coalesce(cardinality(p_folder_ids), 0) = 0 then
    return '{}'::uuid[];
  end if;

  if cardinality(p_folder_ids) > 1000 then
    raise exception 'too many folder roots' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_folder_ids) as requested(id)
    left join public.folders as folder
      on folder.id = requested.id
     and folder.owner_id = v_owner_id
    where folder.id is null
  ) then
    raise exception 'folder not found' using errcode = 'P0002';
  end if;

  with recursive targets(id) as (
    select folder.id
    from public.folders as folder
    where folder.owner_id = v_owner_id
      and folder.id = any(p_folder_ids)
    union
    select child.id
    from public.folders as child
    join targets as parent on child.parent_id = parent.id
    where child.owner_id = v_owner_id
  )
  select coalesce(array_agg(target.id order by target.id), '{}'::uuid[])
  into v_target_ids
  from targets as target;

  while exists (
    select 1
    from public.folders as folder
    where folder.owner_id = v_owner_id
      and folder.id = any(v_target_ids)
  ) loop
    delete from public.folders as folder
    where folder.owner_id = v_owner_id
      and folder.id = any(v_target_ids)
      and not exists (
        select 1
        from public.folders as child
        where child.parent_id = folder.id
          and child.owner_id = v_owner_id
      );

    get diagnostics v_deleted_count = row_count;
    if v_deleted_count = 0 then
      raise exception 'folder tree is not empty or cannot be deleted' using errcode = '23503';
    end if;

    v_passes := v_passes + 1;
    if v_passes > 1000 then
      raise exception 'folder tree exceeds maximum depth' using errcode = '54001';
    end if;
  end loop;

  return v_target_ids;
end
$$;

revoke all on function public.delete_folder_trees(uuid[]) from public, anon;
grant execute on function public.delete_folder_trees(uuid[]) to authenticated;
