-- ============================================================================
-- Migration 168: Wave 5C — Nervous System v1 non-negotiables (Phase 2C)
--
-- Adds:
--   1. health_score_history (for 7/30/90d delta math the explainability
--      drawer needs)
--   2. customer_lifecycle_events (timeline view backing data)
--   3. revenue_attribution (touch-chain audit per closed-won deal)
--   4. ar_credit_blocks (with sharpened override workflow per v2 §1 note 5)
--
-- AR blocking contract:
--   - Block ONLY financed / credit-extended / rental-risk paths
--   - Cash deals pass
--   - Lifecycle gate = "quote allowed, order progression blocked"
--   - Override requires reason + named approver + time window +
--     accounting notification row
--   - Enforced at DB trigger AND edge function
-- ============================================================================

-- ── 1. Health score history (snapshots over time) ─────────────────────────

create table if not exists public.health_score_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  customer_profile_id uuid not null references public.customer_profiles_extended(id) on delete cascade,
  score numeric(5,2) not null,
  components jsonb not null default '{}'::jsonb,
  snapshot_at timestamptz not null default now()
);

comment on table public.health_score_history is 'Append-only health score snapshots. Powers 7/30/90d delta math in the explainability drawer.';

alter table public.health_score_history enable row level security;

create policy "hsh_workspace" on public.health_score_history for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "hsh_service" on public.health_score_history for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_hsh_customer_at on public.health_score_history(customer_profile_id, snapshot_at desc);
create index idx_hsh_workspace on public.health_score_history(workspace_id);

-- Convenience RPC: get a customer's score + 7/30/90d deltas in one call
create or replace function public.get_health_score_with_deltas(p_customer_profile_id uuid)
returns json
language plpgsql
security invoker
stable
as $$
declare
  v_current numeric;
  v_components jsonb;
  v_d7  numeric;
  v_d30 numeric;
  v_d90 numeric;
begin
  select health_score, health_score_components
    into v_current, v_components
  from public.customer_profiles_extended
  where id = p_customer_profile_id;

  if not found then return null; end if;

  select score into v_d7  from public.health_score_history
   where customer_profile_id = p_customer_profile_id and snapshot_at <= now() - interval '7 days'
   order by snapshot_at desc limit 1;
  select score into v_d30 from public.health_score_history
   where customer_profile_id = p_customer_profile_id and snapshot_at <= now() - interval '30 days'
   order by snapshot_at desc limit 1;
  select score into v_d90 from public.health_score_history
   where customer_profile_id = p_customer_profile_id and snapshot_at <= now() - interval '90 days'
   order by snapshot_at desc limit 1;

  return json_build_object(
    'current_score', v_current,
    'components', v_components,
    'delta_7d',  case when v_d7  is null then null else v_current - v_d7  end,
    'delta_30d', case when v_d30 is null then null else v_current - v_d30 end,
    'delta_90d', case when v_d90 is null then null else v_current - v_d90 end
  );
end;
$$;

comment on function public.get_health_score_with_deltas(uuid) is 'Drawer payload: current score + components + 7/30/90d deltas in one round-trip.';

-- ── 2. Customer lifecycle events ──────────────────────────────────────────

create table if not exists public.customer_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  customer_profile_id uuid references public.customer_profiles_extended(id) on delete cascade,
  company_id uuid references public.crm_companies(id) on delete cascade,
  event_type text not null check (event_type in (
    'first_contact', 'first_quote', 'first_purchase', 'first_service',
    'first_warranty_claim', 'nps_response', 'churn_risk_flag', 'won_back', 'lost'
  )),
  event_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  source_table text,
  source_id uuid,
  created_at timestamptz not null default now()
);

comment on table public.customer_lifecycle_events is 'Timeline events for the customer LifecyclePage. Trigger network deferred — seeded manually or via backfill cron.';

alter table public.customer_lifecycle_events enable row level security;

create policy "cle_workspace" on public.customer_lifecycle_events for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "cle_service" on public.customer_lifecycle_events for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_cle_company_at on public.customer_lifecycle_events(company_id, event_at desc);
create index idx_cle_profile_at on public.customer_lifecycle_events(customer_profile_id, event_at desc);
create index idx_cle_workspace_type on public.customer_lifecycle_events(workspace_id, event_type);

-- ── 3. Revenue attribution ────────────────────────────────────────────────

create table if not exists public.revenue_attribution (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  attribution_model text not null check (attribution_model in (
    'first_touch', 'last_touch', 'linear', 'time_decay'
  )),
  touch_chain jsonb not null default '[]'::jsonb,
  attributed_amount numeric(14,2) not null default 0,
  ai_confidence numeric(3,2) check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),
  computed_at timestamptz not null default now()
);

comment on table public.revenue_attribution is 'Per-deal touch-chain attribution. Multiple rows per deal (one per model). Computed by revenue-attribution-compute.';

alter table public.revenue_attribution enable row level security;

create policy "ra_workspace" on public.revenue_attribution for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "ra_service" on public.revenue_attribution for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create unique index uq_ra_deal_model on public.revenue_attribution(deal_id, attribution_model);
create index idx_ra_workspace on public.revenue_attribution(workspace_id);

-- ── 4. AR credit blocks (with override workflow) ─────────────────────────

create table if not exists public.ar_credit_blocks (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  block_reason text not null,
  block_threshold_days integer not null default 60,
  current_max_aging_days integer,
  status text not null default 'active' check (status in ('active', 'overridden', 'cleared')),

  -- Override workflow (v2 §1 note 5)
  override_reason text,
  override_approver_id uuid references public.profiles(id) on delete set null,
  override_until timestamptz,
  override_accounting_notified_at timestamptz,
  override_created_at timestamptz,

  blocked_at timestamptz not null default now(),
  blocked_by uuid references public.profiles(id) on delete set null,
  cleared_at timestamptz,
  cleared_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ar_credit_blocks is 'AR blocks: block financed/credit/rental-risk paths only; cash deals pass. Override requires reason + named approver + time window + accounting notification.';

alter table public.ar_credit_blocks enable row level security;

create policy "arb_workspace_select" on public.ar_credit_blocks for select
  using (workspace_id = public.get_my_workspace());
create policy "arb_workspace_modify" on public.ar_credit_blocks for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "arb_service" on public.ar_credit_blocks for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create unique index uq_arb_company_active on public.ar_credit_blocks(company_id) where status = 'active';
create index idx_arb_workspace_status on public.ar_credit_blocks(workspace_id, status);
create index idx_arb_override_until on public.ar_credit_blocks(override_until) where status = 'overridden';

create trigger set_arb_updated_at
  before update on public.ar_credit_blocks
  for each row execute function public.set_updated_at();

-- Helper RPC for the manager override flow (atomic set)
create or replace function public.apply_ar_override(
  p_block_id uuid,
  p_reason text,
  p_approver_id uuid,
  p_window_days int default 14
)
returns public.ar_credit_blocks
language plpgsql
security definer
as $$
declare
  v_row public.ar_credit_blocks;
begin
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'override reason required (min 5 chars)';
  end if;
  if p_approver_id is null then
    raise exception 'approver_id required';
  end if;

  update public.ar_credit_blocks
  set status = 'overridden',
      override_reason = p_reason,
      override_approver_id = p_approver_id,
      override_until = now() + make_interval(days => p_window_days),
      override_created_at = now(),
      override_accounting_notified_at = now()  -- assumes in-app notification fired by edge fn
  where id = p_block_id and status = 'active'
  returning * into v_row;

  if not found then
    raise exception 'block not found or not in active state';
  end if;

  return v_row;
end;
$$;

comment on function public.apply_ar_override(uuid, text, uuid, int) is 'Manager AR override with audit. Validates reason length + approver, sets override_until window, stamps accounting notification time.';
