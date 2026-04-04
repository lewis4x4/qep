-- ============================================================================
-- Migration 074: AI Trade-In Valuation System
--
-- Per owner's Equipment Trade SOP:
-- - 4 corner photos + walkaround video + serial/hours photos
-- - Equipment Vision AI analyzes condition
-- - 3 market comps required
-- - Pricing: Auction Value × 0.92 (8% discount) - Reconditioning = Value
-- - Over-allowance (>10% above formula) routes to Iron Manager
-- - Target resale margin: 20-25%
-- - Preliminary value in <60 seconds
-- ============================================================================

create table public.trade_valuations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  deal_id uuid references public.crm_deals(id) on delete set null,

  -- Equipment details (from SOP: required information)
  make text not null,
  model text not null,
  year integer,
  serial_number text,
  hours numeric,

  -- Media (from SOP: 4 corner photos, walkaround video, serial plate, hours photo)
  photos jsonb not null default '[]',
  video_url text,

  -- Condition (from SOP)
  operational_status text check (operational_status in ('daily_use', 'operational', 'non_operational')),
  last_full_service text,
  needed_repairs text,
  attachments_included text[],

  -- AI Assessment
  ai_condition_score numeric, -- 0-100 from vision analysis
  ai_condition_notes text,
  ai_detected_damage text[],

  -- Market Comps (from SOP: 3 comps required)
  market_comps jsonb default '[]',

  -- Pricing (from SOP: auction value - 8% - reconditioning)
  auction_value numeric,
  discount_percentage numeric default 8,
  discounted_value numeric,
  reconditioning_estimate numeric,
  preliminary_value numeric,
  final_value numeric,

  -- Target margins (from SOP: 20-25% on resale)
  target_resale_margin_min numeric default 20,
  target_resale_margin_max numeric default 25,
  suggested_resale_price numeric,

  -- Approval (from SOP: over-allowance requires manager approval)
  status text not null default 'pending'
    check (status in ('pending', 'preliminary', 'manager_review', 'approved', 'rejected')),
  over_allowance boolean default false,
  approved_by uuid references public.profiles(id) on delete set null,
  approval_notes text,

  -- Quote language (from SOP: mandatory conditional language)
  conditional_language text default 'Traded machine must be in the same condition as when it was evaluated',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

comment on table public.trade_valuations is 'AI-powered trade-in valuations. Formula: Auction × 0.92 - Reconditioning. Over-allowance routes to Iron Manager.';

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.trade_valuations enable row level security;

create policy "trade_valuations_select_workspace" on public.trade_valuations for select
  using (workspace_id = public.get_my_workspace());
create policy "trade_valuations_insert_workspace" on public.trade_valuations for insert
  with check (workspace_id = public.get_my_workspace());
create policy "trade_valuations_update_workspace" on public.trade_valuations for update
  using (workspace_id = public.get_my_workspace());
create policy "trade_valuations_delete_elevated" on public.trade_valuations for delete
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('manager', 'owner'));
create policy "trade_valuations_service_all" on public.trade_valuations for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index idx_trade_valuations_deal on public.trade_valuations(deal_id) where deal_id is not null;
create index idx_trade_valuations_status on public.trade_valuations(status) where status in ('pending', 'preliminary', 'manager_review');

-- ── Pricing calculation function ────────────────────────────────────────────

create or replace function public.calculate_trade_value(
  p_auction_value numeric,
  p_discount_pct numeric default 8,
  p_reconditioning numeric default 0
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_discounted numeric;
  v_preliminary numeric;
  v_resale_low numeric;
  v_resale_high numeric;
begin
  v_discounted := p_auction_value * (1 - p_discount_pct / 100);
  v_preliminary := v_discounted - p_reconditioning;

  -- Target resale margin: 20-25%
  v_resale_low := v_preliminary / (1 - 0.25); -- 25% margin
  v_resale_high := v_preliminary / (1 - 0.20); -- 20% margin

  return jsonb_build_object(
    'auction_value', p_auction_value,
    'discount_pct', p_discount_pct,
    'discounted_value', round(v_discounted, 2),
    'reconditioning', p_reconditioning,
    'preliminary_value', round(v_preliminary, 2),
    'suggested_resale_low', round(v_resale_low, 2),
    'suggested_resale_high', round(v_resale_high, 2)
  );
end;
$$;

-- ── Auto-calculate on update ────────────────────────────────────────────────

create or replace function public.trade_valuation_auto_calc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.auction_value is not null then
    NEW.discounted_value := NEW.auction_value * (1 - coalesce(NEW.discount_percentage, 8) / 100);
    NEW.preliminary_value := NEW.discounted_value - coalesce(NEW.reconditioning_estimate, 0);
    NEW.suggested_resale_price := NEW.preliminary_value / (1 - 0.225); -- midpoint of 20-25%

    -- Over-allowance check: if final_value exceeds preliminary by >10%
    if NEW.final_value is not null and NEW.preliminary_value > 0 then
      NEW.over_allowance := (NEW.final_value > NEW.preliminary_value * 1.10);
      if NEW.over_allowance and NEW.status = 'preliminary' then
        NEW.status := 'manager_review';
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trade_valuation_calc on public.trade_valuations;
create trigger trade_valuation_calc
  before insert or update on public.trade_valuations
  for each row
  execute function public.trade_valuation_auto_calc();

-- ── Updated_at trigger ──────────────────────────────────────────────────────

drop trigger if exists set_trade_valuations_updated_at on public.trade_valuations;
create trigger set_trade_valuations_updated_at
  before update on public.trade_valuations for each row
  execute function public.set_updated_at();
