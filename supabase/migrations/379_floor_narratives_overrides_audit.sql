-- ============================================================================
-- Migration 379: The Floor — narrative cache, per-user layout overrides,
--                and immutable layout audit.
--
-- Extends the Phase 1 role-default model without disturbing existing rows:
--   1. Adds nullable floor_layouts.user_id for user overrides.
--   2. Replaces the old (workspace_id, iron_role) unique with partial uniques:
--      role default (user_id is null) and per-user override.
--   3. Adds floor_narratives cache for the floor-narrative edge function.
--   4. Adds floor_layout_audit and a trigger that records layout mutations.
-- ============================================================================

-- ── 1. Per-user overrides on floor_layouts ─────────────────────────────────

alter table public.floor_layouts
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

comment on column public.floor_layouts.user_id is
  'Nullable. Null rows are workspace+role defaults; non-null rows override that role layout for one user.';

alter table public.floor_layouts
  drop constraint if exists floor_layouts_workspace_id_iron_role_key;

drop index if exists public.floor_layouts_workspace_id_iron_role_key;

create unique index if not exists floor_layouts_role_default_uidx
  on public.floor_layouts (workspace_id, iron_role)
  where user_id is null;

create unique index if not exists floor_layouts_user_override_uidx
  on public.floor_layouts (workspace_id, user_id, iron_role)
  where user_id is not null;

create index if not exists idx_floor_layouts_user_lookup
  on public.floor_layouts (workspace_id, user_id, iron_role)
  where user_id is not null;

-- Role-default layouts remain globally visible inside a workspace. User
-- overrides are visible to their subject user and elevated operators.
drop policy if exists "floor_layouts_select" on public.floor_layouts;
drop policy if exists "floor_layouts_manage" on public.floor_layouts;
drop policy if exists "floor_layouts_service_all" on public.floor_layouts;

create policy "floor_layouts_select"
  on public.floor_layouts
  for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner')
    and (
      user_id is null
      or user_id = (select auth.uid())
      or (select public.get_my_role()) in ('admin', 'manager', 'owner')
    )
  );

create policy "floor_layouts_manage"
  on public.floor_layouts
  for all
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  );

create policy "floor_layouts_service_all"
  on public.floor_layouts
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

-- ── 2. Narrative cache ─────────────────────────────────────────────────────

create table if not exists public.floor_narratives (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  iron_role text not null
    check (iron_role in (
      'iron_manager',
      'iron_advisor',
      'iron_woman',
      'iron_man',
      'iron_owner',
      'iron_parts_counter',
      'iron_parts_manager'
    )),
  narrative_text text not null,
  source_snapshot_json jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  model text,
  error_snapshot_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, iron_role)
);

comment on table public.floor_narratives is
  'Cached one-sentence Floor narratives by workspace+role. Written by the floor-narrative edge function with deterministic fallback on Claude failure.';
comment on column public.floor_narratives.source_snapshot_json is
  'Small source snapshot used by the edge function prompt and diagnostics.';
comment on column public.floor_narratives.error_snapshot_json is
  'Last generation error, if the row was written from deterministic fallback.';

drop trigger if exists trg_floor_narratives_updated_at on public.floor_narratives;
create trigger trg_floor_narratives_updated_at
  before update on public.floor_narratives
  for each row execute function public.set_updated_at();

create index if not exists idx_floor_narratives_workspace_expiry
  on public.floor_narratives (workspace_id, expires_at desc);

alter table public.floor_narratives enable row level security;

create policy "floor_narratives_select"
  on public.floor_narratives
  for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner')
  );

create policy "floor_narratives_manage"
  on public.floor_narratives
  for all
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  );

create policy "floor_narratives_service_all"
  on public.floor_narratives
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

grant select on public.floor_narratives to authenticated;
grant insert, update, delete on public.floor_narratives to authenticated;

-- ── 3. Immutable layout audit ───────────────────────────────────────────────

create table if not exists public.floor_layout_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  iron_role text not null,
  subject_user_id uuid references auth.users(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('insert', 'update', 'delete', 'reset')),
  old_layout_json jsonb,
  new_layout_json jsonb,
  created_at timestamptz not null default now()
);

comment on table public.floor_layout_audit is
  'Append-only audit trail for Floor composer changes. Populated by trigger on public.floor_layouts.';

create index if not exists idx_floor_layout_audit_workspace_created
  on public.floor_layout_audit (workspace_id, created_at desc);

create index if not exists idx_floor_layout_audit_role_created
  on public.floor_layout_audit (workspace_id, iron_role, created_at desc);

alter table public.floor_layout_audit enable row level security;

create policy "floor_layout_audit_select"
  on public.floor_layout_audit
  for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  );

create policy "floor_layout_audit_insert"
  on public.floor_layout_audit
  for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  );

create policy "floor_layout_audit_service_all"
  on public.floor_layout_audit
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

grant select, insert on public.floor_layout_audit to authenticated;

create or replace function public.record_floor_layout_audit()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_workspace text;
  v_iron_role text;
  v_subject_user_id uuid;
  v_actor_user_id uuid;
begin
  if tg_op = 'DELETE' then
    v_workspace := old.workspace_id;
    v_iron_role := old.iron_role;
    v_subject_user_id := old.user_id;
    v_actor_user_id := old.updated_by;
  else
    v_workspace := new.workspace_id;
    v_iron_role := new.iron_role;
    v_subject_user_id := new.user_id;
    v_actor_user_id := coalesce(new.updated_by, auth.uid());
  end if;

  insert into public.floor_layout_audit (
    workspace_id,
    iron_role,
    subject_user_id,
    actor_user_id,
    action,
    old_layout_json,
    new_layout_json
  )
  values (
    v_workspace,
    v_iron_role,
    v_subject_user_id,
    v_actor_user_id,
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then old.layout_json else null end,
    case when tg_op in ('INSERT', 'UPDATE') then new.layout_json else null end
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_floor_layout_audit on public.floor_layouts;
create trigger trg_floor_layout_audit
  after insert or update or delete on public.floor_layouts
  for each row execute function public.record_floor_layout_audit();
