-- CRM core foundation (QUA-194 / E1)
-- Includes CRM operational tables, RLS, rep-safe deal reads, margin protections,
-- CRM auth audit trail, and import/idempotency metadata.
--
-- Rollback DDL is documented at the bottom of this migration.

-- ── Enums ────────────────────────────────────────────────────────────────────
create type public.crm_activity_type as enum (
  'note', 'call', 'email', 'meeting', 'task', 'sms'
);

create type public.crm_auth_event_type as enum (
  'login_success',
  'login_failure',
  'logout',
  'token_refresh',
  'password_reset_request',
  'password_reset_complete',
  'access_denied'
);

create type public.crm_auth_event_outcome as enum ('success', 'failure');

create type public.crm_import_run_status as enum (
  'queued',
  'running',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled'
);

-- ── Core CRM tables ──────────────────────────────────────────────────────────
create table public.crm_companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  name text not null,
  parent_company_id uuid references public.crm_companies(id) on delete set null,
  assigned_rep_id uuid references public.profiles(id) on delete set null,
  hubspot_company_id text,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  postal_code text,
  country text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  dge_customer_profile_id uuid references public.customer_profiles_extended(id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  title text,
  primary_company_id uuid references public.crm_companies(id) on delete set null,
  assigned_rep_id uuid references public.profiles(id) on delete set null,
  hubspot_contact_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.crm_contact_companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  company_id uuid not null references public.crm_companies(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, contact_id, company_id)
);

create table public.crm_deal_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  name text not null,
  sort_order integer not null default 0,
  probability numeric(5,2) check (probability is null or (probability >= 0 and probability <= 100)),
  is_closed_won boolean not null default false,
  is_closed_lost boolean not null default false,
  hubspot_stage_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  name text not null,
  stage_id uuid not null references public.crm_deal_stages(id) on delete restrict,
  primary_contact_id uuid references public.crm_contacts(id) on delete set null,
  company_id uuid references public.crm_companies(id) on delete set null,
  assigned_rep_id uuid references public.profiles(id) on delete set null,
  amount numeric(14,2),
  expected_close_on date,
  hubspot_deal_id text,
  margin_amount numeric(14,2),
  margin_pct numeric(6,3),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  activity_type public.crm_activity_type not null default 'note',
  body text,
  occurred_at timestamptz not null default now(),
  contact_id uuid references public.crm_contacts(id) on delete set null,
  deal_id uuid references public.crm_deals(id) on delete set null,
  company_id uuid references public.crm_companies(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (((contact_id is not null)::int + (deal_id is not null)::int + (company_id is not null)::int) = 1)
);

create table public.crm_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, name)
);

create table public.crm_contact_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  tag_id uuid not null references public.crm_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (workspace_id, contact_id, tag_id)
);

create table public.crm_territories (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  name text not null,
  description text,
  assigned_rep_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, name)
);

create table public.crm_contact_territories (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  territory_id uuid not null references public.crm_territories(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (workspace_id, contact_id, territory_id)
);

-- ── CRM auth audit table (append-only) ──────────────────────────────────────
create table public.crm_auth_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  occurred_at timestamptz not null default now(),
  event_type public.crm_auth_event_type not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  subject_user_id uuid references auth.users(id) on delete set null,
  request_id text,
  ip_inet inet,
  user_agent text,
  resource text,
  outcome public.crm_auth_event_outcome not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ── Import/idempotency metadata ──────────────────────────────────────────────
create table public.crm_hubspot_import_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  initiated_by uuid references public.profiles(id) on delete set null,
  status public.crm_import_run_status not null default 'queued',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  contacts_processed integer not null default 0,
  companies_processed integer not null default 0,
  deals_processed integer not null default 0,
  activities_processed integer not null default 0,
  error_count integer not null default 0,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_hubspot_import_errors (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  run_id uuid not null references public.crm_hubspot_import_runs(id) on delete cascade,
  entity_type text not null,
  external_id text,
  payload_snippet jsonb,
  reason_code text not null,
  message text,
  created_at timestamptz not null default now()
);

create table public.crm_external_id_map (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  source_system text not null,
  object_type text not null,
  external_id text not null,
  internal_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, source_system, object_type, external_id)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create unique index uq_crm_companies_workspace_hubspot on public.crm_companies(workspace_id, hubspot_company_id) where hubspot_company_id is not null;
create index idx_crm_companies_parent on public.crm_companies(parent_company_id);
create index idx_crm_companies_assigned_rep on public.crm_companies(assigned_rep_id);
create index idx_crm_companies_list on public.crm_companies(workspace_id, lower(name)) where deleted_at is null;

create unique index uq_crm_contacts_workspace_hubspot on public.crm_contacts(workspace_id, hubspot_contact_id) where hubspot_contact_id is not null;
create index idx_crm_contacts_primary_company on public.crm_contacts(primary_company_id);
create index idx_crm_contacts_assigned_rep on public.crm_contacts(assigned_rep_id);
create index idx_crm_contacts_list on public.crm_contacts(workspace_id, lower(last_name), lower(first_name)) where deleted_at is null;

create index idx_crm_contact_companies_contact on public.crm_contact_companies(contact_id);
create index idx_crm_contact_companies_company on public.crm_contact_companies(company_id);

create unique index uq_crm_deal_stages_workspace_hubspot on public.crm_deal_stages(workspace_id, hubspot_stage_id) where hubspot_stage_id is not null;
create index idx_crm_deal_stages_list on public.crm_deal_stages(workspace_id, sort_order);

create unique index uq_crm_deals_workspace_hubspot on public.crm_deals(workspace_id, hubspot_deal_id) where hubspot_deal_id is not null;
create index idx_crm_deals_stage on public.crm_deals(stage_id);
create index idx_crm_deals_primary_contact on public.crm_deals(primary_contact_id);
create index idx_crm_deals_company on public.crm_deals(company_id);
create index idx_crm_deals_assigned_rep on public.crm_deals(assigned_rep_id);
create index idx_crm_deals_list on public.crm_deals(workspace_id, expected_close_on) where deleted_at is null;

create index idx_crm_activities_contact on public.crm_activities(contact_id);
create index idx_crm_activities_deal on public.crm_activities(deal_id);
create index idx_crm_activities_company on public.crm_activities(company_id);
create index idx_crm_activities_subject_time on public.crm_activities(workspace_id, occurred_at desc) where deleted_at is null;

create index idx_crm_contact_tags_contact on public.crm_contact_tags(contact_id);
create index idx_crm_contact_tags_tag on public.crm_contact_tags(tag_id);
create index idx_crm_territories_assigned_rep on public.crm_territories(assigned_rep_id);
create index idx_crm_contact_territories_contact on public.crm_contact_territories(contact_id);
create index idx_crm_contact_territories_territory on public.crm_contact_territories(territory_id);

create index idx_crm_auth_audit_workspace_time_event on public.crm_auth_audit_events(workspace_id, occurred_at desc, event_type);
create index idx_crm_auth_audit_request on public.crm_auth_audit_events(request_id) where request_id is not null;

create index idx_crm_import_runs_workspace_started on public.crm_hubspot_import_runs(workspace_id, started_at desc);
create index idx_crm_import_errors_run on public.crm_hubspot_import_errors(run_id);
create index idx_crm_external_id_internal on public.crm_external_id_map(internal_id);

-- ── Helpers (security definer to avoid recursive-RLS paths) ─────────────────
create or replace function public.crm_rep_can_access_contact(p_contact_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.crm_contacts c
    where c.id = p_contact_id
      and c.deleted_at is null
      and (
        c.assigned_rep_id = auth.uid()
        or exists (
          select 1
          from public.crm_contact_territories ct
          join public.crm_territories t on t.id = ct.territory_id
          where ct.contact_id = c.id
            and t.deleted_at is null
            and t.assigned_rep_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.crm_rep_can_access_company(p_company_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.crm_companies c
    where c.id = p_company_id
      and c.deleted_at is null
      and (
        c.assigned_rep_id = auth.uid()
        or exists (
          select 1
          from public.crm_contact_companies cc
          where cc.company_id = c.id
            and public.crm_rep_can_access_contact(cc.contact_id)
        )
      )
  );
$$;

create or replace function public.crm_rep_can_access_deal(p_deal_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.crm_deals d
    where d.id = p_deal_id
      and d.deleted_at is null
      and (
        d.assigned_rep_id = auth.uid()
        or (d.primary_contact_id is not null and public.crm_rep_can_access_contact(d.primary_contact_id))
        or (d.company_id is not null and public.crm_rep_can_access_company(d.company_id))
      )
  );
$$;

create or replace function public.crm_rep_can_access_activity(p_activity_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.crm_activities a
    where a.id = p_activity_id
      and a.deleted_at is null
      and (
        (a.contact_id is not null and public.crm_rep_can_access_contact(a.contact_id))
        or (a.company_id is not null and public.crm_rep_can_access_company(a.company_id))
        or (a.deal_id is not null and public.crm_rep_can_access_deal(a.deal_id))
      )
  );
$$;

revoke execute on function public.crm_rep_can_access_contact(uuid) from public;
revoke execute on function public.crm_rep_can_access_company(uuid) from public;
revoke execute on function public.crm_rep_can_access_deal(uuid) from public;
revoke execute on function public.crm_rep_can_access_activity(uuid) from public;
grant execute on function public.crm_rep_can_access_contact(uuid) to authenticated;
grant execute on function public.crm_rep_can_access_company(uuid) to authenticated;
grant execute on function public.crm_rep_can_access_deal(uuid) to authenticated;
grant execute on function public.crm_rep_can_access_activity(uuid) to authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.crm_companies enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.crm_contact_companies enable row level security;
alter table public.crm_deal_stages enable row level security;
alter table public.crm_deals enable row level security;
alter table public.crm_activities enable row level security;
alter table public.crm_tags enable row level security;
alter table public.crm_contact_tags enable row level security;
alter table public.crm_territories enable row level security;
alter table public.crm_contact_territories enable row level security;
alter table public.crm_auth_audit_events enable row level security;
alter table public.crm_hubspot_import_runs enable row level security;
alter table public.crm_hubspot_import_errors enable row level security;
alter table public.crm_external_id_map enable row level security;

create policy "crm_companies_service_all" on public.crm_companies for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "crm_companies_all_elevated" on public.crm_companies for all using (public.get_my_role() in ('admin', 'manager', 'owner')) with check (public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "crm_companies_select_rep_scope" on public.crm_companies for select using (public.get_my_role() = 'rep' and public.crm_rep_can_access_company(id));
create policy "crm_companies_insert_rep_assigned" on public.crm_companies for insert with check (public.get_my_role() = 'rep' and assigned_rep_id = auth.uid());
create policy "crm_companies_update_rep_assigned" on public.crm_companies for update using (public.get_my_role() = 'rep' and public.crm_rep_can_access_company(id)) with check (public.get_my_role() = 'rep' and assigned_rep_id = auth.uid());

create policy "crm_contacts_service_all" on public.crm_contacts for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "crm_contacts_all_elevated" on public.crm_contacts for all using (public.get_my_role() in ('admin', 'manager', 'owner')) with check (public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "crm_contacts_select_rep_scope" on public.crm_contacts for select using (public.get_my_role() = 'rep' and public.crm_rep_can_access_contact(id));
create policy "crm_contacts_insert_rep_assigned" on public.crm_contacts for insert with check (public.get_my_role() = 'rep' and assigned_rep_id = auth.uid());
create policy "crm_contacts_update_rep_assigned" on public.crm_contacts for update using (public.get_my_role() = 'rep' and public.crm_rep_can_access_contact(id)) with check (public.get_my_role() = 'rep' and assigned_rep_id = auth.uid());

create policy "crm_contact_companies_service_all" on public.crm_contact_companies for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "crm_contact_companies_all_elevated" on public.crm_contact_companies for all using (public.get_my_role() in ('admin', 'manager', 'owner')) with check (public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "crm_contact_companies_select_rep_scope" on public.crm_contact_companies for select using (public.get_my_role() = 'rep' and (public.crm_rep_can_access_contact(contact_id) or public.crm_rep_can_access_company(company_id)));
create policy "crm_contact_companies_modify_rep_scope" on public.crm_contact_companies for all using (public.get_my_role() = 'rep' and public.crm_rep_can_access_contact(contact_id)) with check (public.get_my_role() = 'rep' and public.crm_rep_can_access_contact(contact_id));

create policy "crm_deal_stages_service_all" on public.crm_deal_stages for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "crm_deal_stages_select_all_roles" on public.crm_deal_stages for select using (public.get_my_role() in ('rep', 'admin', 'manager', 'owner'));
create policy "crm_deal_stages_modify_elevated" on public.crm_deal_stages for all using (public.get_my_role() in ('admin', 'owner')) with check (public.get_my_role() in ('admin', 'owner'));

create policy "crm_deals_service_all" on public.crm_deals for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "crm_deals_all_elevated" on public.crm_deals for all using (public.get_my_role() in ('admin', 'manager', 'owner')) with check (public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "crm_deals_insert_rep_non_margin" on public.crm_deals for insert with check (public.get_my_role() = 'rep' and assigned_rep_id = auth.uid() and margin_amount is null and margin_pct is null);
create policy "crm_deals_update_rep_non_margin" on public.crm_deals for update using (public.get_my_role() = 'rep' and public.crm_rep_can_access_deal(id)) with check (public.get_my_role() = 'rep' and public.crm_rep_can_access_deal(id));
create policy "crm_deals_select_rep_scope" on public.crm_deals for select using (public.get_my_role() = 'rep' and public.crm_rep_can_access_deal(id));

create policy "crm_activities_service_all" on public.crm_activities for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "crm_activities_all_elevated" on public.crm_activities for all using (public.get_my_role() in ('admin', 'manager', 'owner')) with check (public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "crm_activities_select_rep_scope" on public.crm_activities for select using (public.get_my_role() = 'rep' and public.crm_rep_can_access_activity(id));
create policy "crm_activities_insert_rep_scope" on public.crm_activities for insert with check (public.get_my_role() = 'rep' and created_by = auth.uid() and ((contact_id is not null and public.crm_rep_can_access_contact(contact_id)) or (company_id is not null and public.crm_rep_can_access_company(company_id)) or (deal_id is not null and public.crm_rep_can_access_deal(deal_id))));
create policy "crm_activities_update_rep_scope" on public.crm_activities for update using (public.get_my_role() = 'rep' and public.crm_rep_can_access_activity(id)) with check (public.get_my_role() = 'rep' and created_by = auth.uid());

create policy "crm_tags_service_all" on public.crm_tags for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "crm_tags_select_all_roles" on public.crm_tags for select using (public.get_my_role() in ('rep', 'admin', 'manager', 'owner'));
create policy "crm_tags_modify_elevated" on public.crm_tags for all using (public.get_my_role() in ('admin', 'manager', 'owner')) with check (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "crm_contact_tags_service_all" on public.crm_contact_tags for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "crm_contact_tags_all_elevated" on public.crm_contact_tags for all using (public.get_my_role() in ('admin', 'manager', 'owner')) with check (public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "crm_contact_tags_select_rep_scope" on public.crm_contact_tags for select using (public.get_my_role() = 'rep' and public.crm_rep_can_access_contact(contact_id));
create policy "crm_contact_tags_modify_rep_scope" on public.crm_contact_tags for all using (public.get_my_role() = 'rep' and public.crm_rep_can_access_contact(contact_id)) with check (public.get_my_role() = 'rep' and public.crm_rep_can_access_contact(contact_id));

create policy "crm_territories_service_all" on public.crm_territories for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "crm_territories_all_elevated" on public.crm_territories for all using (public.get_my_role() in ('admin', 'manager', 'owner')) with check (public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "crm_territories_select_rep_assigned" on public.crm_territories for select using (public.get_my_role() = 'rep' and assigned_rep_id = auth.uid());

create policy "crm_contact_territories_service_all" on public.crm_contact_territories for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "crm_contact_territories_all_elevated" on public.crm_contact_territories for all using (public.get_my_role() in ('admin', 'manager', 'owner')) with check (public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "crm_contact_territories_select_rep_scope" on public.crm_contact_territories for select using (public.get_my_role() = 'rep' and public.crm_rep_can_access_contact(contact_id));

create policy "crm_auth_audit_events_service_insert" on public.crm_auth_audit_events for insert with check (auth.role() = 'service_role');
create policy "crm_auth_audit_events_select_elevated" on public.crm_auth_audit_events for select using (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "crm_import_runs_service_all" on public.crm_hubspot_import_runs for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "crm_import_runs_admin_owner_all" on public.crm_hubspot_import_runs for all using (public.get_my_role() in ('admin', 'owner')) with check (public.get_my_role() in ('admin', 'owner'));

create policy "crm_import_errors_service_all" on public.crm_hubspot_import_errors for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "crm_import_errors_admin_owner_select" on public.crm_hubspot_import_errors for select using (public.get_my_role() in ('admin', 'owner'));

create policy "crm_external_id_map_service_all" on public.crm_external_id_map for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "crm_external_id_map_admin_owner_select" on public.crm_external_id_map for select using (public.get_my_role() in ('admin', 'owner'));

-- ── Margin controls + deal read surfaces ────────────────────────────────────
revoke select (margin_amount, margin_pct) on table public.crm_deals from authenticated;
grant select (margin_amount, margin_pct) on table public.crm_deals to service_role;

create view public.crm_deals_rep_safe with (security_barrier = true) as
select
  d.id,
  d.workspace_id,
  d.name,
  d.stage_id,
  d.primary_contact_id,
  d.company_id,
  d.assigned_rep_id,
  d.amount,
  d.expected_close_on,
  d.hubspot_deal_id,
  d.created_at,
  d.updated_at,
  d.deleted_at
from public.crm_deals d
where d.deleted_at is null
  and (
    public.get_my_role() in ('admin', 'manager', 'owner')
    or (public.get_my_role() = 'rep' and public.crm_rep_can_access_deal(d.id))
  );

comment on view public.crm_deals_rep_safe is
  'Rep-safe deal projection. Excludes all margin_* columns and is the required rep read surface.';

create view public.crm_deals_elevated_full as
select d.*
from public.crm_deals d
where d.deleted_at is null
  and public.get_my_role() in ('admin', 'manager', 'owner');

grant select on public.crm_deals_rep_safe to authenticated;
grant select on public.crm_deals_elevated_full to authenticated;

-- ── Rep margin mutation guard ────────────────────────────────────────────────
create or replace function public.crm_guard_rep_margin_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.get_my_role() = 'rep' then
    if tg_op = 'INSERT' and (new.margin_amount is not null or new.margin_pct is not null) then
      raise exception 'rep role cannot write margin fields';
    end if;
    if tg_op = 'UPDATE' and (
      new.margin_amount is distinct from old.margin_amount
      or new.margin_pct is distinct from old.margin_pct
    ) then
      raise exception 'rep role cannot modify margin fields';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_guard_rep_margin_write on public.crm_deals;
create trigger crm_guard_rep_margin_write
  before insert or update on public.crm_deals
  for each row execute function public.crm_guard_rep_margin_write();

-- ── Auth audit writer ────────────────────────────────────────────────────────
create or replace function public.log_crm_auth_event(
  p_workspace_id text,
  p_event_type public.crm_auth_event_type,
  p_outcome public.crm_auth_event_outcome,
  p_actor_user_id uuid default auth.uid(),
  p_subject_user_id uuid default null,
  p_request_id text default null,
  p_ip_inet inet default null,
  p_user_agent text default null,
  p_resource text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_metadata jsonb;
begin
  v_metadata := coalesce(p_metadata, '{}'::jsonb)
    - 'password'
    - 'token'
    - 'access_token'
    - 'refresh_token'
    - 'secret';

  insert into public.crm_auth_audit_events (
    workspace_id,
    occurred_at,
    event_type,
    actor_user_id,
    subject_user_id,
    request_id,
    ip_inet,
    user_agent,
    resource,
    outcome,
    metadata
  )
  values (
    coalesce(p_workspace_id, 'default'),
    now(),
    p_event_type,
    p_actor_user_id,
    p_subject_user_id,
    p_request_id,
    p_ip_inet,
    p_user_agent,
    p_resource,
    p_outcome,
    v_metadata
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.log_crm_auth_event(text, public.crm_auth_event_type, public.crm_auth_event_outcome, uuid, uuid, text, inet, text, text, jsonb) from public;
revoke execute on function public.log_crm_auth_event(text, public.crm_auth_event_type, public.crm_auth_event_outcome, uuid, uuid, text, inet, text, text, jsonb) from authenticated;
grant execute on function public.log_crm_auth_event(text, public.crm_auth_event_type, public.crm_auth_event_outcome, uuid, uuid, text, inet, text, text, jsonb) to service_role;

-- ── Updated-at triggers ──────────────────────────────────────────────────────
create trigger set_crm_companies_updated_at before update on public.crm_companies for each row execute function public.set_updated_at();
create trigger set_crm_contacts_updated_at before update on public.crm_contacts for each row execute function public.set_updated_at();
create trigger set_crm_deal_stages_updated_at before update on public.crm_deal_stages for each row execute function public.set_updated_at();
create trigger set_crm_deals_updated_at before update on public.crm_deals for each row execute function public.set_updated_at();
create trigger set_crm_activities_updated_at before update on public.crm_activities for each row execute function public.set_updated_at();
create trigger set_crm_tags_updated_at before update on public.crm_tags for each row execute function public.set_updated_at();
create trigger set_crm_territories_updated_at before update on public.crm_territories for each row execute function public.set_updated_at();
create trigger set_crm_import_runs_updated_at before update on public.crm_hubspot_import_runs for each row execute function public.set_updated_at();
create trigger set_crm_external_id_map_updated_at before update on public.crm_external_id_map for each row execute function public.set_updated_at();

-- ── Rollback DDL (manual, in reverse dependency order) ──────────────────────
-- drop trigger if exists set_crm_external_id_map_updated_at on public.crm_external_id_map;
-- drop trigger if exists set_crm_import_runs_updated_at on public.crm_hubspot_import_runs;
-- drop trigger if exists set_crm_territories_updated_at on public.crm_territories;
-- drop trigger if exists set_crm_tags_updated_at on public.crm_tags;
-- drop trigger if exists set_crm_activities_updated_at on public.crm_activities;
-- drop trigger if exists set_crm_deals_updated_at on public.crm_deals;
-- drop trigger if exists set_crm_deal_stages_updated_at on public.crm_deal_stages;
-- drop trigger if exists set_crm_contacts_updated_at on public.crm_contacts;
-- drop trigger if exists set_crm_companies_updated_at on public.crm_companies;
-- drop trigger if exists crm_guard_rep_margin_write on public.crm_deals;
--
-- drop view if exists public.crm_deals_elevated_full;
-- drop view if exists public.crm_deals_rep_safe;
--
-- drop function if exists public.log_crm_auth_event(text, public.crm_auth_event_type, public.crm_auth_event_outcome, uuid, uuid, text, inet, text, text, jsonb);
-- drop function if exists public.crm_guard_rep_margin_write();
-- drop function if exists public.crm_rep_can_access_activity(uuid);
-- drop function if exists public.crm_rep_can_access_deal(uuid);
-- drop function if exists public.crm_rep_can_access_company(uuid);
-- drop function if exists public.crm_rep_can_access_contact(uuid);
--
-- drop table if exists public.crm_external_id_map cascade;
-- drop table if exists public.crm_hubspot_import_errors cascade;
-- drop table if exists public.crm_hubspot_import_runs cascade;
-- drop table if exists public.crm_auth_audit_events cascade;
-- drop table if exists public.crm_contact_territories cascade;
-- drop table if exists public.crm_territories cascade;
-- drop table if exists public.crm_contact_tags cascade;
-- drop table if exists public.crm_tags cascade;
-- drop table if exists public.crm_activities cascade;
-- drop table if exists public.crm_deals cascade;
-- drop table if exists public.crm_deal_stages cascade;
-- drop table if exists public.crm_contact_companies cascade;
-- drop table if exists public.crm_contacts cascade;
-- drop table if exists public.crm_companies cascade;
--
-- drop type if exists public.crm_import_run_status;
-- drop type if exists public.crm_auth_event_outcome;
-- drop type if exists public.crm_auth_event_type;
-- drop type if exists public.crm_activity_type;
