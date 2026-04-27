-- 498_wave3_status_constraints.sql
--
-- Wave 3 enum/status tightening. Existing free-text columns that are already
-- protected by validated CHECK constraints are converted to enums. Less certain
-- legacy/free-text status columns get NOT VALID checks so new writes tighten
-- without risking a dirty live-data backfill failure.
--
-- Rollback notes:
--   drop the Wave 3 CHECK constraints first if status vocabulary rollback is
--   required. The status columns intentionally remain text to preserve existing
--   text partial indexes.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'customer_status') then
    create type public.customer_status as enum (
      'active', 'inactive', 'prospect', 'credit_hold', 'cash_only',
      'do_not_sell', 'merged', 'archived'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'service_quote_status') then
    create type public.service_quote_status as enum (
      'draft', 'sent', 'approved', 'rejected', 'expired', 'superseded'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'qb_trade_in_disposition') then
    create type public.qb_trade_in_disposition as enum (
      'pending', 'inventory', 'retail', 'wholesale', 'auction',
      'rental_fleet', 'return_to_customer', 'scrap'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'customer_invoice_status') then
    create type public.customer_invoice_status as enum (
      'pending', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'void'
    );
  end if;
end $$;

-- IntelliDealer/QEP equipment availability extensions are intentionally
-- repeated idempotently here because Wave 3 is the documented enum pass.
do $$
begin
  if exists (select 1 from pg_type where typname = 'crm_equipment_availability') then
    alter type public.crm_equipment_availability add value if not exists 'invoiced';
    alter type public.crm_equipment_availability add value if not exists 'on_order';
    alter type public.crm_equipment_availability add value if not exists 'presold';
    alter type public.crm_equipment_availability add value if not exists 'consignment';
    alter type public.crm_equipment_availability add value if not exists 'transferred';
  end if;
end $$;

-- Keep existing text status columns in place and add validated checks instead
-- of converting to enums. This avoids breaking existing text partial indexes
-- while preserving the same allowed lifecycle values for future writes.
do $$
begin
  if to_regclass('public.service_quotes') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'service_quotes' and column_name = 'status')
    and not exists (select 1 from pg_constraint where conname = 'service_quotes_status_wave3_chk') then
    alter table public.service_quotes
      add constraint service_quotes_status_wave3_chk
      check (status::text in ('draft', 'sent', 'approved', 'rejected', 'expired', 'superseded'));
  end if;

  if to_regclass('public.customer_invoices') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_invoices' and column_name = 'status')
    and not exists (select 1 from pg_constraint where conname = 'customer_invoices_status_wave3_chk') then
    alter table public.customer_invoices
      add constraint customer_invoices_status_wave3_chk
      check (status::text in ('pending', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'void'));
  end if;
end $$;

-- Free-text/legacy status fields: tighten new writes only. Existing imported
-- values can be cleaned and VALIDATED in a later data-quality pass.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'qrm_companies_status_wave3_chk') then
    alter table public.qrm_companies
      add constraint qrm_companies_status_wave3_chk
      check (
        status is null or status in (
          'active', 'inactive', 'prospect', 'credit_hold', 'cash_only',
          'do_not_sell', 'merged', 'archived'
        )
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'qb_trade_ins_disposition_wave3_chk') then
    alter table public.qb_trade_ins
      add constraint qb_trade_ins_disposition_wave3_chk
      check (
        disposition is null or disposition in (
          'pending', 'inventory', 'retail', 'wholesale', 'auction',
          'rental_fleet', 'return_to_customer', 'scrap'
        )
      ) not valid;
  end if;
end $$;

comment on type public.customer_status is
  'Wave 3 target enum for qrm_companies.status. Column remains text with NOT VALID check until imported legacy values are proven clean.';
comment on type public.service_quote_status is
  'Reserved Wave 3 lifecycle vocabulary for service_quotes.status. Column remains text with a CHECK constraint to preserve existing partial indexes.';
comment on type public.qb_trade_in_disposition is
  'Wave 3 target enum for qb_trade_ins.disposition. Column remains text with NOT VALID check until trade-in imports are proven clean.';
comment on type public.customer_invoice_status is
  'Reserved Wave 3 lifecycle vocabulary for customer_invoices.status. Column remains text with a CHECK constraint to preserve existing partial indexes.';
