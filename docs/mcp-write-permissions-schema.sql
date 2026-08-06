-- Sageum application-level MCP upload permissions.
-- Supabase OAuth Server does not yet support custom scopes, so write access is
-- granted explicitly per owner and OAuth client_id inside Sageum.

create table if not exists public.mcp_repository_permissions (
  owner_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null,
  can_upload boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, client_id)
);

alter table public.mcp_repository_permissions enable row level security;

drop policy if exists mcp_repository_permissions_owner_select
  on public.mcp_repository_permissions;
create policy mcp_repository_permissions_owner_select
  on public.mcp_repository_permissions
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists mcp_repository_permissions_browser_insert
  on public.mcp_repository_permissions;
create policy mcp_repository_permissions_browser_insert
  on public.mcp_repository_permissions
  for insert
  to authenticated
  with check (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

drop policy if exists mcp_repository_permissions_browser_update
  on public.mcp_repository_permissions;
create policy mcp_repository_permissions_browser_update
  on public.mcp_repository_permissions
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

drop policy if exists mcp_repository_permissions_browser_delete
  on public.mcp_repository_permissions;
create policy mcp_repository_permissions_browser_delete
  on public.mcp_repository_permissions
  for delete
  to authenticated
  using (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

revoke all on table public.mcp_repository_permissions from anon;
revoke all on table public.mcp_repository_permissions from authenticated;
grant select, insert, update, delete on table public.mcp_repository_permissions to authenticated;
