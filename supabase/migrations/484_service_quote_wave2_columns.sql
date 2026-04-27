-- 484_service_quote_wave2_columns.sql
-- Wave 2 column extensions for service_quotes from Phase-4.

alter table public.service_quotes
  add column if not exists quote_number text,
  add column if not exists assigned_salesperson_id uuid references public.profiles(id) on delete set null,
  add column if not exists is_master boolean not null default false,
  add column if not exists cloned_from_quote_id uuid references public.service_quotes(id) on delete set null;

comment on column public.service_quotes.quote_number is 'IntelliDealer Work Order Quote reference number.';
comment on column public.service_quotes.is_master is 'Include Master Quotes filter support.';

create unique index if not exists idx_service_quotes_quote_number
  on public.service_quotes (workspace_id, quote_number)
  where quote_number is not null;
comment on index public.idx_service_quotes_quote_number is 'Purpose: Work Order Quoting reference lookup.';

create index if not exists idx_service_quotes_assigned_salesperson
  on public.service_quotes (workspace_id, assigned_salesperson_id)
  where assigned_salesperson_id is not null;
comment on index public.idx_service_quotes_assigned_salesperson is 'Purpose: service quote list filters by assigned salesperson.';
