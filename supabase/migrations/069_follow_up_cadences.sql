-- ============================================================================
-- Migration 069: Follow-Up Cadence Engine
--
-- Structured multi-touchpoint follow-up sequences per owner's Follow-Up SOP.
-- Core rule: every follow-up must include VALUE. Eliminate "just checking in."
--
-- Two cadence types:
--   1. Sales cadence: Day 0/2-3/7/14/30/monthly after quote
--   2. Post-sale cadence: delivery/1wk/1mo/90d/quarterly after delivery
--
-- Integrates with existing crm_in_app_notifications (migration 046)
-- for notification delivery.
-- ============================================================================

-- ── 1. Follow-up cadences (parent: one per deal) ───────────────────────────

create table public.follow_up_cadences (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  cadence_type text not null check (cadence_type in ('sales', 'post_sale')),
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'cancelled')),
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.follow_up_cadences is 'Structured follow-up sequence for a deal. One active cadence per type per deal.';

-- ── 2. Follow-up touchpoints (children: scheduled interactions) ─────────────

create table public.follow_up_touchpoints (
  id uuid primary key default gen_random_uuid(),
  cadence_id uuid not null references public.follow_up_cadences(id) on delete cascade,

  -- Schedule
  touchpoint_type text not null,
  -- Sales: 'day_0', 'day_2_3', 'day_7', 'day_14', 'day_30', 'monthly'
  -- Post-sale: 'post_delivery', 'post_1wk', 'post_1mo', 'post_90d', 'post_quarterly'
  scheduled_date date not null,

  -- Content — AI-generated value-add, never "just checking in"
  purpose text not null,
  suggested_message text,
  value_type text,
  -- Sales: 'quote_confirmation', 'solution_refinement', 'roi_analysis',
  --        'objection_handling', 'timeline_reset', 'nurture'
  -- Post-sale: 'delivery_training', 'early_issues', 'upsell_visit',
  --            'service_survey', 'retention'

  -- Execution
  status text not null default 'pending' check (status in ('pending', 'completed', 'skipped', 'overdue')),
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  completion_notes text,
  delivery_method text check (delivery_method in ('call', 'text', 'email', 'visit', 'voice_note')),

  -- AI content generation metadata
  content_generated_at timestamptz,
  content_context jsonb default '{}', -- deal/needs/competitor context used for generation

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.follow_up_touchpoints is 'Individual scheduled touchpoints within a cadence. AI generates value-add content for each.';
comment on column public.follow_up_touchpoints.suggested_message is 'AI-generated contextual message — never generic, always value-driven';

-- ── 3. RLS ──────────────────────────────────────────────────────────────────

alter table public.follow_up_cadences enable row level security;
alter table public.follow_up_touchpoints enable row level security;

-- Cadences: workspace-scoped
create policy "cadences_select_workspace"
  on public.follow_up_cadences for select
  using (workspace_id = public.get_my_workspace());

create policy "cadences_insert_workspace"
  on public.follow_up_cadences for insert
  with check (workspace_id = public.get_my_workspace());

create policy "cadences_update_workspace"
  on public.follow_up_cadences for update
  using (workspace_id = public.get_my_workspace());

create policy "cadences_delete_elevated"
  on public.follow_up_cadences for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "cadences_service_all"
  on public.follow_up_cadences for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Touchpoints: via cadence workspace (SECURITY DEFINER helper to avoid recursion)
create or replace function public.touchpoint_in_my_workspace(p_cadence_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.follow_up_cadences c
    where c.id = p_cadence_id
    and c.workspace_id = (
      select coalesce(
        current_setting('request.jwt.claims', true)::jsonb ->> 'workspace_id',
        current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'workspace_id',
        current_setting('request.jwt.claims', true)::jsonb -> 'user_metadata' ->> 'workspace_id',
        'default'
      )
    )
  );
$$;

revoke execute on function public.touchpoint_in_my_workspace(uuid) from public;
grant execute on function public.touchpoint_in_my_workspace(uuid) to authenticated;

create policy "touchpoints_select_via_cadence"
  on public.follow_up_touchpoints for select
  using (public.touchpoint_in_my_workspace(cadence_id));

create policy "touchpoints_insert_via_cadence"
  on public.follow_up_touchpoints for insert
  with check (public.touchpoint_in_my_workspace(cadence_id));

create policy "touchpoints_update_via_cadence"
  on public.follow_up_touchpoints for update
  using (public.touchpoint_in_my_workspace(cadence_id));

create policy "touchpoints_delete_elevated"
  on public.follow_up_touchpoints for delete
  using (
    public.touchpoint_in_my_workspace(cadence_id)
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "touchpoints_service_all"
  on public.follow_up_touchpoints for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── 4. Indexes ──────────────────────────────────────────────────────────────

create index idx_cadences_deal on public.follow_up_cadences(deal_id);
create index idx_cadences_assigned on public.follow_up_cadences(assigned_to) where status = 'active';
create index idx_cadences_status on public.follow_up_cadences(status) where status = 'active';

create index idx_touchpoints_scheduled on public.follow_up_touchpoints(scheduled_date)
  where status = 'pending';
create index idx_touchpoints_cadence on public.follow_up_touchpoints(cadence_id);
create index idx_touchpoints_overdue on public.follow_up_touchpoints(scheduled_date)
  where status = 'overdue';

-- Prevent duplicate active cadences of same type per deal
create unique index uq_cadences_active_per_deal_type
  on public.follow_up_cadences(deal_id, cadence_type)
  where status = 'active';

-- ── 5. Updated_at triggers ──────────────────────────────────────────────────

drop trigger if exists set_follow_up_cadences_updated_at on public.follow_up_cadences;
create trigger set_follow_up_cadences_updated_at
  before update on public.follow_up_cadences
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_follow_up_touchpoints_updated_at on public.follow_up_touchpoints;
create trigger set_follow_up_touchpoints_updated_at
  before update on public.follow_up_touchpoints
  for each row
  execute function public.set_updated_at();

-- ── 6. Helper: create sales cadence with all touchpoints ────────────────────

create or replace function public.create_sales_cadence(
  p_deal_id uuid,
  p_contact_id uuid default null,
  p_assigned_to uuid default null,
  p_workspace_id text default 'default'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cadence_id uuid;
  v_start_date date := current_date;
begin
  -- Create the cadence
  insert into public.follow_up_cadences (workspace_id, deal_id, contact_id, assigned_to, cadence_type)
  values (p_workspace_id, p_deal_id, p_contact_id, p_assigned_to, 'sales')
  returning id into v_cadence_id;

  -- Insert the 6 touchpoints per owner's Follow-Up SOP
  insert into public.follow_up_touchpoints (cadence_id, touchpoint_type, scheduled_date, purpose, value_type) values
    (v_cadence_id, 'day_0',    v_start_date,      'Confirm receipt of quote, answer immediate questions', 'quote_confirmation'),
    (v_cadence_id, 'day_2_3',  v_start_date + 2,  'Revisit needs, refine solution, suggest alternative configs or attachment options', 'solution_refinement'),
    (v_cadence_id, 'day_7',    v_start_date + 7,  'Provide additional value: ROI comparison or attachment bundle suggestion', 'roi_analysis'),
    (v_cadence_id, 'day_14',   v_start_date + 14, 'Address objections, draft talking points based on deal context and competitor mentions', 'objection_handling'),
    (v_cadence_id, 'day_30',   v_start_date + 30, 'Final push or reset timeline with lost-sale reason tracking', 'timeline_reset'),
    (v_cadence_id, 'monthly',  v_start_date + 60, 'Ongoing nurture: new matching inventory, promotions, seasonal offers', 'nurture');

  return v_cadence_id;
end;
$$;

-- ── 7. Helper: create post-sale cadence with all touchpoints ────────────────

create or replace function public.create_post_sale_cadence(
  p_deal_id uuid,
  p_contact_id uuid default null,
  p_assigned_to uuid default null,
  p_workspace_id text default 'default'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cadence_id uuid;
  v_delivery_date date := current_date;
begin
  -- Create the cadence
  insert into public.follow_up_cadences (workspace_id, deal_id, contact_id, assigned_to, cadence_type)
  values (p_workspace_id, p_deal_id, p_contact_id, p_assigned_to, 'post_sale')
  returning id into v_cadence_id;

  -- Insert the 5 touchpoints per owner's Post-Sale SOP
  insert into public.follow_up_touchpoints (cadence_id, touchpoint_type, scheduled_date, purpose, value_type) values
    (v_cadence_id, 'post_delivery',  v_delivery_date,       'Walkaround training, maintenance basics, service contact intro', 'delivery_training'),
    (v_cadence_id, 'post_1wk',       v_delivery_date + 7,   'Check-in for early issues, equipment-specific tips and common first-week questions', 'early_issues'),
    (v_cadence_id, 'post_1mo',       v_delivery_date + 30,  'Site visit for upsell: suggest attachments and efficiency improvements for their application', 'upsell_visit'),
    (v_cadence_id, 'post_90d',       v_delivery_date + 90,  'Service quality check: auto-generate survey about parts/service department experience', 'service_survey'),
    (v_cadence_id, 'post_quarterly', v_delivery_date + 180, 'Retention: identify replacement cycle timing, new model availability', 'retention');

  return v_cadence_id;
end;
$$;

revoke execute on function public.create_sales_cadence(uuid, uuid, uuid, text) from public;
grant execute on function public.create_sales_cadence(uuid, uuid, uuid, text) to authenticated, service_role;

revoke execute on function public.create_post_sale_cadence(uuid, uuid, uuid, text) from public;
grant execute on function public.create_post_sale_cadence(uuid, uuid, uuid, text) to authenticated, service_role;
