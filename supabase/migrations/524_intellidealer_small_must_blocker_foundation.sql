-- 524_intellidealer_small_must_blocker_foundation.sql
--
-- Small remaining IntelliDealer must-blocker foundations outside rental and
-- Deal Genome/service-analysis scopes.
--
-- Intentional non-goals:
-- - No parts_invoices header table is created. Phase 3 parts invoice headers
--   are canonicalized onto public.customer_invoices; public.parts_invoice_lines
--   remains the line-detail surface.
-- - No rental-specific views/tables are introduced here.
-- - No service-analysis/Deal Genome WIP views are introduced here; Wave 4
--   already provides mv_service_jobs_wip, mv_service_wip_aging, and
--   v_tech_daily_capacity.

alter table public.service_agreements
  add column if not exists expiry_date date generated always as (expires_on) stored;

comment on column public.service_agreements.expiry_date is
  'IntelliDealer expiry_date compatibility alias generated from existing service_agreements.expires_on for renewal/expiry audit surfaces.';

create index if not exists idx_service_agreements_expiry_date
  on public.service_agreements (workspace_id, status, expiry_date)
  where deleted_at is null;
comment on index public.idx_service_agreements_expiry_date is
  'Purpose: 60-day service agreement expiry alerts using the IntelliDealer expiry_date compatibility column.';

create index if not exists idx_vendor_invoices_ap_aging_foundation
  on public.vendor_invoices (workspace_id, status, due_date, invoice_date)
  where deleted_at is null and status in ('open', 'partial');
comment on index public.idx_vendor_invoices_ap_aging_foundation is
  'Purpose: Phase 8 AP aging over canonical vendor_invoices without exposing vendor TIN/W-9 data.';

do $$
begin
  if to_regclass('public.v_vendor_invoice_aging') is null then
    execute $view$
      create view public.v_vendor_invoice_aging
        with (security_invoker = true) as
      select
        vi.id,
        vi.workspace_id,
        vi.vendor_id,
        vp.name as vendor_name,
        vp.vendor_number,
        vi.vendor_invoice_number,
        vi.invoice_date,
        vi.due_date,
        vi.ap_account_number,
        vi.po_number,
        vi.terms_code,
        vi.hold_status,
        vi.is_1099_reportable,
        vi.branch_id,
        vi.status,
        vi.amount,
        vi.amount_paid,
        vi.balance_due,
        round(vi.balance_due * 100)::bigint as balance_due_cents,
        'due_date'::text as aging_basis,
        case
          when current_date - vi.due_date <= 30 then 'current'
          when current_date - vi.due_date <= 60 then '31_60'
          when current_date - vi.due_date <= 90 then '61_90'
          when current_date - vi.due_date <= 120 then '91_120'
          else 'over_120'
        end as due_age_bucket,
        case
          when current_date - vi.invoice_date <= 30 then 'current'
          when current_date - vi.invoice_date <= 60 then '31_60'
          when current_date - vi.invoice_date <= 90 then '61_90'
          when current_date - vi.invoice_date <= 120 then '91_120'
          else 'over_120'
        end as invoice_age_bucket,
        greatest(current_date - vi.due_date, 0) as days_overdue,
        greatest(current_date - vi.invoice_date, 0) as days_from_invoice
      from public.vendor_invoices vi
      join public.vendor_profiles vp on vp.id = vi.vendor_id
      where vi.deleted_at is null
        and vi.status <> 'void'
        and vi.balance_due > 0
    $view$;

    comment on view public.v_vendor_invoice_aging is
      'Phase 8 AP aging detail over vendor_invoices. Complements existing ap_aging_view over ap_bills and intentionally omits sensitive vendor TIN/W-9 fields.';
  end if;
end $$;

create index if not exists idx_customer_invoices_portal_ar_aging
  on public.customer_invoices (workspace_id, portal_customer_id, due_date)
  where balance_due > 0 and status not in ('paid', 'void');
comment on index public.idx_customer_invoices_portal_ar_aging is
  'Purpose: Phase 9 customer portal AR aging by portal customer from canonical customer_invoices.';

create index if not exists idx_customer_invoices_company_ar_aging
  on public.customer_invoices (workspace_id, crm_company_id, due_date)
  where crm_company_id is not null and balance_due > 0 and status not in ('paid', 'void');
comment on index public.idx_customer_invoices_company_ar_aging is
  'Purpose: Phase 9 customer portal AR aging by linked CRM company from canonical customer_invoices.';

create index if not exists idx_customer_invoices_portal_parts_history
  on public.customer_invoices (workspace_id, portal_customer_id, invoice_date desc)
  where status <> 'void' and (invoice_type = 'parts' or invoice_source_code = 'PARTS');
comment on index public.idx_customer_invoices_portal_parts_history is
  'Purpose: Phase 9 portal parts invoice history over canonical customer_invoices.';

create index if not exists idx_customer_invoices_company_parts_history
  on public.customer_invoices (workspace_id, crm_company_id, invoice_date desc)
  where crm_company_id is not null
    and status <> 'void'
    and (invoice_type = 'parts' or invoice_source_code = 'PARTS');
comment on index public.idx_customer_invoices_company_parts_history is
  'Purpose: Phase 9 portal parts invoice history by CRM company over canonical customer_invoices.';

do $$
begin
  if to_regclass('public.v_customer_portal_ar_aging') is null then
    execute $view$
      create view public.v_customer_portal_ar_aging
        with (security_invoker = true) as
      select
        pc.workspace_id,
        pc.id as portal_customer_id,
        pc.crm_company_id as company_id,
        sum(case when ci.due_date >= current_date then round(ci.balance_due * 100) else 0 end)::bigint as current_cents,
        sum(case when ci.due_date between current_date - interval '30 days' and current_date - interval '1 day' then round(ci.balance_due * 100) else 0 end)::bigint as d30_cents,
        sum(case when ci.due_date between current_date - interval '60 days' and current_date - interval '31 days' then round(ci.balance_due * 100) else 0 end)::bigint as d60_cents,
        sum(case when ci.due_date between current_date - interval '90 days' and current_date - interval '61 days' then round(ci.balance_due * 100) else 0 end)::bigint as d90_cents,
        sum(case when ci.due_date < current_date - interval '90 days' then round(ci.balance_due * 100) else 0 end)::bigint as d120plus_cents,
        sum(round(ci.balance_due * 100))::bigint as total_cents,
        min(ci.due_date) as oldest_due_date,
        max(ci.invoice_date) as latest_invoice_date,
        count(ci.id)::integer as open_invoice_count
      from public.portal_customers pc
      join public.customer_invoices ci
        on ci.workspace_id = pc.workspace_id
       and (
         ci.portal_customer_id = pc.id
         or (pc.crm_company_id is not null and ci.crm_company_id = pc.crm_company_id)
       )
      where pc.is_active
        and ci.balance_due > 0
        and ci.status not in ('paid', 'void')
      group by pc.workspace_id, pc.id, pc.crm_company_id
    $view$;

    comment on view public.v_customer_portal_ar_aging is
      'Phase 9 customer portal AR aging from canonical customer_invoices. Includes invoices linked directly to the portal user or to the same CRM company.';
  end if;

  if to_regclass('public.v_customer_portal_open_parts_invoices') is null then
    execute $view$
      create view public.v_customer_portal_open_parts_invoices
        with (security_invoker = true) as
      select
        pc.workspace_id,
        pc.id as portal_customer_id,
        pc.crm_company_id as company_id,
        ci.id as customer_invoice_id,
        ci.invoice_number,
        ci.order_number,
        ci.invoice_date,
        ci.due_date,
        ci.status,
        ci.po_number,
        ci.ship_via,
        ci.freight_terms,
        ci.total,
        ci.balance_due,
        round(ci.total * 100)::bigint as total_cents,
        round(ci.balance_due * 100)::bigint as balance_due_cents,
        coalesce(count(pil.id), 0)::integer as line_count,
        coalesce(sum(pil.qty_ordered), 0)::integer as qty_ordered,
        coalesce(sum(pil.qty_issued), 0)::integer as qty_issued,
        coalesce(sum(pil.qty_shipped), 0)::integer as qty_shipped,
        coalesce(sum(pil.qty_invoiced), 0)::integer as qty_invoiced
      from public.portal_customers pc
      join public.customer_invoices ci
        on ci.workspace_id = pc.workspace_id
       and (
         ci.portal_customer_id = pc.id
         or (pc.crm_company_id is not null and ci.crm_company_id = pc.crm_company_id)
       )
      left join public.parts_invoice_lines pil
        on pil.workspace_id = ci.workspace_id
       and pil.customer_invoice_id = ci.id
       and pil.deleted_at is null
      where pc.is_active
        and ci.status not in ('paid', 'void')
        and ci.balance_due > 0
        and (ci.invoice_type = 'parts' or ci.invoice_source_code = 'PARTS')
      group by
        pc.workspace_id,
        pc.id,
        pc.crm_company_id,
        ci.id,
        ci.invoice_number,
        ci.order_number,
        ci.invoice_date,
        ci.due_date,
        ci.status,
        ci.po_number,
        ci.ship_via,
        ci.freight_terms,
        ci.total,
        ci.balance_due
    $view$;

    comment on view public.v_customer_portal_open_parts_invoices is
      'Phase 9 customer portal open parts invoices from canonical customer_invoices plus parts_invoice_lines; no duplicate parts_invoices header is introduced.';
  end if;

  if to_regclass('public.v_customer_portal_parts_invoice_history') is null then
    execute $view$
      create view public.v_customer_portal_parts_invoice_history
        with (security_invoker = true) as
      select
        pc.workspace_id,
        pc.id as portal_customer_id,
        pc.crm_company_id as company_id,
        ci.id as customer_invoice_id,
        ci.invoice_number,
        ci.order_number,
        ci.invoice_date,
        ci.due_date,
        ci.status,
        ci.po_number,
        ci.ship_via,
        ci.freight_terms,
        ci.cash_code,
        ci.discount_code,
        ci.tax_breakdown,
        ci.print_parameters,
        ci.total,
        ci.balance_due,
        round(ci.total * 100)::bigint as total_cents,
        round(ci.balance_due * 100)::bigint as balance_due_cents,
        coalesce(count(pil.id), 0)::integer as line_count,
        coalesce(sum(pil.extended_price_cents), 0)::bigint as lines_total_cents,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'sort_order', pil.sort_order,
              'part_number', pil.part_number,
              'description', pil.description,
              'cash_code', pil.cash_code,
              'bin_location', pil.bin_location,
              'qty_ordered', pil.qty_ordered,
              'qty_issued', pil.qty_issued,
              'qty_shipped', pil.qty_shipped,
              'qty_invoiced', pil.qty_invoiced,
              'unit_price_cents', pil.unit_price_cents,
              'extended_price_cents', pil.extended_price_cents
            )
            order by pil.sort_order
          ) filter (where pil.id is not null),
          '[]'::jsonb
        ) as lines
      from public.portal_customers pc
      join public.customer_invoices ci
        on ci.workspace_id = pc.workspace_id
       and (
         ci.portal_customer_id = pc.id
         or (pc.crm_company_id is not null and ci.crm_company_id = pc.crm_company_id)
       )
      left join public.parts_invoice_lines pil
        on pil.workspace_id = ci.workspace_id
       and pil.customer_invoice_id = ci.id
       and pil.deleted_at is null
      where pc.is_active
        and ci.status <> 'void'
        and (ci.invoice_type = 'parts' or ci.invoice_source_code = 'PARTS')
      group by
        pc.workspace_id,
        pc.id,
        pc.crm_company_id,
        ci.id,
        ci.invoice_number,
        ci.order_number,
        ci.invoice_date,
        ci.due_date,
        ci.status,
        ci.po_number,
        ci.ship_via,
        ci.freight_terms,
        ci.cash_code,
        ci.discount_code,
        ci.tax_breakdown,
        ci.print_parameters,
        ci.total,
        ci.balance_due
    $view$;

    comment on view public.v_customer_portal_parts_invoice_history is
      'Phase 9 customer portal parts invoice history from customer_invoices and parts_invoice_lines. Canonical header remains customer_invoices.';
  end if;
end $$;
