-- Sprint 1 hardening (SEC-QEP-005)
-- Enforce workspace-scoped integration registry with composite uniqueness and
-- workspace-bound RLS for integration_status and credential audit reads.

-- ── Workspace helper ────────────────────────────────────────────────────────
-- Returns the caller workspace from JWT claims when present, otherwise the
-- single-tenant bridge default workspace.
create or replace function public.get_my_workspace()
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  claims jsonb;
  claim_workspace text;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception
    when others then
      claims := null;
  end;

  claim_workspace := coalesce(
    claims ->> 'workspace_id',
    claims -> 'app_metadata' ->> 'workspace_id',
    claims -> 'user_metadata' ->> 'workspace_id'
  );

  return coalesce(nullif(claim_workspace, ''), 'default');
end;
$$;

revoke execute on function public.get_my_workspace() from public;
grant execute on function public.get_my_workspace() to authenticated;

-- ── integration_status workspace model ─────────────────────────────────────
alter table public.integration_status
  add column if not exists workspace_id text;

update public.integration_status
set workspace_id = 'default'
where workspace_id is null;

alter table public.integration_status
  alter column workspace_id set default 'default';

alter table public.integration_status
  alter column workspace_id set not null;

-- Drop legacy audit FKs before replacing integration_status uniqueness.
alter table public.integration_status_credential_audit_events
  drop constraint if exists integration_status_credential_audit_events_integration_key_fkey;

alter table public.integration_status_credential_audit_events
  drop constraint if exists integration_status_credential_audit_events_workspace_key_fkey;

-- Replace global uniqueness with workspace-scoped uniqueness.
drop index if exists idx_integration_status_key;
alter table public.integration_status
  drop constraint if exists integration_status_integration_key_key;

create unique index if not exists uq_integration_status_workspace_key
  on public.integration_status (workspace_id, integration_key);

create index if not exists idx_integration_status_workspace_status
  on public.integration_status (workspace_id, status);

-- ── Audit table workspace consistency ───────────────────────────────────────
alter table public.integration_status_credential_audit_events
  add column if not exists workspace_id text;

update public.integration_status_credential_audit_events
set workspace_id = 'default'
where workspace_id is null;

alter table public.integration_status_credential_audit_events
  alter column workspace_id set default 'default';

alter table public.integration_status_credential_audit_events
  alter column workspace_id set not null;

alter table public.integration_status_credential_audit_events
  add constraint integration_status_credential_audit_events_workspace_key_fkey
  foreign key (workspace_id, integration_key)
  references public.integration_status (workspace_id, integration_key)
  on delete cascade;

create index if not exists idx_integration_status_credential_audit_workspace_key_occurred
  on public.integration_status_credential_audit_events (workspace_id, integration_key, occurred_at desc);

-- ── RLS policy alignment (workspace-bound) ──────────────────────────────────
drop policy if exists "integration_status_select_admin_owner" on public.integration_status;
drop policy if exists "integration_status_update_admin_owner" on public.integration_status;
drop policy if exists "integration_status_insert_owner" on public.integration_status;
drop policy if exists "integration_status_delete_owner" on public.integration_status;
drop policy if exists "integration_status_service_all" on public.integration_status;

drop policy if exists "integration_status_select_admin_owner_workspace" on public.integration_status;
drop policy if exists "integration_status_update_admin_owner_workspace" on public.integration_status;
drop policy if exists "integration_status_insert_owner_workspace" on public.integration_status;
drop policy if exists "integration_status_delete_owner_workspace" on public.integration_status;
drop policy if exists "integration_status_service_all_workspace" on public.integration_status;

create policy "integration_status_select_admin_owner_workspace"
  on public.integration_status
  for select
  using (
    public.get_my_role() in ('admin', 'owner')
    and workspace_id = public.get_my_workspace()
  );

create policy "integration_status_update_admin_owner_workspace"
  on public.integration_status
  for update
  using (
    public.get_my_role() in ('admin', 'owner')
    and workspace_id = public.get_my_workspace()
  )
  with check (
    public.get_my_role() in ('admin', 'owner')
    and workspace_id = public.get_my_workspace()
  );

create policy "integration_status_insert_owner_workspace"
  on public.integration_status
  for insert
  with check (
    public.get_my_role() = 'owner'
    and workspace_id = public.get_my_workspace()
  );

create policy "integration_status_delete_owner_workspace"
  on public.integration_status
  for delete
  using (
    public.get_my_role() = 'owner'
    and workspace_id = public.get_my_workspace()
  );

create policy "integration_status_service_all_workspace"
  on public.integration_status
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "integration_status_credential_audit_select_admin_owner"
  on public.integration_status_credential_audit_events;
drop policy if exists "integration_status_credential_audit_service_all"
  on public.integration_status_credential_audit_events;

drop policy if exists "integration_status_credential_audit_select_admin_owner_workspace"
  on public.integration_status_credential_audit_events;
drop policy if exists "integration_status_credential_audit_service_all_workspace"
  on public.integration_status_credential_audit_events;

create policy "integration_status_credential_audit_select_admin_owner_workspace"
  on public.integration_status_credential_audit_events
  for select
  using (
    public.get_my_role() in ('admin', 'owner')
    and workspace_id = public.get_my_workspace()
  );

create policy "integration_status_credential_audit_service_all_workspace"
  on public.integration_status_credential_audit_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── Trigger function update (write workspace_id into audit rows) ───────────
create or replace function public.log_integration_status_credential_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_type text;
  actor_user_id uuid;
  actor_role text;
  changed_fields text[] := array['credentials_encrypted'];
  metadata jsonb;
begin
  if old.credentials_encrypted is not distinct from new.credentials_encrypted then
    return new;
  end if;

  if old.credentials_encrypted is null and new.credentials_encrypted is not null then
    event_type := 'credentials_set';
  elsif old.credentials_encrypted is not null and new.credentials_encrypted is null then
    event_type := 'credentials_cleared';
  else
    event_type := 'credentials_rotated';
  end if;

  actor_user_id := auth.uid();

  actor_role := case
    when auth.role() = 'service_role' then 'service_role'
    else public.get_my_role()::text
  end;

  metadata := jsonb_build_object(
    'changed_fields', changed_fields,
    'triggered_by', case
      when auth.role() = 'service_role' then 'service'
      when actor_user_id is null then 'system'
      else 'user'
    end,
    'source_table', 'integration_status'
  );

  insert into public.integration_status_credential_audit_events (
    workspace_id,
    integration_key,
    event_type,
    actor_user_id,
    actor_role,
    metadata
  )
  values (
    new.workspace_id,
    new.integration_key,
    event_type,
    actor_user_id,
    actor_role,
    metadata
  );

  return new;
end;
$$;

comment on function public.log_integration_status_credential_change() is
  'Append-only credential lifecycle audit logger for integration_status updates.';

-- ── Rollback notes (manual) ────────────────────────────────────────────────
-- 1) Drop workspace-bound policies and recreate prior role-only policies.
-- 2) Drop constraint integration_status_credential_audit_events_workspace_key_fkey
--    and restore FK on integration_key only.
-- 3) Remove uq_integration_status_workspace_key and restore
--    integration_status_integration_key_key (global unique) only if no
--    multi-workspace rows exist.
-- 4) Drop workspace_id columns from integration_status + audit table only when
--    data migration back to single-row key model is complete.
-- 5) Optionally drop public.get_my_workspace() if no policy references remain.
