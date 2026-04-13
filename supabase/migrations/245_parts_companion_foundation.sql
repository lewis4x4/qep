-- ============================================================
-- Migration 245: Parts Companion Foundation
-- Purpose: Tables, views, triggers, and RLS for the Parts
--          Companion counter-intelligence dashboard.
-- ============================================================

-- ── ALTER parts_catalog: add intelligence columns ───────────────────────────
-- Adds cross-reference, machine compatibility, provenance, and
-- IntelliDealer integration columns to the existing catalog.

alter table public.parts_catalog
  add column if not exists cross_references jsonb not null default '[]',
  add column if not exists compatible_machines uuid[] default '{}',
  add column if not exists frequently_ordered_with uuid[] default '{}',
  add column if not exists superseded_by text,
  add column if not exists supersedes text,
  add column if not exists source_documents text[] default '{}',
  add column if not exists extraction_confidence float default 0.0,
  add column if not exists manually_verified boolean not null default false,
  add column if not exists intellidealer_part_id text,
  add column if not exists last_known_price numeric(10, 2),
  add column if not exists price_updated_at timestamptz;

comment on column public.parts_catalog.cross_references is
  'JSONB array of cross-reference entries: [{ source, part_number, verified, note }]';
comment on column public.parts_catalog.compatible_machines is
  'UUID array referencing machine_profiles.id';
comment on column public.parts_catalog.frequently_ordered_with is
  'UUID array referencing other parts_catalog.id entries commonly ordered together';
comment on column public.parts_catalog.extraction_confidence is
  '0-1 confidence score from AI extraction of manufacturer docs';
comment on column public.parts_catalog.intellidealer_part_id is
  'IntelliDealer internal ID for direct linking (Phase 2)';

create index if not exists idx_parts_catalog_cross_ref
  on public.parts_catalog using gin(cross_references);
-- Justification: Cross-reference lookup — find OEM part from aftermarket number

create index if not exists idx_parts_catalog_compatible_machines
  on public.parts_catalog using gin(compatible_machines);
-- Justification: "Show all parts for machine X" query

create index if not exists idx_parts_catalog_search_fts
  on public.parts_catalog using gin(
    to_tsvector('english',
      coalesce(part_number, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(manufacturer, '') || ' ' ||
      coalesce(category, '')
    )
  );
-- Justification: Full-text search across all text fields for AI-powered lookup


-- ============================================================
-- TABLE: machine_profiles
-- Purpose: Structured reference data extracted from manufacturer
-- documentation. Each row = one machine model.
-- Populated by extract-machine-profiles Edge Function during onboarding.
-- ============================================================
create table public.machine_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  manufacturer text not null,
  model text not null,
  model_family text,
  year_range_start int,
  year_range_end int,
  category text not null,
  specs jsonb not null default '{}',
  -- Structure: {
  --   weight_lbs: 45000,
  --   horsepower: 250,
  --   operating_capacity_lbs: 3500,
  --   boom_reach_ft: 25
  -- }
  maintenance_schedule jsonb not null default '[]',
  -- Structure: [
  --   { interval_hours: 250, tasks: ["Change engine oil", ...], parts: ["BK-495-OF-018"] },
  --   { interval_hours: 500, tasks: [...], parts: [...] }
  -- ]
  fluid_capacities jsonb not null default '{}',
  -- Structure: {
  --   engine_oil: { capacity_qt: 16, spec: "15W-40 CK-4" },
  --   hydraulic: { capacity_gal: 45, spec: "AW-46" }
  -- }
  common_wear_parts jsonb not null default '{}',
  -- Structure: {
  --   engine: [{ part_number: "BK-495-OF-018", description: "Oil Filter", avg_replace_hours: 250 }],
  --   hydraulic: [...], cutting: [...], undercarriage: [...], electrical: [...]
  -- }
  source_documents text[] default '{}',
  extraction_confidence float default 0.0,
  manually_verified boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint uq_machine_profile unique (workspace_id, manufacturer, model, year_range_start)
);

comment on table public.machine_profiles is
  'Structured machine reference data extracted from manufacturer PDFs. One row per model.';

create index idx_machine_profiles_ws_manufacturer
  on public.machine_profiles(workspace_id, manufacturer)
  where deleted_at is null;
-- Justification: Browse by manufacturer → model hierarchy

create index idx_machine_profiles_category
  on public.machine_profiles(workspace_id, category)
  where deleted_at is null;
-- Justification: Filter machines by type (all chippers, all loaders, etc.)

create index idx_machine_profiles_search_fts
  on public.machine_profiles using gin(
    to_tsvector('english',
      manufacturer || ' ' || model || ' ' || coalesce(model_family, '')
    )
  );
-- Justification: Full-text search on machine names ("Barko 495" finds "Barko 495ML")

alter table public.machine_profiles enable row level security;

-- All authenticated users can read machine profiles — this is reference data.
create policy "machine_profiles_select"
  on public.machine_profiles for select
  using (
    workspace_id = public.get_my_workspace()
    and deleted_at is null
  );

-- Admin/owner can modify machine profiles.
create policy "machine_profiles_mutate"
  on public.machine_profiles for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'owner')
  );

create policy "machine_profiles_service_all"
  on public.machine_profiles for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_machine_profiles_updated_at
  before update on public.machine_profiles
  for each row execute function public.set_updated_at();

grant select on public.machine_profiles to authenticated;
grant all on public.machine_profiles to service_role;


-- ============================================================
-- TABLE: parts_requests
-- Purpose: Internal request queue — service techs, sales reps,
-- or customers request parts. Parts counter fulfills.
-- Core workflow engine for the Queue screen.
-- ============================================================
create table public.parts_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  requested_by uuid not null references auth.users(id),
  assigned_to uuid references auth.users(id),
  request_source text not null
    check (request_source in (
      'service', 'sales', 'customer_walkin', 'customer_phone', 'internal'
    )),
  priority text not null default 'normal'
    check (priority in ('critical', 'urgent', 'normal', 'low')),
  status text not null default 'requested'
    check (status in (
      'requested', 'acknowledged', 'locating', 'pulled',
      'ready', 'fulfilled', 'cancelled', 'backordered'
    )),
  customer_id uuid,
  customer_name text,
  machine_profile_id uuid references public.machine_profiles(id) on delete set null,
  machine_description text,
  work_order_number text,
  bay_number text,
  items jsonb not null default '[]',
  -- Structure: [
  --   {
  --     part_number: "BK-495-HF-024",
  --     description: "Hydraulic Return Filter",
  --     quantity: 2,
  --     status: "pulled",
  --     notes: "Customer wants OEM only"
  --   }
  -- ]
  notes text,
  estimated_completion timestamptz,
  auto_escalated boolean not null default false,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  cancelled_at timestamptz
);

comment on table public.parts_requests is
  'Internal parts request queue. Service techs/sales submit; parts counter fulfills.';

create index idx_parts_requests_ws_status
  on public.parts_requests(workspace_id, status)
  where status not in ('fulfilled', 'cancelled');
-- Justification: Queue query always filters to open requests. Partial index excludes closed.

create index idx_parts_requests_assigned
  on public.parts_requests(workspace_id, assigned_to, status)
  where status not in ('fulfilled', 'cancelled');
-- Justification: "My requests" filter — workspace_id first for RLS pushdown

create index idx_parts_requests_priority
  on public.parts_requests(priority, created_at);
-- Justification: Priority sort within the queue

create index idx_parts_requests_source
  on public.parts_requests(workspace_id, request_source);
-- Justification: Filter by source (service, customer, etc.)

create index idx_parts_requests_customer
  on public.parts_requests(customer_id)
  where customer_id is not null;
-- Justification: "All requests for this customer" lookup

create index idx_parts_requests_machine
  on public.parts_requests(machine_profile_id)
  where machine_profile_id is not null;
-- Justification: "All requests for this machine" lookup

alter table public.parts_requests enable row level security;

-- Parts staff (admin/owner iron_woman) see all requests in workspace.
-- Requester can see their own submissions.
create policy "parts_requests_select"
  on public.parts_requests for select
  using (
    workspace_id = public.get_my_workspace()
    and (
      public.get_my_role() in ('admin', 'owner')
      or requested_by = auth.uid()
    )
  );

-- Any authenticated user in the workspace can submit a parts request.
create policy "parts_requests_insert"
  on public.parts_requests for insert
  with check (
    workspace_id = public.get_my_workspace()
  );

-- Admin/owner can update any request. Requesters can only edit while still 'requested'.
create policy "parts_requests_update"
  on public.parts_requests for update
  using (
    workspace_id = public.get_my_workspace()
    and (
      public.get_my_role() in ('admin', 'owner')
      or (requested_by = auth.uid() and status = 'requested')
    )
  );

create policy "parts_requests_service_all"
  on public.parts_requests for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_parts_requests_updated_at
  before update on public.parts_requests
  for each row execute function public.set_updated_at();

grant select, insert, update on public.parts_requests to authenticated;
grant all on public.parts_requests to service_role;

-- Enable realtime for live queue updates
alter publication supabase_realtime add table public.parts_requests;


-- ============================================================
-- TABLE: parts_request_activity
-- Purpose: Activity log for request lifecycle. Every status change,
-- note, or action is recorded for auditability and timeline display.
-- ============================================================
create table public.parts_request_activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  request_id uuid not null references public.parts_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  action text not null
    check (action in (
      'status_change', 'note_added', 'item_added', 'item_removed',
      'assigned', 'escalated', 'customer_notified', 'created'
    )),
  from_value text,
  to_value text,
  notes text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

comment on table public.parts_request_activity is
  'Immutable activity log for parts request lifecycle events.';

create index idx_request_activity_request
  on public.parts_request_activity(request_id, created_at desc);
-- Justification: Timeline display for a specific request

alter table public.parts_request_activity enable row level security;

create policy "request_activity_select"
  on public.parts_request_activity for select
  using (
    workspace_id = public.get_my_workspace()
    and (
      public.get_my_role() in ('admin', 'owner')
      or request_id in (
        select id from public.parts_requests where requested_by = auth.uid()
      )
    )
  );

create policy "request_activity_insert"
  on public.parts_request_activity for insert
  with check (
    workspace_id = public.get_my_workspace()
    and user_id = auth.uid()
  );

create policy "request_activity_service_all"
  on public.parts_request_activity for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select, insert on public.parts_request_activity to authenticated;
grant all on public.parts_request_activity to service_role;

-- Enable realtime for activity feed
alter publication supabase_realtime add table public.parts_request_activity;


-- ============================================================
-- TABLE: counter_inquiries
-- Purpose: Quick log of phone/walk-in inquiries that don't become
-- formal requests. Used for demand tracking and "frequently asked"
-- intelligence.
-- ============================================================
create table public.counter_inquiries (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  user_id uuid not null references auth.users(id),
  inquiry_type text not null default 'lookup'
    check (inquiry_type in (
      'lookup', 'stock_check', 'price_check', 'cross_reference', 'technical'
    )),
  machine_profile_id uuid references public.machine_profiles(id) on delete set null,
  machine_description text,
  query_text text not null,
  result_parts text[] default '{}',
  outcome text not null default 'resolved'
    check (outcome in ('resolved', 'ordered', 'referred', 'unresolved')),
  duration_seconds int,
  created_at timestamptz not null default now()
);

comment on table public.counter_inquiries is
  'Lightweight inquiry log for demand intelligence. Tracks what parts people are asked about.';

create index idx_counter_inquiries_user
  on public.counter_inquiries(user_id, created_at desc);
-- Justification: "My recent inquiries" for re-lookup and reporting

create index idx_counter_inquiries_machine
  on public.counter_inquiries(machine_profile_id)
  where machine_profile_id is not null;
-- Justification: Demand intelligence — what machines are people asking about?

create index idx_counter_inquiries_date
  on public.counter_inquiries(workspace_id, created_at desc);
-- Justification: Recent inquiries feed, daily/weekly counts

alter table public.counter_inquiries enable row level security;

create policy "counter_inquiries_staff"
  on public.counter_inquiries for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'owner')
  );

-- Users can read their own inquiry history (recent lookups feature)
create policy "counter_inquiries_own_select"
  on public.counter_inquiries for select
  using (
    user_id = auth.uid()
  );

create policy "counter_inquiries_own_insert"
  on public.counter_inquiries for insert
  with check (
    workspace_id = public.get_my_workspace()
    and user_id = auth.uid()
  );

create policy "counter_inquiries_service_all"
  on public.counter_inquiries for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select, insert on public.counter_inquiries to authenticated;
grant all on public.counter_inquiries to service_role;


-- ============================================================
-- TABLE: parts_preferences
-- Purpose: Per-user UI preferences for parts counter staff
-- ============================================================
create table public.parts_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  dark_mode boolean not null default false,
  queue_panel_collapsed boolean not null default false,
  default_queue_filter text not null default 'all'
    check (default_queue_filter in ('all', 'mine', 'unassigned', 'service', 'customer')),
  show_fulfilled_requests boolean not null default false,
  keyboard_shortcuts_enabled boolean not null default true,
  sound_notifications boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.parts_preferences is
  'Per-user UI preferences for Parts Companion.';

create index idx_parts_preferences_user
  on public.parts_preferences(user_id);

alter table public.parts_preferences enable row level security;

create policy "parts_preferences_own"
  on public.parts_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "parts_preferences_service_all"
  on public.parts_preferences for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_parts_preferences_updated_at
  before update on public.parts_preferences
  for each row execute function public.set_updated_at();

grant all on public.parts_preferences to authenticated;
grant all on public.parts_preferences to service_role;


-- ============================================================
-- VIEW: v_parts_queue
-- Purpose: Priority-sorted queue of open parts requests with
-- computed age and urgency for the Queue dashboard.
-- ============================================================
create or replace view public.v_parts_queue with (security_barrier = true) as
select
  pr.id,
  pr.workspace_id,
  pr.request_source,
  pr.priority,
  pr.status,
  pr.bay_number,
  pr.machine_description,
  pr.customer_name,
  pr.work_order_number,
  pr.items,
  pr.notes,
  pr.auto_escalated,
  pr.escalated_at,
  pr.estimated_completion,
  pr.created_at,
  pr.updated_at,
  pr.fulfilled_at,
  pr.cancelled_at,
  pr.customer_id,
  -- Requester info
  pr.requested_by,
  req_profile.full_name as requester_name,
  -- Assignee info
  pr.assigned_to,
  asgn_profile.full_name as assignee_name,
  -- Machine profile info (if linked)
  pr.machine_profile_id,
  mp.manufacturer as machine_manufacturer,
  mp.model as machine_model,
  mp.category as machine_category,
  -- Computed fields
  extract(epoch from (now() - pr.created_at)) / 60 as age_minutes,
  case
    when pr.priority = 'critical' then 1
    when pr.priority = 'urgent' then 2
    when pr.priority = 'normal' then 3
    when pr.priority = 'low' then 4
    else 5
  end as priority_sort,
  case
    when pr.priority = 'critical'
      and extract(epoch from (now() - pr.created_at)) > 7200 then true
    when pr.estimated_completion is not null
      and pr.estimated_completion < now() then true
    else false
  end as is_overdue
from public.parts_requests pr
left join public.profiles req_profile on req_profile.id = pr.requested_by
left join public.profiles asgn_profile on asgn_profile.id = pr.assigned_to
left join public.machine_profiles mp on mp.id = pr.machine_profile_id
where pr.status not in ('fulfilled', 'cancelled')
  and pr.workspace_id = public.get_my_workspace()
order by
  priority_sort asc,
  pr.created_at asc;

grant select on public.v_parts_queue to authenticated;


-- ============================================================
-- TRIGGER: Auto-escalate parts requests based on age
-- ============================================================
create or replace function public.auto_escalate_parts_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Service requests open > 2 hours: escalate to critical
  if new.request_source = 'service'
     and new.priority != 'critical'
     and new.status in ('requested', 'acknowledged', 'locating')
     and new.created_at < now() - interval '2 hours'
  then
    new.priority := 'critical';
    new.auto_escalated := true;
    new.escalated_at := now();
  end if;

  -- Any request open > 4 hours with normal priority: escalate to urgent
  if new.priority = 'normal'
     and new.status in ('requested', 'acknowledged', 'locating')
     and new.created_at < now() - interval '4 hours'
  then
    new.priority := 'urgent';
    new.auto_escalated := true;
    new.escalated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_auto_escalate_parts
  before update on public.parts_requests
  for each row
  execute function public.auto_escalate_parts_requests();


-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- drop trigger if exists trg_auto_escalate_parts on public.parts_requests;
-- drop function if exists public.auto_escalate_parts_requests();
-- drop view if exists public.v_parts_queue;
-- drop policy if exists "parts_preferences_service_all" on public.parts_preferences;
-- drop policy if exists "parts_preferences_own" on public.parts_preferences;
-- drop trigger if exists set_parts_preferences_updated_at on public.parts_preferences;
-- drop index if exists idx_parts_preferences_user;
-- drop table if exists public.parts_preferences;
-- drop policy if exists "counter_inquiries_service_all" on public.counter_inquiries;
-- drop policy if exists "counter_inquiries_own_insert" on public.counter_inquiries;
-- drop policy if exists "counter_inquiries_staff" on public.counter_inquiries;
-- drop index if exists idx_counter_inquiries_date;
-- drop index if exists idx_counter_inquiries_machine;
-- drop index if exists idx_counter_inquiries_user;
-- drop table if exists public.counter_inquiries;
-- drop policy if exists "request_activity_service_all" on public.parts_request_activity;
-- drop policy if exists "request_activity_insert" on public.parts_request_activity;
-- drop policy if exists "request_activity_select" on public.parts_request_activity;
-- drop index if exists idx_request_activity_request;
-- drop table if exists public.parts_request_activity;
-- alter publication supabase_realtime drop table public.parts_requests;
-- alter publication supabase_realtime drop table public.parts_request_activity;
-- drop policy if exists "parts_requests_service_all" on public.parts_requests;
-- drop policy if exists "parts_requests_update" on public.parts_requests;
-- drop policy if exists "parts_requests_insert" on public.parts_requests;
-- drop policy if exists "parts_requests_select" on public.parts_requests;
-- drop trigger if exists set_parts_requests_updated_at on public.parts_requests;
-- drop index if exists idx_parts_requests_machine;
-- drop index if exists idx_parts_requests_customer;
-- drop index if exists idx_parts_requests_source;
-- drop index if exists idx_parts_requests_priority;
-- drop index if exists idx_parts_requests_assigned;
-- drop index if exists idx_parts_requests_ws_status;
-- drop table if exists public.parts_requests;
-- drop policy if exists "machine_profiles_service_all" on public.machine_profiles;
-- drop policy if exists "machine_profiles_mutate" on public.machine_profiles;
-- drop policy if exists "machine_profiles_select" on public.machine_profiles;
-- drop trigger if exists set_machine_profiles_updated_at on public.machine_profiles;
-- drop index if exists idx_machine_profiles_search_fts;
-- drop index if exists idx_machine_profiles_category;
-- drop index if exists idx_machine_profiles_ws_manufacturer;
-- drop table if exists public.machine_profiles;
-- alter table public.parts_catalog drop column if exists price_updated_at;
-- alter table public.parts_catalog drop column if exists last_known_price;
-- alter table public.parts_catalog drop column if exists intellidealer_part_id;
-- alter table public.parts_catalog drop column if exists manually_verified;
-- alter table public.parts_catalog drop column if exists extraction_confidence;
-- alter table public.parts_catalog drop column if exists source_documents;
-- alter table public.parts_catalog drop column if exists supersedes;
-- alter table public.parts_catalog drop column if exists superseded_by;
-- alter table public.parts_catalog drop column if exists frequently_ordered_with;
-- alter table public.parts_catalog drop column if exists compatible_machines;
-- alter table public.parts_catalog drop column if exists cross_references;
-- drop index if exists idx_parts_catalog_search_fts;
-- drop index if exists idx_parts_catalog_compatible_machines;
-- drop index if exists idx_parts_catalog_cross_ref;
