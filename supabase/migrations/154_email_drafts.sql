-- ============================================================================
-- Migration 154: Email Drafts (Wave 5A.2)
--
-- Backing table for the shared draft-email edge function. Drafts are NEVER
-- auto-sent — they sit in this table and the rep reviews/edits/sends from
-- the UI. Used by deal-timing-engine, tariff-tracking, price-file-import,
-- and replacement-cost trade-up nudges.
-- ============================================================================

create table public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  -- What kind of draft and what triggered it
  scenario text not null check (scenario in (
    'budget_cycle', 'price_increase', 'tariff', 'requote', 'trade_up', 'custom'
  )),
  tone text not null default 'consultative' check (tone in ('urgent', 'consultative', 'friendly')),

  -- Linked entities (any combination)
  deal_id uuid references public.crm_deals(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  company_id uuid references public.crm_companies(id) on delete set null,
  equipment_id uuid references public.crm_equipment(id) on delete set null,

  -- Generated content
  subject text not null,
  body text not null,
  preview text,
  urgency_score numeric(3,2) check (urgency_score is null or (urgency_score >= 0 and urgency_score <= 1)),

  -- Source facts the LLM was given (for audit + re-generation)
  context jsonb not null default '{}'::jsonb,

  -- Lifecycle
  status text not null default 'pending' check (status in ('pending', 'edited', 'sent', 'dismissed', 'failed')),
  sent_at timestamptz,
  sent_via text, -- 'gmail' | 'outlook' | 'manual' | etc.

  -- Audit
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.email_drafts is 'AI-generated email drafts staged for rep review. Never auto-sent.';
comment on column public.email_drafts.scenario is 'What triggered this draft — drives the prompt template used.';
comment on column public.email_drafts.context is 'Facts passed to the LLM. Lets us regenerate or audit the draft.';

alter table public.email_drafts enable row level security;

create policy "email_drafts_workspace_select" on public.email_drafts for select
  using (workspace_id = public.get_my_workspace());
create policy "email_drafts_workspace_modify" on public.email_drafts for all
  using (workspace_id = public.get_my_workspace())
  with check (workspace_id = public.get_my_workspace());
create policy "email_drafts_service" on public.email_drafts for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index idx_email_drafts_workspace_status_urgency
  on public.email_drafts(workspace_id, status, urgency_score desc);
create index idx_email_drafts_deal on public.email_drafts(deal_id) where deal_id is not null;
create index idx_email_drafts_created_by on public.email_drafts(created_by) where created_by is not null;
create index idx_email_drafts_scenario_status on public.email_drafts(scenario, status);

create trigger set_email_drafts_updated_at
  before update on public.email_drafts for each row
  execute function public.set_updated_at();
