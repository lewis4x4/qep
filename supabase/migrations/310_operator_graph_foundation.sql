-- ============================================================================
-- Migration 310: Operator Graph Foundation (Slice 1 — "The Graph Is Real")
--
-- The 4-surface shell from Slice 0 (Today / Graph / Pulse / Ask Iron) needs a
-- normalized event + intent layer underneath. Today, signals live only inside
-- anomaly_alerts, touches are implied by crm_activities, and recommended
-- "moves" don't exist at all. This migration creates the three normalized
-- streams that power the operator graph:
--
--   signals   — anything the system notices (crm, integrations, external)
--   touches   — anything a human did (call, email, meeting, sms, field visit)
--   moves     — recommendations from the agent, with a full lifecycle
--
-- It also adds the 21→5 stage-collapse view so the Today surface and the Graph
-- explorer can group deals without hard-coding the 21-step pipeline anywhere
-- outside this file.
--
-- Companion: deal_health_score(p_deal_id) function, modeled after the existing
-- compute_customer_health_score RPC (migration 150) but adapted to deal signals.
--
-- Conventions (verified against migrations 021 + 057):
--   - workspace_id text not null default 'default'
--   - RLS enabled on every table
--   - Service role bypass + elevated ALL + rep-scope SELECT pattern
--   - Rep scope uses the existing crm_rep_can_access_* security-definer helpers
--   - updated_at trigger using public.set_updated_at (matches 021 pattern)
--   - Indexes: every FK gets one, plus list-view indexes scoped by workspace
--
-- Rollback DDL is at the bottom.
-- ============================================================================

-- ── Enums ────────────────────────────────────────────────────────────────────

create type public.operator_signal_kind as enum (
  -- CRM-origin signals
  'stage_change',
  'sla_breach',
  'sla_warning',
  'quote_viewed',
  'quote_expiring',
  'deposit_received',
  'credit_approved',
  'credit_declined',
  -- External / integration signals
  'inbound_email',
  'inbound_call',
  'inbound_sms',
  'telematics_idle',
  'telematics_fault',
  'permit_filed',
  'auction_listing',
  'competitor_mention',
  'news_mention',
  -- Fleet / service signals
  'equipment_available',
  'equipment_returning',
  'service_due',
  'warranty_expiring',
  -- Catch-all
  'other'
);

create type public.operator_signal_severity as enum ('low', 'medium', 'high', 'critical');

create type public.operator_touch_direction as enum ('inbound', 'outbound');

create type public.operator_touch_channel as enum (
  'call', 'email', 'meeting', 'sms', 'field_visit', 'voice_note', 'chat', 'other'
);

create type public.operator_move_kind as enum (
  'call_now',
  'send_quote',
  'send_follow_up',
  'schedule_meeting',
  'escalate',
  'drop_deal',
  'reassign',
  'field_visit',
  'send_proposal',
  'pricing_review',
  'inventory_reserve',
  'service_escalate',
  'rescue_offer',
  'other'
);

create type public.operator_move_status as enum (
  'suggested',
  'accepted',
  'completed',
  'snoozed',
  'dismissed',
  'expired'
);

create type public.operator_entity_type as enum (
  'deal', 'contact', 'company', 'equipment', 'activity', 'rental', 'workspace'
);

-- ── Tables ───────────────────────────────────────────────────────────────────

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  kind public.operator_signal_kind not null,
  severity public.operator_signal_severity not null default 'medium',
  source text not null,                         -- e.g. 'crm', 'gmail', 'telematics', 'dodge'
  title text not null,
  description text,
  entity_type public.operator_entity_type,
  entity_id uuid,
  assigned_rep_id uuid references public.profiles(id) on delete set null,
  -- Dedup key so ingesters are idempotent. Partial unique index below.
  dedupe_key text,
  occurred_at timestamptz not null default now(),
  -- For one-shot "snooze" so we don't re-surface the same signal repeatedly.
  suppressed_until timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.signals is
  'Normalized event stream: anything the system notices that might warrant a move. Feeds the Pulse surface and the recommender.';

create table public.touches (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  channel public.operator_touch_channel not null,
  direction public.operator_touch_direction not null,
  summary text,
  body text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  -- FKs reference the real qrm_* tables (crm_* are now compat views from mig 170).
  contact_id uuid references public.qrm_contacts(id) on delete set null,
  company_id uuid references public.qrm_companies(id) on delete set null,
  deal_id uuid references public.qrm_deals(id) on delete set null,
  equipment_id uuid references public.qrm_equipment(id) on delete set null,
  -- Reuse existing qrm_activities when this touch corresponds to one.
  activity_id uuid references public.qrm_activities(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  -- External provenance so we can dedupe against Gmail/Outlook/etc.
  external_source text,
  external_id text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (contact_id is not null)::int
    + (company_id is not null)::int
    + (deal_id is not null)::int
    + (equipment_id is not null)::int >= 1
  )
);

comment on table public.touches is
  'Normalized human interaction stream: every call/email/meeting/sms, whether it was logged manually or ingested from an integration. One touch = one atomic interaction.';

create table public.moves (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  kind public.operator_move_kind not null,
  status public.operator_move_status not null default 'suggested',
  title text not null,
  rationale text,                                -- plain-English "why now"
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  priority smallint not null default 50 check (priority between 0 and 100),
  entity_type public.operator_entity_type,
  entity_id uuid,
  assigned_rep_id uuid references public.profiles(id) on delete set null,
  -- Drafted content the human can one-click send (email body, sms copy, etc.).
  draft jsonb,
  -- Which signal(s) triggered this recommendation.
  signal_ids uuid[] not null default '{}'::uuid[],
  -- Lifecycle timestamps.
  due_at timestamptz,
  snoozed_until timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz,
  dismissed_reason text,
  -- Model provenance: which recommender produced this, at which version.
  recommender text,
  recommender_version text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.moves is
  'Recommended actions from the agent. Each move carries rationale, drafted content, and a lifecycle (suggested → accepted → completed). This is the unit of work on the Today surface.';

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- signals
create index idx_signals_workspace_occurred
  on public.signals (workspace_id, occurred_at desc);
create index idx_signals_entity
  on public.signals (entity_type, entity_id)
  where entity_id is not null;
create index idx_signals_rep_open
  on public.signals (assigned_rep_id, occurred_at desc)
  where suppressed_until is null;
create index idx_signals_kind
  on public.signals (kind, occurred_at desc);
create index idx_signals_severity
  on public.signals (severity, occurred_at desc);
create unique index uq_signals_workspace_dedupe
  on public.signals (workspace_id, dedupe_key)
  where dedupe_key is not null;

-- touches
create index idx_touches_workspace_occurred
  on public.touches (workspace_id, occurred_at desc);
create index idx_touches_contact
  on public.touches (contact_id, occurred_at desc)
  where contact_id is not null;
create index idx_touches_company
  on public.touches (company_id, occurred_at desc)
  where company_id is not null;
create index idx_touches_deal
  on public.touches (deal_id, occurred_at desc)
  where deal_id is not null;
create index idx_touches_equipment
  on public.touches (equipment_id, occurred_at desc)
  where equipment_id is not null;
create index idx_touches_activity
  on public.touches (activity_id)
  where activity_id is not null;
create index idx_touches_actor
  on public.touches (actor_user_id, occurred_at desc)
  where actor_user_id is not null;
create unique index uq_touches_workspace_external
  on public.touches (workspace_id, external_source, external_id)
  where external_source is not null and external_id is not null;

-- moves
create index idx_moves_workspace_created
  on public.moves (workspace_id, created_at desc);
create index idx_moves_rep_queue
  on public.moves (assigned_rep_id, status, priority desc, created_at desc)
  where status in ('suggested', 'accepted');
create index idx_moves_entity
  on public.moves (entity_type, entity_id)
  where entity_id is not null;
create index idx_moves_due
  on public.moves (due_at)
  where due_at is not null and status in ('suggested', 'accepted');
create index idx_moves_kind
  on public.moves (kind, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.signals enable row level security;
alter table public.touches enable row level security;
alter table public.moves enable row level security;

-- signals: service role bypass, elevated all, rep sees signals assigned to them
-- or tied to entities they can reach (contact/company/deal).
create policy "signals_service_all" on public.signals
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "signals_all_elevated" on public.signals
  for all using (public.get_my_role() in ('admin', 'manager', 'owner'))
  with check (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "signals_select_rep_scope" on public.signals
  for select using (
    public.get_my_role() = 'rep' and (
      assigned_rep_id = auth.uid()
      or (entity_type = 'deal' and entity_id is not null
          and public.crm_rep_can_access_deal(entity_id))
      or (entity_type = 'contact' and entity_id is not null
          and public.crm_rep_can_access_contact(entity_id))
      or (entity_type = 'company' and entity_id is not null
          and public.crm_rep_can_access_company(entity_id))
    )
  );

-- touches: service role bypass, elevated all, rep sees touches they logged or
-- tied to entities they own.
create policy "touches_service_all" on public.touches
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "touches_all_elevated" on public.touches
  for all using (public.get_my_role() in ('admin', 'manager', 'owner'))
  with check (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "touches_select_rep_scope" on public.touches
  for select using (
    public.get_my_role() = 'rep' and (
      actor_user_id = auth.uid()
      or (contact_id is not null and public.crm_rep_can_access_contact(contact_id))
      or (company_id is not null and public.crm_rep_can_access_company(company_id))
      or (deal_id is not null and public.crm_rep_can_access_deal(deal_id))
    )
  );

create policy "touches_insert_rep_scope" on public.touches
  for insert with check (
    public.get_my_role() = 'rep'
    and actor_user_id = auth.uid()
    and (
      (contact_id is not null and public.crm_rep_can_access_contact(contact_id))
      or (company_id is not null and public.crm_rep_can_access_company(company_id))
      or (deal_id is not null and public.crm_rep_can_access_deal(deal_id))
    )
  );

create policy "touches_update_rep_own" on public.touches
  for update using (public.get_my_role() = 'rep' and actor_user_id = auth.uid())
  with check (public.get_my_role() = 'rep' and actor_user_id = auth.uid());

-- moves: service role bypass, elevated all, rep sees moves assigned to them or
-- tied to entities they own; rep can update lifecycle (accept/dismiss/snooze)
-- on their own moves.
create policy "moves_service_all" on public.moves
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "moves_all_elevated" on public.moves
  for all using (public.get_my_role() in ('admin', 'manager', 'owner'))
  with check (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "moves_select_rep_scope" on public.moves
  for select using (
    public.get_my_role() = 'rep' and (
      assigned_rep_id = auth.uid()
      or (entity_type = 'deal' and entity_id is not null
          and public.crm_rep_can_access_deal(entity_id))
      or (entity_type = 'contact' and entity_id is not null
          and public.crm_rep_can_access_contact(entity_id))
      or (entity_type = 'company' and entity_id is not null
          and public.crm_rep_can_access_company(entity_id))
    )
  );

create policy "moves_update_rep_own" on public.moves
  for update using (public.get_my_role() = 'rep' and assigned_rep_id = auth.uid())
  with check (public.get_my_role() = 'rep' and assigned_rep_id = auth.uid());

-- ── Updated-at triggers ──────────────────────────────────────────────────────

create trigger set_signals_updated_at
  before update on public.signals
  for each row execute function public.set_updated_at();

create trigger set_touches_updated_at
  before update on public.touches
  for each row execute function public.set_updated_at();

create trigger set_moves_updated_at
  before update on public.moves
  for each row execute function public.set_updated_at();

-- ── 21 → 5 stage-collapse view ──────────────────────────────────────────────
-- The 21-step pipeline (migration 066) is the ground truth, but the operator
-- UI groups deals into five human-scale buckets. This view is the single
-- source of truth for that mapping. If we add a stage we add a row here.

create or replace view public.crm_deal_stage_groups
with (security_barrier = true) as
with stage_group_map(stage_name, bucket, bucket_sort) as (
  values
    -- 1. Inbound — lead captured, not yet engaged
    ('Lead Received',        'inbound',      1),
    ('Initial Contact',      'inbound',      1),
    -- 2. Discover — scoping + quoting
    ('Needs Assessment',     'discover',     2),
    ('QRM Entry',            'discover',     2),
    ('Inventory Validation', 'discover',     2),
    ('Quote Created',        'discover',     2),
    ('Quote Sent',           'discover',     2),
    -- 3. Decide — customer in the room with a quote
    ('Quote Presented',      'decide',       3),
    ('Ask for Sale',         'decide',       3),
    ('QRM Updated',          'decide',       3),
    ('Follow-Up Set',        'decide',       3),
    ('Ongoing Follow-Up',    'decide',       3),
    -- 4. Close — paperwork, credit, deposit
    ('Sales Order Signed',   'close',        4),
    ('Credit Submitted',     'close',        4),
    ('Deal Shared',          'close',        4),
    ('Deposit Collected',    'close',        4),
    -- 5. Deliver — iron leaves the yard
    ('Equipment Ready',      'deliver',      5),
    ('Delivery Scheduled',   'deliver',      5),
    ('Delivery Completed',   'deliver',      5),
    ('Invoice Closed',       'deliver',      5),
    ('Post-Sale Follow-Up',  'deliver',      5)
)
select
  s.id          as stage_id,
  s.workspace_id,
  s.name        as stage_name,
  s.sort_order,
  coalesce(m.bucket,      'inbound') as bucket,
  coalesce(m.bucket_sort, 1)         as bucket_sort
from public.qrm_deal_stages s
left join stage_group_map m on m.stage_name = s.name;

comment on view public.crm_deal_stage_groups is
  '21-stage pipeline collapsed into 5 operator buckets: inbound → discover → decide → close → deliver. Used by the Graph/Today surfaces.';

grant select on public.crm_deal_stage_groups to authenticated, service_role;

-- ── Deal health score function ──────────────────────────────────────────────
-- Modeled after compute_customer_health_score (migration 150) but over deal
-- signals. Output in [0, 100]. Ingredients:
--   +20  most recent touch within 7 days
--   +15  signal count (recent, last 14 days) up to cap
--   +15  no SLA breach in the last 7 days
--   +20  stage velocity (days-since-stage-change within expected window)
--   +20  amount * probability weighting (hot deals with real money)
--   +10  has an open move assigned (means the system has a next step)
--
-- Missing inputs are treated as "no credit" rather than neutral — we'd rather
-- under-score an ambiguous deal than hallucinate health.

create or replace function public.deal_health_score(p_deal_id uuid)
returns numeric
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_score numeric := 0;
  v_recent_touch_count integer := 0;
  v_recent_signal_count integer := 0;
  v_has_sla_breach boolean := false;
  v_days_since_stage_change integer;
  v_amount numeric;
  v_probability numeric;
  v_has_open_move boolean := false;
  v_deal_exists boolean := false;
  v_stage_changed_at timestamptz;
begin
  -- Confirm the deal exists and pull amount + probability.
  select
    true,
    d.amount,
    coalesce(s.probability, 0),
    coalesce(d.sla_started_at, d.updated_at)
  into v_deal_exists, v_amount, v_probability, v_stage_changed_at
  from public.qrm_deals d
  join public.qrm_deal_stages s on s.id = d.stage_id
  where d.id = p_deal_id
    and d.deleted_at is null;

  if not v_deal_exists then
    return null;
  end if;

  -- Recent touch credit (+20 if any touch in last 7 days)
  select count(*) into v_recent_touch_count
  from public.touches t
  where t.deal_id = p_deal_id
    and t.occurred_at > now() - interval '7 days';
  if v_recent_touch_count > 0 then
    v_score := v_score + 20;
  end if;

  -- Signal activity (+3 per recent signal, capped at +15)
  select count(*) into v_recent_signal_count
  from public.signals sig
  where sig.entity_type = 'deal'
    and sig.entity_id = p_deal_id
    and sig.occurred_at > now() - interval '14 days';
  v_score := v_score + least(15, v_recent_signal_count * 3);

  -- No recent SLA breach (+15)
  select exists (
    select 1 from public.signals sig
    where sig.entity_type = 'deal'
      and sig.entity_id = p_deal_id
      and sig.kind = 'sla_breach'
      and sig.occurred_at > now() - interval '7 days'
  ) into v_has_sla_breach;
  if not v_has_sla_breach then
    v_score := v_score + 15;
  end if;

  -- Stage velocity (+20 if moved within 14 days, graded otherwise)
  v_days_since_stage_change := extract(day from (now() - v_stage_changed_at));
  if v_days_since_stage_change is null then
    -- no change info → no credit
    null;
  elsif v_days_since_stage_change <= 3 then
    v_score := v_score + 20;
  elsif v_days_since_stage_change <= 7 then
    v_score := v_score + 15;
  elsif v_days_since_stage_change <= 14 then
    v_score := v_score + 10;
  elsif v_days_since_stage_change <= 30 then
    v_score := v_score + 5;
  end if;

  -- Money-weighted contribution. 20 pts max, proportional to amount * prob.
  --   amount * probability / 100   →  expected revenue
  --   cap at $500k for scoring purposes so a single huge deal doesn't
  --   dominate the score to the point it never drops.
  if v_amount is not null and v_amount > 0 then
    v_score := v_score + least(20, (v_amount * v_probability / 100.0) / 25000.0);
  end if;

  -- Has an open move (+10)
  select exists (
    select 1 from public.moves mv
    where mv.entity_type = 'deal'
      and mv.entity_id = p_deal_id
      and mv.status in ('suggested', 'accepted')
  ) into v_has_open_move;
  if v_has_open_move then
    v_score := v_score + 10;
  end if;

  return greatest(0, least(100, v_score));
end;
$$;

revoke execute on function public.deal_health_score(uuid) from public;
grant execute on function public.deal_health_score(uuid) to authenticated, service_role;

comment on function public.deal_health_score(uuid) is
  'Operator graph deal health score in [0, 100]. Weighted on recency of touches, signal activity, SLA cleanliness, stage velocity, expected revenue, and open-move presence.';

-- ── Rollback DDL (manual, reverse order) ────────────────────────────────────
-- drop function if exists public.deal_health_score(uuid);
-- drop view if exists public.crm_deal_stage_groups;
-- drop trigger if exists set_moves_updated_at on public.moves;
-- drop trigger if exists set_touches_updated_at on public.touches;
-- drop trigger if exists set_signals_updated_at on public.signals;
-- drop table if exists public.moves cascade;
-- drop table if exists public.touches cascade;
-- drop table if exists public.signals cascade;
-- drop type if exists public.operator_entity_type;
-- drop type if exists public.operator_move_status;
-- drop type if exists public.operator_move_kind;
-- drop type if exists public.operator_touch_channel;
-- drop type if exists public.operator_touch_direction;
-- drop type if exists public.operator_signal_severity;
-- drop type if exists public.operator_signal_kind;
