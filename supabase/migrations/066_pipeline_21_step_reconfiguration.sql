-- ============================================================================
-- Migration 066: 21-Step Pipeline Reconfiguration
--
-- Replaces existing deal stages with the owner's exact 21-step pipeline
-- derived from operational SOPs (April 3, 2026).
--
-- CRITICAL schema notes (verified from migration 021):
--   - Column is `sort_order` (integer), NOT `display_order`
--   - Probability is 0-100 scale, CHECK (probability >= 0 AND probability <= 100)
--   - `stage_id` on crm_deals uses ON DELETE RESTRICT — must remap deals first
--   - Unique constraint on (workspace_id, name)
-- ============================================================================

-- ── 1. Add new columns to crm_deal_stages ───────────────────────────────────

alter table public.crm_deal_stages
  add column if not exists description text,
  add column if not exists sla_minutes integer;

comment on column public.crm_deal_stages.description is 'SOP-derived description of this pipeline step';
comment on column public.crm_deal_stages.sla_minutes is 'SLA deadline in minutes for transitioning out of this stage (null = no SLA)';

-- ── 2. Add SLA tracking columns to crm_deals ───────────────────────────────

alter table public.crm_deals
  add column if not exists sla_started_at timestamptz,
  add column if not exists sla_deadline_at timestamptz;

comment on column public.crm_deals.sla_started_at is 'Timestamp when current stage SLA timer started';
comment on column public.crm_deals.sla_deadline_at is 'Timestamp when current stage SLA expires';

create index if not exists idx_crm_deals_sla_deadline
  on public.crm_deals(sla_deadline_at)
  where sla_deadline_at is not null;

-- ── 3. Insert the 21-step pipeline (owner's SOP) ───────────────────────────
-- Use a temp table to hold the new stages, then remap existing deals.

do $$
declare
  ws text := 'default';
  new_stage_ids uuid[];
  stage_rec record;
  old_stage record;
  closest_new_id uuid;
begin
  -- 3a. Insert the 21 owner-specified stages
  -- Using ON CONFLICT to handle re-runs gracefully
  insert into public.crm_deal_stages
    (workspace_id, name, sort_order, probability, description, sla_minutes, is_closed_won, is_closed_lost)
  values
    (ws, 'Lead Received',       1,   5, 'Inbound lead routed by territory to correct Iron Advisor', 15, false, false),
    (ws, 'Initial Contact',     2,  10, 'First customer conversation. SLA: <30 minutes from lead receipt', null, false, false),
    (ws, 'Needs Assessment',    3,  15, 'Structured assessment: application, machine, timeline, budget, trade-in, decision maker', 60, false, false),
    (ws, 'QRM Entry',           4,  15, 'All assessment data entered in QRM. Voice capture auto-fill preferred', null, false, false),
    (ws, 'Inventory Validation',5,  20, 'Validate stock availability via IntelliDealer or manual check', null, false, false),
    (ws, 'Quote Created',       6,  25, 'Quote generated. SLA: <1 hour from needs assessment conversation', null, false, false),
    (ws, 'Quote Sent',          7,  30, 'Quote package sent: quote + photos + brochure + credit app + video link', 30, false, false),
    (ws, 'Quote Presented',     8,  35, 'Walk-through of proposal with customer. SLA: <30 min after quote sent', null, false, false),
    (ws, 'Ask for Sale',        9,  40, 'Close attempt. Next step identified: demo, finance, or site visit', null, false, false),
    (ws, 'QRM Updated',        10,  40, 'Post-presentation status entered. Voice capture preferred', null, false, false),
    (ws, 'Follow-Up Set',      11,  45, 'Auto-cadence activated: Day 0, 2-3, 7, 14, 30, then monthly', null, false, false),
    (ws, 'Ongoing Follow-Up',  12,  45, 'Active follow-up until decision. Monthly nurture if no sale', null, false, false),
    (ws, 'Sales Order Signed', 13,  70, 'Customer signature on sales order. Margin check: <10% routes to manager', null, false, false),
    (ws, 'Credit Submitted',   14,  75, 'Credit application submitted to bank. Track approval status', null, false, false),
    (ws, 'Deal Shared',        15,  80, 'Invoice shared with bank and Iron Woman for processing', null, false, false),
    (ws, 'Deposit Collected',  16,  85, 'Deposit received and verified. HARD GATE: no deposit = no order', null, false, false),
    (ws, 'Equipment Ready',    17,  90, 'Machine washed, attachments installed, PDI complete, payment confirmed', null, false, false),
    (ws, 'Delivery Scheduled', 18,  92, 'Traffic ticket created. Delivery date confirmed with customer', null, false, false),
    (ws, 'Delivery Completed', 19,  95, 'Equipment delivered. Delivery report signed. Hour meter recorded', null, false, false),
    (ws, 'Invoice Closed',     20,  98, 'Invoice closed. Warranty registration filed', null, false, false),
    (ws, 'Post-Sale Follow-Up',21, 100, 'Ongoing: 1 week, 1 month, 90 days, quarterly/bi-annual', null, true, false)
  on conflict (workspace_id, name) do update set
    sort_order = excluded.sort_order,
    probability = excluded.probability,
    description = excluded.description,
    sla_minutes = excluded.sla_minutes,
    is_closed_won = excluded.is_closed_won,
    is_closed_lost = excluded.is_closed_lost;

  -- 3b. Remap any existing deals that point to old stages (non-21-step stages)
  -- Strategy: map each deal's old stage to the closest new stage by sort_order
  for old_stage in
    select distinct ds.id as old_stage_id, ds.sort_order as old_order, ds.name as old_name
    from public.crm_deal_stages ds
    where ds.workspace_id = ws
      and ds.name not in (
        'Lead Received', 'Initial Contact', 'Needs Assessment', 'QRM Entry',
        'Inventory Validation', 'Quote Created', 'Quote Sent', 'Quote Presented',
        'Ask for Sale', 'QRM Updated', 'Follow-Up Set', 'Ongoing Follow-Up',
        'Sales Order Signed', 'Credit Submitted', 'Deal Shared', 'Deposit Collected',
        'Equipment Ready', 'Delivery Scheduled', 'Delivery Completed', 'Invoice Closed',
        'Post-Sale Follow-Up'
      )
      and exists (select 1 from public.crm_deals d where d.stage_id = ds.id)
  loop
    -- Find the closest new stage by sort_order
    select id into closest_new_id
    from public.crm_deal_stages
    where workspace_id = ws
      and name in (
        'Lead Received', 'Initial Contact', 'Needs Assessment', 'QRM Entry',
        'Inventory Validation', 'Quote Created', 'Quote Sent', 'Quote Presented',
        'Ask for Sale', 'QRM Updated', 'Follow-Up Set', 'Ongoing Follow-Up',
        'Sales Order Signed', 'Credit Submitted', 'Deal Shared', 'Deposit Collected',
        'Equipment Ready', 'Delivery Scheduled', 'Delivery Completed', 'Invoice Closed',
        'Post-Sale Follow-Up'
      )
    order by abs(sort_order - old_stage.old_order)
    limit 1;

    -- Remap deals
    update public.crm_deals
    set stage_id = closest_new_id, updated_at = now()
    where stage_id = old_stage.old_stage_id;
  end loop;

  -- 3c. Delete orphaned old stages (no deals reference them after remapping)
  delete from public.crm_deal_stages
  where workspace_id = ws
    and name not in (
      'Lead Received', 'Initial Contact', 'Needs Assessment', 'QRM Entry',
      'Inventory Validation', 'Quote Created', 'Quote Sent', 'Quote Presented',
      'Ask for Sale', 'QRM Updated', 'Follow-Up Set', 'Ongoing Follow-Up',
      'Sales Order Signed', 'Credit Submitted', 'Deal Shared', 'Deposit Collected',
      'Equipment Ready', 'Delivery Scheduled', 'Delivery Completed', 'Invoice Closed',
      'Post-Sale Follow-Up'
    )
    and not exists (select 1 from public.crm_deals d where d.stage_id = crm_deal_stages.id);

end;
$$;

-- ── 4. SLA trigger: auto-set sla_started_at and sla_deadline_at on stage change ─

create or replace function public.crm_deal_sla_on_stage_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stage_sla integer;
begin
  -- Only fire when stage_id actually changes
  if OLD.stage_id is distinct from NEW.stage_id then
    -- Look up SLA for the new stage
    select sla_minutes into stage_sla
    from public.crm_deal_stages
    where id = NEW.stage_id;

    if stage_sla is not null then
      NEW.sla_started_at := now();
      NEW.sla_deadline_at := now() + (stage_sla || ' minutes')::interval;
    else
      -- No SLA for this stage — clear the timer
      NEW.sla_started_at := null;
      NEW.sla_deadline_at := null;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists crm_deal_sla_stage_change on public.crm_deals;
create trigger crm_deal_sla_stage_change
  before update of stage_id on public.crm_deals
  for each row
  execute function public.crm_deal_sla_on_stage_change();

-- Also fire on INSERT for new deals entering SLA-tracked stages
drop trigger if exists crm_deal_sla_stage_insert on public.crm_deals;
create trigger crm_deal_sla_stage_insert
  before insert on public.crm_deals
  for each row
  execute function public.crm_deal_sla_on_stage_change();
