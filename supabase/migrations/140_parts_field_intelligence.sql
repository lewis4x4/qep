-- ============================================================================
-- Migration 140: Parts Field Intelligence (Wave 3)
--
-- 3A: Voice-to-parts-order — expand order_source, add voice/photo metadata
-- 3B: Photo-to-part identification — photo_identification_results column
-- 3C: Predictive failure parts kits
-- ============================================================================

-- ══════════════════════════════════════════════════════════════════════════════
-- 3A + 3B: Expand order_source and add field-intelligence columns
-- ══════════════════════════════════════════════════════════════════════════════

-- Expand order_source to include voice, photo, predictive, auto_replenish
alter table public.parts_orders
  drop constraint if exists parts_orders_order_source_check;

alter table public.parts_orders
  add constraint parts_orders_order_source_check
    check (order_source in (
      'portal', 'counter', 'phone', 'online', 'transfer',
      'voice', 'photo', 'predictive', 'auto_replenish'
    ));

-- Voice order metadata
alter table public.parts_orders
  add column if not exists is_machine_down boolean not null default false,
  add column if not exists voice_transcript text,
  add column if not exists voice_extraction jsonb,
  add column if not exists photo_identification jsonb;

comment on column public.parts_orders.is_machine_down is
  'Urgency flag: customer has a machine down, triggers expedited vendor routing and compressed SLA.';
comment on column public.parts_orders.voice_transcript is
  'Raw voice transcript when order originated from voice-to-parts.';
comment on column public.parts_orders.voice_extraction is
  'AI extraction result: parts, quantities, equipment context, urgency from voice input.';
comment on column public.parts_orders.photo_identification is
  'AI photo identification result: matched parts with confidence scores.';

create index idx_parts_orders_machine_down
  on public.parts_orders(workspace_id)
  where is_machine_down = true and status not in ('delivered', 'cancelled');

-- ══════════════════════════════════════════════════════════════════════════════
-- 3C: Predictive Failure Parts Kits
-- ══════════════════════════════════════════════════════════════════════════════

create table public.parts_predictive_kits (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  -- Fleet linkage
  fleet_id uuid references public.customer_fleet(id) on delete cascade,
  crm_company_id uuid references public.crm_companies(id) on delete set null,
  equipment_make text,
  equipment_model text,
  equipment_serial text,
  current_hours numeric,
  service_interval_hours numeric,

  -- Prediction
  predicted_service_window text not null,
  predicted_failure_type text,
  confidence numeric(5, 4) not null default 0.5
    check (confidence >= 0 and confidence <= 1),

  -- Kit contents
  kit_parts jsonb not null default '[]'::jsonb,
  -- [{part_number, description, quantity, unit_cost, in_stock, branch_id}]
  kit_value numeric(14, 2) not null default 0,
  kit_part_count integer not null default 0,

  -- Stock availability at nearest branch
  nearest_branch_id text,
  stock_status text not null default 'unknown' check (
    stock_status in ('all_in_stock', 'partial', 'none', 'unknown')
  ),
  parts_in_stock integer not null default 0,
  parts_total integer not null default 0,

  -- Lifecycle
  status text not null default 'suggested' check (
    status in ('suggested', 'staged', 'ordered', 'fulfilled', 'expired', 'dismissed')
  ),
  staged_order_id uuid references public.parts_orders(id) on delete set null,
  dismissed_reason text,
  expires_at timestamptz,

  -- Computation
  model_version text not null default 'v1',
  computation_batch_id text,
  drivers jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.parts_predictive_kits is
  'AI-generated predictive maintenance parts kits. Based on fleet hours, service intervals, and historical failure patterns, the system predicts upcoming parts needs and pre-stages kits at the nearest branch.';

alter table public.parts_predictive_kits enable row level security;

create policy "predictive_kits_select"
  on public.parts_predictive_kits for select
  using (workspace_id = public.get_my_workspace());

create policy "predictive_kits_mutate"
  on public.parts_predictive_kits for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "predictive_kits_service_all"
  on public.parts_predictive_kits for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_parts_predictive_kits_updated_at
  before update on public.parts_predictive_kits
  for each row execute function public.set_updated_at();

create index idx_predictive_kits_ws_status
  on public.parts_predictive_kits(workspace_id, status)
  where status in ('suggested', 'staged');

create index idx_predictive_kits_fleet
  on public.parts_predictive_kits(fleet_id)
  where fleet_id is not null;

create index idx_predictive_kits_company
  on public.parts_predictive_kits(crm_company_id)
  where crm_company_id is not null;
