-- 433_qrm_work_order_wip_snapshots.sql
--
-- Wave 1 clean foundation: Phase-5 Deal Genome from
-- docs/intellidealer-gap-audit/phase-5-deal-genome.yaml#analysis_wip.wip_method.
--
-- Rollback notes:
--   drop trigger if exists set_qrm_work_order_wip_snapshots_updated_at on public.qrm_work_order_wip_snapshots;
--   drop policy if exists "qrm_work_order_wip_snapshots_rep_select" on public.qrm_work_order_wip_snapshots;
--   drop policy if exists "qrm_work_order_wip_snapshots_rep_scope" on public.qrm_work_order_wip_snapshots;
--   drop policy if exists "qrm_work_order_wip_snapshots_rep_own_select" on public.qrm_work_order_wip_snapshots;
--   drop policy if exists "qrm_work_order_wip_snapshots_workspace_select" on public.qrm_work_order_wip_snapshots;
--   drop policy if exists "qrm_work_order_wip_snapshots_workspace_insert" on public.qrm_work_order_wip_snapshots;
--   drop policy if exists "qrm_work_order_wip_snapshots_workspace_update" on public.qrm_work_order_wip_snapshots;
--   drop policy if exists "qrm_work_order_wip_snapshots_delete_elevated" on public.qrm_work_order_wip_snapshots;
--   drop policy if exists "qrm_work_order_wip_snapshots_all_elevated" on public.qrm_work_order_wip_snapshots;
--   drop policy if exists "qrm_work_order_wip_snapshots_service_all" on public.qrm_work_order_wip_snapshots;
--   drop table if exists public.qrm_work_order_wip_snapshots;
create table public.qrm_work_order_wip_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  snapshot_date date not null,
  method text not null check (method in ('balancing','aging')),
  branch_id uuid references public.branches(id) on delete set null,
  wip_account_id uuid,
  unprocessed_included boolean not null default false,
  bucket_current_cents bigint not null default 0,
  bucket_31_60_cents bigint not null default 0,
  bucket_61_90_cents bigint not null default 0,
  bucket_91_120_cents bigint not null default 0,
  bucket_over_120_cents bigint not null default 0,
  total_cents bigint generated always as (
    bucket_current_cents + bucket_31_60_cents + bucket_61_90_cents + bucket_91_120_cents + bucket_over_120_cents
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, snapshot_date, method, branch_id, wip_account_id)
);

comment on table public.qrm_work_order_wip_snapshots is 'Point-in-time Work In Process aging/balancing snapshots for IntelliDealer WIP analysis.';
comment on column public.qrm_work_order_wip_snapshots.wip_account_id is 'GL account UUID retained without FK until gl_accounts exists later in Wave 1.';

create index idx_qrm_wip_snapshots_date
  on public.qrm_work_order_wip_snapshots (workspace_id, snapshot_date desc, method)
  where deleted_at is null;
comment on index public.idx_qrm_wip_snapshots_date is 'Purpose: latest WIP snapshot lookup by workspace, date, and method.';

alter table public.qrm_work_order_wip_snapshots enable row level security;

create policy "qrm_work_order_wip_snapshots_service_all"
  on public.qrm_work_order_wip_snapshots for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "qrm_work_order_wip_snapshots_all_elevated"
  on public.qrm_work_order_wip_snapshots for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_qrm_work_order_wip_snapshots_updated_at
  before update on public.qrm_work_order_wip_snapshots
  for each row execute function public.set_updated_at();
