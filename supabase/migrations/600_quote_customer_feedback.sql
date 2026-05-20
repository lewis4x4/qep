-- Additive customer feedback capture for quote QR landing NPS submissions (A3.10-1).

set statement_timeout = 0;

create table if not exists public.quote_customer_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),

  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,
  quote_package_version_id uuid references public.quote_package_versions(id) on delete set null,
  quote_document_artifact_id uuid references public.quote_document_artifacts(id) on delete set null,

  deal_id uuid references public.qrm_deals(id) on delete set null,
  contact_id uuid references public.qrm_contacts(id) on delete set null,
  company_id uuid references public.qrm_companies(id) on delete set null,

  source text not null default 'qr_landing'
    check (source in ('qr_landing', 'deal_room', 'email_link')),

  client_submission_id uuid not null,

  nps_score integer not null check (nps_score between 0 and 10),
  fit_score integer not null check (fit_score between 1 and 5),
  missing_or_unclear text check (
    missing_or_unclear is null or char_length(missing_or_unclear) <= 1000
  ),

  contact_requested boolean not null default false,

  submitted_name text check (
    submitted_name is null or char_length(submitted_name) <= 200
  ),
  submitted_email text check (
    submitted_email is null or char_length(submitted_email) <= 320
  ),

  user_agent text check (
    user_agent is null or char_length(user_agent) <= 500
  ),
  ip_hash text check (
    ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$'
  ),

  rep_user_id uuid references public.profiles(id) on delete set null,
  rep_notified_at timestamptz,
  lifecycle_event_id uuid references public.customer_lifecycle_events(id) on delete set null,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_quote_customer_feedback_client_submission
  on public.quote_customer_feedback (quote_package_id, client_submission_id);

create index if not exists idx_quote_customer_feedback_quote_created
  on public.quote_customer_feedback (quote_package_id, created_at desc);

create index if not exists idx_quote_customer_feedback_workspace_created
  on public.quote_customer_feedback (workspace_id, created_at desc);

create index if not exists idx_quote_customer_feedback_rep_created
  on public.quote_customer_feedback (rep_user_id, created_at desc)
  where rep_user_id is not null;

alter table public.quote_customer_feedback enable row level security;

drop policy if exists "qcf_service_all" on public.quote_customer_feedback;
create policy "qcf_service_all" on public.quote_customer_feedback for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "qcf_staff_select_workspace" on public.quote_customer_feedback;
create policy "qcf_staff_select_workspace" on public.quote_customer_feedback for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

comment on table public.quote_customer_feedback is
  'Public quote landing feedback submissions keyed by quote share token with idempotent client_submission_id dedupe.';