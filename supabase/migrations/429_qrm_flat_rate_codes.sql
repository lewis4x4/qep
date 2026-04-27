-- 429_qrm_flat_rate_codes.sql
--
-- Wave 1 clean foundation: Phase-5 Deal Genome from
-- docs/intellidealer-gap-audit/phase-5-deal-genome.yaml#analysis_quote_gain.col_standard_hours.
-- The service_job_segments flat-rate FK/standard-hours extension is Wave 2 scope and intentionally not included here.
--
-- Rollback notes:
--   drop trigger if exists set_qrm_flat_rate_codes_updated_at on public.qrm_flat_rate_codes;
--   drop policy if exists "qrm_flat_rate_codes_rep_select" on public.qrm_flat_rate_codes;
--   drop policy if exists "qrm_flat_rate_codes_rep_scope" on public.qrm_flat_rate_codes;
--   drop policy if exists "qrm_flat_rate_codes_rep_own_select" on public.qrm_flat_rate_codes;
--   drop policy if exists "qrm_flat_rate_codes_workspace_select" on public.qrm_flat_rate_codes;
--   drop policy if exists "qrm_flat_rate_codes_workspace_insert" on public.qrm_flat_rate_codes;
--   drop policy if exists "qrm_flat_rate_codes_workspace_update" on public.qrm_flat_rate_codes;
--   drop policy if exists "qrm_flat_rate_codes_delete_elevated" on public.qrm_flat_rate_codes;
--   drop policy if exists "qrm_flat_rate_codes_all_elevated" on public.qrm_flat_rate_codes;
--   drop policy if exists "qrm_flat_rate_codes_service_all" on public.qrm_flat_rate_codes;
--   drop table if exists public.qrm_flat_rate_codes;
create table public.qrm_flat_rate_codes (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  code text not null,
  description text,
  standard_hours numeric(8,2) not null check (standard_hours >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, code)
);

comment on table public.qrm_flat_rate_codes is 'Flat-rate labor codes with standard hours for quote gain/loss and service profitability analysis.';

create index idx_qrm_flat_rate_codes_active
  on public.qrm_flat_rate_codes (workspace_id, lower(code))
  where is_active = true and deleted_at is null;
comment on index public.idx_qrm_flat_rate_codes_active is 'Purpose: active flat-rate-code lookup by workspace and code.';

alter table public.qrm_flat_rate_codes enable row level security;

create policy "qrm_flat_rate_codes_service_all"
  on public.qrm_flat_rate_codes for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "qrm_flat_rate_codes_all_elevated"
  on public.qrm_flat_rate_codes for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "qrm_flat_rate_codes_rep_select"
  on public.qrm_flat_rate_codes for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_qrm_flat_rate_codes_updated_at
  before update on public.qrm_flat_rate_codes
  for each row execute function public.set_updated_at();
