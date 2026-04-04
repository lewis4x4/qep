-- ============================================================================
-- Migration 076: Escalation Tickets & Post-Sale Issue Routing
--
-- Per owner's post-sale SOP example:
-- Single voice command creates: email draft + follow-up task + escalation ticket
-- Routes to correct department manager based on issue type
-- ============================================================================

create table public.escalation_tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  -- Source
  touchpoint_id uuid references public.follow_up_touchpoints(id) on delete set null,
  deal_id uuid references public.crm_deals(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,

  -- Issue
  issue_description text not null,
  department text, -- 'parts', 'service', 'sales', 'admin'
  branch text, -- 'lake_city', 'ocala'
  severity text default 'normal' check (severity in ('low', 'normal', 'high', 'critical')),

  -- Routing
  assigned_to uuid references public.profiles(id) on delete set null,
  escalated_by uuid references public.profiles(id) on delete set null,

  -- Resolution
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved', 'closed')),
  resolution_notes text,
  resolved_at timestamptz,

  -- Auto-generated actions
  email_drafted boolean default false,
  email_draft_content text,
  email_recipient text,
  follow_up_task_created boolean default false,
  follow_up_task_id uuid references public.crm_activities(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.escalation_tickets is 'Issue escalation from post-sale follow-ups. Voice command creates email + task + ticket in one shot.';

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.escalation_tickets enable row level security;

create policy "escalations_select_workspace" on public.escalation_tickets for select
  using (workspace_id = public.get_my_workspace());
create policy "escalations_insert_workspace" on public.escalation_tickets for insert
  with check (workspace_id = public.get_my_workspace());
create policy "escalations_update_workspace" on public.escalation_tickets for update
  using (workspace_id = public.get_my_workspace());
create policy "escalations_delete_elevated" on public.escalation_tickets for delete
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "escalations_service_all" on public.escalation_tickets for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index idx_escalations_status on public.escalation_tickets(status) where status in ('open', 'in_progress');
create index idx_escalations_assigned on public.escalation_tickets(assigned_to) where status in ('open', 'in_progress');
create index idx_escalations_deal on public.escalation_tickets(deal_id) where deal_id is not null;

-- ── Updated_at trigger ──────────────────────────────────────────────────────

drop trigger if exists set_escalation_tickets_updated_at on public.escalation_tickets;
create trigger set_escalation_tickets_updated_at
  before update on public.escalation_tickets for each row
  execute function public.set_updated_at();
