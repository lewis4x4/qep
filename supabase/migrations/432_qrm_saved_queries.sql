-- 432_qrm_saved_queries.sql
--
-- Wave 1 clean foundation: Phase-5 Deal Genome from
-- docs/intellidealer-gap-audit/phase-5-deal-genome.yaml#data_miner_query.name.
--
-- Rollback notes:
--   drop trigger if exists set_qrm_saved_queries_updated_at on public.qrm_saved_queries;
--   drop policy if exists "qrm_saved_queries_rep_select" on public.qrm_saved_queries;
--   drop policy if exists "qrm_saved_queries_rep_scope" on public.qrm_saved_queries;
--   drop policy if exists "qrm_saved_queries_rep_own_select" on public.qrm_saved_queries;
--   drop policy if exists "qrm_saved_queries_workspace_select" on public.qrm_saved_queries;
--   drop policy if exists "qrm_saved_queries_workspace_insert" on public.qrm_saved_queries;
--   drop policy if exists "qrm_saved_queries_workspace_update" on public.qrm_saved_queries;
--   drop policy if exists "qrm_saved_queries_delete_elevated" on public.qrm_saved_queries;
--   drop policy if exists "qrm_saved_queries_all_elevated" on public.qrm_saved_queries;
--   drop policy if exists "qrm_saved_queries_service_all" on public.qrm_saved_queries;
--   drop table if exists public.qrm_saved_queries;
create table public.qrm_saved_queries (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  name text not null,
  description text,
  created_by uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  data_source text not null,
  select_columns jsonb not null default '[]'::jsonb,
  filter_criteria jsonb not null default '{}'::jsonb,
  sort_order jsonb,
  authority_role_codes text[],
  last_run_at timestamptz,
  last_modified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, created_by, name)
);

comment on table public.qrm_saved_queries is 'Data Miner saved-query repository with selected columns, filters, sort order, and authority role gates.';
comment on column public.qrm_saved_queries.name is 'IntelliDealer Data Miner Query Name.';

create index idx_qrm_saved_queries_workspace
  on public.qrm_saved_queries (workspace_id, lower(name))
  where deleted_at is null;
comment on index public.idx_qrm_saved_queries_workspace is 'Purpose: saved-query search by name within workspace.';

create index idx_qrm_saved_queries_owner
  on public.qrm_saved_queries (workspace_id, created_by, updated_at desc)
  where deleted_at is null;
comment on index public.idx_qrm_saved_queries_owner is 'Purpose: filter saved queries by owner/created-by.';

alter table public.qrm_saved_queries enable row level security;

create policy "qrm_saved_queries_service_all"
  on public.qrm_saved_queries for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "qrm_saved_queries_all_elevated"
  on public.qrm_saved_queries for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "qrm_saved_queries_rep_select"
  on public.qrm_saved_queries for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and (created_by = (select auth.uid()) or coalesce(authority_role_codes, array[]::text[]) && array[(select public.get_my_role())::text])
  );

create trigger set_qrm_saved_queries_updated_at
  before update on public.qrm_saved_queries
  for each row execute function public.set_updated_at();
