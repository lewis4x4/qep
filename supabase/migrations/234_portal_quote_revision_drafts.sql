-- ============================================================================
-- Migration 234: Portal Quote Revision Drafts
--
-- Internal working state for dealership-side revision authoring and approval
-- before a revised portal proposal is published to the customer.
-- ============================================================================

create table if not exists public.portal_quote_revision_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  portal_quote_review_id uuid not null references public.portal_quote_reviews(id) on delete cascade,
  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  prepared_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'awaiting_approval', 'published', 'superseded')),
  quote_data jsonb not null default '{}'::jsonb,
  quote_pdf_url text,
  dealer_message text,
  revision_summary text,
  customer_request_snapshot text,
  compare_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

comment on table public.portal_quote_revision_drafts is
  'Internal staged revisions for portal quote reviews. Drafts are dealership working state and are not customer-visible.';

create index if not exists idx_pqrd_review_status
  on public.portal_quote_revision_drafts (portal_quote_review_id, status);

create index if not exists idx_pqrd_deal_status
  on public.portal_quote_revision_drafts (deal_id, status);

create unique index if not exists idx_pqrd_active_unique
  on public.portal_quote_revision_drafts (portal_quote_review_id)
  where status in ('draft', 'awaiting_approval');

alter table public.portal_quote_revision_drafts enable row level security;

create policy "portal_quote_revision_drafts_internal_select" on public.portal_quote_revision_drafts
  for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'manager', 'owner')
  );

create policy "portal_quote_revision_drafts_internal_insert" on public.portal_quote_revision_drafts
  for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'manager', 'owner')
  );

create policy "portal_quote_revision_drafts_internal_update" on public.portal_quote_revision_drafts
  for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'manager', 'owner')
  );

create policy "portal_quote_revision_drafts_service" on public.portal_quote_revision_drafts
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists set_portal_quote_revision_drafts_updated_at on public.portal_quote_revision_drafts;
create trigger set_portal_quote_revision_drafts_updated_at
  before update on public.portal_quote_revision_drafts
  for each row execute function public.set_updated_at();
