-- 480_parts_quote_wave2_columns.sql
-- Wave 2 compatibility extension for parts_quotes from Phase-3.
-- Wave 1 already created parts_quotes, so this remains additive only.

alter table public.parts_quotes
  add column if not exists converted_service_job_id uuid references public.service_jobs(id) on delete set null,
  add column if not exists converted_at timestamptz;

comment on column public.parts_quotes.converted_service_job_id is 'Service job created from an accepted parts quote.';
comment on column public.parts_quotes.converted_at is 'Timestamp when the quote was converted to service work.';

create index if not exists idx_parts_quotes_converted_service_job
  on public.parts_quotes (workspace_id, converted_service_job_id)
  where converted_service_job_id is not null;
comment on index public.idx_parts_quotes_converted_service_job is 'Purpose: parts-quote to service-WO drill-through.';
