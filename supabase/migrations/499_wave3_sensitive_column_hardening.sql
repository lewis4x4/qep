-- 499_wave3_sensitive_column_hardening.sql
--
-- Wave 3 RLS/masking hardening for sensitive Wave 2 columns.
-- Non-destructive: no columns are dropped/renamed; direct writes are guarded,
-- helper masks are additive, and public compatibility views stay security_invoker.
--
-- Rollback notes:
--   drop the triggers/functions created below, recreate crm_companies from 496,
--   and grant column SELECTs back to authenticated if required.

create or replace function public.qrm_can_access_customer_financial()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- There is no finance public.user_role in this repo yet. Match the Wave 0
  -- EIN guard: service_role plus elevated internal roles.
  select auth.role() = 'service_role'
    or coalesce(public.get_my_role()::text, '') in ('admin', 'manager', 'owner');
$$;

comment on function public.qrm_can_access_customer_financial() is
  'Returns true for service callers and elevated QEP roles allowed to view/write sensitive customer finance and tax-routing fields.';

revoke execute on function public.qrm_can_access_customer_financial() from public;
grant execute on function public.qrm_can_access_customer_financial() to authenticated, service_role;

create or replace function public.mask_customer_money_cents(p_cents bigint)
returns bigint
language sql
stable
set search_path = ''
as $$
  select case when public.qrm_can_access_customer_financial() then p_cents else null end;
$$;

comment on function public.mask_customer_money_cents(bigint) is
  'Returns money-in-cents only to qrm_can_access_customer_financial callers; otherwise NULL.';

revoke execute on function public.mask_customer_money_cents(bigint) from public;
grant execute on function public.mask_customer_money_cents(bigint) to authenticated, service_role;

create or replace function public.mask_sensitive_identifier(p_value text, p_keep_right integer default 4)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_value is null then null
    when public.qrm_can_access_customer_financial() then p_value
    when length(regexp_replace(p_value, '\s+', '', 'g')) <= greatest(p_keep_right, 0) then '••••'
    else repeat('•', greatest(length(p_value) - greatest(p_keep_right, 0), 4)) || right(p_value, greatest(p_keep_right, 0))
  end;
$$;

comment on function public.mask_sensitive_identifier(text, integer) is
  'Masks tax, credit, lien, and routing identifiers unless the caller has customer-financial access.';

revoke execute on function public.mask_sensitive_identifier(text, integer) from public;
grant execute on function public.mask_sensitive_identifier(text, integer) to authenticated, service_role;

-- Extend migration 237's equipment-financial guard to Wave 2 equipment finance,
-- floorplan, rental, invoice, and GL-routing fields.
revoke select (
  current_cost_cents,
  net_book_value_cents,
  supplier_invoice_number,
  supplier_invoice_date,
  supplier_invoice_amount_cents,
  reference_amount_cents,
  note_amount_cents,
  note_code,
  note_due_date,
  finance_amount_cents,
  finance_due_date,
  settlement_number,
  settlement_date,
  maintenance_expense_cents,
  rental_cost_pct,
  rental_insurable_amount_cents,
  rental_amount_cents,
  sale_gl_account,
  inventory_gl_account
) on table public.qrm_equipment from authenticated;

grant select (
  current_cost_cents,
  net_book_value_cents,
  supplier_invoice_number,
  supplier_invoice_date,
  supplier_invoice_amount_cents,
  reference_amount_cents,
  note_amount_cents,
  note_code,
  note_due_date,
  finance_amount_cents,
  finance_due_date,
  settlement_number,
  settlement_date,
  maintenance_expense_cents,
  rental_cost_pct,
  rental_insurable_amount_cents,
  rental_amount_cents,
  sale_gl_account,
  inventory_gl_account
) on table public.qrm_equipment to service_role;

create or replace function public.crm_guard_rep_equipment_financial_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.qrm_can_access_customer_financial() then
    return new;
  end if;

  if tg_op = 'INSERT' and (
    new.purchase_price is not null
    or new.current_market_value is not null
    or new.replacement_cost is not null
    or new.daily_rental_rate is not null
    or new.weekly_rental_rate is not null
    or new.monthly_rental_rate is not null
    or new.current_cost_cents is not null
    or new.net_book_value_cents is not null
    or new.supplier_invoice_number is not null
    or new.supplier_invoice_date is not null
    or new.supplier_invoice_amount_cents is not null
    or new.reference_amount_cents is not null
    or new.note_amount_cents is not null
    or new.note_code is not null
    or new.note_due_date is not null
    or new.finance_amount_cents is not null
    or new.finance_due_date is not null
    or new.settlement_number is not null
    or new.settlement_date is not null
    or new.maintenance_expense_cents is not null
    or new.rental_cost_pct is not null
    or new.rental_insurable_amount_cents is not null
    or new.rental_amount_cents is not null
    or new.sale_gl_account is not null
    or new.inventory_gl_account is not null
  ) then
    raise exception 'FORBIDDEN_EQUIPMENT_FINANCIAL_WRITE'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (
    new.purchase_price is distinct from old.purchase_price
    or new.current_market_value is distinct from old.current_market_value
    or new.replacement_cost is distinct from old.replacement_cost
    or new.daily_rental_rate is distinct from old.daily_rental_rate
    or new.weekly_rental_rate is distinct from old.weekly_rental_rate
    or new.monthly_rental_rate is distinct from old.monthly_rental_rate
    or new.current_cost_cents is distinct from old.current_cost_cents
    or new.net_book_value_cents is distinct from old.net_book_value_cents
    or new.supplier_invoice_number is distinct from old.supplier_invoice_number
    or new.supplier_invoice_date is distinct from old.supplier_invoice_date
    or new.supplier_invoice_amount_cents is distinct from old.supplier_invoice_amount_cents
    or new.reference_amount_cents is distinct from old.reference_amount_cents
    or new.note_amount_cents is distinct from old.note_amount_cents
    or new.note_code is distinct from old.note_code
    or new.note_due_date is distinct from old.note_due_date
    or new.finance_amount_cents is distinct from old.finance_amount_cents
    or new.finance_due_date is distinct from old.finance_due_date
    or new.settlement_number is distinct from old.settlement_number
    or new.settlement_date is distinct from old.settlement_date
    or new.maintenance_expense_cents is distinct from old.maintenance_expense_cents
    or new.rental_cost_pct is distinct from old.rental_cost_pct
    or new.rental_insurable_amount_cents is distinct from old.rental_insurable_amount_cents
    or new.rental_amount_cents is distinct from old.rental_amount_cents
    or new.sale_gl_account is distinct from old.sale_gl_account
    or new.inventory_gl_account is distinct from old.inventory_gl_account
  ) then
    raise exception 'FORBIDDEN_EQUIPMENT_FINANCIAL_WRITE'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.crm_guard_rep_equipment_financial_write() from public;

drop trigger if exists guard_rep_equipment_financial_write on public.qrm_equipment;
create trigger guard_rep_equipment_financial_write
  before insert or update on public.qrm_equipment
  for each row execute function public.crm_guard_rep_equipment_financial_write();

-- Guard customer financial/tax/routing fields even if a future policy grants
-- broader direct qrm_companies writes.
create or replace function public.qrm_companies_guard_sensitive_financial_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.qrm_can_access_customer_financial() then
    return new;
  end if;

  if (tg_op = 'INSERT' and (
      new.credit_limit_cents is not null
      or new.credit_limit_set_by is not null
      or new.credit_limit_set_at is not null
      or new.credit_limit_review_at is not null
      or new.duns_number is not null
      or new.naics_code is not null
      or new.tax_code_equipment is not null
      or new.tax_code_parts is not null
      or new.tax_code_service is not null
      or new.tax_code_rental is not null
      or new.labor_tax_code_1 is not null
      or new.labor_tax_code_2 is not null
      or new.exempt_status_notes is not null
      or new.avatax_entity_use_code is not null
      or new.ibe_account_number is not null
      or new.ar_type is distinct from 'open_item'::public.ar_type
      or new.payment_terms_id is not null
      or new.payment_terms_code is not null
      or new.terms_code is not null
      or new.ar_agency_id is not null
      or new.total_ar_cents is not null
      or new.current_ar_balance is distinct from 0
      or new.highest_ar_balance is not null
      or new.credit_rating is not null
    )) or (tg_op = 'UPDATE' and (
      new.credit_limit_cents is distinct from old.credit_limit_cents
      or new.credit_limit_set_by is distinct from old.credit_limit_set_by
      or new.credit_limit_set_at is distinct from old.credit_limit_set_at
      or new.credit_limit_review_at is distinct from old.credit_limit_review_at
      or new.duns_number is distinct from old.duns_number
      or new.naics_code is distinct from old.naics_code
      or new.tax_code_equipment is distinct from old.tax_code_equipment
      or new.tax_code_parts is distinct from old.tax_code_parts
      or new.tax_code_service is distinct from old.tax_code_service
      or new.tax_code_rental is distinct from old.tax_code_rental
      or new.labor_tax_code_1 is distinct from old.labor_tax_code_1
      or new.labor_tax_code_2 is distinct from old.labor_tax_code_2
      or new.exempt_status_notes is distinct from old.exempt_status_notes
      or new.avatax_entity_use_code is distinct from old.avatax_entity_use_code
      or new.ibe_account_number is distinct from old.ibe_account_number
      or new.ar_type is distinct from old.ar_type
      or new.payment_terms_id is distinct from old.payment_terms_id
      or new.payment_terms_code is distinct from old.payment_terms_code
      or new.terms_code is distinct from old.terms_code
      or new.ar_agency_id is distinct from old.ar_agency_id
      or new.total_ar_cents is distinct from old.total_ar_cents
      or new.current_ar_balance is distinct from old.current_ar_balance
      or new.highest_ar_balance is distinct from old.highest_ar_balance
      or new.credit_rating is distinct from old.credit_rating
    )) then
    raise exception 'FORBIDDEN_CUSTOMER_FINANCIAL_WRITE'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.qrm_companies_guard_sensitive_financial_write() is
  'Blocks non-elevated callers from inserting/changing customer credit, tax identity, AR routing, and financial-cache columns.';

revoke execute on function public.qrm_companies_guard_sensitive_financial_write() from public;

drop trigger if exists trg_qrm_companies_guard_sensitive_financial on public.qrm_companies;
create trigger trg_qrm_companies_guard_sensitive_financial
  before insert or update of
    credit_limit_cents,
    credit_limit_set_by,
    credit_limit_set_at,
    credit_limit_review_at,
    duns_number,
    naics_code,
    tax_code_equipment,
    tax_code_parts,
    tax_code_service,
    tax_code_rental,
    labor_tax_code_1,
    labor_tax_code_2,
    exempt_status_notes,
    avatax_entity_use_code,
    ibe_account_number,
    ar_type,
    payment_terms_id,
    payment_terms_code,
    terms_code,
    ar_agency_id,
    total_ar_cents,
    current_ar_balance,
    highest_ar_balance,
    credit_rating
  on public.qrm_companies
  for each row
  execute function public.qrm_companies_guard_sensitive_financial_write();

-- Customer invoice AR/cash routing fields are finance-only. Keep the existing
-- table/API shape but remove default client column reads and block non-elevated
-- direct writes.
revoke select (cash_code, ar_account_number, ar_agency_id, statement_run_id)
  on table public.customer_invoices from authenticated;
grant select (cash_code, ar_account_number, ar_agency_id, statement_run_id)
  on table public.customer_invoices to service_role;

create or replace function public.customer_invoices_guard_financial_routing_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.qrm_can_access_customer_financial() then
    return new;
  end if;

  if (tg_op = 'INSERT' and (
      new.cash_code is not null
      or new.ar_account_number is not null
      or new.ar_agency_id is not null
      or new.statement_run_id is not null
    )) or (tg_op = 'UPDATE' and (
      new.cash_code is distinct from old.cash_code
      or new.ar_account_number is distinct from old.ar_account_number
      or new.ar_agency_id is distinct from old.ar_agency_id
      or new.statement_run_id is distinct from old.statement_run_id
    )) then
    raise exception 'FORBIDDEN_CUSTOMER_INVOICE_FINANCIAL_ROUTING_WRITE'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.customer_invoices_guard_financial_routing_write() from public;

drop trigger if exists trg_customer_invoices_guard_financial_routing on public.customer_invoices;
create trigger trg_customer_invoices_guard_financial_routing
  before insert or update of cash_code, ar_account_number, ar_agency_id, statement_run_id
  on public.customer_invoices
  for each row
  execute function public.customer_invoices_guard_financial_routing_write();

-- Trade-in payoff/lien fields are sensitive finance fields.
create or replace function public.qb_can_access_trade_in_financial()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.role() = 'service_role'
    or coalesce(public.get_my_role()::text, '') in ('admin', 'manager', 'owner');
$$;

revoke execute on function public.qb_can_access_trade_in_financial() from public;
grant execute on function public.qb_can_access_trade_in_financial() to authenticated, service_role;

revoke select (
  payoff_amount_cents,
  payoff_good_through_date,
  lien_holder_name,
  lien_holder_address,
  lien_holder_account_number,
  lien_release_received_at,
  title_received_at
) on table public.qb_trade_ins from authenticated;

grant select (
  payoff_amount_cents,
  payoff_good_through_date,
  lien_holder_name,
  lien_holder_address,
  lien_holder_account_number,
  lien_release_received_at,
  title_received_at
) on table public.qb_trade_ins to service_role;

create or replace function public.qb_trade_ins_guard_financial_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.qb_can_access_trade_in_financial() then
    return new;
  end if;

  if (tg_op = 'INSERT' and (
      new.payoff_amount_cents is not null
      or new.payoff_good_through_date is not null
      or new.lien_holder_name is not null
      or new.lien_holder_address is not null
      or new.lien_holder_account_number is not null
      or new.lien_release_received_at is not null
      or new.title_received_at is not null
    )) or (tg_op = 'UPDATE' and (
      new.payoff_amount_cents is distinct from old.payoff_amount_cents
      or new.payoff_good_through_date is distinct from old.payoff_good_through_date
      or new.lien_holder_name is distinct from old.lien_holder_name
      or new.lien_holder_address is distinct from old.lien_holder_address
      or new.lien_holder_account_number is distinct from old.lien_holder_account_number
      or new.lien_release_received_at is distinct from old.lien_release_received_at
      or new.title_received_at is distinct from old.title_received_at
    )) then
    raise exception 'FORBIDDEN_TRADE_IN_FINANCIAL_WRITE'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.qb_trade_ins_guard_financial_write() from public;

drop trigger if exists trg_qb_trade_ins_guard_financial on public.qb_trade_ins;
create trigger trg_qb_trade_ins_guard_financial
  before insert or update of
    payoff_amount_cents,
    payoff_good_through_date,
    lien_holder_name,
    lien_holder_address,
    lien_holder_account_number,
    lien_release_received_at,
    title_received_at
  on public.qb_trade_ins
  for each row
  execute function public.qb_trade_ins_guard_financial_write();

-- Refresh CRM compatibility view so sensitive customer financial/identity fields
-- are masked by default. Direct qrm_companies access remains RLS-scoped.
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
    ((duns_number is not null or naics_code is not null or ibe_account_number is not null) and not public.qrm_can_access_customer_financial()) as identity_financial_fields_masked
  from public.qrm_companies;

comment on view public.crm_companies is
  'CRM company compatibility view. EIN plus Wave 2 credit/tax identity/customer-financial fields are role-masked; raw qrm_companies remains RLS-scoped.';
