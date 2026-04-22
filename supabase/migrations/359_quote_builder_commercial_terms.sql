-- ============================================================================
-- 359 · Quote builder commercial terms
--
-- Persists the sales-structuring fields added to the stabilized quote flow.
-- ============================================================================

set statement_timeout = 0;

alter table public.quote_packages
  add column if not exists branch_slug text;

alter table public.quote_packages
  add column if not exists commercial_discount_type text;

alter table public.quote_packages
  add column if not exists commercial_discount_value numeric default 0;

alter table public.quote_packages
  add column if not exists tax_total numeric default 0;

alter table public.quote_packages
  add column if not exists cash_down numeric default 0;

alter table public.quote_packages
  add column if not exists amount_financed numeric default 0;

alter table public.quote_packages
  add column if not exists tax_profile text;

alter table public.quote_packages
  add column if not exists selected_finance_scenario text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_packages_commercial_discount_type_check'
  ) then
    alter table public.quote_packages
      add constraint quote_packages_commercial_discount_type_check
      check (
        commercial_discount_type is null
        or commercial_discount_type in ('flat', 'percent')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_packages_tax_profile_check'
  ) then
    alter table public.quote_packages
      add constraint quote_packages_tax_profile_check
      check (
        tax_profile is null
        or tax_profile in (
          'standard',
          'agriculture_exempt',
          'fire_mitigation_exempt',
          'government_exempt',
          'resale_exempt'
        )
      );
  end if;
end $$;

comment on column public.quote_packages.tax_total is
  'Estimated tax total from the quote builder commercial-terms step.';
comment on column public.quote_packages.branch_slug is
  'Branch selected in the quote builder at the time the draft was saved.';
comment on column public.quote_packages.commercial_discount_type is
  'Quote-level commercial discount mode selected by the rep (flat or percent).';
comment on column public.quote_packages.commercial_discount_value is
  'Raw quote-level commercial discount value entered by the rep.';
comment on column public.quote_packages.cash_down is
  'Customer cash down applied before amount financed is computed.';
comment on column public.quote_packages.amount_financed is
  'Estimated amount financed after discount, trade allowance, tax, and cash down.';
comment on column public.quote_packages.tax_profile is
  'Rep-selected tax intent profile used for estimated tax handling in quote builder.';
comment on column public.quote_packages.selected_finance_scenario is
  'Rep-selected financing scenario label from the quote builder financing step.';
