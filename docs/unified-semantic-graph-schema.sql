-- Sageum unified semantic graph for knowledge documents and individual rules.

create table if not exists public.knowledge_semantic_nodes (
  id uuid primary key,
  owner_id uuid not null,
  node_kind text not null,
  document_id uuid,
  rule_id uuid,
  version_id uuid not null,
  embedding_model text not null,
  content_hash text not null,
  indexed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_semantic_nodes_kind_check
    check (node_kind in ('document', 'rule')),
  constraint knowledge_semantic_nodes_reference_check
    check (
      (node_kind = 'document' and document_id is not null and rule_id is null)
      or (node_kind = 'rule' and document_id is null and rule_id is not null)
    ),
  constraint knowledge_semantic_nodes_document_owner_fkey
    foreign key (document_id, owner_id)
    references public.documents (id, owner_id)
    on delete cascade,
  constraint knowledge_semantic_nodes_rule_owner_fkey
    foreign key (rule_id, owner_id)
    references public.knowledge_rules (id, owner_id)
    on delete cascade,
  constraint knowledge_semantic_nodes_version_fkey
    foreign key (version_id)
    references public.document_versions (id)
    on delete cascade,
  constraint knowledge_semantic_nodes_id_owner_unique unique (id, owner_id)
);

create index if not exists knowledge_semantic_nodes_owner_kind_idx
  on public.knowledge_semantic_nodes (owner_id, node_kind, updated_at desc);
create index if not exists knowledge_semantic_nodes_document_owner_fkey_idx
  on public.knowledge_semantic_nodes (document_id, owner_id)
  where document_id is not null;
create index if not exists knowledge_semantic_nodes_rule_owner_fkey_idx
  on public.knowledge_semantic_nodes (rule_id, owner_id)
  where rule_id is not null;
create index if not exists knowledge_semantic_nodes_version_fkey_idx
  on public.knowledge_semantic_nodes (version_id);
create unique index if not exists knowledge_semantic_nodes_owner_document_unique
  on public.knowledge_semantic_nodes (owner_id, document_id)
  where document_id is not null;
create unique index if not exists knowledge_semantic_nodes_owner_rule_unique
  on public.knowledge_semantic_nodes (owner_id, rule_id)
  where rule_id is not null;

create table if not exists public.knowledge_semantic_links (
  id uuid primary key,
  owner_id uuid not null,
  left_node_id uuid not null,
  right_node_id uuid not null,
  semantic_score double precision not null,
  coverage_score double precision not null,
  matched_pair_count integer not null,
  embedding_model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_semantic_links_left_node_owner_fkey
    foreign key (left_node_id, owner_id)
    references public.knowledge_semantic_nodes (id, owner_id)
    on delete cascade,
  constraint knowledge_semantic_links_right_node_owner_fkey
    foreign key (right_node_id, owner_id)
    references public.knowledge_semantic_nodes (id, owner_id)
    on delete cascade,
  constraint knowledge_semantic_links_canonical_pair_check
    check (left_node_id::text < right_node_id::text),
  constraint knowledge_semantic_links_score_check
    check (semantic_score between 0 and 1),
  constraint knowledge_semantic_links_coverage_check
    check (coverage_score between 0 and 1),
  constraint knowledge_semantic_links_pair_count_check
    check (matched_pair_count between 1 and 3),
  constraint knowledge_semantic_links_owner_pair_unique
    unique (owner_id, left_node_id, right_node_id),
  constraint knowledge_semantic_links_id_owner_unique unique (id, owner_id)
);

create index if not exists knowledge_semantic_links_owner_left_idx
  on public.knowledge_semantic_links (owner_id, left_node_id, semantic_score desc);
create index if not exists knowledge_semantic_links_owner_right_idx
  on public.knowledge_semantic_links (owner_id, right_node_id, semantic_score desc);
create index if not exists knowledge_semantic_links_left_node_owner_fkey_idx
  on public.knowledge_semantic_links (left_node_id, owner_id);
create index if not exists knowledge_semantic_links_right_node_owner_fkey_idx
  on public.knowledge_semantic_links (right_node_id, owner_id);

create table if not exists public.knowledge_semantic_link_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  link_id uuid not null,
  left_chunk_id text not null,
  right_chunk_id text not null,
  pair_score double precision not null,
  ordinal integer not null,
  created_at timestamptz not null default now(),
  constraint knowledge_semantic_link_evidence_link_owner_fkey
    foreign key (link_id, owner_id)
    references public.knowledge_semantic_links (id, owner_id)
    on delete cascade,
  constraint knowledge_semantic_link_evidence_left_chunk_fkey
    foreign key (left_chunk_id)
    references public.document_chunks (id)
    on delete cascade,
  constraint knowledge_semantic_link_evidence_right_chunk_fkey
    foreign key (right_chunk_id)
    references public.document_chunks (id)
    on delete cascade,
  constraint knowledge_semantic_link_evidence_pair_score_check
    check (pair_score between 0 and 1),
  constraint knowledge_semantic_link_evidence_ordinal_check
    check (ordinal between 0 and 2),
  constraint knowledge_semantic_link_evidence_link_ordinal_unique
    unique (link_id, ordinal)
);

create index if not exists knowledge_semantic_link_evidence_owner_link_idx
  on public.knowledge_semantic_link_evidence (owner_id, link_id, ordinal);
create index if not exists knowledge_semantic_link_evidence_link_owner_fkey_idx
  on public.knowledge_semantic_link_evidence (link_id, owner_id);
create index if not exists knowledge_semantic_link_evidence_left_chunk_fkey_idx
  on public.knowledge_semantic_link_evidence (left_chunk_id);
create index if not exists knowledge_semantic_link_evidence_right_chunk_fkey_idx
  on public.knowledge_semantic_link_evidence (right_chunk_id);

alter table public.knowledge_semantic_nodes enable row level security;
alter table public.knowledge_semantic_links enable row level security;
alter table public.knowledge_semantic_link_evidence enable row level security;

drop policy if exists knowledge_semantic_nodes_select_own on public.knowledge_semantic_nodes;
create policy knowledge_semantic_nodes_select_own
  on public.knowledge_semantic_nodes for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists knowledge_semantic_links_select_own on public.knowledge_semantic_links;
create policy knowledge_semantic_links_select_own
  on public.knowledge_semantic_links for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists knowledge_semantic_link_evidence_select_own
  on public.knowledge_semantic_link_evidence;
create policy knowledge_semantic_link_evidence_select_own
  on public.knowledge_semantic_link_evidence for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.knowledge_semantic_nodes from anon, authenticated;
revoke all on public.knowledge_semantic_links from anon, authenticated;
revoke all on public.knowledge_semantic_link_evidence from anon, authenticated;
grant select on public.knowledge_semantic_nodes to authenticated;
grant select on public.knowledge_semantic_links to authenticated;
grant select on public.knowledge_semantic_link_evidence to authenticated;
grant select, insert, update, delete on public.knowledge_semantic_nodes to service_role;
grant select, insert, update, delete on public.knowledge_semantic_links to service_role;
grant select, insert, update, delete on public.knowledge_semantic_link_evidence to service_role;

create or replace function public.replace_knowledge_semantic_node_graph(
  p_owner_id uuid,
  p_node jsonb,
  p_links jsonb,
  p_evidence jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_node_id uuid;
begin
  if jsonb_typeof(p_node) <> 'object'
    or jsonb_typeof(p_links) <> 'array'
    or jsonb_typeof(p_evidence) <> 'array'
  then
    raise exception 'node must be an object and links/evidence must be arrays'
      using errcode = '22023';
  end if;

  v_node_id := (p_node->>'id')::uuid;

  insert into public.knowledge_semantic_nodes (
    id, owner_id, node_kind, document_id, rule_id, version_id,
    embedding_model, content_hash, indexed_at, updated_at
  ) values (
    v_node_id,
    p_owner_id,
    p_node->>'node_kind',
    nullif(p_node->>'document_id', '')::uuid,
    nullif(p_node->>'rule_id', '')::uuid,
    (p_node->>'version_id')::uuid,
    p_node->>'embedding_model',
    p_node->>'content_hash',
    now(),
    now()
  )
  on conflict (id) do update
    set node_kind = excluded.node_kind,
        document_id = excluded.document_id,
        rule_id = excluded.rule_id,
        version_id = excluded.version_id,
        embedding_model = excluded.embedding_model,
        content_hash = excluded.content_hash,
        indexed_at = now(),
        updated_at = now()
    where public.knowledge_semantic_nodes.owner_id = p_owner_id;

  delete from public.knowledge_semantic_links
  where owner_id = p_owner_id
    and (left_node_id = v_node_id or right_node_id = v_node_id);

  insert into public.knowledge_semantic_links (
    id, owner_id, left_node_id, right_node_id, semantic_score,
    coverage_score, matched_pair_count, embedding_model
  )
  select
    link.id, p_owner_id, link.left_node_id, link.right_node_id,
    link.semantic_score, link.coverage_score, link.matched_pair_count,
    link.embedding_model
  from jsonb_to_recordset(p_links) as link(
    id uuid,
    left_node_id uuid,
    right_node_id uuid,
    semantic_score double precision,
    coverage_score double precision,
    matched_pair_count integer,
    embedding_model text
  )
  on conflict (owner_id, left_node_id, right_node_id) do update
    set semantic_score = excluded.semantic_score,
        coverage_score = excluded.coverage_score,
        matched_pair_count = excluded.matched_pair_count,
        embedding_model = excluded.embedding_model,
        updated_at = now();

  insert into public.knowledge_semantic_link_evidence (
    id, owner_id, link_id, left_chunk_id, right_chunk_id, pair_score, ordinal
  )
  select
    evidence.id, p_owner_id, evidence.link_id, evidence.left_chunk_id,
    evidence.right_chunk_id, evidence.pair_score, evidence.ordinal
  from jsonb_to_recordset(p_evidence) as evidence(
    id uuid,
    link_id uuid,
    left_chunk_id text,
    right_chunk_id text,
    pair_score double precision,
    ordinal integer
  )
  on conflict (link_id, ordinal) do update
    set left_chunk_id = excluded.left_chunk_id,
        right_chunk_id = excluded.right_chunk_id,
        pair_score = excluded.pair_score;
end;
$$;

revoke all on function public.replace_knowledge_semantic_node_graph(uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_knowledge_semantic_node_graph(uuid, jsonb, jsonb, jsonb)
  to service_role;
