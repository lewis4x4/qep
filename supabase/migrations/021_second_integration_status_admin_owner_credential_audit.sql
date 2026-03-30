-- CRM MVP Slice E2 (QUA-195)
-- Align integration_status access with blueprint §7.2 (admin + owner + service_role)
-- and add observable credential-change audit events.

-- ── integration_status RLS alignment ────────────────────────────────────────
drop policy if exists "integration_status_select_owner" on public.integration_status;
drop policy if exists "integration_status_all_owner" on public.integration_status;
drop policy if exists "integration_status_service" on public.integration_status;

create policy "integration_status_select_admin_owner"
  on public.integration_status
  for select
  using (public.get_my_role() in ('admin', 'owner'));

create policy "integration_status_update_admin_owner"
  on public.integration_status
  for update
  using (public.get_my_role() in ('admin', 'owner'))
  with check (public.get_my_role() in ('admin', 'owner'));

create policy "integration_status_insert_owner"
  on public.integration_status
  for insert
  with check (public.get_my_role() = 'owner');

create policy "integration_status_delete_owner"
  on public.integration_status
  for delete
  using (public.get_my_role() = 'owner');

create policy "integration_status_service_all"
  on public.integration_status
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── Credential audit table (append-only) ────────────────────────────────────
create table if not exists public.integration_status_credential_audit_events (
  id uuid primary key default gen_random_uuid(),
  integration_key text not null
    references public.integration_status(integration_key)
    on delete cascade,
  event_type text not null check (
    event_type in ('credentials_set', 'credentials_rotated', 'credentials_cleared')
  ),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  changed_fields text[] not null default array[]::text[],
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_integration_status_credential_audit_key_occurred
  on public.integration_status_credential_audit_events(integration_key, occurred_at desc);

create index if not exists idx_integration_status_credential_audit_actor_occurred
  on public.integration_status_credential_audit_events(actor_user_id, occurred_at desc);

comment on table public.integration_status_credential_audit_events is
  'Append-only credential change audit events for integration_status updates.';

alter table public.integration_status_credential_audit_events enable row level security;

create policy "integration_status_credential_audit_select_admin_owner"
  on public.integration_status_credential_audit_events
  for select
  using (public.get_my_role() in ('admin', 'owner'));

create policy "integration_status_credential_audit_service_all"
  on public.integration_status_credential_audit_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── Trigger: log credential changes without storing secrets ─────────────────
create or replace function public.log_integration_status_credential_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_type text;
  changed_fields text[] := array['credentials_encrypted'];
  actor_role text;
  request_id text;
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

  if old.endpoint_url is distinct from new.endpoint_url then
    changed_fields := array_append(changed_fields, 'endpoint_url');
  end if;

  if old.config is distinct from new.config then
    changed_fields := array_append(changed_fields, 'config');
  end if;

  if old.status is distinct from new.status then
    changed_fields := array_append(changed_fields, 'status');
  end if;

  actor_role := case
    when auth.role() = 'service_role' then 'service_role'
    else public.get_my_role()
  end;

  request_id := nullif(current_setting('request.header.x-request-id', true), '');

  insert into public.integration_status_credential_audit_events (
    integration_key,
    event_type,
    actor_user_id,
    actor_role,
    changed_fields,
    request_id,
    metadata
  )
  values (
    new.integration_key,
    event_type,
    auth.uid(),
    actor_role,
    changed_fields,
    request_id,
    jsonb_build_object(
      'previous_status', old.status,
      'new_status', new.status
    )
  );

  return new;
end;
$$;

drop trigger if exists integration_status_credential_audit_trg on public.integration_status;

create trigger integration_status_credential_audit_trg
  after update on public.integration_status
  for each row
  when (old.credentials_encrypted is distinct from new.credentials_encrypted)
  execute function public.log_integration_status_credential_change();

-- ── Rollback (manual) ───────────────────────────────────────────────────────
-- drop trigger if exists integration_status_credential_audit_trg on public.integration_status;
-- drop function if exists public.log_integration_status_credential_change();
-- drop policy if exists "integration_status_credential_audit_service_all" on public.integration_status_credential_audit_events;
-- drop policy if exists "integration_status_credential_audit_select_admin_owner" on public.integration_status_credential_audit_events;
-- drop table if exists public.integration_status_credential_audit_events;
-- drop policy if exists "integration_status_service_all" on public.integration_status;
-- drop policy if exists "integration_status_delete_owner" on public.integration_status;
-- drop policy if exists "integration_status_insert_owner" on public.integration_status;
-- drop policy if exists "integration_status_update_admin_owner" on public.integration_status;
-- drop policy if exists "integration_status_select_admin_owner" on public.integration_status;
-- create policy "integration_status_select_owner" on public.integration_status
--   for select using (public.get_my_role() = 'owner');
-- create policy "integration_status_all_owner" on public.integration_status
--   for all using (public.get_my_role() = 'owner');
-- create policy "integration_status_service" on public.integration_status
--   for all using (auth.role() = 'service_role');
