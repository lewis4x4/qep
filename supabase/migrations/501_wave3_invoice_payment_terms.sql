-- 501_wave3_invoice_payment_terms.sql
--
-- Wave 3 payment-terms relationship for customer invoice headers. Wave 2 added
-- customer default terms on qrm_companies but customer_invoices still only had
-- free-text terms/freight fields. Add the canonical nullable FK without
-- backfilling or dropping legacy codes.
--
-- Rollback notes:
--   drop index if exists public.idx_customer_invoices_payment_terms;
--   alter table public.customer_invoices drop constraint if exists customer_invoices_payment_terms_id_wave3_fkey;
--   alter table public.customer_invoices drop column if exists payment_terms_id;

alter table public.customer_invoices
  add column if not exists payment_terms_id uuid;

comment on column public.customer_invoices.payment_terms_id is
  'Canonical AR payment terms applied to this invoice; nullable during IntelliDealer cutover when only legacy terms_code is available.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.customer_invoices'::regclass
      and c.contype = 'f'
      and a.attname = 'payment_terms_id'
  ) then
    alter table public.customer_invoices
      add constraint customer_invoices_payment_terms_id_wave3_fkey
      foreign key (payment_terms_id) references public.payment_terms(id) on delete set null not valid;
  end if;
end $$;

create index if not exists idx_customer_invoices_payment_terms
  on public.customer_invoices (workspace_id, payment_terms_id)
  where payment_terms_id is not null;
comment on index public.idx_customer_invoices_payment_terms is
  'Purpose: AR invoice aging and payment-term compliance reporting by canonical terms row.';
