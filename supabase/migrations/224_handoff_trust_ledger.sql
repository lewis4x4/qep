-- ============================================================================
-- Migration 224: Handoff Trust Ledger (Phase 3 Slice 3.1)
--
-- A cross-role scoring surface that attributes quality-of-handoff to the seam
-- between two roles, not to either role individually. When a deal, account,
-- or task moves from one Iron role to another (e.g. advisor → manager for
-- approval, manager → advisor for execution, owner → manager for branch
-- escalation), the handoff is scored on:
--
--   1. Information completeness — did the sender include all context?
--   2. Recipient readiness — did the receiver act promptly and correctly?
--   3. Outcome alignment — did the deal/property fare better or worse after?
--
-- The ledger is fed by P0.4 Flow Bus events (event_type patterns like
-- 'deal.stage_change', 'approval.request', 'task.reassign') and by
-- observation of the CRM activity stream. A nightly edge function
-- (handoff-trust-scorer) computes rolling scores.
--
-- ── Security ──────────────────────────────────────────────────────────────
--
-- Reads: managers, owners, admins (workspace-scoped).
-- Writes: service_role only (nightly scorer + flow bus triggers).
-- Individual reps never see handoff scores — this is a private managerial
-- read per the roadmap design.
--
-- ── Naming ────────────────────────────────────────────────────────────────
--
-- Table prefix: handoff_ (distinct from flow_engine / flow_bus / qrm_
-- namespaces). The handoff ledger is a Phase 3 analytics surface that reads
-- FROM the flow bus, not a new bus or engine.

-- 1. Handoff events — each row is one role-to-role transfer
create table public.handoff_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,

  -- What was handed off
  subject_type text not null check (subject_type in ('deal', 'account', 'task', 'equipment', 'quote')),
  subject_id uuid not null,

  -- Who handed off and who received
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  from_iron_role text not null
    check (from_iron_role in ('iron_manager', 'iron_advisor', 'iron_woman', 'iron_man')),
  to_user_id uuid not null references public.profiles(id) on delete cascade,
  to_iron_role text not null
    check (to_iron_role in ('iron_manager', 'iron_advisor', 'iron_woman', 'iron_man')),

  -- When and why
  handoff_at timestamptz not null default now(),
  handoff_reason text,
  -- The flow_event that triggered this handoff (nullable — some handoffs are inferred)
  source_event_id uuid,

  -- Scoring (filled by nightly scorer; null until scored)
  info_completeness real check (info_completeness is null or (info_completeness >= 0 and info_completeness <= 1)),
  recipient_readiness real check (recipient_readiness is null or (recipient_readiness >= 0 and recipient_readiness <= 1)),
  outcome_alignment real check (outcome_alignment is null or (outcome_alignment >= 0 and outcome_alignment <= 1)),
  composite_score real generated always as (
    coalesce(info_completeness, 0) * 0.35 +
    coalesce(recipient_readiness, 0) * 0.35 +
    coalesce(outcome_alignment, 0) * 0.30
  ) stored,

  -- What happened to the subject after handoff (filled by scorer)
  outcome text check (outcome in ('improved', 'unchanged', 'degraded', 'unknown')),
  scored_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.handoff_events is
  'Phase 3 Slice 3.1: Cross-role handoff trust ledger. Scores quality of role-to-role transfers. Manager-gated read, service-role write.';

-- 2. Indexes
create index idx_handoff_events_workspace_time
  on public.handoff_events (workspace_id, handoff_at desc);

create index idx_handoff_events_from_user
  on public.handoff_events (from_user_id, handoff_at desc);

create index idx_handoff_events_to_user
  on public.handoff_events (to_user_id, handoff_at desc);

create index idx_handoff_events_subject
  on public.handoff_events (subject_type, subject_id);

create index idx_handoff_events_unscored
  on public.handoff_events (workspace_id)
  where scored_at is null;

-- 3. updated_at trigger
create trigger handoff_events_set_updated_at
  before update on public.handoff_events
  for each row
  execute function public.set_updated_at();

-- 4. RLS
alter table public.handoff_events enable row level security;

create policy "handoff_events_select_elevated"
  on public.handoff_events for select
  using (public.get_my_role() in ('manager', 'owner', 'admin'));

create policy "handoff_events_service_all"
  on public.handoff_events for all
  using (auth.role() = 'service_role');

-- 5. Rolling scores — one row per (from_role, to_role) per workspace per period
create table public.handoff_role_seam_scores (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,

  from_iron_role text not null
    check (from_iron_role in ('iron_manager', 'iron_advisor', 'iron_woman', 'iron_man')),
  to_iron_role text not null
    check (to_iron_role in ('iron_manager', 'iron_advisor', 'iron_woman', 'iron_man')),

  -- Rolling window
  period_start timestamptz not null,
  period_end timestamptz not null,

  -- Aggregates
  handoff_count int not null default 0,
  scored_count int not null default 0,
  avg_composite real,
  avg_info_completeness real,
  avg_recipient_readiness real,
  avg_outcome_alignment real,
  improved_pct real,
  degraded_pct real,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint handoff_role_seam_scores_period_valid
    check (period_end > period_start),
  constraint handoff_role_seam_scores_roles_different
    check (from_iron_role <> to_iron_role)
);

comment on table public.handoff_role_seam_scores is
  'Phase 3 Slice 3.1: Rolling handoff quality scores per role-seam (from_role → to_role) per period. Manager-gated read, service-role write.';

create unique index idx_handoff_seam_scores_unique
  on public.handoff_role_seam_scores (workspace_id, from_iron_role, to_iron_role, period_start);

create trigger handoff_role_seam_scores_set_updated_at
  before update on public.handoff_role_seam_scores
  for each row
  execute function public.set_updated_at();

alter table public.handoff_role_seam_scores enable row level security;

create policy "handoff_seam_scores_select_elevated"
  on public.handoff_role_seam_scores for select
  using (public.get_my_role() in ('manager', 'owner', 'admin'));

create policy "handoff_seam_scores_service_all"
  on public.handoff_role_seam_scores for all
  using (auth.role() = 'service_role');

-- 6. Helper: compute rolling 30-day seam scores
create or replace function public.compute_handoff_seam_scores(
  p_workspace_id text,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.handoff_role_seam_scores (
    workspace_id, from_iron_role, to_iron_role,
    period_start, period_end,
    handoff_count, scored_count,
    avg_composite, avg_info_completeness, avg_recipient_readiness, avg_outcome_alignment,
    improved_pct, degraded_pct
  )
  select
    p_workspace_id,
    e.from_iron_role,
    e.to_iron_role,
    p_period_start,
    p_period_end,
    count(*),
    count(*) filter (where e.scored_at is not null),
    avg(e.composite_score),
    avg(e.info_completeness),
    avg(e.recipient_readiness),
    avg(e.outcome_alignment),
    coalesce(count(*) filter (where e.outcome = 'improved')::real / nullif(count(*) filter (where e.outcome is not null), 0), 0),
    coalesce(count(*) filter (where e.outcome = 'degraded')::real / nullif(count(*) filter (where e.outcome is not null), 0), 0)
  from public.handoff_events e
  where e.workspace_id = p_workspace_id
    and e.handoff_at >= p_period_start
    and e.handoff_at < p_period_end
    and e.from_iron_role <> e.to_iron_role
  group by e.from_iron_role, e.to_iron_role
  on conflict (workspace_id, from_iron_role, to_iron_role, period_start)
  do update set
    handoff_count = excluded.handoff_count,
    scored_count = excluded.scored_count,
    avg_composite = excluded.avg_composite,
    avg_info_completeness = excluded.avg_info_completeness,
    avg_recipient_readiness = excluded.avg_recipient_readiness,
    avg_outcome_alignment = excluded.avg_outcome_alignment,
    improved_pct = excluded.improved_pct,
    degraded_pct = excluded.degraded_pct,
    updated_at = now();
end;
$$;

comment on function public.compute_handoff_seam_scores is
  'Phase 3 Slice 3.1: Compute rolling handoff quality scores per role-seam for a workspace and period. Upserts into handoff_role_seam_scores.';
