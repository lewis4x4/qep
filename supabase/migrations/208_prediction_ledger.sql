-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 208 — Prediction Ledger (Phase 0 P0.3 + P0.8 atomic)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Creates the append-only prediction ledger that records every AI-ranked
-- recommendation the QRM Command Center emits at issue time. Pairs with a
-- nightly grader function (qrm-prediction-scorer) that closes out predictions
-- against observed deal outcomes once they materialize.
--
-- This is the substrate every future AI surface depends on:
--   - Phase 4 Forecast Confidence reads accuracy bands from this ledger.
--   - Phase 5 Trust Thermostat reads belief-decay receipts from this ledger.
--   - Phase 4 Learning Layer trains rerankers from this ledger.
--
-- Without it, the system has no way to grade its own predictions, no way to
-- know whether the ranker is improving over time, and no way to deliver any
-- of the above downstream surfaces honestly.
--
-- ── ATOMIC P0.8 TRACE COLUMNS ───────────────────────────────────────────────
--
-- The roadmap §4 P0.8 originally called for `trace_id` and `trace_steps jsonb`
-- to be added in a follow-up migration on Day 11. We add them HERE in 208 so
-- there is no follow-up. The trace substrate ships atomically with the
-- ledger. Day 11's P0.8 work becomes purely the trace UI route + the
-- `qrm-prediction-trace` function — the schema is already in place.
--
-- ── RETENTION POLICY ────────────────────────────────────────────────────────
--
-- Default: graded predictions (those with non-null `outcome`) are kept
-- forever. Ungraded predictions (`outcome IS NULL`) are pruned at 180 days
-- age. The actual prune job is a Phase 4 nightly that reads this constant
-- and deletes accordingly. Phase 0 Day 4 ships only the schema + the
-- documented intent — no enforcement.
--
-- The retention policy is intentionally NOT a per-row column. A column
-- storing 'graded_forever_ungraded_180d' on every row would be wasteful and
-- would not actually enforce anything. Policy lives:
--   - in this migration's comment (source of truth for engineering)
--   - in the qrm-prediction-retention skeleton scheduled for Phase 4
--   - eventually in workspace_settings if we need per-workspace overrides
--
-- ── SCALE NOTES ─────────────────────────────────────────────────────────────
--
-- Per Slice 1 ranker behavior, each `/qrm/command` request emits up to 24
-- recommendation cards (3 lanes × 8 cap each). At ~10 active reps making 5
-- requests per day, that's ~1,200 ledger rows per day per workspace, or
-- ~440K rows per workspace per year. The (workspace_id, predicted_at desc)
-- WHERE outcome IS NULL partial index keeps the prune scan tight, and the
-- (subject_type, subject_id, predicted_at desc) index keeps point lookups
-- (the trace UI, the grader, the Trust Thermostat) under 10ms.
--
-- ── RLS STRATEGY ────────────────────────────────────────────────────────────
--
-- Inserts: service-role only. The qrm-command-center edge function uses the
-- admin client for ledger writes. This is a bounded admin escalation — the
-- function only writes to qrm_predictions; it never reads from this table
-- via the admin client.
--
-- Reads: managers + owners + admins can read all rows in their workspace
-- (for the trace UI and downstream analytics). Reps can read their own
-- predictions (predictions where the deal's assigned_rep_id = auth.uid()).
-- Per-rep visibility lands in Phase 4 with the Rep Reality Reflection;
-- Phase 0 only ships manager-and-above visibility.
--
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Table 1: qrm_predictions ────────────────────────────────────────────────

create table public.qrm_predictions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  -- When the prediction was made
  predicted_at timestamptz not null default now(),

  -- What the prediction is about
  subject_type text not null check (subject_type in (
    'deal', 'contact', 'company', 'quote', 'demo', 'task'
  )),
  subject_id uuid not null,

  -- The kind of prediction (e.g. 'recommendation:revenue_ready',
  -- 'recommendation:revenue_at_risk', 'recommendation:blockers',
  -- 'chief_of_staff:best_move', 'forecast_confidence:7d')
  prediction_kind text not null,

  -- The numeric score the ranker emitted (0..N, ranker-defined scale)
  score numeric not null,

  -- Pre-formatted, terminology-locked rationale bullets (jsonb array of strings)
  rationale jsonb not null default '[]'::jsonb,

  -- Stable hashes for change detection without deep equality scans:
  --   rationale_hash = sha256(canonical-json(rationale[]))
  --   inputs_hash    = sha256(canonical-json(deal core fields + role weights + ranker version))
  --   signals_hash   = sha256(canonical-json(deal's signal bundle))
  rationale_hash text not null,
  inputs_hash text not null,
  signals_hash text not null,

  -- Where the prediction came from
  --   'rules'      — Phase 0 deterministic ranker (current Slice 1)
  --   'rules+llm'  — Phase 4 LLM-augmented ranker (future)
  model_source text not null check (model_source in ('rules', 'rules+llm')),

  -- Outcome resolution (filled in by qrm-prediction-scorer when the deal
  -- closes or the prediction expires unverified)
  --   'won'        — deal closed-won; prediction matched the ranker's bias
  --   'lost'       — deal closed-lost
  --   'expired'    — prediction window passed without resolution
  --   'snoozed'    — user explicitly dismissed; not a real outcome
  --   NULL         — still open
  outcome text check (outcome is null or outcome in ('won', 'lost', 'expired', 'snoozed')),
  outcome_at timestamptz,
  outcome_logged_by uuid references public.profiles(id) on delete set null,

  -- ── P0.8 trace substrate (atomic with P0.3) ─────────────────────────────
  --
  -- trace_id is a stable identifier the user sees in the URL of the
  -- /qrm/command/trace/:predictionId route (Phase 0 Day 11). Defaults to id
  -- so a prediction without an explicit trace can still be referenced.
  --
  -- trace_steps is the ordered factor-contribution breakdown the ranker
  -- produces (see ScoredDeal.factorContributions in
  -- supabase/functions/_shared/qrm-command-center/ranking.ts). Shape:
  --   [
  --     { "factor": "expectedRevenue",       "value": 0.42, "weight": 1.0 },
  --     { "factor": "urgencyFromCloseDate",  "value": 0.30, "weight": 0.9 },
  --     ...
  --   ]
  trace_id uuid not null default gen_random_uuid(),
  trace_steps jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.qrm_predictions enable row level security;

-- Inserts: service-role only (the edge function writes via admin client).
create policy "qrm_predictions_insert_service"
  on public.qrm_predictions for insert
  with check (auth.role() = 'service_role');

-- Reads: managers + owners + admins see everything in their workspace.
create policy "qrm_predictions_select_elevated"
  on public.qrm_predictions for select
  using (public.get_my_role() in ('manager', 'owner', 'admin'));

-- Reads: reps see predictions about deals they own (subject_type='deal' AND
-- the deal's assigned_rep_id = auth.uid()). Other subject types are not
-- visible to reps until Phase 4 broadens this.
create policy "qrm_predictions_select_own_deal"
  on public.qrm_predictions for select
  using (
    subject_type = 'deal'
    and exists (
      select 1
      from public.crm_deals d
      where d.id = qrm_predictions.subject_id
        and d.assigned_rep_id = auth.uid()
    )
  );

-- Service role can do anything (the qrm-prediction-scorer reads + updates).
create policy "qrm_predictions_service_all"
  on public.qrm_predictions for all
  using (auth.role() = 'service_role');

-- ── Indexes ────────────────────────────────────────────────────────────────

-- Point lookup by subject (the trace UI, the grader, the Trust Thermostat)
create index idx_qrm_predictions_subject
  on public.qrm_predictions (subject_type, subject_id, predicted_at desc);

-- Workspace + time-range scans (manager dashboards, retention prune candidate)
create index idx_qrm_predictions_workspace_time
  on public.qrm_predictions (workspace_id, predicted_at desc);

-- Partial index for the prune candidate set (ungraded predictions only)
create index idx_qrm_predictions_prune_candidates
  on public.qrm_predictions (workspace_id, predicted_at desc)
  where outcome is null;

-- Trace ID lookup (Phase 0 Day 11 trace UI)
create index idx_qrm_predictions_trace_id
  on public.qrm_predictions (trace_id);

-- Inputs/signals hash lookup for dedupe (skip insert if a prediction with
-- the same inputs+signals already exists for this subject within a window)
create index idx_qrm_predictions_dedupe
  on public.qrm_predictions (subject_id, inputs_hash, signals_hash, predicted_at desc);

-- updated_at trigger (matches existing pattern across the codebase)
create trigger set_qrm_predictions_updated_at
  before update on public.qrm_predictions
  for each row execute function public.set_updated_at();

-- ── Table 2: qrm_prediction_outcomes ────────────────────────────────────────
--
-- One row per resolved prediction. Stores the factual outcome and any
-- supporting evidence so the grader can be back-tested itself.
--
-- We keep outcomes in a separate table (rather than just the outcome column
-- on qrm_predictions) because:
--   1. A single prediction can resolve to multiple observed outcomes over
--      time (e.g. provisional 'won' that becomes 'lost' after a refund).
--      The outcomes table preserves the full timeline; qrm_predictions.outcome
--      is the canonical "current state" pointer.
--   2. Outcome rows carry their own evidence payload that we want to audit
--      separately from the prediction itself.
--   3. Phase 4 Forecast Confidence wants outcome rows decoupled so it can
--      build accuracy bands without scanning the full predictions table.

create table public.qrm_prediction_outcomes (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  prediction_id uuid not null references public.qrm_predictions(id) on delete cascade,

  -- Outcome state at this point in time
  outcome text not null check (outcome in ('won', 'lost', 'expired', 'snoozed')),

  -- When the outcome was observed
  observed_at timestamptz not null default now(),

  -- Evidence payload — concrete data the grader used to determine the outcome
  -- (e.g. {"deal_stage_id": "abc", "is_closed_won": true, "closed_at": "..."})
  evidence jsonb not null default '{}'::jsonb,

  -- Source of the outcome determination
  --   'qrm-prediction-scorer' — nightly grader (default)
  --   'manual'                — user override / correction
  --   'webhook'               — future: external system signal
  source text not null default 'qrm-prediction-scorer',

  logged_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.qrm_prediction_outcomes enable row level security;

create policy "qrm_prediction_outcomes_insert_service"
  on public.qrm_prediction_outcomes for insert
  with check (auth.role() = 'service_role');

create policy "qrm_prediction_outcomes_select_elevated"
  on public.qrm_prediction_outcomes for select
  using (public.get_my_role() in ('manager', 'owner', 'admin'));

create policy "qrm_prediction_outcomes_service_all"
  on public.qrm_prediction_outcomes for all
  using (auth.role() = 'service_role');

create index idx_qrm_prediction_outcomes_prediction
  on public.qrm_prediction_outcomes (prediction_id, observed_at desc);

create index idx_qrm_prediction_outcomes_workspace_time
  on public.qrm_prediction_outcomes (workspace_id, observed_at desc);

-- ── Comments for self-documentation ─────────────────────────────────────────

comment on table public.qrm_predictions is
  'Phase 0 P0.3 — Append-only ledger of AI-ranked recommendations the QRM '
  'Command Center emits at issue time. Pairs with qrm_prediction_outcomes for '
  'grading. Includes P0.8 trace columns (trace_id, trace_steps) atomically. '
  'Retention: graded forever, ungraded pruned at 180d (enforcement is Phase 4).';

comment on column public.qrm_predictions.trace_id is
  'P0.8 trace substrate. Stable URL identifier for the /qrm/command/trace/:predictionId route.';

comment on column public.qrm_predictions.trace_steps is
  'P0.8 trace substrate. Ordered factor-contribution breakdown from the ranker.';

comment on table public.qrm_prediction_outcomes is
  'Phase 0 P0.3 — Per-prediction outcome timeline. One row per observed outcome, '
  'oldest to newest. The current canonical outcome lives on qrm_predictions.outcome.';
