-- ============================================================================
-- Migration 611: Customer price-lock attribute
--
-- Adds the OEM-DP6 future hook so customer/account records can be explicitly
-- excluded from automatic OEM repricing when QEP later signs price-lock,
-- national-account, or government-contract agreements. No customers are locked
-- by default.
-- ============================================================================

alter table public.qrm_companies
  add column if not exists price_lock_active boolean not null default false,
  add column if not exists price_lock_reason text,
  add column if not exists price_lock_expires_at date;

comment on column public.qrm_companies.price_lock_active is
  'OEM-DP6 future hook. When true, OEM reprice scans must suppress automatic repricing for this customer/account.';
comment on column public.qrm_companies.price_lock_reason is
  'Human-readable reason for a customer price lock, such as national account, government contract, or annual price-lock agreement.';
comment on column public.qrm_companies.price_lock_expires_at is
  'Optional expiration date for the customer price lock. Null means the lock remains active until manually cleared.';

create index if not exists idx_qrm_companies_price_lock_active
  on public.qrm_companies(workspace_id, price_lock_active)
  where price_lock_active = true and deleted_at is null;

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
    legacy_customer_number,
    price_lock_active,
    price_lock_reason,
    price_lock_expires_at
  from public.qrm_companies;

comment on view public.crm_companies is
  'CRM company compatibility view. EIN plus Wave 2 credit/tax identity/customer-financial fields are role-masked; includes OEM-DP6 customer price-lock attributes.';
