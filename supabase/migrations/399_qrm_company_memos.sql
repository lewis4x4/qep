-- 399_qrm_company_memos.sql
--
-- Wave 1A: IntelliDealer Customer Profile pinned/history memos from
-- docs/intellidealer-gap-audit/phase-1-crm.yaml#customer.memos_pinned.
--
-- Rollback notes:
--   drop trigger if exists set_qrm_company_memos_updated_at on public.qrm_company_memos;
--   drop policy if exists "qrm_company_memos_rep_scope" on public.qrm_company_memos;
--   drop policy if exists "qrm_company_memos_all_elevated" on public.qrm_company_memos;
--   drop policy if exists "qrm_company_memos_service_all" on public.qrm_company_memos;
--   drop table if exists public.qrm_company_memos;

create table public.qrm_company_memos (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid not null references public.qrm_companies(id) on delete cascade,
  body text not null,
  pinned boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.qrm_company_memos is
  'Pinned and historical customer memos from IntelliDealer Customer Profile Memos tab.';

create index idx_qrm_company_memos_company_pinned
  on public.qrm_company_memos (workspace_id, company_id, pinned desc, created_at desc)
  where deleted_at is null;
comment on index public.idx_qrm_company_memos_company_pinned is
  'Purpose: load pinned banners and chronological memo history on Customer Profile without scanning all memos.';

alter table public.qrm_company_memos enable row level security;

create policy "qrm_company_memos_service_all"
  on public.qrm_company_memos for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "qrm_company_memos_all_elevated"
  on public.qrm_company_memos for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "qrm_company_memos_rep_scope"
  on public.qrm_company_memos for all
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and public.crm_rep_can_access_company(company_id)
  )
  with check (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and public.crm_rep_can_access_company(company_id)
  );

create trigger set_qrm_company_memos_updated_at
  before update on public.qrm_company_memos
  for each row execute function public.set_updated_at();
