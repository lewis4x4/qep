-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 209 — Flow Bus (Phase 0 P0.4)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Creates the QRM Flow Bus — a generic publish/subscribe event fabric for
-- cross-module signal propagation. Sits ALONGSIDE the existing Flow Engine
-- (workflow execution engine, migrations 194/195/196), NOT as a replacement.
-- The Flow Engine runs predefined multi-step workflows; the Flow Bus is a
-- topic-addressable pub/sub bus. Two distinct architectures, two distinct
-- namespaces:
--
--   _shared/flow-engine/   → existing workflow execution engine (UNTOUCHED)
--   _shared/flow-bus/      → new pub/sub bus (this migration's consumers)
--
-- ── ATOMIC ADD-033 FIELD ABSORPTION ─────────────────────────────────────────
--
-- Per the merge §4 (plans/2026-04-08-qrm-addendum-merge.md), the addendum's
-- canonical event object specifies 17 fields that MUST land in the initial
-- schema, NOT a follow-up migration. All 17 are present in flow_events below:
--
--   1. event_id              (uuid, publisher-controlled or auto-generated)
--   2. event_type            (text, e.g. 'follow_up.due')
--   3. source_module         (text, e.g. 'follow-up-engine')
--   4. source_record_id      (uuid, the originating record)
--   5. customer_id           (uuid, optional cross-reference)
--   6. company_id            (uuid, optional cross-reference)
--   7. equipment_id          (uuid, optional cross-reference)
--   8. deal_id               (uuid, optional cross-reference)
--   9. severity              (text enum: low/medium/high/critical/null)
--  10. commercial_relevance  (text enum: high/medium/low/none/null)
--  11. suggested_owner       (uuid → profiles, ON DELETE SET NULL)
--  12. required_action       (text)
--  13. recommended_deadline  (timestamptz)
--  14. draft_message         (text)
--  15. escalation_rule       (text)
--  16. status                (text enum: pending/in_progress/resolved/escalated/expired)
--  17. created_at            (timestamptz, auto)
--
-- ── DESIGN DECISIONS ────────────────────────────────────────────────────────
--
-- 1. Idempotency lives DIRECTLY on flow_events (column + unique partial
--    index), NOT in flow_action_idempotency from migration 194. Reasoning:
--    flow_action_idempotency has run-scoped semantics (PK on idempotency_key
--    text + run_id FK to flow_workflow_runs) that don't fit bus events. Bus
--    events are topic-addressable, run-independent. Putting dedup directly
--    on flow_events is one round-trip on the fast path and race-safe via
--    the unique constraint. The verification artifact's mention of
--    "share idempotency infrastructure" referred to the PATTERN (idempotency
--    keys with TTL semantics), not literal table reuse.
--
-- 2. Cross-table FKs (deal_id, company_id, equipment_id, customer_id) are
--    plain uuid columns WITHOUT foreign key constraints. Reasoning: the bus
--    should be loose-coupled to the rest of the schema. A bus event about a
--    deleted deal should still exist for forensic purposes; FK CASCADE
--    semantics would lose history. Exception: suggested_owner FKs to
--    profiles ON DELETE SET NULL because losing a user shouldn't delete the
--    event but should null the assignment.
--
-- 3. flow_event_types is a SOFT registry. Events do NOT need to be
--    pre-registered to publish. The registry exists for documentation,
--    eventual schema validation, and discovery. Publishers populate it
--    lazily as they wire (Day 7 onwards).
--
-- 4. flow_subscriptions is PASSIVE METADATA in Day 6. Day 6 ships the table
--    + the registerSubscription() helper. Day 7+ wires actual handler
--    dispatch through these subscriptions. No runtime dispatcher in Day 6.
--
-- 5. RLS strategy: insert via service-role only (the bus is published-to by
--    backend code, not directly by users). Reads for managers/owners/admins
--    workspace-wide. Reads for reps gated to deal-scoped events where they
--    own the deal. Same pattern as qrm_predictions (migration 208).
--
-- 6. NO new edge function created in Day 6. The bus is infrastructure
--    consumed by existing edge functions via
--    `import { publishFlowEvent } from "../_shared/flow-bus/publish.ts"`.
--    Day 7 wires the first 4 publishers (follow-up-engine, nudge-scheduler,
--    deal-timing-scan, anomaly-scan).
--
-- ── SCALE NOTES ─────────────────────────────────────────────────────────────
--
-- At ~10 active reps making ~5 /qrm/command requests per day, the qrm-
-- command-center function is one publisher. Per request the bus might emit
-- 0-5 events (e.g. recommendation_emitted, lane_card_clicked). That's
-- ~250 events per day per workspace from this one publisher. Day 7's 4
-- additional publishers will roughly double that (~500/day). At 365 days /
-- workspace * 1 year, ~180K rows per workspace per year. The (event_type,
-- published_at desc) and (workspace_id, published_at desc) indexes keep
-- common scans tight; the (deal_id, published_at desc) partial index
-- supports per-deal feeds in O(log n).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Table 1: flow_events ────────────────────────────────────────────────────
--
-- Append-only event surface. Every cross-module signal lands here.

create table public.flow_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  -- ── ADD-033 canonical event object fields (17 total) ──
  event_id uuid not null default gen_random_uuid(),
  event_type text not null,
  source_module text not null,
  source_record_id uuid,
  customer_id uuid,
  company_id uuid,
  equipment_id uuid,
  deal_id uuid,
  severity text check (severity is null or severity in ('low', 'medium', 'high', 'critical')),
  commercial_relevance text check (commercial_relevance is null or commercial_relevance in ('high', 'medium', 'low', 'none')),
  suggested_owner uuid references public.profiles(id) on delete set null,
  required_action text,
  recommended_deadline timestamptz,
  draft_message text,
  escalation_rule text,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'resolved', 'escalated', 'expired')),
  -- created_at is the 17th ADD-033 field (defined below alongside other timestamps)

  -- ── Bus-specific fields (not part of ADD-033) ──
  payload jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  idempotency_key text,
  correlation_id uuid,
  parent_event_id uuid,

  -- ── Standard timestamps ──
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bus is published-to by backend code only; never by direct user access.
alter table public.flow_events enable row level security;

-- Inserts: service-role only.
create policy "flow_events_insert_service"
  on public.flow_events for insert
  with check (auth.role() = 'service_role');

-- Reads: managers + owners + admins see everything in their workspace.
create policy "flow_events_select_elevated"
  on public.flow_events for select
  using (public.get_my_role() in ('manager', 'owner', 'admin'));

-- Reads: reps see deal-scoped events where they own the underlying deal.
create policy "flow_events_select_own_deal"
  on public.flow_events for select
  using (
    deal_id is not null
    and exists (
      select 1
      from public.crm_deals d
      where d.id = flow_events.deal_id
        and d.assigned_rep_id = auth.uid()
    )
  );

-- Service role can do anything (publishers, subscribers, retention prune).
create policy "flow_events_service_all"
  on public.flow_events for all
  using (auth.role() = 'service_role');

-- ── Indexes on flow_events ──
--
-- Partial unique index for idempotent publishes. The partial WHERE clause
-- means the constraint only applies when idempotency_key is non-null —
-- non-idempotent publishes pass through the fast path with no constraint
-- check.
create unique index idx_flow_events_idempotency_uq
  on public.flow_events (workspace_id, idempotency_key)
  where idempotency_key is not null;

-- Type-scoped time queries (the most common subscriber lookup pattern)
create index idx_flow_events_type_time
  on public.flow_events (event_type, published_at desc);

-- Workspace + time scans (manager dashboards, retention candidate scans)
create index idx_flow_events_workspace_time
  on public.flow_events (workspace_id, published_at desc);

-- Per-deal feed (Slice 1 + future Phase 2 surfaces will read this)
create index idx_flow_events_deal_time
  on public.flow_events (deal_id, published_at desc)
  where deal_id is not null;

-- Correlation chain queries (Phase 4+ when event chaining matures)
create index idx_flow_events_correlation
  on public.flow_events (correlation_id, published_at)
  where correlation_id is not null;

-- updated_at trigger (matches existing pattern across the codebase)
create trigger set_flow_events_updated_at
  before update on public.flow_events
  for each row execute function public.set_updated_at();

-- ── Table 2: flow_event_types ───────────────────────────────────────────────
--
-- Soft registry of known event types. Publishers do NOT need to pre-register
-- — the bus accepts any event_type string. The registry exists for:
--   1. Documentation (what events does this workspace see?)
--   2. Schema validation (eventual: enforce payload shape per event_type)
--   3. Discovery (UI/admin tools listing known event types)
--
-- Lazy population: Day 7+ wiring populates entries as publishers come online.

create table public.flow_event_types (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  name text not null,
  description text,
  schema jsonb,  -- optional JSON schema for payload validation (Phase 4+)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

alter table public.flow_event_types enable row level security;

create policy "flow_event_types_insert_service"
  on public.flow_event_types for insert
  with check (auth.role() = 'service_role');

-- Reads open to all authenticated users (it's a registry, not sensitive)
create policy "flow_event_types_select_authenticated"
  on public.flow_event_types for select
  using (auth.role() = 'authenticated' or auth.role() = 'service_role');

create policy "flow_event_types_service_all"
  on public.flow_event_types for all
  using (auth.role() = 'service_role');

create trigger set_flow_event_types_updated_at
  before update on public.flow_event_types
  for each row execute function public.set_updated_at();

-- ── Table 3: flow_subscriptions ─────────────────────────────────────────────
--
-- Per-surface listener registry. A subscription says "this handler module +
-- handler name should be invoked when an event matching this pattern arrives."
--
-- Day 6 ships the table + the registerSubscription() helper. The table is
-- PASSIVE METADATA in Day 6 — there is no runtime dispatcher that reads from
-- it yet. Day 7+ wires actual dispatch.
--
-- Pattern grammar (matches existing flow-engine convention):
--   - Literal: 'follow_up.due' matches exactly 'follow_up.due'
--   - Wildcard: '*' matches any single segment
--   - Glob: 'deal.*' matches 'deal.stalled', 'deal.closed_won', etc.
--   - Universal: '*' alone matches everything
--
-- The matchesPattern() pure function in supabase/functions/_shared/flow-bus/
-- subscribe.ts implements the grammar and is unit-tested.

create table public.flow_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  event_type_pattern text not null,
  handler_module text not null,
  handler_name text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, event_type_pattern, handler_module, handler_name)
);

alter table public.flow_subscriptions enable row level security;

create policy "flow_subscriptions_insert_service"
  on public.flow_subscriptions for insert
  with check (auth.role() = 'service_role');

create policy "flow_subscriptions_update_service"
  on public.flow_subscriptions for update
  using (auth.role() = 'service_role');

create policy "flow_subscriptions_select_elevated"
  on public.flow_subscriptions for select
  using (public.get_my_role() in ('manager', 'owner', 'admin'));

create policy "flow_subscriptions_service_all"
  on public.flow_subscriptions for all
  using (auth.role() = 'service_role');

create index idx_flow_subscriptions_pattern_enabled
  on public.flow_subscriptions (event_type_pattern, enabled)
  where enabled = true;

create trigger set_flow_subscriptions_updated_at
  before update on public.flow_subscriptions
  for each row execute function public.set_updated_at();

-- ── Comments for self-documentation ─────────────────────────────────────────

comment on table public.flow_events is
  'Phase 0 P0.4 — Append-only QRM Flow Bus surface. Topic-addressable pub/sub '
  'event fabric. Sits alongside the existing Flow Engine (workflow execution '
  'engine, migrations 194-196), NOT as a replacement. All 17 ADD-033 canonical '
  'event-object fields absorbed atomically. Idempotency via partial unique '
  'index on (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL.';

comment on column public.flow_events.event_id is
  'ADD-033 publisher-controlled event identifier. Distinct from the row PK id. '
  'Defaults to gen_random_uuid() but publishers can supply their own for retry '
  'semantics or external tracing.';

comment on column public.flow_events.idempotency_key is
  'Optional dedup key. When supplied, the partial unique index '
  'idx_flow_events_idempotency_uq blocks duplicate publishes with the same '
  '(workspace_id, idempotency_key) tuple. The publish helper catches the '
  'unique violation and returns the existing event_id with deduped=true.';

comment on table public.flow_event_types is
  'Phase 0 P0.4 — Soft registry of known event types. Events do NOT need to be '
  'pre-registered to publish. Lazy population by publishers as they wire in.';

comment on table public.flow_subscriptions is
  'Phase 0 P0.4 — Passive subscription registry. Day 6 ships the table; Day 7+ '
  'wires actual handler dispatch. Pattern grammar: literal, segment-wildcard, '
  'glob, universal — see _shared/flow-bus/subscribe.ts matchesPattern().';
