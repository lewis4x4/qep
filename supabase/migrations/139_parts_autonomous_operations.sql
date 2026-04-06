-- ============================================================================
-- Migration 139: Parts Autonomous Operations (Wave 2)
--
-- 2A: Auto-replenishment rules + queue
-- 2B: Vendor scoring columns (fill_rate, price_competitiveness, composite)
-- 2C: Order events audit trail for auto-advance and timeline
-- ============================================================================

-- ══════════════════════════════════════════════════════════════════════════════
-- 2A: Auto-Replenishment
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Replenishment rules (per-workspace configuration) ───────────────────────

create table public.parts_replenishment_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  is_enabled boolean not null default false,

  -- Auto-approve threshold: orders below this $ amount get auto-approved
  auto_approve_max_dollars numeric(14, 2) not null default 500,

  -- Budget cap per day (0 = unlimited)
  daily_budget_cap numeric(14, 2) not null default 0,

  -- Who approves orders above auto_approve threshold
  approval_user_ids uuid[] not null default '{}',

  -- Preferred vendor overrides (part_number → vendor_id)
  vendor_overrides jsonb not null default '{}'::jsonb,

  -- Parts excluded from auto-replenishment
  excluded_part_numbers text[] not null default '{}',

  -- Minimum days between auto-orders for same part+branch
  cooldown_days integer not null default 3 check (cooldown_days >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id)
);

comment on table public.parts_replenishment_rules is
  'Per-workspace configuration for autonomous parts replenishment. Controls auto-approve thresholds, budget caps, and vendor routing overrides.';

alter table public.parts_replenishment_rules enable row level security;

create policy "replenish_rules_select"
  on public.parts_replenishment_rules for select
  using (workspace_id = public.get_my_workspace());

create policy "replenish_rules_mutate"
  on public.parts_replenishment_rules for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "replenish_rules_service_all"
  on public.parts_replenishment_rules for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_parts_replenishment_rules_updated_at
  before update on public.parts_replenishment_rules
  for each row execute function public.set_updated_at();

-- ── Auto-replenishment queue ────────────────────────────────────────────────

create table public.parts_auto_replenish_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  part_number text not null,
  branch_id text not null,

  -- Trigger data
  qty_on_hand integer not null,
  reorder_point integer not null,
  recommended_qty integer not null,
  economic_order_qty integer,

  -- Vendor routing
  selected_vendor_id uuid references public.vendor_profiles(id) on delete set null,
  vendor_score numeric(6, 4),
  vendor_selection_reason text,

  -- Cost estimate
  estimated_unit_cost numeric(14, 4),
  estimated_total numeric(14, 2),

  -- Lifecycle
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'auto_approved', 'rejected', 'ordered', 'expired')
  ),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  parts_order_id uuid references public.parts_orders(id) on delete set null,
  rejection_reason text,
  expires_at timestamptz not null default now() + interval '7 days',

  -- Computation metadata
  computation_batch_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, part_number, branch_id, status)
    deferrable initially deferred
);

comment on table public.parts_auto_replenish_queue is
  'Auto-generated replenishment requests. Pending items await manager approval (or auto-approve if below threshold). Approved items become parts_orders.';

create index idx_replenish_queue_ws_status
  on public.parts_auto_replenish_queue(workspace_id, status)
  where status in ('pending', 'approved', 'auto_approved');

create index idx_replenish_queue_expires
  on public.parts_auto_replenish_queue(expires_at)
  where status = 'pending';

alter table public.parts_auto_replenish_queue enable row level security;

create policy "replenish_queue_select"
  on public.parts_auto_replenish_queue for select
  using (workspace_id = public.get_my_workspace());

create policy "replenish_queue_mutate"
  on public.parts_auto_replenish_queue for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "replenish_queue_service_all"
  on public.parts_auto_replenish_queue for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_parts_auto_replenish_queue_updated_at
  before update on public.parts_auto_replenish_queue
  for each row execute function public.set_updated_at();

-- ══════════════════════════════════════════════════════════════════════════════
-- 2B: Vendor Scoring Extensions
-- ══════════════════════════════════════════════════════════════════════════════

alter table public.vendor_profiles
  add column if not exists fill_rate numeric(5, 4) default null
    check (fill_rate is null or (fill_rate >= 0 and fill_rate <= 1)),
  add column if not exists price_competitiveness numeric(5, 4) default null
    check (price_competitiveness is null or (price_competitiveness >= 0 and price_competitiveness <= 1)),
  add column if not exists machine_down_priority boolean not null default false,
  add column if not exists composite_score numeric(6, 4) default null,
  add column if not exists score_computed_at timestamptz default null;

comment on column public.vendor_profiles.fill_rate is
  'Fraction of orders shipped complete (0–1). Updated by parts-auto-replenish cron.';
comment on column public.vendor_profiles.composite_score is
  'Weighted blend of responsiveness, lead time, fill rate, and price competitiveness. Used for auto-routing.';

-- ── Vendor-to-part mapping (which vendors carry which parts) ────────────────

create table if not exists public.vendor_part_catalog (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  vendor_id uuid not null references public.vendor_profiles(id) on delete cascade,
  part_number text not null,
  vendor_sku text,
  unit_cost numeric(14, 4),
  lead_time_days numeric(8, 2),
  is_preferred boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, vendor_id, part_number)
);

comment on table public.vendor_part_catalog is
  'Maps vendors to the parts they supply, with cost and lead time per vendor-part pair. Drives auto-routing.';

alter table public.vendor_part_catalog enable row level security;

create policy "vpc_select" on public.vendor_part_catalog for select
  using (workspace_id = public.get_my_workspace());

create policy "vpc_mutate" on public.vendor_part_catalog for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "vpc_service_all" on public.vendor_part_catalog for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_vendor_part_catalog_updated_at
  before update on public.vendor_part_catalog
  for each row execute function public.set_updated_at();

create index idx_vpc_ws_part on public.vendor_part_catalog(workspace_id, lower(part_number))
  where is_active = true;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2C: Order Events Audit Trail
-- ══════════════════════════════════════════════════════════════════════════════

create table public.parts_order_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  parts_order_id uuid not null references public.parts_orders(id) on delete cascade,

  event_type text not null check (event_type in (
    'created', 'submitted', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled',
    'lines_updated', 'fields_updated', 'pick_completed',
    'auto_replenish_created', 'auto_replenish_approved', 'auto_replenish_auto_approved',
    'vendor_confirmed', 'tracking_received', 'delivery_scanned',
    'notification_sent', 'escalation_triggered'
  )),

  -- Who/what triggered this event
  source text not null default 'manual' check (
    source in ('manual', 'system', 'webhook', 'cron', 'auto_advance')
  ),
  actor_id uuid references public.profiles(id) on delete set null,

  -- Transition details
  from_status text,
  to_status text,

  -- Arbitrary event payload
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

comment on table public.parts_order_events is
  'Append-only audit trail for parts orders. Every status change, edit, pick, and automated action is logged here. Powers the order timeline UI.';

create index idx_order_events_order
  on public.parts_order_events(parts_order_id, created_at);

create index idx_order_events_ws_type
  on public.parts_order_events(workspace_id, event_type);

alter table public.parts_order_events enable row level security;

create policy "order_events_select"
  on public.parts_order_events for select
  using (workspace_id = public.get_my_workspace());

create policy "order_events_insert_staff"
  on public.parts_order_events for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "order_events_service_all"
  on public.parts_order_events for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
