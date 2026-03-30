-- Sprint 2 (1A): Contact & Company Management
-- Adds equipment registry, custom fields, duplicate candidates, merge audit,
-- company hierarchy safeguards, and workspace-scoped search indexes.

create extension if not exists pg_trgm;

-- ── Enums ────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'crm_custom_field_object_type'
      and n.nspname = 'public'
  ) then
    create type public.crm_custom_field_object_type as enum (
      'contact',
      'company',
      'equipment'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'crm_duplicate_candidate_status'
      and n.nspname = 'public'
  ) then
    create type public.crm_duplicate_candidate_status as enum (
      'open',
      'dismissed',
      'merged'
    );
  end if;
end
$$;

-- ── Existing table delta ─────────────────────────────────────────────────────
alter table public.crm_contacts
  add column if not exists merged_into_contact_id uuid references public.crm_contacts(id) on delete set null;

create index if not exists idx_crm_contacts_merged_into
  on public.crm_contacts(workspace_id, merged_into_contact_id)
  where merged_into_contact_id is not null;

-- Enforce one primary company association per contact/workspace.
create unique index if not exists uq_crm_contact_companies_primary
  on public.crm_contact_companies(workspace_id, contact_id)
  where is_primary;

-- ── New Sprint 2 tables ──────────────────────────────────────────────────────
create table if not exists public.crm_equipment (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  company_id uuid not null references public.crm_companies(id) on delete restrict,
  primary_contact_id uuid references public.crm_contacts(id) on delete set null,
  name text not null,
  asset_tag text,
  serial_number text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.crm_custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  object_type public.crm_custom_field_object_type not null,
  key text not null,
  label text not null,
  data_type text not null,
  constraints jsonb not null default '{}'::jsonb,
  required boolean not null default false,
  visibility_roles jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (jsonb_typeof(visibility_roles) = 'array')
);

create table if not exists public.crm_custom_field_values (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  definition_id uuid not null references public.crm_custom_field_definitions(id) on delete restrict,
  record_type public.crm_custom_field_object_type not null,
  record_id uuid not null,
  value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  rule_id text not null,
  left_contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  right_contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  score numeric(6,4) not null default 0,
  status public.crm_duplicate_candidate_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (left_contact_id <> right_contact_id),
  check (left_contact_id < right_contact_id)
);

create table if not exists public.crm_merge_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  survivor_contact_id uuid not null references public.crm_contacts(id) on delete restrict,
  loser_contact_id uuid not null references public.crm_contacts(id) on delete restrict,
  snapshot jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create unique index if not exists uq_crm_equipment_workspace_asset_tag
  on public.crm_equipment(workspace_id, lower(asset_tag))
  where asset_tag is not null and deleted_at is null;

create index if not exists idx_crm_equipment_company
  on public.crm_equipment(company_id);

create index if not exists idx_crm_equipment_primary_contact
  on public.crm_equipment(primary_contact_id)
  where primary_contact_id is not null;

create index if not exists idx_crm_equipment_workspace_deleted
  on public.crm_equipment(workspace_id, deleted_at);

create unique index if not exists uq_crm_custom_field_definitions_workspace_key
  on public.crm_custom_field_definitions(workspace_id, object_type, key)
  where deleted_at is null;

create index if not exists idx_crm_custom_field_definitions_workspace_object_sort
  on public.crm_custom_field_definitions(workspace_id, object_type, sort_order)
  where deleted_at is null;

create unique index if not exists uq_crm_custom_field_values_definition_record
  on public.crm_custom_field_values(definition_id, record_type, record_id);

create index if not exists idx_crm_custom_field_values_record
  on public.crm_custom_field_values(workspace_id, record_type, record_id);

create unique index if not exists uq_crm_duplicate_candidates_workspace_pair_rule
  on public.crm_duplicate_candidates(workspace_id, rule_id, left_contact_id, right_contact_id);

create index if not exists idx_crm_duplicate_candidates_workspace_status
  on public.crm_duplicate_candidates(workspace_id, status, updated_at desc);

create index if not exists idx_crm_duplicate_candidates_left
  on public.crm_duplicate_candidates(left_contact_id);

create index if not exists idx_crm_duplicate_candidates_right
  on public.crm_duplicate_candidates(right_contact_id);

create index if not exists idx_crm_merge_audit_workspace_occurred
  on public.crm_merge_audit_events(workspace_id, occurred_at desc);

create index if not exists idx_crm_merge_audit_survivor
  on public.crm_merge_audit_events(survivor_contact_id);

create index if not exists idx_crm_merge_audit_loser
  on public.crm_merge_audit_events(loser_contact_id);

-- Search acceleration indexes (AC16/AC17)
create index if not exists idx_crm_companies_name_trgm
  on public.crm_companies using gin (lower(name) gin_trgm_ops)
  where deleted_at is null;

create index if not exists idx_crm_contacts_full_name_trgm
  on public.crm_contacts using gin (lower((first_name || ' ' || last_name)) gin_trgm_ops)
  where deleted_at is null;

create index if not exists idx_crm_contacts_email_trgm
  on public.crm_contacts using gin (lower(email) gin_trgm_ops)
  where email is not null and deleted_at is null;

-- ── Helpers ──────────────────────────────────────────────────────────────────
create or replace function public.crm_company_parent_would_create_cycle(
  p_company_id uuid,
  p_parent_company_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  with recursive ancestors as (
    select c.id, c.parent_company_id
    from public.crm_companies c
    where c.id = p_parent_company_id

    union all

    select p.id, p.parent_company_id
    from public.crm_companies p
    join ancestors a on a.parent_company_id = p.id
    where p.id is not null
  )
  select exists (
    select 1
    from ancestors
    where id = p_company_id
  );
$$;

create or replace function public.crm_guard_company_hierarchy_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_company_id is null then
    return new;
  end if;

  if new.parent_company_id = new.id then
    raise exception 'company hierarchy cycle detected';
  end if;

  if public.crm_company_parent_would_create_cycle(new.id, new.parent_company_id) then
    raise exception 'company hierarchy cycle detected';
  end if;

  return new;
end;
$$;

create or replace function public.crm_rep_can_access_equipment(p_equipment_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.crm_equipment e
    where e.id = p_equipment_id
      and e.deleted_at is null
      and public.crm_rep_can_access_company(e.company_id)
  );
$$;

create or replace function public.crm_rep_can_access_custom_record(
  p_record_type public.crm_custom_field_object_type,
  p_record_id uuid
)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if p_record_type = 'contact' then
    return public.crm_rep_can_access_contact(p_record_id);
  elsif p_record_type = 'company' then
    return public.crm_rep_can_access_company(p_record_id);
  elsif p_record_type = 'equipment' then
    return public.crm_rep_can_access_equipment(p_record_id);
  end if;

  return false;
end;
$$;

create or replace function public.crm_company_subtree_rollups(
  p_workspace_id text,
  p_company_id uuid
)
returns table(contact_count bigint, equipment_count bigint)
language sql
security definer
stable
set search_path = ''
as $$
  with recursive subtree as (
    select c.id
    from public.crm_companies c
    where c.workspace_id = p_workspace_id
      and c.deleted_at is null
      and c.id = p_company_id

    union all

    select child.id
    from public.crm_companies child
    join subtree s on child.parent_company_id = s.id
    where child.workspace_id = p_workspace_id
      and child.deleted_at is null
  ),
  contact_ids as (
    select c.id as contact_id
    from public.crm_contacts c
    where c.workspace_id = p_workspace_id
      and c.deleted_at is null
      and c.primary_company_id in (select id from subtree)

    union

    select cc.contact_id
    from public.crm_contact_companies cc
    join public.crm_contacts c on c.id = cc.contact_id
    where cc.workspace_id = p_workspace_id
      and c.deleted_at is null
      and cc.company_id in (select id from subtree)
  )
  select
    (select count(*) from contact_ids) as contact_count,
    (
      select count(*)
      from public.crm_equipment e
      where e.workspace_id = p_workspace_id
        and e.deleted_at is null
        and e.company_id in (select id from subtree)
    ) as equipment_count;
$$;

create or replace function public.crm_refresh_duplicate_candidates(
  p_workspace_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  with normalized_contacts as (
    select
      c.id,
      c.workspace_id,
      lower(trim(c.email)) as normalized_email
    from public.crm_contacts c
    where c.workspace_id = p_workspace_id
      and c.deleted_at is null
      and c.email is not null
      and trim(c.email) <> ''
  ),
  candidate_pairs as (
    select
      least(a.id, b.id) as left_contact_id,
      greatest(a.id, b.id) as right_contact_id
    from normalized_contacts a
    join normalized_contacts b
      on a.workspace_id = b.workspace_id
     and a.normalized_email = b.normalized_email
     and a.id < b.id
  ),
  inserted as (
    insert into public.crm_duplicate_candidates (
      workspace_id,
      rule_id,
      left_contact_id,
      right_contact_id,
      score,
      status
    )
    select
      p_workspace_id,
      'email_exact',
      cp.left_contact_id,
      cp.right_contact_id,
      1.0,
      'open'::public.crm_duplicate_candidate_status
    from candidate_pairs cp
    on conflict (workspace_id, rule_id, left_contact_id, right_contact_id)
      do nothing
    returning id
  )
  select count(*) into v_inserted
  from inserted;

  return coalesce(v_inserted, 0);
end;
$$;

create or replace function public.crm_merge_contacts(
  p_workspace_id text,
  p_actor_user_id uuid,
  p_survivor_contact_id uuid,
  p_loser_contact_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_survivor public.crm_contacts%rowtype;
  v_loser public.crm_contacts%rowtype;
  v_now timestamptz := now();
  v_audit_id uuid;
  v_existing_audit_id uuid;
  v_survivor_has_primary boolean := false;
begin
  if p_survivor_contact_id is null or p_loser_contact_id is null then
    raise exception 'survivor and loser contact ids are required';
  end if;

  if p_survivor_contact_id = p_loser_contact_id then
    raise exception 'survivor and loser contact ids must differ';
  end if;

  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select e.id
      into v_existing_audit_id
    from public.crm_merge_audit_events e
    where e.workspace_id = p_workspace_id
      and e.metadata ->> 'idempotency_key' = trim(p_idempotency_key)
    order by e.occurred_at desc
    limit 1;

    if v_existing_audit_id is not null then
      return jsonb_build_object(
        'status', 'already_merged',
        'audit_event_id', v_existing_audit_id,
        'survivor_id', p_survivor_contact_id,
        'loser_id', p_loser_contact_id
      );
    end if;
  end if;

  select * into v_survivor
  from public.crm_contacts
  where id = p_survivor_contact_id
  for update;

  if not found then
    raise exception 'survivor contact not found';
  end if;

  select * into v_loser
  from public.crm_contacts
  where id = p_loser_contact_id
  for update;

  if not found then
    raise exception 'loser contact not found';
  end if;

  if v_survivor.workspace_id <> p_workspace_id or v_loser.workspace_id <> p_workspace_id then
    raise exception 'contacts must belong to the requested workspace';
  end if;

  if v_survivor.deleted_at is not null then
    raise exception 'survivor contact is deleted';
  end if;

  if v_loser.deleted_at is not null and v_loser.merged_into_contact_id = p_survivor_contact_id then
    return jsonb_build_object(
      'status', 'already_merged',
      'survivor_id', p_survivor_contact_id,
      'loser_id', p_loser_contact_id
    );
  end if;

  if v_survivor.hubspot_contact_id is not null
     and v_loser.hubspot_contact_id is not null
     and v_survivor.hubspot_contact_id <> v_loser.hubspot_contact_id then
    raise exception 'hubspot_id_conflict';
  end if;

  select exists (
    select 1
    from public.crm_contact_companies cc
    where cc.workspace_id = p_workspace_id
      and cc.contact_id = p_survivor_contact_id
      and cc.is_primary
  )
  into v_survivor_has_primary;

  -- Repoint direct FKs.
  update public.crm_deals
  set primary_contact_id = p_survivor_contact_id,
      updated_at = v_now
  where workspace_id = p_workspace_id
    and primary_contact_id = p_loser_contact_id;

  update public.crm_activities
  set contact_id = p_survivor_contact_id,
      updated_at = v_now
  where workspace_id = p_workspace_id
    and contact_id = p_loser_contact_id;

  update public.crm_equipment
  set primary_contact_id = p_survivor_contact_id,
      updated_at = v_now
  where workspace_id = p_workspace_id
    and primary_contact_id = p_loser_contact_id;

  -- Merge mapping tables while preserving uniqueness.
  insert into public.crm_contact_companies (workspace_id, contact_id, company_id, is_primary)
  select
    cc.workspace_id,
    p_survivor_contact_id,
    cc.company_id,
    case
      when v_survivor_has_primary then false
      else cc.is_primary
    end
  from public.crm_contact_companies cc
  where cc.workspace_id = p_workspace_id
    and cc.contact_id = p_loser_contact_id
  on conflict (workspace_id, contact_id, company_id)
  do update set is_primary = public.crm_contact_companies.is_primary or excluded.is_primary;

  delete from public.crm_contact_companies
  where workspace_id = p_workspace_id
    and contact_id = p_loser_contact_id;

  insert into public.crm_contact_tags (workspace_id, contact_id, tag_id)
  select ct.workspace_id, p_survivor_contact_id, ct.tag_id
  from public.crm_contact_tags ct
  where ct.workspace_id = p_workspace_id
    and ct.contact_id = p_loser_contact_id
  on conflict (workspace_id, contact_id, tag_id)
  do nothing;

  delete from public.crm_contact_tags
  where workspace_id = p_workspace_id
    and contact_id = p_loser_contact_id;

  insert into public.crm_contact_territories (workspace_id, contact_id, territory_id)
  select ct.workspace_id, p_survivor_contact_id, ct.territory_id
  from public.crm_contact_territories ct
  where ct.workspace_id = p_workspace_id
    and ct.contact_id = p_loser_contact_id
  on conflict (workspace_id, contact_id, territory_id)
  do nothing;

  delete from public.crm_contact_territories
  where workspace_id = p_workspace_id
    and contact_id = p_loser_contact_id;

  insert into public.crm_custom_field_values (workspace_id, definition_id, record_type, record_id, value)
  select cfv.workspace_id, cfv.definition_id, cfv.record_type, p_survivor_contact_id, cfv.value
  from public.crm_custom_field_values cfv
  where cfv.workspace_id = p_workspace_id
    and cfv.record_type = 'contact'
    and cfv.record_id = p_loser_contact_id
  on conflict (definition_id, record_type, record_id)
  do update set value = excluded.value, updated_at = now();

  delete from public.crm_custom_field_values
  where workspace_id = p_workspace_id
    and record_type = 'contact'
    and record_id = p_loser_contact_id;

  -- Keep external-id mappings coherent.
  delete from public.crm_external_id_map loser_map
  using public.crm_external_id_map survivor_map
  where loser_map.workspace_id = p_workspace_id
    and survivor_map.workspace_id = p_workspace_id
    and loser_map.internal_id = p_loser_contact_id
    and survivor_map.internal_id = p_survivor_contact_id
    and loser_map.source_system = survivor_map.source_system
    and loser_map.object_type = survivor_map.object_type
    and loser_map.external_id = survivor_map.external_id;

  update public.crm_external_id_map
  set internal_id = p_survivor_contact_id,
      updated_at = v_now
  where workspace_id = p_workspace_id
    and internal_id = p_loser_contact_id;

  -- Mark candidate rows.
  update public.crm_duplicate_candidates
  set status = 'merged',
      updated_at = v_now
  where workspace_id = p_workspace_id
    and (
      (left_contact_id = least(p_survivor_contact_id, p_loser_contact_id)
       and right_contact_id = greatest(p_survivor_contact_id, p_loser_contact_id))
      or left_contact_id = p_loser_contact_id
      or right_contact_id = p_loser_contact_id
    );

  update public.crm_contacts
  set merged_into_contact_id = p_survivor_contact_id,
      deleted_at = coalesce(deleted_at, v_now),
      updated_at = v_now
  where id = p_loser_contact_id;

  insert into public.crm_merge_audit_events (
    workspace_id,
    occurred_at,
    actor_user_id,
    survivor_contact_id,
    loser_contact_id,
    snapshot,
    metadata
  )
  values (
    p_workspace_id,
    v_now,
    p_actor_user_id,
    p_survivor_contact_id,
    p_loser_contact_id,
    jsonb_build_object(
      'survivor', to_jsonb(v_survivor),
      'loser', to_jsonb(v_loser)
    ),
    jsonb_build_object(
      'idempotency_key', nullif(trim(coalesce(p_idempotency_key, '')), '')
    )
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'status', 'merged',
    'audit_event_id', v_audit_id,
    'survivor_id', p_survivor_contact_id,
    'loser_id', p_loser_contact_id
  );
end;
$$;

revoke execute on function public.crm_company_parent_would_create_cycle(uuid, uuid) from public;
revoke execute on function public.crm_guard_company_hierarchy_cycle() from public;
revoke execute on function public.crm_rep_can_access_equipment(uuid) from public;
revoke execute on function public.crm_rep_can_access_custom_record(public.crm_custom_field_object_type, uuid) from public;
revoke execute on function public.crm_company_subtree_rollups(text, uuid) from public;
revoke execute on function public.crm_refresh_duplicate_candidates(text) from public;
revoke execute on function public.crm_merge_contacts(text, uuid, uuid, uuid, text) from public;

revoke execute on function public.crm_refresh_duplicate_candidates(text) from authenticated;
revoke execute on function public.crm_merge_contacts(text, uuid, uuid, uuid, text) from authenticated;

grant execute on function public.crm_company_parent_would_create_cycle(uuid, uuid) to authenticated;
grant execute on function public.crm_guard_company_hierarchy_cycle() to service_role;
grant execute on function public.crm_rep_can_access_equipment(uuid) to authenticated;
grant execute on function public.crm_rep_can_access_custom_record(public.crm_custom_field_object_type, uuid) to authenticated;
grant execute on function public.crm_company_subtree_rollups(text, uuid) to authenticated;
grant execute on function public.crm_refresh_duplicate_candidates(text) to service_role;
grant execute on function public.crm_merge_contacts(text, uuid, uuid, uuid, text) to service_role;

-- ── Triggers ─────────────────────────────────────────────────────────────────
drop trigger if exists crm_guard_company_hierarchy_cycle on public.crm_companies;
create trigger crm_guard_company_hierarchy_cycle
  before insert or update of parent_company_id on public.crm_companies
  for each row execute function public.crm_guard_company_hierarchy_cycle();

drop trigger if exists set_crm_equipment_updated_at on public.crm_equipment;
create trigger set_crm_equipment_updated_at
  before update on public.crm_equipment
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_custom_field_definitions_updated_at on public.crm_custom_field_definitions;
create trigger set_crm_custom_field_definitions_updated_at
  before update on public.crm_custom_field_definitions
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_custom_field_values_updated_at on public.crm_custom_field_values;
create trigger set_crm_custom_field_values_updated_at
  before update on public.crm_custom_field_values
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_duplicate_candidates_updated_at on public.crm_duplicate_candidates;
create trigger set_crm_duplicate_candidates_updated_at
  before update on public.crm_duplicate_candidates
  for each row execute function public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.crm_equipment enable row level security;
alter table public.crm_custom_field_definitions enable row level security;
alter table public.crm_custom_field_values enable row level security;
alter table public.crm_duplicate_candidates enable row level security;
alter table public.crm_merge_audit_events enable row level security;

create policy "crm_equipment_service_all"
  on public.crm_equipment for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "crm_equipment_all_elevated"
  on public.crm_equipment for all
  using (public.get_my_role() in ('admin', 'manager', 'owner'))
  with check (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "crm_equipment_rep_scope"
  on public.crm_equipment for all
  using (public.get_my_role() = 'rep' and public.crm_rep_can_access_company(company_id))
  with check (public.get_my_role() = 'rep' and public.crm_rep_can_access_company(company_id));

create policy "crm_custom_field_definitions_service_all"
  on public.crm_custom_field_definitions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "crm_custom_field_definitions_read_all_elevated"
  on public.crm_custom_field_definitions for select
  using (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "crm_custom_field_definitions_modify_elevated"
  on public.crm_custom_field_definitions for all
  using (public.get_my_role() in ('admin', 'owner'))
  with check (public.get_my_role() in ('admin', 'owner'));

create policy "crm_custom_field_definitions_rep_visible"
  on public.crm_custom_field_definitions for select
  using (
    public.get_my_role() = 'rep'
    and deleted_at is null
    and (
      jsonb_array_length(visibility_roles) = 0
      or visibility_roles ? 'rep'
    )
  );

create policy "crm_custom_field_values_service_all"
  on public.crm_custom_field_values for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "crm_custom_field_values_all_elevated"
  on public.crm_custom_field_values for all
  using (public.get_my_role() in ('admin', 'manager', 'owner'))
  with check (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "crm_custom_field_values_rep_scope"
  on public.crm_custom_field_values for all
  using (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_custom_record(record_type, record_id)
    and exists (
      select 1
      from public.crm_custom_field_definitions d
      where d.id = definition_id
        and d.workspace_id = public.crm_custom_field_values.workspace_id
        and d.deleted_at is null
        and (
          jsonb_array_length(d.visibility_roles) = 0
          or d.visibility_roles ? 'rep'
        )
    )
  )
  with check (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_custom_record(record_type, record_id)
    and exists (
      select 1
      from public.crm_custom_field_definitions d
      where d.id = definition_id
        and d.workspace_id = public.crm_custom_field_values.workspace_id
        and d.deleted_at is null
        and (
          jsonb_array_length(d.visibility_roles) = 0
          or d.visibility_roles ? 'rep'
        )
    )
  );

create policy "crm_duplicate_candidates_service_all"
  on public.crm_duplicate_candidates for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "crm_duplicate_candidates_all_elevated"
  on public.crm_duplicate_candidates for all
  using (public.get_my_role() in ('admin', 'manager', 'owner'))
  with check (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "crm_duplicate_candidates_rep_visible_pairs"
  on public.crm_duplicate_candidates for select
  using (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_contact(left_contact_id)
    and public.crm_rep_can_access_contact(right_contact_id)
  );

create policy "crm_merge_audit_events_service_insert"
  on public.crm_merge_audit_events for insert
  with check (auth.role() = 'service_role');

create policy "crm_merge_audit_events_elevated_select"
  on public.crm_merge_audit_events for select
  using (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "crm_merge_audit_events_rep_select_visible"
  on public.crm_merge_audit_events for select
  using (
    public.get_my_role() = 'rep'
    and (
      public.crm_rep_can_access_contact(survivor_contact_id)
      or public.crm_rep_can_access_contact(loser_contact_id)
    )
  );

-- ── Rollback DDL (manual, reverse dependency order) ─────────────────────────
-- drop policy if exists "crm_merge_audit_events_rep_select_visible" on public.crm_merge_audit_events;
-- drop policy if exists "crm_merge_audit_events_elevated_select" on public.crm_merge_audit_events;
-- drop policy if exists "crm_merge_audit_events_service_insert" on public.crm_merge_audit_events;
-- drop policy if exists "crm_duplicate_candidates_rep_visible_pairs" on public.crm_duplicate_candidates;
-- drop policy if exists "crm_duplicate_candidates_all_elevated" on public.crm_duplicate_candidates;
-- drop policy if exists "crm_duplicate_candidates_service_all" on public.crm_duplicate_candidates;
-- drop policy if exists "crm_custom_field_values_rep_scope" on public.crm_custom_field_values;
-- drop policy if exists "crm_custom_field_values_all_elevated" on public.crm_custom_field_values;
-- drop policy if exists "crm_custom_field_values_service_all" on public.crm_custom_field_values;
-- drop policy if exists "crm_custom_field_definitions_rep_visible" on public.crm_custom_field_definitions;
-- drop policy if exists "crm_custom_field_definitions_modify_elevated" on public.crm_custom_field_definitions;
-- drop policy if exists "crm_custom_field_definitions_read_all_elevated" on public.crm_custom_field_definitions;
-- drop policy if exists "crm_custom_field_definitions_service_all" on public.crm_custom_field_definitions;
-- drop policy if exists "crm_equipment_rep_scope" on public.crm_equipment;
-- drop policy if exists "crm_equipment_all_elevated" on public.crm_equipment;
-- drop policy if exists "crm_equipment_service_all" on public.crm_equipment;
--
-- drop trigger if exists set_crm_duplicate_candidates_updated_at on public.crm_duplicate_candidates;
-- drop trigger if exists set_crm_custom_field_values_updated_at on public.crm_custom_field_values;
-- drop trigger if exists set_crm_custom_field_definitions_updated_at on public.crm_custom_field_definitions;
-- drop trigger if exists set_crm_equipment_updated_at on public.crm_equipment;
-- drop trigger if exists crm_guard_company_hierarchy_cycle on public.crm_companies;
--
-- drop function if exists public.crm_merge_contacts(text, uuid, uuid, uuid, text);
-- drop function if exists public.crm_refresh_duplicate_candidates(text);
-- drop function if exists public.crm_company_subtree_rollups(text, uuid);
-- drop function if exists public.crm_rep_can_access_custom_record(public.crm_custom_field_object_type, uuid);
-- drop function if exists public.crm_rep_can_access_equipment(uuid);
-- drop function if exists public.crm_guard_company_hierarchy_cycle();
-- drop function if exists public.crm_company_parent_would_create_cycle(uuid, uuid);
--
-- drop index if exists idx_crm_contacts_email_trgm;
-- drop index if exists idx_crm_contacts_full_name_trgm;
-- drop index if exists idx_crm_companies_name_trgm;
-- drop index if exists idx_crm_merge_audit_loser;
-- drop index if exists idx_crm_merge_audit_survivor;
-- drop index if exists idx_crm_merge_audit_workspace_occurred;
-- drop index if exists idx_crm_duplicate_candidates_right;
-- drop index if exists idx_crm_duplicate_candidates_left;
-- drop index if exists idx_crm_duplicate_candidates_workspace_status;
-- drop index if exists uq_crm_duplicate_candidates_workspace_pair_rule;
-- drop index if exists idx_crm_custom_field_values_record;
-- drop index if exists uq_crm_custom_field_values_definition_record;
-- drop index if exists idx_crm_custom_field_definitions_workspace_object_sort;
-- drop index if exists uq_crm_custom_field_definitions_workspace_key;
-- drop index if exists idx_crm_equipment_workspace_deleted;
-- drop index if exists idx_crm_equipment_primary_contact;
-- drop index if exists idx_crm_equipment_company;
-- drop index if exists uq_crm_equipment_workspace_asset_tag;
-- drop index if exists uq_crm_contact_companies_primary;
-- drop index if exists idx_crm_contacts_merged_into;
--
-- alter table public.crm_contacts drop column if exists merged_into_contact_id;
-- drop table if exists public.crm_merge_audit_events;
-- drop table if exists public.crm_duplicate_candidates;
-- drop table if exists public.crm_custom_field_values;
-- drop table if exists public.crm_custom_field_definitions;
-- drop table if exists public.crm_equipment;
--
-- drop type if exists public.crm_duplicate_candidate_status;
-- drop type if exists public.crm_custom_field_object_type;
