-- Keep Supabase OAuth tokens read-only at the Data API and Storage boundary.
-- MCP uploads are authorized by Sageum using owner_id + client_id, then executed
-- with the server-only Supabase secret. Ordinary browser sessions have no
-- client_id claim and keep the existing application write capabilities.

drop policy if exists documents_owner_access on public.documents;
drop policy if exists documents_owner_select on public.documents;
drop policy if exists documents_browser_insert on public.documents;
drop policy if exists documents_browser_update on public.documents;
drop policy if exists documents_browser_delete on public.documents;

create policy documents_owner_select
  on public.documents for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy documents_browser_insert
  on public.documents for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );
create policy documents_browser_update
  on public.documents for update to authenticated
  using (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  )
  with check (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );
create policy documents_browser_delete
  on public.documents for delete to authenticated
  using (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

drop policy if exists document_versions_owner_access on public.document_versions;
drop policy if exists document_versions_owner_select on public.document_versions;
drop policy if exists document_versions_browser_insert on public.document_versions;
drop policy if exists document_versions_browser_update on public.document_versions;
drop policy if exists document_versions_browser_delete on public.document_versions;

create policy document_versions_owner_select
  on public.document_versions for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy document_versions_browser_insert
  on public.document_versions for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );
create policy document_versions_browser_update
  on public.document_versions for update to authenticated
  using (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  )
  with check (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );
create policy document_versions_browser_delete
  on public.document_versions for delete to authenticated
  using (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

drop policy if exists document_chunks_owner_access on public.document_chunks;
drop policy if exists document_chunks_owner_select on public.document_chunks;
drop policy if exists document_chunks_browser_insert on public.document_chunks;
drop policy if exists document_chunks_browser_update on public.document_chunks;
drop policy if exists document_chunks_browser_delete on public.document_chunks;

create policy document_chunks_owner_select
  on public.document_chunks for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy document_chunks_browser_insert
  on public.document_chunks for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );
create policy document_chunks_browser_update
  on public.document_chunks for update to authenticated
  using (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  )
  with check (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );
create policy document_chunks_browser_delete
  on public.document_chunks for delete to authenticated
  using (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

drop policy if exists document_ingestion_jobs_owner_insert
  on public.document_ingestion_jobs;
create policy document_ingestion_jobs_owner_insert
  on public.document_ingestion_jobs for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

drop policy if exists document_ingestion_jobs_owner_update
  on public.document_ingestion_jobs;
create policy document_ingestion_jobs_owner_update
  on public.document_ingestion_jobs for update to authenticated
  using (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  )
  with check (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

drop policy if exists folders_insert_own on public.folders;
create policy folders_insert_own
  on public.folders for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

drop policy if exists folders_update_own on public.folders;
create policy folders_update_own
  on public.folders for update to authenticated
  using (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  )
  with check (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

drop policy if exists folders_delete_own on public.folders;
create policy folders_delete_own
  on public.folders for delete to authenticated
  using (
    (select auth.uid()) = owner_id
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

drop policy if exists documents_storage_insert_own on storage.objects;
create policy documents_storage_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

drop policy if exists documents_storage_update_own on storage.objects;
create policy documents_storage_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );

drop policy if exists documents_storage_delete_own on storage.objects;
create policy documents_storage_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and coalesce((select auth.jwt()) ->> 'client_id', '') = ''
  );
