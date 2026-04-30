create or replace view public.qrm_intellidealer_customer_import_dashboard
with (security_invoker = true) as
select
  r.id,
  r.workspace_id,
  r.status,
  r.source_file_name,
  r.source_file_hash,
  r.master_rows,
  r.contact_rows,
  r.contact_memo_rows,
  r.ar_agency_rows,
  r.profitability_rows,
  r.error_count,
  r.warning_count,
  r.created_at,
  r.completed_at,
  (
    select count(*)
    from public.qrm_intellidealer_customer_master_stage s
    where s.run_id = r.id
  ) as master_stage_count,
  (
    select count(*)
    from public.qrm_intellidealer_customer_contacts_stage s
    where s.run_id = r.id
  ) as contacts_stage_count,
  (
    select count(*)
    from public.qrm_intellidealer_customer_contact_memos_stage s
    where s.run_id = r.id
  ) as contact_memos_stage_count,
  (
    select count(*)
    from public.qrm_intellidealer_customer_contact_memos_stage s
    where s.run_id = r.id
      and nullif(s.memo, '') is not null
  ) as contact_memos_nonblank_count,
  (
    select count(*)
    from public.qrm_intellidealer_customer_ar_agency_stage s
    where s.run_id = r.id
  ) as ar_agency_stage_count,
  (
    select count(*)
    from public.qrm_intellidealer_customer_profitability_stage s
    where s.run_id = r.id
  ) as profitability_stage_count,
  (
    select count(*)
    from public.qrm_intellidealer_customer_master_stage s
    where s.run_id = r.id
      and s.canonical_company_id is not null
  ) as mapped_master_count,
  (
    select count(*)
    from public.qrm_intellidealer_customer_contacts_stage s
    where s.run_id = r.id
      and s.canonical_contact_id is not null
  ) as mapped_contacts_count,
  (
    select count(*)
    from public.qrm_intellidealer_customer_ar_agency_stage s
    where s.run_id = r.id
      and s.canonical_company_id is not null
      and s.canonical_agency_id is not null
  ) as mapped_ar_agency_count,
  (
    select count(*)
    from public.qrm_intellidealer_customer_profitability_stage s
    where s.run_id = r.id
      and s.canonical_company_id is not null
  ) as mapped_profitability_count,
  (
    select count(*)
    from public.qrm_customer_ar_agencies a
    where a.workspace_id = r.workspace_id
      and a.deleted_at is null
  ) as canonical_ar_agencies_count,
  (
    select count(*)
    from public.qrm_customer_profitability_import_facts f
    where f.workspace_id = r.workspace_id
      and f.deleted_at is null
  ) as canonical_profitability_facts_count,
  (
    select count(*)
    from public.qrm_customer_ar_agencies a
    where a.workspace_id = r.workspace_id
      and a.card_number is not null
      and a.card_number !~* '^REDACTED:'
      and a.card_number !~ '^[*?xX-]+$'
  ) as raw_card_rows_count,
  (
    select count(*)
    from public.qrm_customer_ar_agencies a
    where a.workspace_id = r.workspace_id
      and a.card_number ~* '^REDACTED:'
  ) as redacted_card_rows_count,
  (
    select count(*)
    from public.qrm_intellidealer_customer_import_errors e
    where e.run_id = r.id
  ) as import_errors_count
from public.qrm_intellidealer_customer_import_runs r;

comment on view public.qrm_intellidealer_customer_import_dashboard is
  'Read-only IntelliDealer customer import reconciliation view for admin UI. security_invoker=true keeps base-table RLS in force.';

grant select on public.qrm_intellidealer_customer_import_dashboard to authenticated;
