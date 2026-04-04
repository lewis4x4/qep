-- ============================================================================
-- Migration 070: Deposit Management System
--
-- Owner's Deposit SOP is non-negotiable: NO DEPOSIT = NO ORDER.
-- This migration creates the deposit tracking system and enforces a HARD
-- pipeline gate at Stage 16 (Deposit Collected).
--
-- Deposit tiers (from SOP, exact values):
--   $0-$10K      → $500     (tier_1, non-refundable)
--   $10K-$100K   → $1,000   (tier_2, non-refundable)
--   $100K-$250K  → $2,500   (tier_3, non-refundable)
--   $250K+       → MAX($5K, 1%) (tier_4, non-refundable)
-- ============================================================================

-- ── 1. Deposits table ───────────────────────────────────────────────────────

create table public.deposits (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  deal_id uuid not null references public.crm_deals(id) on delete cascade,

  -- Calculation
  equipment_value numeric not null,
  required_amount numeric not null,
  deposit_tier text not null check (deposit_tier in ('tier_1', 'tier_2', 'tier_3', 'tier_4')),

  -- Collection
  status text not null default 'pending'
    check (status in ('pending', 'requested', 'received', 'verified', 'applied', 'refund_requested', 'refunded')),
  payment_method text
    check (payment_method in ('cash', 'check', 'cashiers_check', 'credit_card', 'debit_card', 'ach', 'wire')),
  received_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null,

  -- Invoice
  invoice_reference text,
  applied_to_final_invoice boolean default false,

  -- Refund (for special orders)
  refund_policy text not null default 'non_refundable'
    check (refund_policy in ('non_refundable', 'management_discretion')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

comment on table public.deposits is 'Equipment sale deposits. HARD GATE: no verified deposit = deal cannot progress past Stage 16.';

-- ── 2. Add deposit columns to crm_deals ─────────────────────────────────────

alter table public.crm_deals
  add column if not exists deposit_status text not null default 'not_required',
  add column if not exists deposit_amount numeric,
  add column if not exists margin_check_status text not null default 'not_checked';

comment on column public.crm_deals.deposit_status is 'Deposit lifecycle: not_required, pending, verified, waived';
comment on column public.crm_deals.margin_check_status is 'Margin review: not_checked, passed, flagged, approved_by_manager';

-- ── 3. RLS ──────────────────────────────────────────────────────────────────

alter table public.deposits enable row level security;

create policy "deposits_select_workspace"
  on public.deposits for select
  using (workspace_id = public.get_my_workspace());

create policy "deposits_insert_workspace"
  on public.deposits for insert
  with check (workspace_id = public.get_my_workspace());

create policy "deposits_update_workspace"
  on public.deposits for update
  using (workspace_id = public.get_my_workspace());

create policy "deposits_delete_elevated"
  on public.deposits for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "deposits_service_all"
  on public.deposits for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── 4. Indexes ──────────────────────────────────────────────────────────────

create index idx_deposits_deal on public.deposits(deal_id);
create index idx_deposits_status on public.deposits(status) where status in ('pending', 'requested', 'received');
create unique index uq_deposits_active_per_deal
  on public.deposits(deal_id) where status not in ('refunded', 'refund_requested');

-- ── 5. Deposit tier calculation function ────────────────────────────────────

create or replace function public.calculate_deposit_tier(p_equipment_value numeric)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_amount numeric;
  v_tier text;
  v_one_pct numeric;
begin
  if p_equipment_value <= 10000 then
    v_amount := 500;
    v_tier := 'tier_1';
  elsif p_equipment_value <= 100000 then
    v_amount := 1000;
    v_tier := 'tier_2';
  elsif p_equipment_value <= 250000 then
    v_amount := 2500;
    v_tier := 'tier_3';
  else
    v_one_pct := p_equipment_value * 0.01;
    v_amount := greatest(5000, v_one_pct);
    v_tier := 'tier_4';
  end if;

  return jsonb_build_object(
    'amount', v_amount,
    'tier', v_tier,
    'refund_policy', 'non_refundable',
    'equipment_value', p_equipment_value
  );
end;
$$;

-- ── 6. HARD PIPELINE GATE: prevent stage progression past 16 ────────────────
--    without a verified deposit.
--
--    This is enforced at the database level — no application code can bypass it.

create or replace function public.enforce_deposit_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_sort_order integer;
  v_deposit_verified boolean;
begin
  -- Only check when stage_id changes
  if OLD.stage_id is not distinct from NEW.stage_id then
    return NEW;
  end if;

  -- Get the sort_order of the new stage
  select sort_order into v_new_sort_order
  from public.crm_deal_stages
  where id = NEW.stage_id;

  -- Stage 17+ requires verified deposit
  if v_new_sort_order >= 17 then
    select exists (
      select 1 from public.deposits
      where deal_id = NEW.id
        and status = 'verified'
    ) into v_deposit_verified;

    if not v_deposit_verified then
      raise exception 'DEPOSIT_GATE: Cannot progress past Stage 16 (Deposit Collected) without a verified deposit. No deposit = no order.'
        using errcode = 'P0001';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists enforce_deposit_gate_on_stage on public.crm_deals;
create trigger enforce_deposit_gate_on_stage
  before update of stage_id on public.crm_deals
  for each row
  execute function public.enforce_deposit_gate();

-- ── 7. Margin check gate: flag deals under 10% at Stage 13 ─────────────────

create or replace function public.enforce_margin_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_sort_order integer;
begin
  if OLD.stage_id is not distinct from NEW.stage_id then
    return NEW;
  end if;

  select sort_order into v_new_sort_order
  from public.crm_deal_stages
  where id = NEW.stage_id;

  -- At Stage 13 (Sales Order Signed), check margin
  if v_new_sort_order = 13 and NEW.margin_pct is not null and NEW.margin_pct < 10 then
    NEW.margin_check_status := 'flagged';
    -- Don't block — just flag for Iron Manager review
    -- The pipeline-enforcer cron will create the notification
  elsif v_new_sort_order = 13 and (NEW.margin_pct is null or NEW.margin_pct >= 10) then
    NEW.margin_check_status := 'passed';
  end if;

  return NEW;
end;
$$;

drop trigger if exists enforce_margin_check_on_stage on public.crm_deals;
create trigger enforce_margin_check_on_stage
  before update of stage_id on public.crm_deals
  for each row
  execute function public.enforce_margin_check();

-- ── 8. Updated_at trigger ───────────────────────────────────────────────────

drop trigger if exists set_deposits_updated_at on public.deposits;
create trigger set_deposits_updated_at
  before update on public.deposits
  for each row
  execute function public.set_updated_at();
