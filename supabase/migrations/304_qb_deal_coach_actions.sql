-- Migration 304: Deal Coach action tracking
--
-- Slice 13. Every suggestion the Deal Coach sidebar shows, and every
-- action the rep takes on it (apply / dismiss), lands here. Two
-- purposes:
--   1. Per-quote dismissal memory — don't re-show a dismissed suggestion
--      on the same quote after a refresh.
--   2. Training fuel for Slice 18 ML coach — rule-acceptance data tells
--      the model which suggestions actually move reps.
--
-- Keyed on (quote_package_id, rule_id) — same rule on the same quote
-- collapses to one row via upsert. Status moves through shown → applied
-- or shown → dismissed; no back-transitions.

create table public.qb_deal_coach_actions (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        text not null default 'default',
  quote_package_id    uuid not null references public.quote_packages(id) on delete cascade,

  -- Which rule fired. Matches the rule's registry id (e.g., 'margin_baseline').
  rule_id             text not null,

  -- Severity snapshotted at show-time so we can trend it historically
  severity            text not null check (severity in ('critical', 'warning', 'info')),

  -- Action taken — null means "shown but not yet acted on"
  action              text check (action is null or action in ('applied', 'dismissed')),

  -- Free-form snapshot of the suggestion body at show-time (so Slice 18
  -- can train on the exact text the rep saw, even if rule wording
  -- changes later).
  suggestion_snapshot jsonb,

  -- Metadata
  shown_by            uuid references public.profiles(id) on delete set null,
  shown_at            timestamptz not null default now(),
  acted_at            timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.qb_deal_coach_actions is
  'Per-quote per-rule tracking of Deal Coach suggestions. Drives dismissal memory and Slice 18 training data.';

create unique index ux_qb_deal_coach_actions_quote_rule
  on public.qb_deal_coach_actions(quote_package_id, rule_id);

create index idx_qb_deal_coach_actions_rule
  on public.qb_deal_coach_actions(rule_id, shown_at desc);

create index idx_qb_deal_coach_actions_action
  on public.qb_deal_coach_actions(action, acted_at desc)
  where action is not null;

-- updated_at trigger
create trigger set_qb_deal_coach_actions_updated_at
  before update on public.qb_deal_coach_actions
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.qb_deal_coach_actions enable row level security;

create policy "qb_deal_coach_actions_service" on public.qb_deal_coach_actions
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "qb_deal_coach_actions_select" on public.qb_deal_coach_actions
  for select using (
    workspace_id = public.get_my_workspace()
    and auth.uid() is not null
  );

-- Insert: any authenticated workspace member can record a shown/dismissed/applied row.
-- The shown_by must match the acting user to prevent impersonation.
create policy "qb_deal_coach_actions_insert_own" on public.qb_deal_coach_actions
  for insert with check (
    workspace_id = public.get_my_workspace()
    and auth.uid() is not null
    and (shown_by is null or shown_by = auth.uid())
  );

-- Update: shown_by or admin can update the action column + acted_at.
-- This matches the upsert-then-update pattern on apply/dismiss.
create policy "qb_deal_coach_actions_update_own_or_admin" on public.qb_deal_coach_actions
  for update using (
    workspace_id = public.get_my_workspace()
    and (
      shown_by = auth.uid()
      or public.get_my_role() in ('admin', 'manager', 'owner')
    )
  ) with check (
    workspace_id = public.get_my_workspace()
    and (
      shown_by = auth.uid()
      or public.get_my_role() in ('admin', 'manager', 'owner')
    )
  );
