-- 452_customer_attachments.sql
--
-- Wave 1 clean foundation: Phase-9 Advanced Intelligence from
-- docs/intellidealer-gap-audit/phase-9-advanced-intelligence.yaml#customer_portal_view.multimedia.
--
-- Rollback notes:
--   drop trigger if exists set_customer_attachments_updated_at on public.customer_attachments;
--   drop policy if exists "customer_attachments_rep_select" on public.customer_attachments;
--   drop policy if exists "customer_attachments_rep_scope" on public.customer_attachments;
--   drop policy if exists "customer_attachments_rep_own_select" on public.customer_attachments;
--   drop policy if exists "customer_attachments_workspace_select" on public.customer_attachments;
--   drop policy if exists "customer_attachments_workspace_insert" on public.customer_attachments;
--   drop policy if exists "customer_attachments_workspace_update" on public.customer_attachments;
--   drop policy if exists "customer_attachments_delete_elevated" on public.customer_attachments;
--   drop policy if exists "customer_attachments_all_elevated" on public.customer_attachments;
--   drop policy if exists "customer_attachments_service_all" on public.customer_attachments;
--   drop table if exists public.customer_attachments;
create table public.customer_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid not null references public.qrm_companies(id) on delete cascade,
  classification text check (classification in ('portal','logo','site_photo','signed_agreement','other')),
  file_url text not null,
  file_name text,
  mime_type text,
  uploaded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.customer_attachments is 'Customer portal multimedia and customer-profile attachment metadata.';

create index idx_customer_attachments_company
  on public.customer_attachments (workspace_id, company_id, created_at desc)
  where deleted_at is null;
comment on index public.idx_customer_attachments_company is 'Purpose: customer attachment timeline and portal media lookup.';

alter table public.customer_attachments enable row level security;

create policy "customer_attachments_service_all"
  on public.customer_attachments for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "customer_attachments_all_elevated"
  on public.customer_attachments for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "customer_attachments_rep_scope"
  on public.customer_attachments for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and public.crm_rep_can_access_company(company_id)
  );

create trigger set_customer_attachments_updated_at
  before update on public.customer_attachments
  for each row execute function public.set_updated_at();
