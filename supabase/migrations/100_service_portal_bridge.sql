-- ============================================================================
-- Migration 100: Bridge portal tables ↔ internal service engine
-- ============================================================================

alter table public.service_requests
  add column if not exists service_job_id uuid references public.service_jobs(id) on delete set null;

create index if not exists idx_service_requests_internal_job
  on public.service_requests(service_job_id)
  where service_job_id is not null;

comment on column public.service_requests.service_job_id is
  'Internal service_jobs record created from this portal request.';

alter table public.portal_quote_reviews
  add column if not exists service_quote_id uuid references public.service_quotes(id) on delete set null;

create index if not exists idx_portal_quote_reviews_service_quote
  on public.portal_quote_reviews(service_quote_id)
  where service_quote_id is not null;

comment on column public.portal_quote_reviews.service_quote_id is
  'Link to internal service_quotes when portal review mirrors a service quote.';
