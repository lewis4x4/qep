-- ============================================================================
-- Migration 181: Data Quality audit class completion (Enhancement 1)
--
-- Implements the 4 audit classes declared in mig 164's CHECK constraint
-- but never populated by run_data_quality_audit():
--
--   equipment_no_geocoords     — no lat/lng via telematics_feeds
--                                 AND no lat/lng in crm_equipment.metadata
--   equipment_stale_telematics — telematics_feeds.last_reading_at > 7 days ago
--                                 (or is_active=true but never read)
--   documents_unclassified     — equipment_documents.document_type = 'other'
--                                 on rows older than 24 hours
--   quotes_no_tax_jurisdiction — open quote_packages with no matching
--                                 quote_tax_breakdowns row OR stale
--                                 breakdown (> stale_after)
--
-- Re-declares run_data_quality_audit() with all 12 classes live.
-- Idempotent re-runs via the existing uq_dqi_class_entity index from mig 164.
-- ============================================================================

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
    where e.company_id is null and e.deleted_at is null
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'equipment_no_owner', v_count;

  -- 2. Equipment missing make/model
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'equipment_no_make_model', 'warn', 'qrm_equipment', e.id,
           jsonb_build_object('name', e.name), now()
    from public.qrm_equipment e
    where (e.make is null or e.model is null) and e.deleted_at is null
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
      and not exists (select 1 from public.equipment_service_intervals esi where esi.equipment_id = e.id)
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'equipment_no_intervals', v_count;

  -- 4. Duplicate serial numbers
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'equipment_duplicate_serial', 'error', 'qrm_equipment', e.id,
           jsonb_build_object('serial_number', e.serial_number, 'name', e.name), now()
    from public.qrm_equipment e
    where e.serial_number is not null and e.deleted_at is null
      and e.serial_number in (
        select serial_number from public.qrm_equipment
        where serial_number is not null and deleted_at is null
        group by serial_number having count(*) > 1
      )
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'equipment_duplicate_serial', v_count;

  -- 5. Account without budget cycle
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'account_no_budget_cycle', 'warn', 'qrm_companies', c.id,
           jsonb_build_object('name', c.name), now()
    from public.qrm_companies c
    left join public.customer_profiles_extended cpe on cpe.crm_company_id = c.id
    where c.deleted_at is null and cpe.budget_cycle_month is null
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'account_no_budget_cycle', v_count;

  -- 6. Account without tax treatment
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

  -- 7. Contact stale ownership
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'contact_stale_ownership', 'warn', 'qrm_contacts', ct.id,
           jsonb_build_object('first_name', ct.first_name, 'last_name', ct.last_name), now()
    from public.qrm_contacts ct
    where ct.deleted_at is null and ct.assigned_rep_id is not null
      and not exists (
        select 1 from public.qrm_activities a
        where a.created_by = ct.assigned_rep_id
          and a.created_at > now() - interval '90 days'
      )
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'contact_stale_ownership', v_count;

  -- 8. Quote without validity window
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'quote_no_validity_window', 'warn', 'quote_packages', q.id,
           jsonb_build_object('deal_id', q.deal_id, 'status', q.status), now()
    from public.quote_packages q
    where q.expires_at is null and q.status in ('draft', 'sent', 'negotiating')
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'quote_no_validity_window', v_count;

  -- ─── NEW classes (Enhancement 1) ───────────────────────────────────

  -- 9. Equipment without geocoords: no telematics feed with lat/lng AND
  --    no lat/lng in crm_equipment.metadata
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'equipment_no_geocoords', 'info', 'qrm_equipment', e.id,
           jsonb_build_object('name', e.name), now()
    from public.qrm_equipment e
    where e.deleted_at is null
      and not exists (
        select 1 from public.telematics_feeds tf
        where tf.equipment_id = e.id
          and tf.last_lat is not null
          and tf.last_lng is not null
      )
      and (e.metadata is null
        or (e.metadata->>'lat') is null
        or (e.metadata->>'lng') is null
      )
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'equipment_no_geocoords', v_count;

  -- 10. Equipment with stale telematics: feed marked active but no reading
  --     in 7+ days
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'equipment_stale_telematics', 'warn', 'qrm_equipment', e.id,
           jsonb_build_object(
             'name', e.name,
             'last_reading_at', tf.last_reading_at,
             'provider', tf.provider
           ), now()
    from public.qrm_equipment e
    join public.telematics_feeds tf on tf.equipment_id = e.id
    where e.deleted_at is null
      and tf.is_active = true
      and (
        tf.last_reading_at is null
        or tf.last_reading_at < now() - interval '7 days'
      )
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'equipment_stale_telematics', v_count;

  -- 11. Unclassified documents: document_type = 'other' on rows older than
  --     24 hours (fresh uploads are allowed a classification grace window)
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'documents_unclassified', 'info', 'equipment_documents', d.id,
           jsonb_build_object('title', d.title, 'file_url', d.file_url), now()
    from public.equipment_documents d
    where d.document_type = 'other'
      and d.created_at < now() - interval '24 hours'
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'documents_unclassified', v_count;

  -- 12. Open quotes with no tax jurisdiction: no quote_tax_breakdowns row
  --     OR breakdown is stale (past stale_after)
  insert into public.admin_data_issues (issue_class, severity, entity_table, entity_id, detail, last_checked)
    select 'quotes_no_tax_jurisdiction', 'warn', 'quote_packages', q.id,
           jsonb_build_object('deal_id', q.deal_id, 'status', q.status), now()
    from public.quote_packages q
    where q.status in ('draft', 'sent', 'negotiating')
      and (
        not exists (
          select 1 from public.quote_tax_breakdowns qtb
          where qtb.quote_package_id = q.id
        )
        or exists (
          select 1 from public.quote_tax_breakdowns qtb
          where qtb.quote_package_id = q.id
            and qtb.stale_after < now()
        )
      )
  on conflict (workspace_id, issue_class, entity_table, entity_id)
    do update set last_checked = now(), status = 'open';
  get diagnostics v_count = row_count;
  return query select 'quotes_no_tax_jurisdiction', v_count;
end;
$$;

comment on function public.run_data_quality_audit() is
  'Full 12-class data-quality scan (Enhancement 1 closure). Idempotent — re-running bumps last_checked on existing open issues. SECURITY INVOKER honors caller RLS.';
