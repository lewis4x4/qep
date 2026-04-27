-- 449_ar_agencies.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#customer_ar.ar_agency_default.
-- Phase-9 collection_agencies is intentionally skipped per documented reconciliation.
--
-- Rollback notes:
--   drop trigger if exists set_ar_agencies_updated_at on public.ar_agencies;
--   drop policy if exists "ar_agencies_rep_select" on public.ar_agencies;
--   drop policy if exists "ar_agencies_rep_scope" on public.ar_agencies;
--   drop policy if exists "ar_agencies_rep_own_select" on public.ar_agencies;
--   drop policy if exists "ar_agencies_workspace_select" on public.ar_agencies;
--   drop policy if exists "ar_agencies_workspace_insert" on public.ar_agencies;
--   drop policy if exists "ar_agencies_workspace_update" on public.ar_agencies;
--   drop policy if exists "ar_agencies_delete_elevated" on public.ar_agencies;
--   drop policy if exists "ar_agencies_all_elevated" on public.ar_agencies;
--   drop policy if exists "ar_agencies_service_all" on public.ar_agencies;
--   drop table if exists public.ar_agencies;
create table public.ar_agencies (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  code text not null,
  name text not null,
  gl_receivable_account text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, code)
);

comment on table public.ar_agencies is 'A/R agency lookup; canonical replacement for duplicate Phase-9 collection_agencies.';

create index idx_ar_agencies_active
  on public.ar_agencies (workspace_id, lower(code))
  where active = true and deleted_at is null;
comment on index public.idx_ar_agencies_active is 'Purpose: active AR agency lookup by workspace and code.';

alter table public.ar_agencies enable row level security;

create policy "ar_agencies_service_all"
  on public.ar_agencies for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "ar_agencies_all_elevated"
  on public.ar_agencies for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "ar_agencies_rep_select"
  on public.ar_agencies for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_ar_agencies_updated_at
  before update on public.ar_agencies
  for each row execute function public.set_updated_at();
