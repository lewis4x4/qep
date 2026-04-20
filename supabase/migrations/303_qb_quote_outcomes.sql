-- Migration 303: Quote outcomes (Slice 10 Win/Loss Learning Loop)
--
-- Captures WHY a quote closed — the training fuel for:
--   - Slice 12 cycle-velocity analytics (reason → brand × time)
--   - Slice 13 deal-coach rules (bid-window + relationship signals)
--   - Slice 18 ML deal coach (historical outcome data)
--
-- One row per close transition. Schema is intentionally NOT unique on
-- quote_package_id because a reopened/requoted deal can accumulate
-- multiple outcomes over time; the latest row is the current truth and
-- older rows are history.
--
-- Skippable capture (owner decision): rep can dismiss the capture drawer
-- via "Skip, add reason later" which writes an outcome row with
-- outcome='skipped'. This lets us measure skip-rate and re-prompt later
-- without blocking the close transition.
--
-- Today this FKs to quote_packages (the live quote table). When the
-- full quote_packages → qb_quotes migration lands in a later slice, we
-- add a second FK column on this table and migrate the data.

create table public.qb_quote_outcomes (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        text not null default 'default',
  quote_package_id    uuid not null references public.quote_packages(id) on delete cascade,

  -- Classification
  outcome             text not null check (outcome in ('won', 'lost', 'expired', 'skipped')),

  -- Primary reason. Enumeration aligned with the capture drawer chips.
  -- Nullable because 'skipped' rows carry no reason.
  reason              text check (
    reason is null or reason in (
      'price',           -- we were too expensive
      'timing',          -- customer wasn't ready; deal stalled past window
      'relationship',    -- won/lost on incumbent relationship
      'service_credit',  -- service bundle sealed or killed it
      'financing',       -- rate/terms were decisive
      'competitor',      -- another dealer closed them
      'spec_mismatch',   -- we couldn't configure what they needed
      'other'            -- free-text required in reason_details
    )
  ),

  -- Optional free-text "what actually happened"
  reason_details      text check (
    reason_details is null or char_length(reason_details) between 1 and 2000
  ),

  -- Optional competitor name (if reason = 'competitor')
  competitor          text,

  -- Price sensitivity indicator (null / primary / secondary / none)
  -- Tracks how much PRICE vs. other factors mattered in this deal.
  price_sensitivity   text check (
    price_sensitivity is null or price_sensitivity in ('primary', 'secondary', 'none')
  ),

  -- Capture metadata
  captured_by         uuid references public.profiles(id) on delete set null,
  captured_at         timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

comment on table public.qb_quote_outcomes is
  'Win/loss reasons captured when a quote transitions to accepted/rejected/expired. '
  'Training fuel for the Deal Coach slices (13, 18). Skippable capture writes '
  'outcome=skipped so we can measure skip-rate and re-prompt later.';

create index idx_qb_quote_outcomes_package on public.qb_quote_outcomes(quote_package_id);
create index idx_qb_quote_outcomes_workspace on public.qb_quote_outcomes(workspace_id, captured_at desc);
create index idx_qb_quote_outcomes_outcome on public.qb_quote_outcomes(outcome, captured_at desc);
create index idx_qb_quote_outcomes_reason on public.qb_quote_outcomes(reason) where reason is not null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Mirrors the pattern from qb_freight_zones / qb_price_sheets:
--  - service_role: unrestricted
--  - authenticated users: read within workspace, write requires admin/manager/owner
--    OR captured_by == auth.uid() (lets reps record their own outcomes)

alter table public.qb_quote_outcomes enable row level security;

create policy "qb_quote_outcomes_service" on public.qb_quote_outcomes
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "qb_quote_outcomes_select" on public.qb_quote_outcomes
  for select using (
    workspace_id = public.get_my_workspace()
    and auth.uid() is not null
  );

create policy "qb_quote_outcomes_insert_own_or_admin" on public.qb_quote_outcomes
  for insert with check (
    workspace_id = public.get_my_workspace()
    and (
      public.get_my_role() in ('admin', 'manager', 'owner')
      or captured_by = auth.uid()
    )
  );

create policy "qb_quote_outcomes_update_admin" on public.qb_quote_outcomes
  for update using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  ) with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "qb_quote_outcomes_delete_admin" on public.qb_quote_outcomes
  for delete using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'owner')
  );
