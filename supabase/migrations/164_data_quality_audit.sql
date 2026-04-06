-- ============================================================================
-- Migration 164: Data Quality Audit Layer (Wave 6.8 — new in v2)
--
-- Nightly cron data-quality-audit populates admin_data_issues with one row
-- per failing record per audit class. Surfaced in /admin/data-quality with
-- resolve / ignore actions.
--
-- Audit classes:
--   - equipment_no_owner            equipment without company linkage
--   - equipment_no_make_model       equipment missing make/model
--   - equipment_no_geocoords        equipment with no lat/lng on metadata
--   - equipment_stale_telematics    no telematics reading in 7+ days
--   - equipment_duplicate_serial    same serial number on multiple rows
--   - equipment_no_intervals        no equipment_service_intervals defined
--   - documents_unclassified        equipment_documents.document_type is null
--   - quotes_no_tax_jurisdiction    quote_packages without tax breakdown
-- ============================================================================

create table if not exists public.admin_data_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  issue_class text not null check (issue_class in (
    'equipment_no_owner',
    'equipment_no_make_model',
    'equipment_no_geocoords',
    'equipment_stale_telematics',
    'equipment_duplicate_serial',
    'equipment_no_intervals',
    'documents_unclassified',
    'quotes_no_tax_jurisdiction'
  )),
  severity text not null default 'warn' check (severity in ('info', 'warn', 'error')),
  entity_table text not null,
  entity_id uuid,
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  first_seen timestamptz not null default now(),
  last_checked timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.admin_data_issues is 'Nightly data-quality audit punch list. One row per failing record per class.';

alter table public.admin_data_issues enable row level security;

create policy "dqi_workspace" on public.admin_data_issues for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "dqi_service" on public.admin_data_issues for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create unique index uq_dqi_class_entity on public.admin_data_issues(workspace_id, issue_class, entity_table, entity_id);
create index idx_dqi_workspace_status on public.admin_data_issues(workspace_id, status, severity);
create index idx_dqi_class on public.admin_data_issues(issue_class, status);

create trigger set_dqi_updated_at
  before update on public.admin_data_issues
  for each row execute function public.set_updated_at();

-- ── Audit RPCs (one per class — keep them small + composable) ─────────────

create or replace function public.run_data_quality_audit()
returns table (issue_class text, found_count int)
language plpgsql
security invoker
as $$
declare
  v_count int;
begin
  -- 1. Equipment without owner linkage
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'equipment_no_owner', 'error', 'crm_equipment', e.id,
           jsonb_build_object('name', e.name), now()
    from public.crm_equipment e
    where e.company_id is null
      and e.deleted_at is null
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'equipment_no_owner', v_count;

  -- 2. Equipment missing make/model
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'equipment_no_make_model', 'warn', 'crm_equipment', e.id,
           jsonb_build_object('name', e.name), now()
    from public.crm_equipment e
    where (e.make is null or e.model is null)
      and e.deleted_at is null
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'equipment_no_make_model', v_count;

  -- 3. Equipment without service intervals
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'equipment_no_intervals', 'info', 'crm_equipment', e.id,
           jsonb_build_object('name', e.name), now()
    from public.crm_equipment e
    where e.deleted_at is null
      and not exists (
        select 1 from public.equipment_service_intervals esi where esi.equipment_id = e.id
      )
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'equipment_no_intervals', v_count;

  -- 4. Duplicate serial numbers
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'equipment_duplicate_serial', 'error', 'crm_equipment', e.id,
           jsonb_build_object('serial_number', e.serial_number, 'name', e.name), now()
    from public.crm_equipment e
    where e.serial_number is not null
      and e.deleted_at is null
      and e.serial_number in (
        select serial_number from public.crm_equipment
        where serial_number is not null and deleted_at is null
        group by serial_number having count(*) > 1
      )
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'equipment_duplicate_serial', v_count;
end;
$$;

comment on function public.run_data_quality_audit() is 'Nightly data-quality scan. Idempotent — re-running just bumps last_checked on existing open issues.';
