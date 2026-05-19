-- ============================================================================
-- 588_customer_voice_match_semantic.sql
-- Slice B: pgvector semantic customer matching for the voice capture pipeline.
--
-- Three deliverables:
--   1. Bump qrm_companies.updated_at when corpus fields change so the
--      embed-crm incremental fetch re-embeds the row.
--   2. Bump the parent qrm_companies.updated_at when any contact row attached
--      to that company changes — the rep-facing primary contact name is part
--      of the embedded corpus and contacts have no compound primary-key flag,
--      so we bump conservatively on any contact change.
--   3. New RPC match_customers_by_embedding(query, ws, k, min) that returns
--      cosine-ranked customer_ids the voice matcher consumes as a lane.
--
-- OPERATOR NOTE: After deploying this migration, re-trigger embed-crm with
-- {"entity_types": ["company"], "force_all": true} so existing companies are
-- re-embedded against the extended companySummary() template (DBA + aliases +
-- primary contact name). Without the backfill, only newly-touched companies
-- pick up the richer corpus.
-- ============================================================================

-- ── 1. Set updated_at on every qrm_companies / qrm_contacts write ─────────
-- Idempotent: drop-and-recreate so we own the trigger going forward.

drop trigger if exists set_qrm_companies_updated_at on public.qrm_companies;
create trigger set_qrm_companies_updated_at
  before update on public.qrm_companies
  for each row execute function public.set_updated_at();

drop trigger if exists set_qrm_contacts_updated_at on public.qrm_contacts;
create trigger set_qrm_contacts_updated_at
  before update on public.qrm_contacts
  for each row execute function public.set_updated_at();

-- ── 2. Cascade contact changes into the parent company's updated_at ──────
-- The embed-crm companySummary() now includes primary contact name; without
-- this, a contact rename leaves the company's embedding stale until the
-- company row itself is touched.

create or replace function public.qrm_contacts_bump_parent_company_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  if tg_op = 'DELETE' then
    v_company_id := old.primary_company_id;
  else
    v_company_id := new.primary_company_id;
    if tg_op = 'UPDATE' and new.primary_company_id is distinct from old.primary_company_id then
      update public.qrm_companies
        set updated_at = now()
        where id = old.primary_company_id;
    end if;
  end if;

  if v_company_id is not null then
    update public.qrm_companies
      set updated_at = now()
      where id = v_company_id;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_qrm_contacts_bump_company on public.qrm_contacts;
create trigger trg_qrm_contacts_bump_company
  after insert or update or delete on public.qrm_contacts
  for each row execute function public.qrm_contacts_bump_parent_company_updated_at();

-- ── 3. RPC: cosine-rank customers against a query embedding ──────────────
-- crm_embeddings has no workspace_id column — we join through qrm_companies
-- to keep results scoped to the caller's workspace. Over-fetch from the HNSW
-- index (limit 40) before applying the workspace filter so the index doesn't
-- truncate cross-workspace neighbors and starve the caller's hits.

create or replace function public.match_customers_by_embedding(
  p_query_embedding extensions.vector(1536),
  p_workspace_id text default null,
  p_top_k int default 10,
  p_min_similarity float default 0.7
)
returns table (
  customer_id uuid,
  similarity float
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with my_ws as (
    select coalesce(p_workspace_id, public.get_my_workspace()) as workspace_id
  ),
  candidates as (
    select
      ce.entity_id as candidate_id,
      1 - (ce.embedding <=> p_query_embedding) as sim
    from public.crm_embeddings ce
    where ce.entity_type = 'company'
    order by ce.embedding <=> p_query_embedding
    limit 40
  )
  select
    c.candidate_id as customer_id,
    c.sim::float as similarity
  from candidates c
  inner join public.qrm_companies co on co.id = c.candidate_id
  inner join my_ws on co.workspace_id = my_ws.workspace_id
  where co.deleted_at is null
    and c.sim >= p_min_similarity
  order by c.sim desc
  limit p_top_k;
$$;

grant execute on function public.match_customers_by_embedding(extensions.vector(1536), text, int, float)
  to authenticated, service_role;

comment on function public.match_customers_by_embedding(extensions.vector(1536), text, int, float) is
  'Slice B (mig 588): cosine-rank companies against a query embedding. Scoped to caller workspace via qrm_companies.workspace_id. HNSW index does the heavy lifting; over-fetch then filter so workspace scoping does not collide with the index neighborhood.';
