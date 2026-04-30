-- ============================================================================
-- Migration 518: stabilize IntelliDealer dashboard reconciliation counts
--
-- The browser dashboard only needs aggregate reconciliation counts. Reading the
-- security-invoker dashboard view as an authenticated user can make PostgREST
-- evaluate several RLS-heavy count subqueries and intermittently hit statement
-- timeouts. This SECURITY DEFINER function returns counts only, with an
-- explicit elevated-role guard, and never exposes sensitive row payloads.
-- ============================================================================

create or replace function public.qrm_intellidealer_customer_import_run_counts(p_run_id uuid)
returns table (
  master_stage_count bigint,
  contacts_stage_count bigint,
  contact_memos_stage_count bigint,
  contact_memos_nonblank_count bigint,
  ar_agency_stage_count bigint,
  profitability_stage_count bigint,
  mapped_master_count bigint,
  mapped_contacts_count bigint,
  mapped_ar_agency_count bigint,
  mapped_profitability_count bigint,
  canonical_ar_agencies_count bigint,
  canonical_profitability_facts_count bigint,
  raw_card_rows_count bigint,
  redacted_card_rows_count bigint,
  import_errors_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
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
  from public.qrm_intellidealer_customer_import_runs r
  where r.id = p_run_id
    and (
      auth.role() = 'service_role'
      or public.get_my_role() in ('admin', 'manager', 'owner')
    );
$$;

revoke execute on function public.qrm_intellidealer_customer_import_run_counts(uuid) from public;
grant execute on function public.qrm_intellidealer_customer_import_run_counts(uuid) to authenticated, service_role;

comment on function public.qrm_intellidealer_customer_import_run_counts(uuid) is
  'Returns aggregate-only IntelliDealer import reconciliation counts for elevated dashboard users without exposing sensitive rows.';

-- ============================================================================
-- Migration 518 complete.
-- ============================================================================
