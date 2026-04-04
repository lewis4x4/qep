-- ============================================================================
-- Migration 077: Equipment Intake Pipeline (8 Stages)
--
-- Per owner's New Equipment Intake document.
-- Kanban-style board with stage-gated progression:
-- 1. Purchase & Logistics → 2. Equipment Arrival → 3. PDI Completion
-- 4. Inventory Labeling → 5. Sales Readiness → 6. Online Listing
-- 7. Internal Documentation → 8. Sale Ready
-- ============================================================================

create table public.equipment_intake (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  equipment_id uuid references public.crm_equipment(id) on delete set null,

  -- Stage tracking (from SOP: 8 stages)
  current_stage integer not null default 1 check (current_stage between 1 and 8),

  -- Stage 1: Purchase & Logistics
  po_number text,
  stock_number text,
  ship_to_branch text,
  freight_method text,
  estimated_arrival date,
  demand_assessment text check (demand_assessment in ('stock', 'retail_deal')),

  -- Stage 2: Equipment Arrival
  arrival_date date,
  freight_damage_found boolean default false,
  freight_damage_notes text,
  arrival_photos jsonb default '[]',
  received_in_intellidealer boolean default false,

  -- Stage 3: PDI
  pdi_checklist jsonb default '[]',
  pdi_completed boolean default false,
  pdi_signed_off_by uuid references public.profiles(id) on delete set null,
  decals_installed boolean default false,
  qr_code_installed boolean default false,
  attachments_mounted boolean default false,

  -- Stage 4: Inventory Labeling
  barcode_interior boolean default false,
  barcode_exterior boolean default false,

  -- Stage 5: Sales Readiness
  detail_needed boolean default false,
  detail_scheduled boolean default false,
  detail_contractor text,
  photo_ready boolean default false,

  -- Stage 6: Online Listing
  machinery_trader_listed boolean default false,
  facebook_listed boolean default false,
  equipment_trader_listed boolean default false,
  pricing_verified boolean default false,
  listing_photos jsonb default '[]',

  -- Stage 7: Internal Documentation
  intellidealer_notes_added boolean default false,
  spare_parts_documented boolean default false,
  special_setup_documented boolean default false,

  -- Stage 8: Sale Ready
  team_notified boolean default false,
  high_demand_flagged boolean default false,

  -- Stage history
  stage_history jsonb default '[]',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.equipment_intake is 'Equipment intake pipeline. 8-stage Kanban from purchase to sale-ready.';

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.equipment_intake enable row level security;

create policy "intake_select_workspace" on public.equipment_intake for select
  using (workspace_id = public.get_my_workspace());
create policy "intake_insert_workspace" on public.equipment_intake for insert
  with check (workspace_id = public.get_my_workspace());
create policy "intake_update_workspace" on public.equipment_intake for update
  using (workspace_id = public.get_my_workspace());
create policy "intake_service_all" on public.equipment_intake for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index idx_intake_stage on public.equipment_intake(current_stage) where current_stage < 8;
create index idx_intake_equipment on public.equipment_intake(equipment_id) where equipment_id is not null;

-- ── Stage history tracking trigger ──────────────────────────────────────────

create or replace function public.track_intake_stage_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if OLD.current_stage is distinct from NEW.current_stage then
    NEW.stage_history := NEW.stage_history || jsonb_build_object(
      'stage', NEW.current_stage,
      'entered_at', now()::text,
      'from_stage', OLD.current_stage
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists intake_stage_history on public.equipment_intake;
create trigger intake_stage_history
  before update of current_stage on public.equipment_intake
  for each row execute function public.track_intake_stage_change();

drop trigger if exists set_equipment_intake_updated_at on public.equipment_intake;
create trigger set_equipment_intake_updated_at
  before update on public.equipment_intake for each row
  execute function public.set_updated_at();
