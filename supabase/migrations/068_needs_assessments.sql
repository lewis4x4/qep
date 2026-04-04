-- ============================================================================
-- Migration 068: Needs Assessment Table
--
-- Structured assessment data from owner's SOP covering:
-- application, machine requirements, timeline, budget, trade-in,
-- decision process, and next steps.
--
-- Primary entry method: voice capture auto-fill. Also supports manual and AI chat.
-- ============================================================================

-- ── 1. Create needs_assessments table ───────────────────────────────────────

create table public.needs_assessments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  deal_id uuid references public.crm_deals(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  voice_capture_id uuid references public.voice_captures(id) on delete set null,

  -- Application (from SOP: "What are you using the machine for?")
  application text,
  work_type text,
  terrain_material text,

  -- Machine Requirements (from SOP)
  current_equipment text,
  current_equipment_issues text,
  machine_interest text,
  attachments_needed text[],
  brand_preference text,

  -- Timeline (from SOP: "When do you need it?")
  timeline_description text,
  timeline_urgency text check (timeline_urgency in ('urgent', 'normal', 'flexible')),
  job_scheduled boolean default false,

  -- Budget & Payment (from SOP)
  budget_type text check (budget_type in ('cash', 'financing', 'lease')),
  budget_amount numeric,
  monthly_payment_target numeric,
  financing_preference text,

  -- Trade-In (from SOP: "Any equipment to trade?")
  has_trade_in boolean default false,
  trade_in_details text,

  -- Decision Process (from SOP: "Who is the decision maker?")
  is_decision_maker boolean,
  decision_maker_name text,

  -- Next Step (from SOP: "Quote, Demo, Credit application")
  next_step text check (next_step in ('quote', 'demo', 'credit_application', 'site_visit', 'follow_up')),

  -- Metadata
  entry_method text check (entry_method in ('voice', 'manual', 'ai_chat')) default 'manual',
  qrm_narrative text, -- Natural language summary in owner's preferred format

  -- Completeness tracking
  fields_populated integer not null default 0,
  fields_total integer not null default 15,
  completeness_pct numeric(5,2) generated always as (
    round((fields_populated::numeric / nullif(fields_total, 0)) * 100, 2)
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

comment on table public.needs_assessments is 'Structured customer needs assessment per owner SOP. Primary input: voice capture auto-fill.';
comment on column public.needs_assessments.qrm_narrative is 'Natural language summary in the format: "I spoke to [name] with [company]..."';
comment on column public.needs_assessments.completeness_pct is 'Auto-calculated percentage of populated assessment fields';

-- ── 2. RLS ──────────────────────────────────────────────────────────────────

alter table public.needs_assessments enable row level security;

create policy "needs_assessments_select_workspace"
  on public.needs_assessments for select
  using (workspace_id = public.get_my_workspace());

create policy "needs_assessments_insert_workspace"
  on public.needs_assessments for insert
  with check (workspace_id = public.get_my_workspace());

create policy "needs_assessments_update_workspace"
  on public.needs_assessments for update
  using (workspace_id = public.get_my_workspace());

create policy "needs_assessments_delete_elevated"
  on public.needs_assessments for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "needs_assessments_service_all"
  on public.needs_assessments for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── 3. Indexes ──────────────────────────────────────────────────────────────

create index idx_needs_assessments_deal on public.needs_assessments(deal_id);
create index idx_needs_assessments_contact on public.needs_assessments(contact_id);
create index idx_needs_assessments_voice on public.needs_assessments(voice_capture_id)
  where voice_capture_id is not null;

-- ── 4. Add FK on crm_deals ──────────────────────────────────────────────────

alter table public.crm_deals
  add column if not exists needs_assessment_id uuid
    references public.needs_assessments(id) on delete set null;

-- ── 5. Auto-calculate fields_populated on change ────────────────────────────

create or replace function public.needs_assessment_calc_completeness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  NEW.fields_populated := (
    (NEW.application is not null)::int +
    (NEW.work_type is not null)::int +
    (NEW.terrain_material is not null)::int +
    (NEW.current_equipment is not null)::int +
    (NEW.machine_interest is not null)::int +
    (NEW.attachments_needed is not null and array_length(NEW.attachments_needed, 1) > 0)::int +
    (NEW.brand_preference is not null)::int +
    (NEW.timeline_description is not null)::int +
    (NEW.budget_type is not null)::int +
    (NEW.budget_amount is not null)::int +
    (NEW.monthly_payment_target is not null)::int +
    (NEW.has_trade_in is not null and NEW.has_trade_in = true)::int +
    (NEW.is_decision_maker is not null)::int +
    (NEW.next_step is not null)::int +
    (NEW.qrm_narrative is not null)::int
  );
  return NEW;
end;
$$;

drop trigger if exists needs_assessment_completeness on public.needs_assessments;
create trigger needs_assessment_completeness
  before insert or update on public.needs_assessments
  for each row
  execute function public.needs_assessment_calc_completeness();

-- ── 6. Updated_at trigger ───────────────────────────────────────────────────

drop trigger if exists set_needs_assessments_updated_at on public.needs_assessments;
create trigger set_needs_assessments_updated_at
  before update on public.needs_assessments
  for each row
  execute function public.set_updated_at();
