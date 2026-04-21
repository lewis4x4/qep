-- Migration 339 — Document Twin (Slice II)
--
-- Every published document produces a typed fact record. This migration
-- ships the substrate for that claim: a fact taxonomy, a fact table, an
-- idempotent job ledger, and audit-event extensions so twin runs are
-- first-class citizens of the document_audit_events log.
--
-- What this migration does NOT do:
--   • Install a trigger / cron that auto-queues twins. That lives in a
--     follow-up slice; operators drive the first extractions by hand
--     through the router's /twin-rerun endpoint.
--   • Enforce a feature flag. Call-site gates live in document-router +
--     document-twin (admin-only). A workspace-level flag table can be
--     bolted on later without changing this schema.
--
-- RLS model:
--   document_facts   → inherits workspace + audience from the parent
--                      document (read); writes are service-role only.
--   document_twin_jobs → admins+ can read their workspace's jobs; writes
--                      are service-role only.
--
-- No data migration. No existing behavior changes.

-- ── 1. Fact taxonomy enum ────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_fact_type') then
    create type public.document_fact_type as enum (
      'party_customer', 'party_vendor', 'party_lienholder',
      'effective_date', 'expiration_date', 'renewal_window',
      'equipment_tag', 'part_sku', 'parts_list_total',
      'monetary_amount',
      'obligation_delivery', 'obligation_inspection', 'obligation_service_interval',
      'signature_present', 'signature_missing',
      'document_class', 'amendment_of', 'supersedes'
    );
  end if;
end
$$;

-- ── 2. document_facts table ──────────────────────────────────────────────

create table if not exists public.document_facts (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  workspace_id text not null,
  chunk_id uuid references public.chunks(id) on delete set null,
  fact_type public.document_fact_type not null,
  value jsonb not null,
  confidence real not null check (confidence between 0 and 1),
  audience public.document_audience not null default 'company_wide',
  extracted_by_model text not null,
  extracted_at timestamptz not null default now(),
  trace_id uuid,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  superseded_by uuid references public.document_facts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_document_facts_doc_type on public.document_facts (document_id, fact_type);
create index if not exists idx_document_facts_workspace_type_date on public.document_facts (workspace_id, fact_type, extracted_at desc);
create index if not exists idx_document_facts_equipment on public.document_facts ((value->>'normalized'))
  where fact_type = 'equipment_tag';

alter table public.document_facts enable row level security;

-- Read: mirror the parent document's visibility. A caller that can't see
-- the document can't see its facts.
drop policy if exists document_facts_select on public.document_facts;
create policy document_facts_select on public.document_facts
  for select
  using (
    deleted_at is null
    and exists (
      select 1
      from public.documents d
      where d.id = document_facts.document_id
    )
  );

-- Writes are service-role only. Verification flows come through the
-- document-router (service-role escalation) or a future admin RPC.
drop policy if exists document_facts_write on public.document_facts;
create policy document_facts_write on public.document_facts
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.document_facts is
  'Slice II: typed fact records produced by the document-twin pipeline. Every row is tied to its originating chunk where possible; confidence ∈ [0,1]; supersession is the retirement path (no hard deletes).';

-- ── 3. document_twin_jobs (idempotency ledger) ───────────────────────────

create table if not exists public.document_twin_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  workspace_id text not null,
  status text not null check (status in ('pending','running','succeeded','failed','skipped')),
  model_version text not null,
  input_hash text not null,
  started_at timestamptz,
  completed_at timestamptz,
  error_detail jsonb,
  trace_id uuid,
  fact_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, input_hash, model_version)
);

create index if not exists idx_document_twin_jobs_document_created on public.document_twin_jobs (document_id, created_at desc);
create index if not exists idx_document_twin_jobs_workspace_status on public.document_twin_jobs (workspace_id, status, created_at desc);

alter table public.document_twin_jobs enable row level security;

drop policy if exists document_twin_jobs_select on public.document_twin_jobs;
create policy document_twin_jobs_select on public.document_twin_jobs
  for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin','manager','owner')
  );

drop policy if exists document_twin_jobs_write on public.document_twin_jobs;
create policy document_twin_jobs_write on public.document_twin_jobs
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.document_twin_jobs is
  'Slice II: idempotent twin extraction ledger. unique(document_id, input_hash, model_version) means a successful run short-circuits on next trigger with status=skipped.';

-- ── 4. Audit event enum additions ────────────────────────────────────────

alter type public.document_audit_event_type add value if not exists 'twin_extracted';
alter type public.document_audit_event_type add value if not exists 'twin_failed';
alter type public.document_audit_event_type add value if not exists 'twin_reextracted';
alter type public.document_audit_event_type add value if not exists 'fact_verified';
alter type public.document_audit_event_type add value if not exists 'fact_superseded';
