-- Migration 034: add HubSpot cutover transition audit events
-- Extends integration_status_credential_audit_events so Sprint 5 handoff
-- transitions are recorded as durable audit rows instead of inferred UI state.

alter table public.integration_status_credential_audit_events
  drop constraint if exists integration_status_credential_audit_events_event_type_check;

alter table public.integration_status_credential_audit_events
  add constraint integration_status_credential_audit_events_event_type_check
  check (
    event_type in (
      'credentials_set',
      'credentials_rotated',
      'credentials_cleared',
      'deploy_gate_approved',
      'source_only_enabled',
      'parallel_run_reopened'
    )
  );

comment on table public.integration_status_credential_audit_events is
  'Append-only integration audit events for credential lifecycle and HubSpot cutover transitions.';

create or replace function public.log_hubspot_cutover_audit_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_cutover jsonb;
  new_cutover jsonb;
  actor_user_id uuid;
  actor_role text;
begin
  if new.integration_key <> 'hubspot' then
    return new;
  end if;

  old_cutover := coalesce(old.config -> 'hubspot_cutover', '{}'::jsonb);
  new_cutover := coalesce(new.config -> 'hubspot_cutover', '{}'::jsonb);

  if old_cutover = new_cutover then
    return new;
  end if;

  actor_user_id := auth.uid();
  actor_role := case
    when auth.role() = 'service_role' then 'service_role'
    else public.get_my_role()::text
  end;

  if coalesce((old_cutover ->> 'deploy_gate_ready')::boolean, false) = false
    and coalesce((new_cutover ->> 'deploy_gate_ready')::boolean, false) = true
    and coalesce((new_cutover ->> 'source_only_enabled')::boolean, false) = false then
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
      'deploy_gate_approved',
      actor_user_id,
      actor_role,
      jsonb_build_object(
        'validated_at', new_cutover ->> 'validated_at',
        'note', new_cutover ->> 'note'
      )
    );
  end if;

  if coalesce((old_cutover ->> 'source_only_enabled')::boolean, false) = false
    and coalesce((new_cutover ->> 'source_only_enabled')::boolean, false) = true then
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
      'source_only_enabled',
      actor_user_id,
      actor_role,
      jsonb_build_object(
        'source_only_activated_at', new_cutover ->> 'source_only_activated_at',
        'validated_at', new_cutover ->> 'validated_at'
      )
    );
  end if;

  if (
    coalesce((old_cutover ->> 'source_only_enabled')::boolean, false)
    or coalesce((old_cutover ->> 'deploy_gate_ready')::boolean, false)
    or coalesce((old_cutover ->> 'parallel_run_enabled')::boolean, true) = false
  )
    and coalesce((new_cutover ->> 'source_only_enabled')::boolean, false) = false
    and coalesce((new_cutover ->> 'deploy_gate_ready')::boolean, false) = false
    and coalesce((new_cutover ->> 'parallel_run_enabled')::boolean, true) = true then
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
      'parallel_run_reopened',
      actor_user_id,
      actor_role,
      jsonb_build_object(
        'previous_source_only_enabled', coalesce((old_cutover ->> 'source_only_enabled')::boolean, false),
        'previous_deploy_gate_ready', coalesce((old_cutover ->> 'deploy_gate_ready')::boolean, false)
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists integration_status_hubspot_cutover_audit_trg on public.integration_status;

create trigger integration_status_hubspot_cutover_audit_trg
  after update on public.integration_status
  for each row
  when (
    old.integration_key = 'hubspot'
    and old.config is distinct from new.config
  )
  execute function public.log_hubspot_cutover_audit_events();

-- Rollback (manual)
-- drop trigger if exists integration_status_hubspot_cutover_audit_trg on public.integration_status;
-- drop function if exists public.log_hubspot_cutover_audit_events();
-- alter table public.integration_status_credential_audit_events
--   drop constraint if exists integration_status_credential_audit_events_event_type_check;
-- alter table public.integration_status_credential_audit_events
--   add constraint integration_status_credential_audit_events_event_type_check
--   check (
--     event_type in ('credentials_set', 'credentials_rotated', 'credentials_cleared')
--   );
-- comment on table public.integration_status_credential_audit_events is
--   'Append-only credential change audit events for integration_status updates.';
