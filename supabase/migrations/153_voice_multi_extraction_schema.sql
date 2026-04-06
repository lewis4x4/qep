-- ============================================================================
-- Migration 153: Voice Multi-Extraction Schema Support
--
-- Gap closure for Moonshot 3 ("Brian Method"):
-- - Scheduled follow-ups table (arbitrary future dates, not just cadence)
-- - Voice-captured equipment records linked to companies
-- - Extraction intent markers on voice_qrm_results for multi-deal tracking
-- ============================================================================

-- ── 1. Scheduled follow-ups (future-dated tasks, beyond cadence) ────────────

create table public.scheduled_follow_ups (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  -- Who/what
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,

  -- Context — at most one entity link
  deal_id uuid references public.crm_deals(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  company_id uuid references public.crm_companies(id) on delete set null,
  voice_capture_id uuid references public.voice_captures(id) on delete set null,

  -- Task
  title text not null,
  description text,
  scheduled_for date not null,
  scheduled_time time,

  -- Source
  source text not null default 'manual' check (source in ('manual', 'voice_extraction', 'sop_step', 'deal_timing')),
  extraction_confidence numeric(3,2),

  -- Status
  status text not null default 'pending' check (status in ('pending', 'completed', 'snoozed', 'dismissed')),
  completed_at timestamptz,
  completion_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.scheduled_follow_ups is 'Arbitrary future-dated tasks from voice extraction or manual entry. Separate from cadence engine.';

alter table public.scheduled_follow_ups enable row level security;
create policy "scheduled_follow_ups_workspace" on public.scheduled_follow_ups for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "scheduled_follow_ups_service" on public.scheduled_follow_ups for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_scheduled_followups_assigned_date on public.scheduled_follow_ups(assigned_to, scheduled_for)
  where status = 'pending';
create index idx_scheduled_followups_deal on public.scheduled_follow_ups(deal_id) where deal_id is not null;
create index idx_scheduled_followups_company on public.scheduled_follow_ups(company_id) where company_id is not null;

-- ── 2. Voice-extracted equipment (linked to companies + voice captures) ─────

create table public.voice_extracted_equipment (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  voice_capture_id uuid not null references public.voice_captures(id) on delete cascade,
  company_id uuid references public.crm_companies(id) on delete set null,
  crm_equipment_id uuid references public.crm_equipment(id) on delete set null,

  -- Extracted attributes
  make text,
  model text,
  year integer,
  hours numeric,
  serial_number text,
  current_value_estimate numeric,

  -- Context from voice
  mentioned_as text, -- 'current_fleet' | 'trade_in' | 'competitor' | 'interest'
  raw_mention text,  -- original voice snippet

  -- Link back to created deal if applicable
  linked_deal_id uuid references public.crm_deals(id) on delete set null,

  created_at timestamptz not null default now()
);

comment on table public.voice_extracted_equipment is 'Equipment records auto-extracted from voice notes. Links to crm_equipment if matched, linked_deal if applicable.';

alter table public.voice_extracted_equipment enable row level security;
create policy "voice_equipment_workspace" on public.voice_extracted_equipment for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "voice_equipment_service" on public.voice_extracted_equipment for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_voice_equipment_capture on public.voice_extracted_equipment(voice_capture_id);
create index idx_voice_equipment_company on public.voice_extracted_equipment(company_id) where company_id is not null;

-- ── 3. Extend voice_qrm_results with multi-deal support ─────────────────────

alter table public.voice_qrm_results
  add column if not exists additional_deal_ids uuid[] default '{}',
  add column if not exists extracted_equipment_ids uuid[] default '{}',
  add column if not exists scheduled_follow_up_ids uuid[] default '{}',
  add column if not exists budget_cycle_captured boolean default false;

comment on column public.voice_qrm_results.additional_deal_ids is 'Extra deals created beyond the primary deal (multi-deal extraction)';
comment on column public.voice_qrm_results.extracted_equipment_ids is 'Equipment records created from voice mentions';
comment on column public.voice_qrm_results.scheduled_follow_up_ids is 'Future-dated tasks extracted from voice';

-- ── 4. Trigger ──────────────────────────────────────────────────────────────

create trigger set_scheduled_follow_ups_updated_at
  before update on public.scheduled_follow_ups for each row
  execute function public.set_updated_at();
