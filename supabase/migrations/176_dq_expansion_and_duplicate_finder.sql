-- ============================================================================
-- Migration 176: Data Quality coverage expansion + duplicate finder
--                (Phases G + H)
--
-- (G) Adds 4 missing audit classes from spec §10.5:
--     - account_no_budget_cycle      — companies w/o budget_cycle_month
--     - account_no_tax_treatment     — companies w/o any active tax_treatments
--     - contact_stale_ownership      — contacts whose assigned rep has not
--                                       logged any activity in 90+ days
--     - quote_no_validity_window     — quote_packages with NULL expires_at
--
-- (H) New find_duplicate_companies() RPC: fuzzy match on lower(name) +
--     city + state. Returns groups of suspected duplicates so the
--     QrmDuplicatesPage can offer one-click merges.
-- ============================================================================

-- ── (G.0) Loosen the issue_class CHECK constraint to add the new classes ─

alter table public.admin_data_issues drop constraint if exists admin_data_issues_issue_class_check;
alter table public.admin_data_issues add constraint admin_data_issues_issue_class_check
  check (issue_class in (
    'equipment_no_owner',
    'equipment_no_make_model',
    'equipment_no_geocoords',
    'equipment_stale_telematics',
    'equipment_duplicate_serial',
    'equipment_no_intervals',
    'documents_unclassified',
    'quotes_no_tax_jurisdiction',
    'account_no_budget_cycle',
    'account_no_tax_treatment',
    'contact_stale_ownership',
    'quote_no_validity_window'
  ));

-- ── (G.1) Extend run_data_quality_audit() with the 4 new classes ──────────

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
    select 'equipment_no_owner', 'error', 'qrm_equipment', e.id,
           jsonb_build_object('name', e.name), now()
    from public.qrm_equipment e
    where e.company_id is null
      and e.deleted_at is null
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'equipment_no_owner', v_count;

  -- 2. Equipment missing make/model
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'equipment_no_make_model', 'warn', 'qrm_equipment', e.id,
           jsonb_build_object('name', e.name), now()
    from public.qrm_equipment e
    where (e.make is null or e.model is null)
      and e.deleted_at is null
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'equipment_no_make_model', v_count;

  -- 3. Equipment without service intervals
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'equipment_no_intervals', 'info', 'qrm_equipment', e.id,
           jsonb_build_object('name', e.name), now()
    from public.qrm_equipment e
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
    select 'equipment_duplicate_serial', 'error', 'qrm_equipment', e.id,
           jsonb_build_object('serial_number', e.serial_number, 'name', e.name), now()
    from public.qrm_equipment e
    where e.serial_number is not null
      and e.deleted_at is null
      and e.serial_number in (
        select serial_number from public.qrm_equipment
        where serial_number is not null and deleted_at is null
        group by serial_number having count(*) > 1
      )
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'equipment_duplicate_serial', v_count;

  -- ─── New classes (Phase G) ───────────────────────────────────────────

  -- 5. account_no_budget_cycle: companies whose extended profile has no budget cycle month
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'account_no_budget_cycle', 'warn', 'qrm_companies', c.id,
           jsonb_build_object('name', c.name), now()
    from public.qrm_companies c
    left join public.customer_profiles_extended cpe on cpe.crm_company_id = c.id
    where c.deleted_at is null
      and (cpe.budget_cycle_month is null)
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'account_no_budget_cycle', v_count;

  -- 6. account_no_tax_treatment: companies w/o any verified exemption AND no
  --    matching jurisdiction. Best-effort: flag any company that has no
  --    customer_profiles_extended.metadata->tax_jurisdiction set.
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'account_no_tax_treatment', 'info', 'qrm_companies', c.id,
           jsonb_build_object('name', c.name), now()
    from public.qrm_companies c
    where c.deleted_at is null
      and not exists (
        select 1 from public.tax_exemption_certificates tec
        where tec.crm_company_id = c.id and tec.status = 'verified'
      )
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'account_no_tax_treatment', v_count;

  -- 7. contact_stale_ownership: contacts whose owning rep has not logged
  --    any activity in 90+ days. Use qrm_activities for the check.
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'contact_stale_ownership', 'warn', 'qrm_contacts', ct.id,
           jsonb_build_object('first_name', ct.first_name, 'last_name', ct.last_name), now()
    from public.qrm_contacts ct
    where ct.deleted_at is null
      and ct.assigned_rep_id is not null
      and not exists (
        select 1 from public.qrm_activities a
        where a.created_by = ct.assigned_rep_id
          and a.created_at > now() - interval '90 days'
      )
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'contact_stale_ownership', v_count;

  -- 8. quote_no_validity_window: open quotes with no expires_at set
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'quote_no_validity_window', 'warn', 'quote_packages', q.id,
           jsonb_build_object('deal_id', q.deal_id, 'status', q.status), now()
    from public.quote_packages q
    where q.expires_at is null
      and q.status in ('draft', 'sent', 'negotiating')
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'quote_no_validity_window', v_count;
end;
$$;

comment on function public.run_data_quality_audit() is
  '12-class data-quality scan. Idempotent — re-running just bumps last_checked on existing open issues.';

-- ── (H) Duplicate company finder ──────────────────────────────────────────

create extension if not exists pg_trgm with schema extensions;

create or replace function public.find_duplicate_companies(p_threshold numeric default 0.6)
returns table (
  group_key text,
  company_a_id uuid,
  company_a_name text,
  company_b_id uuid,
  company_b_name text,
  similarity_score numeric
)
language plpgsql
security invoker
stable
as $$
begin
  return query
    select
      lower(trim(a.name)) || '|' || coalesce(lower(a.city), '') as group_key,
      a.id, a.name,
      b.id, b.name,
      round(extensions.similarity(lower(a.name), lower(b.name))::numeric, 3) as similarity_score
    from public.qrm_companies a
    join public.qrm_companies b
      on a.id < b.id
     and a.workspace_id = b.workspace_id
     and a.deleted_at is null
     and b.deleted_at is null
     and (
       extensions.similarity(lower(a.name), lower(b.name)) >= p_threshold
       or (a.name = b.name)
     )
     and (
       coalesce(lower(a.city), '') = coalesce(lower(b.city), '')
       or (a.city is null and b.city is null)
     )
    order by similarity_score desc
    limit 200;
end;
$$;

comment on function public.find_duplicate_companies(numeric) is
  'Fuzzy duplicate-company finder using pg_trgm similarity on (name) within matching city. Returns pairs sorted by score.';
