-- Sageum business-rule documents, semantic vector bindings, and relation graph storage.

alter table public.documents
  add column if not exists document_kind text not null default 'knowledge';

-- The application upload validator already enforces the 50 MiB product limit.
alter table public.document_versions
  drop constraint if exists document_versions_size_check;
alter table public.document_versions
  add constraint document_versions_size_check
  check (size_bytes between 0 and 52428800);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_document_kind_check'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_document_kind_check
      check (document_kind in ('knowledge', 'rule'));
  end if;
end
$$;

create index if not exists documents_owner_kind_active_idx
  on public.documents (owner_id, document_kind, updated_at desc)
  where deletion_status = 'active';

alter table public.document_ingestion_jobs
  add column if not exists document_kind text not null default 'knowledge';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'document_ingestion_jobs_document_kind_check'
      and conrelid = 'public.document_ingestion_jobs'::regclass
  ) then
    alter table public.document_ingestion_jobs
      add constraint document_ingestion_jobs_document_kind_check
      check (document_kind in ('knowledge', 'rule'));
  end if;
end
$$;

create index if not exists document_ingestion_jobs_owner_kind_created_idx
  on public.document_ingestion_jobs (owner_id, document_kind, created_at desc);

create table if not exists public.rule_documents (
  document_id uuid primary key,
  owner_id uuid not null,
  source_mode text not null default 'upload',
  manual_content text,
  enabled boolean not null default true,
  extraction_status text not null default 'processing',
  extraction_error text,
  extraction_warning text,
  extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rule_documents_document_owner_fkey
    foreign key (document_id, owner_id)
    references public.documents (id, owner_id)
    on delete cascade,
  constraint rule_documents_source_mode_check
    check (source_mode in ('upload', 'manual')),
  constraint rule_documents_manual_content_check
    check (
      (source_mode = 'upload' and manual_content is null)
      or (source_mode = 'manual' and char_length(btrim(manual_content)) between 1 and 2000)
    ),
  constraint rule_documents_extraction_status_check
    check (extraction_status in ('processing', 'ready', 'failed')),
  constraint rule_documents_error_length_check
    check (extraction_error is null or char_length(extraction_error) <= 500),
  constraint rule_documents_warning_length_check
    check (extraction_warning is null or char_length(extraction_warning) <= 500),
  constraint rule_documents_id_owner_unique unique (document_id, owner_id)
);

alter table public.rule_documents
  add column if not exists source_mode text not null default 'upload',
  add column if not exists manual_content text;

alter table public.rule_documents
  drop constraint if exists rule_documents_source_mode_check,
  drop constraint if exists rule_documents_manual_content_check;
alter table public.rule_documents
  add constraint rule_documents_source_mode_check
    check (source_mode in ('upload', 'manual')),
  add constraint rule_documents_manual_content_check
    check (
      (source_mode = 'upload' and manual_content is null)
      or (source_mode = 'manual' and char_length(btrim(manual_content)) between 1 and 2000)
    );

create index if not exists rule_documents_owner_status_idx
  on public.rule_documents (owner_id, extraction_status, updated_at desc);

create table if not exists public.knowledge_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  rule_document_id uuid not null,
  rule_version_id uuid not null,
  source_chunk_id text not null,
  ordinal integer not null,
  statement text not null,
  evidence_quote text not null,
  evidence_start_offset integer not null,
  evidence_end_offset integer not null,
  confidence double precision not null,
  enabled boolean not null default true,
  extraction_model text not null,
  extraction_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_rules_rule_document_owner_fkey
    foreign key (rule_document_id, owner_id)
    references public.rule_documents (document_id, owner_id)
    on delete cascade,
  constraint knowledge_rules_rule_version_document_owner_fkey
    foreign key (rule_version_id, rule_document_id, owner_id)
    references public.document_versions (id, document_id, owner_id)
    on delete cascade,
  constraint knowledge_rules_source_chunk_fkey
    foreign key (source_chunk_id)
    references public.document_chunks (id)
    on delete cascade,
  constraint knowledge_rules_ordinal_check check (ordinal >= 0),
  constraint knowledge_rules_statement_length_check check (char_length(statement) between 1 and 2000),
  constraint knowledge_rules_evidence_length_check check (char_length(evidence_quote) between 1 and 4000),
  constraint knowledge_rules_evidence_offsets_check check (
    evidence_start_offset >= 0 and evidence_end_offset > evidence_start_offset
  ),
  constraint knowledge_rules_confidence_check check (confidence between 0 and 1),
  constraint knowledge_rules_document_ordinal_unique
    unique (rule_version_id, ordinal),
  constraint knowledge_rules_id_owner_unique unique (id, owner_id)
);

create index if not exists knowledge_rules_owner_enabled_idx
  on public.knowledge_rules (owner_id, updated_at desc)
  where enabled = true;
create index if not exists knowledge_rules_rule_document_idx
  on public.knowledge_rules (rule_document_id, ordinal);
create index if not exists knowledge_rules_rule_document_owner_fkey_idx
  on public.knowledge_rules (rule_document_id, owner_id);
create index if not exists knowledge_rules_rule_version_document_owner_fkey_idx
  on public.knowledge_rules (rule_version_id, rule_document_id, owner_id);
create index if not exists knowledge_rules_source_chunk_idx
  on public.knowledge_rules (source_chunk_id);

create table if not exists public.knowledge_rule_bindings (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null,
  owner_id uuid not null,
  document_id uuid not null,
  version_id uuid not null,
  chunk_id text not null,
  chunk_text text not null,
  vector_score double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_rule_bindings_rule_owner_fkey
    foreign key (rule_id, owner_id)
    references public.knowledge_rules (id, owner_id)
    on delete cascade,
  constraint knowledge_rule_bindings_version_document_owner_fkey
    foreign key (version_id, document_id, owner_id)
    references public.document_versions (id, document_id, owner_id)
    on delete cascade,
  constraint knowledge_rule_bindings_chunk_fkey
    foreign key (chunk_id)
    references public.document_chunks (id)
    on delete cascade,
  constraint knowledge_rule_bindings_chunk_text_check check (char_length(chunk_text) between 1 and 20000),
  constraint knowledge_rule_bindings_score_check check (vector_score between 0 and 1),
  constraint knowledge_rule_bindings_rule_chunk_unique unique (rule_id, chunk_id)
);

create index if not exists knowledge_rule_bindings_rule_score_idx
  on public.knowledge_rule_bindings (rule_id, vector_score desc);
create index if not exists knowledge_rule_bindings_rule_owner_fkey_idx
  on public.knowledge_rule_bindings (rule_id, owner_id);
create index if not exists knowledge_rule_bindings_version_document_owner_fkey_idx
  on public.knowledge_rule_bindings (version_id, document_id, owner_id);
create index if not exists knowledge_rule_bindings_owner_document_idx
  on public.knowledge_rule_bindings (owner_id, document_id);
create index if not exists knowledge_rule_bindings_chunk_idx
  on public.knowledge_rule_bindings (chunk_id);

alter table public.rule_documents enable row level security;
alter table public.knowledge_rules enable row level security;
alter table public.knowledge_rule_bindings enable row level security;

drop policy if exists rule_documents_select_own on public.rule_documents;
create policy rule_documents_select_own
  on public.rule_documents for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists knowledge_rules_select_own on public.knowledge_rules;
create policy knowledge_rules_select_own
  on public.knowledge_rules for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists knowledge_rule_bindings_select_own on public.knowledge_rule_bindings;
create policy knowledge_rule_bindings_select_own
  on public.knowledge_rule_bindings for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.rule_documents from anon, authenticated;
revoke all on public.knowledge_rules from anon, authenticated;
revoke all on public.knowledge_rule_bindings from anon, authenticated;
grant select on public.rule_documents to authenticated;
grant select on public.knowledge_rules to authenticated;
grant select on public.knowledge_rule_bindings to authenticated;
grant select, insert, update, delete on public.rule_documents to service_role;
grant select, insert, update, delete on public.knowledge_rules to service_role;
grant select, insert, update, delete on public.knowledge_rule_bindings to service_role;

drop function if exists public.replace_knowledge_rule_extraction(
  uuid, uuid, uuid, jsonb, jsonb, text
);

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
    document_id, owner_id, source_mode, manual_content, enabled, extraction_status, extraction_error,
    extraction_warning, extracted_at, updated_at
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
  where id = p_rule_document_id
    and owner_id = p_owner_id;

  delete from public.knowledge_rules
  where owner_id = p_owner_id
    and rule_document_id = p_rule_document_id;

  insert into public.knowledge_rules (
    id, owner_id, rule_document_id, rule_version_id, source_chunk_id, ordinal,
    statement, evidence_quote, evidence_start_offset, evidence_end_offset,
    confidence, enabled, extraction_model, extraction_version
  )
  select
    rule.id, p_owner_id, p_rule_document_id, p_rule_version_id, rule.source_chunk_id,
    rule.ordinal, rule.statement, rule.evidence_quote, rule.evidence_start_offset,
    rule.evidence_end_offset,
    rule.confidence,
    case
      when p_preserve_rule_enabled then coalesce(rule.enabled, true)
      else true
    end,
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
    id, rule_id, owner_id, document_id, version_id, chunk_id,
    chunk_text, vector_score
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
  where document_id = p_rule_document_id
    and owner_id = p_owner_id;
end;
$$;

revoke all on function public.replace_knowledge_rule_extraction(
  uuid, uuid, uuid, jsonb, jsonb, text, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.replace_knowledge_rule_extraction(
  uuid, uuid, uuid, jsonb, jsonb, text, text, text, text, text, boolean
) to service_role;
