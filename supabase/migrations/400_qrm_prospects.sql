-- 400_qrm_prospects.sql
--
-- Wave 1A: IntelliDealer Prospect Board foundation from
-- docs/intellidealer-gap-audit/phase-1-crm.yaml#prospect.status.
--
-- Rollback notes:
--   drop trigger if exists set_qrm_prospects_updated_at on public.qrm_prospects;
--   drop policy if exists "qrm_prospects_rep_scope" on public.qrm_prospects;
--   drop policy if exists "qrm_prospects_all_elevated" on public.qrm_prospects;
--   drop policy if exists "qrm_prospects_service_all" on public.qrm_prospects;
--   drop table if exists public.qrm_prospects;
--   drop type if exists public.prospect_status;

create type public.prospect_status as enum ('early','almost','sold','delivered','lost_sale','expired');

create table public.qrm_prospects (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  prospect_status public.prospect_status not null default 'early',
  source text,
  salesperson_id uuid references public.profiles(id) on delete set null,
  selling text,
  trading text,
  company_id uuid references public.qrm_companies(id) on delete set null,
  company_name_unconverted text,
  comments text,
  added_at timestamptz not null default now(),
  modified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.qrm_prospects is
  'Pre-customer Prospect Board records for early-funnel equipment opportunities before quote/deal conversion.';

create index idx_qrm_prospects_board
  on public.qrm_prospects (workspace_id, prospect_status, modified_at desc)
  where deleted_at is null;
comment on index public.idx_qrm_prospects_board is
  'Purpose: Prospect Board status filter and recency ordering by workspace.';

create index idx_qrm_prospects_salesperson
  on public.qrm_prospects (workspace_id, salesperson_id, modified_at desc)
  where salesperson_id is not null and deleted_at is null;
comment on index public.idx_qrm_prospects_salesperson is
  'Purpose: salesperson-scoped Prospect Board and rep forecast slices.';

alter table public.qrm_prospects enable row level security;

create policy "qrm_prospects_service_all"
  on public.qrm_prospects for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "qrm_prospects_all_elevated"
  on public.qrm_prospects for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "qrm_prospects_rep_scope"
  on public.qrm_prospects for all
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and (salesperson_id = (select auth.uid()) or public.crm_rep_can_access_company(company_id))
  )
  with check (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and (salesperson_id = (select auth.uid()) or public.crm_rep_can_access_company(company_id))
  );

create trigger set_qrm_prospects_updated_at
  before update on public.qrm_prospects
  for each row execute function public.set_updated_at();
