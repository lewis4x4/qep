-- Migration 340 — Obligations Graph (Slice III)
--
-- A typed edge table + two projection functions that turn document_facts
-- into a queryable obligations graph. Every twin run calls
-- public.project_document_obligations(doc_id) so the graph stays current
-- without a cron (Slice III MVP). An hourly at-risk sweep runs via a
-- separate function operators can schedule on pg_cron when they want
-- automated drift detection.
--
-- Relationship to earlier slices:
--   • document_facts (339) is the upstream source of every edge.
--   • exception_queue (165) is where at-risk transitions surface for
--     operator attention in Slice VI.
--   • qrm_predictions (208, 338) is the audit trail for projection runs.

-- ── Enums ────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_obligation_edge_type') then
    create type public.document_obligation_edge_type as enum (
      'promises_delivery', 'guarantees_until', 'expires_on',
      'governs_equipment', 'references_po', 'amends', 'supersedes', 'fulfills',
      'at_risk_because', 'settled_by'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'document_obligation_status') then
    create type public.document_obligation_status as enum (
      'active', 'fulfilled', 'expired', 'at_risk', 'voided'
    );
  end if;
end
$$;

-- ── document_obligations table ───────────────────────────────────────────

create table if not exists public.document_obligations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  edge_type public.document_obligation_edge_type not null,
  from_document_id uuid references public.documents(id) on delete cascade,
  from_entity_type text,
  from_entity_id uuid,
  to_document_id uuid references public.documents(id) on delete cascade,
  to_entity_type text,
  to_entity_id uuid,
  to_entity_label text,
  valid_from timestamptz,
  valid_until timestamptz,
  status public.document_obligation_status not null default 'active',
  source_fact_ids uuid[] not null default array[]::uuid[],
  confidence real not null default 0 check (confidence between 0 and 1),
  last_computed_at timestamptz not null default now(),
  computation_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_obligations_workspace_until on public.document_obligations (workspace_id, status, valid_until);
create index if not exists idx_obligations_from_entity on public.document_obligations (from_entity_type, from_entity_id, status);
create index if not exists idx_obligations_to_entity on public.document_obligations (to_entity_type, to_entity_id, status);
create index if not exists idx_obligations_document on public.document_obligations (from_document_id, to_document_id);

alter table public.document_obligations enable row level security;

drop policy if exists document_obligations_select on public.document_obligations;
create policy document_obligations_select on public.document_obligations
  for select
  using (workspace_id = public.get_my_workspace());

drop policy if exists document_obligations_write on public.document_obligations;
create policy document_obligations_write on public.document_obligations
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.document_obligations is
  'Slice III: typed edges derived from document_facts. Written by project_document_obligations(); read by the Context Pane and the Plays engine.';

-- ── project_document_obligations() ───────────────────────────────────────
-- Derives self-anchored edges for one document. Runs inside the twin
-- extraction success path so the graph is never more than a few seconds
-- stale relative to the facts it's built from.
--
-- MVP coverage (Slice III): expires_on edges for every expiration_date
-- fact, governs_equipment edges for every equipment_tag fact. More
-- cross-document edges (amends, supersedes, references_po) ship in the
-- Plays slice.

create or replace function public.project_document_obligations(p_document_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_workspace text;
  v_batch uuid := gen_random_uuid();
  v_count integer := 0;
begin
  select workspace_id into v_workspace
  from public.documents
  where id = p_document_id;
  if v_workspace is null then
    return 0;
  end if;

  -- Soft-voice any prior rows for this document so stale edges don't
  -- linger after facts are superseded. A follow-up insert will replace
  -- the live set.
  update public.document_obligations
  set status = 'voided',
      updated_at = now()
  where from_document_id = p_document_id
    and status in ('active', 'at_risk');

  -- expires_on edges: one per expiration_date fact. valid_until = the
  -- fact's normalized ISO date.
  insert into public.document_obligations (
    workspace_id, edge_type, from_document_id,
    from_entity_type, to_entity_type, to_entity_label,
    valid_until, source_fact_ids, confidence,
    status, computation_batch_id
  )
  select
    f.workspace_id,
    'expires_on'::public.document_obligation_edge_type,
    f.document_id,
    'document',
    'commitment',
    coalesce(f.value->>'raw', f.value->>'normalized'),
    nullif(f.value->>'normalized', '')::timestamptz,
    array[f.id],
    f.confidence,
    'active',
    v_batch
  from public.document_facts f
  where f.document_id = p_document_id
    and f.fact_type = 'expiration_date'
    and f.deleted_at is null;

  get diagnostics v_count = row_count;

  insert into public.document_obligations (
    workspace_id, edge_type, from_document_id,
    from_entity_type, to_entity_type, to_entity_label,
    source_fact_ids, confidence, status, computation_batch_id
  )
  select
    f.workspace_id,
    'governs_equipment'::public.document_obligation_edge_type,
    f.document_id,
    'document',
    'equipment',
    coalesce(f.value->>'normalized', f.value->>'raw'),
    array[f.id],
    f.confidence,
    'active',
    v_batch
  from public.document_facts f
  where f.document_id = p_document_id
    and f.fact_type = 'equipment_tag'
    and f.deleted_at is null;

  return v_count;
end;
$$;

comment on function public.project_document_obligations(uuid) is
  'Slice III: projects document_facts for one document into document_obligations. Voids prior active/at_risk rows for the document, inserts fresh edges. Returns the count of expires_on edges created (MVP metric).';

revoke execute on function public.project_document_obligations(uuid) from public;
grant execute on function public.project_document_obligations(uuid) to service_role;

-- ── mark_at_risk_obligations() ───────────────────────────────────────────
-- Flips active → at_risk for edges whose business window is about to
-- close without fulfillment. Intended to run hourly via pg_cron; callable
-- manually by admins through a follow-up router endpoint.

create or replace function public.mark_at_risk_obligations()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  with promoted as (
    update public.document_obligations
    set status = 'at_risk',
        last_computed_at = now(),
        updated_at = now()
    where status = 'active'
      and edge_type = 'expires_on'
      and valid_until is not null
      and valid_until <= now() + interval '14 days'
      and valid_until > now()
      and not exists (
        select 1
        from public.document_obligations fulfilled
        where fulfilled.from_document_id = document_obligations.from_document_id
          and fulfilled.edge_type = 'fulfills'
          and fulfilled.status in ('active', 'fulfilled')
      )
    returning 1
  )
  select count(*) into v_count from promoted;
  return v_count;
end;
$$;

comment on function public.mark_at_risk_obligations() is
  'Slice III: sweep that promotes active edges to at_risk when the business window is closing. MVP rule: expires_on within 14 days with no fulfills edge. Returns count of promotions.';

revoke execute on function public.mark_at_risk_obligations() from public;
grant execute on function public.mark_at_risk_obligations() to service_role;
