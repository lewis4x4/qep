-- ============================================================================
-- Migration 583: Quality Center Phase 1 — kanban-grade triage on flare_reports
--
-- Adds:
--   • Richer status vocabulary (acknowledged, investigating, fixing, shipped,
--     verified, wont_fix, duplicate, needs_info) so engineering can move bugs
--     across a real board instead of the legacy triaged/in_progress/fixed
--     trio. Existing rows are migrated in-place — see step 1.
--   • status_updated_at / status_updated_by — last-touched audit on the row
--   • eta_date — owner-facing "we expect this fixed by" date
--   • owner_summary — plain-English status that stakeholder owners can read
--   • priority — low / medium / high / urgent (orthogonal to severity)
--   • flare_status_history — append-only audit of every status transition,
--     with optional engineering note
--
-- Order of ops matters: we migrate the legacy `status` values FIRST, then
-- swap the check constraint to the new vocabulary. Doing it the other way
-- around fails the constraint on existing rows.
-- ============================================================================

-- ── 1. Migrate legacy status values to the new vocabulary ──────────────────
update public.flare_reports set status = 'acknowledged' where status = 'triaged';
update public.flare_reports set status = 'fixing'       where status = 'in_progress';
update public.flare_reports set status = 'shipped'      where status = 'fixed';
update public.flare_reports set status = 'wont_fix'     where status = 'wontfix';
-- 'new' and 'duplicate' carry over as-is.

-- ── 2. Swap the check constraint ───────────────────────────────────────────
-- pg names the constraint flare_reports_status_check (table_column_check)
-- per the unnamed CHECK in 185. Drop + re-add idempotently.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.flare_reports'::regclass
      and conname  = 'flare_reports_status_check'
  ) then
    alter table public.flare_reports drop constraint flare_reports_status_check;
  end if;
end $$;

alter table public.flare_reports
  add constraint flare_reports_status_check
  check (status in (
    'new', 'acknowledged', 'investigating', 'fixing',
    'shipped', 'verified', 'wont_fix', 'duplicate', 'needs_info'
  ));

-- ── 3. New triage columns ──────────────────────────────────────────────────
alter table public.flare_reports
  add column if not exists status_updated_at timestamptz,
  add column if not exists status_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists eta_date          date,
  add column if not exists owner_summary     text,
  add column if not exists priority          text
    check (priority is null or priority in ('low', 'medium', 'high', 'urgent'));

-- Backfill status_updated_at for existing rows so the board has a sortable
-- value from day one. Uses triaged_at when set, else falls back to created_at.
update public.flare_reports
  set status_updated_at = coalesce(triaged_at, fixed_at, created_at)
  where status_updated_at is null;

-- Index for board queries that order by last status touch within workspace.
create index if not exists idx_flare_workspace_status_updated
  on public.flare_reports (workspace_id, status, status_updated_at desc);

-- ── 4. flare_status_history — append-only transition audit ────────────────
create table if not exists public.flare_status_history (
  id           uuid primary key default gen_random_uuid(),
  flare_id     uuid not null references public.flare_reports(id) on delete cascade,
  workspace_id text not null default public.get_my_workspace(),
  from_status  text,
  to_status    text not null,
  changed_by   uuid references auth.users(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now()
);

comment on table public.flare_status_history is
  'Quality Center Phase 1 (mig 583): append-only audit of flare_reports status transitions. Powers the avg-fix-time tile + the per-card history thread.';

create index if not exists idx_flare_status_history_flare_created
  on public.flare_status_history (flare_id, created_at desc);

create index if not exists idx_flare_status_history_workspace_to_status
  on public.flare_status_history (workspace_id, to_status, created_at desc);

alter table public.flare_status_history enable row level security;

-- Mirror the flare_reports policy stack: workspace members in
-- admin/manager/owner/support read + write; service role bypasses.
-- Helper calls wrapped in (select ...) to keep the planner happy
-- (init-plan-safe — see scripts/check-rls-initplan.mjs).
create policy "flare_status_history_workspace_read"
  on public.flare_status_history for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('owner', 'admin', 'manager', 'support')
  );

create policy "flare_status_history_workspace_insert"
  on public.flare_status_history for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('owner', 'admin', 'manager', 'support')
  );

create policy "flare_status_history_service_all"
  on public.flare_status_history for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
