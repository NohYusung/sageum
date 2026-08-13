-- Migrate directional subject/object relations to rule-vector semantic bindings.

alter table public.knowledge_rules
  add column if not exists evidence_start_offset integer,
  add column if not exists evidence_end_offset integer;

update public.knowledge_rules as rule
set evidence_start_offset = greatest(strpos(chunk.text, rule.evidence_quote) - 1, 0),
    evidence_end_offset = greatest(strpos(chunk.text, rule.evidence_quote) - 1, 0)
      + char_length(rule.evidence_quote)
from public.document_chunks as chunk
where chunk.id = rule.source_chunk_id
  and (rule.evidence_start_offset is null or rule.evidence_end_offset is null);

update public.knowledge_rules
set evidence_start_offset = 0,
    evidence_end_offset = greatest(char_length(evidence_quote), 1)
where evidence_start_offset is null or evidence_end_offset is null;

alter table public.knowledge_rules
  alter column evidence_start_offset set not null,
  alter column evidence_end_offset set not null,
  drop constraint if exists knowledge_rules_subject_length_check,
  drop constraint if exists knowledge_rules_predicate_length_check,
  drop constraint if exists knowledge_rules_object_length_check,
  drop constraint if exists knowledge_rules_relation_type_check,
  drop constraint if exists knowledge_rules_subject_offsets_check,
  drop constraint if exists knowledge_rules_object_offsets_check,
  drop column if exists subject,
  drop column if exists predicate,
  drop column if exists object,
  drop column if exists relation_type,
  drop column if exists subject_start_offset,
  drop column if exists subject_end_offset,
  drop column if exists object_start_offset,
  drop column if exists object_end_offset;

alter table public.knowledge_rules
  drop constraint if exists knowledge_rules_evidence_offsets_check;
alter table public.knowledge_rules
  add constraint knowledge_rules_evidence_offsets_check check (
    evidence_start_offset >= 0 and evidence_end_offset > evidence_start_offset
  );

alter table public.knowledge_rule_bindings
  add column if not exists chunk_text text;

update public.knowledge_rule_bindings as binding
set chunk_text = chunk.text
from public.document_chunks as chunk
where chunk.id = binding.chunk_id
  and binding.chunk_text is null;

delete from public.knowledge_rule_bindings as older
using public.knowledge_rule_bindings as newer
where older.rule_id = newer.rule_id
  and older.chunk_id = newer.chunk_id
  and (
    older.vector_score < newer.vector_score
    or (older.vector_score = newer.vector_score and older.id::text > newer.id::text)
  );

drop index if exists public.knowledge_rule_bindings_rule_role_idx;
drop index if exists public.knowledge_rule_bindings_owner_document_idx;

alter table public.knowledge_rule_bindings
  alter column chunk_text set not null,
  drop constraint if exists knowledge_rule_bindings_role_check,
  drop constraint if exists knowledge_rule_bindings_match_length_check,
  drop constraint if exists knowledge_rule_bindings_offsets_check,
  drop constraint if exists knowledge_rule_bindings_rule_role_chunk_unique,
  drop column if exists role,
  drop column if exists matched_text,
  drop column if exists start_offset,
  drop column if exists end_offset;

alter table public.knowledge_rule_bindings
  drop constraint if exists knowledge_rule_bindings_chunk_text_check,
  drop constraint if exists knowledge_rule_bindings_rule_chunk_unique;
alter table public.knowledge_rule_bindings
  add constraint knowledge_rule_bindings_chunk_text_check
    check (char_length(chunk_text) between 1 and 20000),
  add constraint knowledge_rule_bindings_rule_chunk_unique unique (rule_id, chunk_id);

create index if not exists knowledge_rule_bindings_rule_score_idx
  on public.knowledge_rule_bindings (rule_id, vector_score desc);
create index if not exists knowledge_rule_bindings_owner_document_idx
  on public.knowledge_rule_bindings (owner_id, document_id);

create or replace function public.replace_knowledge_rule_extraction(
  p_owner_id uuid,
  p_rule_document_id uuid,
  p_rule_version_id uuid,
  p_rules jsonb,
  p_bindings jsonb,
  p_warning text default null,
  p_source_mode text default 'upload',
  p_manual_content text default null,
  p_document_title text default null,
  p_document_source_type text default null,
  p_preserve_rule_enabled boolean default false
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_rules) <> 'array' or jsonb_typeof(p_bindings) <> 'array' then
    raise exception 'rules and bindings must be arrays' using errcode = '22023';
  end if;
  if p_source_mode not in ('upload', 'manual') then
    raise exception 'invalid rule source mode' using errcode = '22023';
  end if;
  if (
    (p_source_mode = 'upload' and p_manual_content is not null)
    or (p_source_mode = 'manual' and char_length(btrim(coalesce(p_manual_content, ''))) not between 1 and 2000)
  ) then
    raise exception 'invalid manual rule content' using errcode = '22023';
  end if;

  perform 1
  from public.documents as document
  join public.document_versions as version
    on version.id = p_rule_version_id
   and version.document_id = document.id
   and version.owner_id = document.owner_id
  where document.id = p_rule_document_id
    and document.owner_id = p_owner_id
    and document.document_kind = 'rule'
    and document.deletion_status = 'active';
  if not found then
    raise exception 'rule document not found' using errcode = 'P0002';
  end if;

  insert into public.rule_documents (
    document_id, owner_id, source_mode, manual_content, enabled, extraction_status,
    extraction_error, extraction_warning, extracted_at, updated_at
  ) values (
    p_rule_document_id, p_owner_id, p_source_mode, p_manual_content,
    true, 'processing', null, null, null, now()
  )
  on conflict (document_id) do update
    set source_mode = excluded.source_mode,
        manual_content = excluded.manual_content,
        extraction_status = 'processing',
        extraction_error = null,
        extraction_warning = null,
        updated_at = now();

  update public.documents
  set latest_version_id = p_rule_version_id,
      title = coalesce(nullif(btrim(p_document_title), ''), title),
      source_type = coalesce(nullif(btrim(p_document_source_type), ''), source_type),
      updated_at = now()
  where id = p_rule_document_id and owner_id = p_owner_id;

  delete from public.knowledge_rules
  where owner_id = p_owner_id and rule_document_id = p_rule_document_id;

  insert into public.knowledge_rules (
    id, owner_id, rule_document_id, rule_version_id, source_chunk_id, ordinal,
    statement, evidence_quote, evidence_start_offset, evidence_end_offset,
    confidence, enabled, extraction_model, extraction_version
  )
  select
    rule.id, p_owner_id, p_rule_document_id, p_rule_version_id, rule.source_chunk_id,
    rule.ordinal, rule.statement, rule.evidence_quote, rule.evidence_start_offset,
    rule.evidence_end_offset, rule.confidence,
    case when p_preserve_rule_enabled then coalesce(rule.enabled, true) else true end,
    rule.extraction_model, rule.extraction_version
  from jsonb_to_recordset(p_rules) as rule(
    id uuid,
    source_chunk_id text,
    ordinal integer,
    statement text,
    evidence_quote text,
    evidence_start_offset integer,
    evidence_end_offset integer,
    confidence double precision,
    enabled boolean,
    extraction_model text,
    extraction_version text
  );

  insert into public.knowledge_rule_bindings (
    id, rule_id, owner_id, document_id, version_id, chunk_id, chunk_text, vector_score
  )
  select
    binding.id, binding.rule_id, p_owner_id, binding.document_id,
    binding.version_id, binding.chunk_id, binding.chunk_text, binding.vector_score
  from jsonb_to_recordset(p_bindings) as binding(
    id uuid,
    rule_id uuid,
    document_id uuid,
    version_id uuid,
    chunk_id text,
    chunk_text text,
    vector_score double precision
  );

  update public.rule_documents
  set extraction_status = 'ready',
      extraction_error = null,
      extraction_warning = nullif(left(coalesce(p_warning, ''), 500), ''),
      extracted_at = now(),
      updated_at = now()
  where document_id = p_rule_document_id and owner_id = p_owner_id;
end;
$$;

revoke all on function public.replace_knowledge_rule_extraction(
  uuid, uuid, uuid, jsonb, jsonb, text, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.replace_knowledge_rule_extraction(
  uuid, uuid, uuid, jsonb, jsonb, text, text, text, text, text, boolean
) to service_role;
