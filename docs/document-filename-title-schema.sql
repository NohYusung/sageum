-- Keep uploaded document titles identical to the latest original filename.
-- Directly entered business rules retain their generated title and filename.

create or replace function public.rename_document(
  p_document_id uuid,
  p_original_filename text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_document public.documents%rowtype;
  v_version public.document_versions%rowtype;
  v_filename text := btrim(p_original_filename);
  v_current_extension text;
  v_new_extension text;
begin
  if v_owner_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if coalesce((select auth.jwt()) ->> 'client_id', '') <> '' then
    raise exception 'browser session required' using errcode = '42501';
  end if;
  if v_filename = '' or char_length(v_filename) > 1024 then
    raise exception 'filename must contain 1 to 1024 characters' using errcode = '22023';
  end if;
  if v_filename in ('.', '..')
    or position('/' in v_filename) > 0
    or position(chr(92) in v_filename) > 0
    or v_filename ~ '[[:cntrl:]]' then
    raise exception 'filename contains an invalid path or control character' using errcode = '22023';
  end if;

  select document.*
  into v_document
  from public.documents as document
  where document.id = p_document_id
    and document.owner_id = v_owner_id
    and document.deletion_status = 'active'
  for update;
  if not found or v_document.latest_version_id is null then
    raise exception 'document not found' using errcode = 'P0002';
  end if;

  if v_document.document_kind = 'rule' and exists (
    select 1
    from public.rule_documents as rule_document
    where rule_document.document_id = v_document.id
      and rule_document.owner_id = v_owner_id
      and rule_document.source_mode = 'manual'
  ) then
    raise exception 'manual rule documents must be edited through the rule editor' using errcode = '23514';
  end if;

  select version.*
  into v_version
  from public.document_versions as version
  where version.id = v_document.latest_version_id
    and version.document_id = v_document.id
    and version.owner_id = v_owner_id
  for update;
  if not found then
    raise exception 'latest document version not found' using errcode = 'P0002';
  end if;

  v_current_extension := substring(v_version.original_filename from '(\.[^.]*)$');
  v_new_extension := substring(v_filename from '(\.[^.]*)$');
  if v_current_extension is null
    or v_new_extension is distinct from v_current_extension
    or btrim(left(v_filename, -char_length(v_current_extension))) = '' then
    raise exception 'document extension cannot be changed' using errcode = '23514';
  end if;

  update public.document_versions
  set original_filename = v_filename
  where id = v_version.id
    and document_id = v_document.id
    and owner_id = v_owner_id;

  update public.documents
  set title = v_filename,
      updated_at = now()
  where id = v_document.id
    and owner_id = v_owner_id;
end
$$;

revoke all on function public.rename_document(uuid, text) from public, anon;
grant execute on function public.rename_document(uuid, text) to authenticated;

-- One-time normalization for existing uploaded documents.
update public.documents as document
set title = version.original_filename,
    updated_at = now()
from public.document_versions as version
left join public.rule_documents as rule_document
  on rule_document.document_id = version.document_id
 and rule_document.owner_id = version.owner_id
where document.latest_version_id = version.id
  and document.owner_id = version.owner_id
  and (
    document.document_kind = 'knowledge'
    or (
      document.document_kind = 'rule'
      and coalesce(rule_document.source_mode, 'upload') = 'upload'
    )
  )
  and document.title is distinct from version.original_filename;
