-- ============================================================================
-- Migration 512: IntelliDealer legacy customer number company search
--
-- Adds the imported legacy customer number to the CRM compatibility company
-- list RPC so QRM users can find imported customers by their IntelliDealer key.
-- ============================================================================

create index if not exists idx_qrm_companies_legacy_customer_number_prefix
  on public.qrm_companies (lower(legacy_customer_number) text_pattern_ops)
  where deleted_at is null and legacy_customer_number is not null;

comment on column public.qrm_companies.legacy_customer_number is
  'Legacy IntelliDealer customer number retained for lookup, audit, and Account 360 source identity.';

create or replace view public.crm_companies
  with (security_invoker = true)
  as
  select
    id,
    workspace_id,
    name,
    parent_company_id,
    assigned_rep_id,
    hubspot_company_id,
    address_line_1,
    address_line_2,
    city,
    state,
    postal_code,
    country,
    metadata,
    created_at,
    updated_at,
    deleted_at,
    legal_name,
    dba,
    phone,
    website,
    classification,
    territory_code,
    county,
    status,
    notes,
    search_1,
    search_2,
    public.mask_customer_ein(ein) as ein,
    (ein is not null and not public.qrm_can_access_customer_ein()) as ein_masked,
    product_category,
    industry,
    size,
    owner_name,
    brand_of_interest,
    township,
    lot,
    concession,
    latitude,
    longitude,
    business_fax,
    business_cell,
    business_email,
    tax_code_equipment,
    tax_code_parts,
    tax_code_service,
    tax_code_rental,
    labor_tax_code_1,
    labor_tax_code_2,
    exempt_status_notes,
    avatax_entity_use_code,
    public.mask_sensitive_identifier(duns_number, 4) as duns_number,
    public.mask_sensitive_identifier(naics_code, 2) as naics_code,
    opt_out_sale_pi,
    opt_out_sale_pi_at,
    opt_out_sale_pi_source,
    ar_type,
    combine_statement_with_parent,
    statement_message,
    statement_date,
    payment_terms_id,
    payment_terms_code,
    terms_code,
    default_po_number,
    default_po_expires_at,
    po_required_on_invoice,
    assess_late_charges,
    print_retail_price,
    print_parts_invoices,
    auto_email_inspection,
    public.mask_sensitive_identifier(ibe_account_number, 4) as ibe_account_number,
    public.mask_customer_money_cents(credit_limit_cents) as credit_limit_cents,
    credit_limit_set_by,
    credit_limit_set_at,
    credit_limit_review_at,
    pricing_group_id,
    pricing_level,
    discount_group,
    preferred_language,
    home_branch_id,
    do_not_contact,
    notify_payment_issues,
    notify_multiple_accounts,
    notify_legal_concerns,
    notify_birthday,
    requires_hazmat_certified_carrier,
    requires_lift_gate,
    requires_signature,
    allow_after_hours_dropoff,
    preferred_carrier,
    shipping_notes,
    header_alert,
    primary_contact_id,
    ar_agency_id,
    public.mask_customer_money_cents(total_ar_cents) as total_ar_cents,
    total_ar_computed_at,
    responsible_branch_id,
    ar_type::text as ar_account_type,
    last_invoice_date,
    avg_payment_days,
    avg_payment_days_calculated_at,
    last_payment_date,
    case when public.qrm_can_access_customer_financial() then highest_ar_balance else null end as highest_ar_balance,
    highest_ar_balance_date,
    (public.mask_customer_money_cents(credit_limit_cents)::numeric / 100.0) as credit_limit,
    'USD'::text as credit_limit_currency,
    credit_limit_review_at::timestamptz as credit_limit_review_at_ts,
    case when public.qrm_can_access_customer_financial() then current_ar_balance else null end as current_ar_balance,
    current_ar_balance_updated_at,
    case when public.qrm_can_access_customer_financial() then credit_rating else null end as credit_rating,
    case when public.qrm_can_access_customer_financial() then credit_rating_source else null end as credit_rating_source,
    case when public.qrm_can_access_customer_financial() then credit_rating_updated_at else null end as credit_rating_updated_at,
    (credit_limit_cents is not null and not public.qrm_can_access_customer_financial()) as credit_limit_masked,
    ((duns_number is not null or naics_code is not null or ibe_account_number is not null) and not public.qrm_can_access_customer_financial()) as identity_financial_fields_masked,
    legacy_customer_number
  from public.qrm_companies;

comment on view public.crm_companies is
  'CRM company compatibility view. Adds IntelliDealer legacy customer number lookup while preserving role-masked financial and identity fields.';

drop function if exists public.list_crm_companies_page(text, text, uuid, integer);

create or replace function public.list_crm_companies_page(
  p_search text default null,
  p_after_name text default null,
  p_after_id uuid default null,
  p_limit integer default 25
)
returns table (
  id uuid,
  workspace_id text,
  name text,
  parent_company_id uuid,
  assigned_rep_id uuid,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  postal_code text,
  country text,
  created_at timestamptz,
  updated_at timestamptz,
  search_1 text,
  search_2 text,
  legacy_customer_number text
)
language sql
security invoker
set search_path = public
as $$
  with normalized as (
    select
      nullif(trim(coalesce(p_search, '')), '') as search_term,
      nullif(replace(replace(lower(trim(coalesce(p_search, ''))), '%', ''), '_', ''), '') as search_prefix
  )
  select
    c.id,
    c.workspace_id,
    c.name,
    c.parent_company_id,
    c.assigned_rep_id,
    c.address_line_1,
    c.address_line_2,
    c.city,
    c.state,
    c.postal_code,
    c.country,
    c.created_at,
    c.updated_at,
    c.search_1,
    c.search_2,
    c.legacy_customer_number
  from public.crm_companies c
  cross join normalized n
  where c.deleted_at is null
    and (
      n.search_term is null
      or c.name ilike ('%' || replace(replace(n.search_term, '%', ''), '_', '') || '%')
      or coalesce(c.city, '') ilike ('%' || replace(replace(n.search_term, '%', ''), '_', '') || '%')
      or coalesce(c.state, '') ilike ('%' || replace(replace(n.search_term, '%', ''), '_', '') || '%')
      or coalesce(c.legacy_customer_number, '') ilike ('%' || replace(replace(n.search_term, '%', ''), '_', '') || '%')
      or (n.search_prefix is not null and lower(coalesce(c.search_1, '')) like (n.search_prefix || '%'))
      or (n.search_prefix is not null and lower(coalesce(c.search_2, '')) like (n.search_prefix || '%'))
      or (n.search_prefix is not null and lower(coalesce(c.legacy_customer_number, '')) like (n.search_prefix || '%'))
    )
    and (
      p_after_id is null
      or (c.name, c.id) > (p_after_name, p_after_id)
    )
  order by c.name asc, c.id asc
  limit greatest(coalesce(p_limit, 25), 1);
$$;
