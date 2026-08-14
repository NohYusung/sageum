-- Add precomputed rule-to-rule links and convert rule bindings into one anchor per document.

delete from public.knowledge_rule_bindings as older
using public.knowledge_rule_bindings as newer
where older.rule_id = newer.rule_id
  and older.document_id = newer.document_id
  and (
    older.vector_score < newer.vector_score
    or (older.vector_score = newer.vector_score and older.id::text > newer.id::text)
  );

alter table public.knowledge_rule_bindings
  drop constraint if exists knowledge_rule_bindings_rule_chunk_unique,
  drop constraint if exists knowledge_rule_bindings_rule_document_unique;
alter table public.knowledge_rule_bindings
  add constraint knowledge_rule_bindings_rule_document_unique
  unique (rule_id, document_id);

create table if not exists public.knowledge_rule_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  left_rule_id uuid not null,
  right_rule_id uuid not null,
  vector_score double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_rule_links_left_rule_owner_fkey
    foreign key (left_rule_id, owner_id)
    references public.knowledge_rules (id, owner_id)
    on delete cascade,
  constraint knowledge_rule_links_right_rule_owner_fkey
    foreign key (right_rule_id, owner_id)
    references public.knowledge_rules (id, owner_id)
    on delete cascade,
  constraint knowledge_rule_links_canonical_pair_check
    check (left_rule_id::text < right_rule_id::text),
  constraint knowledge_rule_links_score_check check (vector_score between 0 and 1),
  constraint knowledge_rule_links_owner_pair_unique
    unique (owner_id, left_rule_id, right_rule_id)
);

create index if not exists knowledge_rule_links_owner_left_idx
  on public.knowledge_rule_links (owner_id, left_rule_id, vector_score desc);
create index if not exists knowledge_rule_links_owner_right_idx
  on public.knowledge_rule_links (owner_id, right_rule_id, vector_score desc);
create index if not exists knowledge_rule_links_left_rule_owner_fkey_idx
  on public.knowledge_rule_links (left_rule_id, owner_id);
create index if not exists knowledge_rule_links_right_rule_owner_fkey_idx
  on public.knowledge_rule_links (right_rule_id, owner_id);

alter table public.knowledge_rule_links enable row level security;

drop policy if exists knowledge_rule_links_select_own on public.knowledge_rule_links;
create policy knowledge_rule_links_select_own
  on public.knowledge_rule_links for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.knowledge_rule_links from anon, authenticated;
grant select on public.knowledge_rule_links to authenticated;
grant select, insert, update, delete on public.knowledge_rule_links to service_role;

-- Replace the legacy "two directly bound documents" warning with the new
-- direct-or-one-hop path rule. This only touches rows carrying the old message,
-- so partial-extraction warnings remain intact.
update public.rule_documents as rule_document
set extraction_warning = case
      when exists (
        select 1
        from public.knowledge_rules as rule
        where rule.owner_id = rule_document.owner_id
          and rule.rule_document_id = rule_document.document_id
          and (
            exists (
              select 1
              from public.knowledge_rule_bindings as direct_binding
              where direct_binding.owner_id = rule.owner_id
                and direct_binding.rule_id = rule.id
            )
            or exists (
              select 1
              from public.knowledge_rule_links as rule_link
              join public.knowledge_rule_bindings as linked_binding
                on linked_binding.owner_id = rule_link.owner_id
               and linked_binding.rule_id = case
                 when rule_link.left_rule_id = rule.id then rule_link.right_rule_id
                 else rule_link.left_rule_id
               end
              where rule_link.owner_id = rule.owner_id
                and (rule_link.left_rule_id = rule.id or rule_link.right_rule_id = rule.id)
            )
          )
      ) then null
      else '현재 활용 가능한 규칙·문서 연결 경로가 없습니다'
    end,
    updated_at = now()
where rule_document.extraction_status = 'ready'
  and rule_document.extraction_warning = '현재 일반 문서에서 이 규칙과 유사한 문서를 2개 이상 찾지 못함';

drop function if exists public.replace_knowledge_rule_extraction(
  uuid, uuid, uuid, jsonb, jsonb, text, text, text, text, text, boolean
);

create or replace function public.replace_knowledge_rule_extraction(
  p_owner_id uuid,
  p_rule_document_id uuid,
  p_rule_version_id uuid,
  p_rules jsonb,
  p_bindings jsonb,
  p_links jsonb,
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
  if jsonb_typeof(p_rules) <> 'array'
    or jsonb_typeof(p_bindings) <> 'array'
    or jsonb_typeof(p_links) <> 'array'
  then
    raise exception 'rules, bindings, and links must be arrays' using errcode = '22023';
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

  insert into public.knowledge_rule_links (
    id, owner_id, left_rule_id, right_rule_id, vector_score
  )
  select
    link.id, p_owner_id, link.left_rule_id, link.right_rule_id, link.vector_score
  from jsonb_to_recordset(p_links) as link(
    id uuid,
    left_rule_id uuid,
    right_rule_id uuid,
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
  uuid, uuid, uuid, jsonb, jsonb, jsonb, text, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.replace_knowledge_rule_extraction(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, text, text, text, text, text, boolean
) to service_role;

create or replace function public.replace_owner_knowledge_rule_graph(
  p_owner_id uuid,
  p_bindings jsonb,
  p_links jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_bindings) <> 'array' or jsonb_typeof(p_links) <> 'array' then
    raise exception 'bindings and links must be arrays' using errcode = '22023';
  end if;

  delete from public.knowledge_rule_links where owner_id = p_owner_id;
  delete from public.knowledge_rule_bindings where owner_id = p_owner_id;

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

  insert into public.knowledge_rule_links (
    id, owner_id, left_rule_id, right_rule_id, vector_score
  )
  select
    link.id, p_owner_id, link.left_rule_id, link.right_rule_id, link.vector_score
  from jsonb_to_recordset(p_links) as link(
    id uuid,
    left_rule_id uuid,
    right_rule_id uuid,
    vector_score double precision
  );
end;
$$;

revoke all on function public.replace_owner_knowledge_rule_graph(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_owner_knowledge_rule_graph(uuid, jsonb, jsonb)
  to service_role;
