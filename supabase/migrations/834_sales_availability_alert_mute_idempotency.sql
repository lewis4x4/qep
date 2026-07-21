-- Migration 834: make SA8 availability-alert mute changes idempotent.
--
-- Migration 831 introduced the caller-scoped preference RPC, but refreshed
-- every queued/muted delivery on each invocation. Re-applying an unchanged
-- preference therefore reset the enabled channel's retry time to now. Keep
-- the preference upsert atomic and update only rows whose delivery state
-- actually transitions.

begin;

create index if not exists idx_sales_alert_preferences_expiry
  on public.sales_availability_alert_preferences (
    muted_until,
    workspace_id,
    user_id
  )
  where muted_channel is not null and muted_until is not null;

create or replace function public.enqueue_sales_availability_alert(
  p_availability_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.quote_availability_requests%rowtype;
  v_query_id uuid;
  v_recipient_user_id uuid;
  v_recipient_user_ids uuid[];
  v_title text;
  v_body text;
begin
  select * into v_request
  from public.quote_availability_requests
  where id = p_availability_request_id;

  if not found then
    raise exception 'availability request % not found', p_availability_request_id
      using errcode = 'P0002';
  end if;

  v_title := concat('Availability needed: ', v_request.requested_machine_label);
  v_body := concat_ws(
    ' · ',
    v_request.requested_machine_label,
    nullif(v_request.customer_need, ''),
    concat('Urgency: ', v_request.urgency)
  );

  -- Materialize recipients once so membership/role changes cannot add an
  -- unlocked recipient between lock acquisition and the delivery upsert.
  select coalesce(array_agg(profile.id order by profile.id), '{}'::uuid[])
  into v_recipient_user_ids
  from public.profiles profile
  join public.profile_workspaces membership
    on membership.profile_id = profile.id
   and membership.workspace_id = v_request.workspace_id
  where profile.is_active = true
    and (
      profile.id = v_request.assigned_to
      or profile.role in ('admin', 'manager', 'owner')
    );

  -- Serialize preference reads and delivery reconciliation with the mute RPC.
  -- The materialized UUID order gives every fan-out the same lock order and
  -- avoids deadlocks when recipients share an availability request.
  foreach v_recipient_user_id in array v_recipient_user_ids
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_request.workspace_id || ':' || v_recipient_user_id::text,
        834
      )
    );
  end loop;

  insert into public.sales_availability_alert_queries (
    workspace_id,
    availability_request_id,
    requested_by,
    business_dedupe_key,
    title,
    body,
    payload
  ) values (
    v_request.workspace_id,
    v_request.id,
    v_request.requested_by,
    concat('quote_availability:', v_request.workspace_id, ':', v_request.id),
    v_title,
    v_body,
    jsonb_build_object(
      'availability_request_id', v_request.id,
      'quote_package_id', v_request.quote_package_id,
      'requested_machine_label', v_request.requested_machine_label,
      'urgency', v_request.urgency,
      'sla_due_at', v_request.sla_due_at
    )
  )
  on conflict (workspace_id, availability_request_id) do update
    set title = excluded.title,
        body = excluded.body,
        payload = excluded.payload
  returning id into v_query_id;

  -- Reassignment supersedes only work that has not reached a terminal/provider
  -- state. Previously queued deliveries for an old assignee must not fire
  -- after ownership moves.
  update public.sales_availability_alert_deliveries delivery
  set status = 'cancelled',
      next_attempt_at = null,
      metadata = delivery.metadata || jsonb_build_object(
        'cancelled_reason', 'recipient_no_longer_current',
        'cancelled_at', now()
      )
  where delivery.workspace_id = v_request.workspace_id
    and delivery.alert_query_id = v_query_id
    and delivery.status in ('queued', 'muted', 'failed')
    and not (delivery.recipient_user_id = any(v_recipient_user_ids));

  with recipients as (
    select unnest(v_recipient_user_ids) as user_id
  ), channels(channel, provider) as (
    values
      ('sms'::text, 'twilio'::text),
      ('eight_by_eight'::text, 'eight_by_eight'::text)
  )
  insert into public.sales_availability_alert_deliveries (
    workspace_id,
    alert_query_id,
    recipient_user_id,
    channel,
    provider,
    status,
    next_attempt_at,
    metadata
  )
  select
    v_request.workspace_id,
    v_query_id,
    recipient.user_id,
    channel.channel,
    channel.provider,
    case
      when preference.muted_channel = channel.channel
        and (preference.muted_until is null or preference.muted_until > now())
        then 'muted'
      else 'queued'
    end,
    case
      when preference.muted_channel = channel.channel
        and (preference.muted_until is null or preference.muted_until > now())
        then null
      else now()
    end,
    jsonb_build_object(
      'business_dedupe_key', concat('quote_availability:', v_request.workspace_id, ':', v_request.id),
      'mute_evaluated_at', now()
    )
  from recipients recipient
  cross join channels channel
  left join public.sales_availability_alert_preferences preference
    on preference.workspace_id = v_request.workspace_id
   and preference.user_id = recipient.user_id
  on conflict (workspace_id, alert_query_id, recipient_user_id, channel)
  do update set
    status = excluded.status,
    next_attempt_at = excluded.next_attempt_at,
    metadata = public.sales_availability_alert_deliveries.metadata
      || excluded.metadata
      || jsonb_build_object('recipient_reconciled_at', now())
  where (
      public.sales_availability_alert_deliveries.status = 'queued'
      and excluded.status = 'muted'
    )
    or (
      public.sales_availability_alert_deliveries.status = 'muted'
      and excluded.status = 'queued'
    )
    or (
      public.sales_availability_alert_deliveries.status = 'failed'
      and excluded.status = 'muted'
    )
    or public.sales_availability_alert_deliveries.status = 'cancelled';

  insert into public.qrm_in_app_notifications (
    workspace_id,
    user_id,
    kind,
    title,
    body,
    metadata
  )
  select distinct
    v_request.workspace_id,
    delivery.recipient_user_id,
    'quote_availability_requested',
    v_title,
    v_body,
    jsonb_build_object(
      'alert_query_id', v_query_id,
      'availability_request_id', v_request.id,
      'business_dedupe_key', concat('quote_availability:', v_request.workspace_id, ':', v_request.id)
    )
  from public.sales_availability_alert_deliveries delivery
  where delivery.alert_query_id = v_query_id
    and delivery.workspace_id = v_request.workspace_id
    and delivery.status <> 'cancelled'
    and not exists (
      select 1
      from public.qrm_in_app_notifications existing
      where existing.workspace_id = v_request.workspace_id
        and existing.user_id = delivery.recipient_user_id
        and existing.kind = 'quote_availability_requested'
        and existing.metadata ->> 'alert_query_id' = v_query_id::text
    );

  return v_query_id;
end;
$$;

comment on function public.enqueue_sales_availability_alert(uuid) is
  'SA8 internal queue fan-out. Serializes with preference changes and updates only effective delivery-state transitions; queued is not delivery proof.';

revoke all on function public.enqueue_sales_availability_alert(uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_sales_availability_alert(uuid)
  to service_role;

create or replace function public.set_sales_availability_alert_mute(
  p_channel text,
  p_muted_until timestamptz default null
)
returns public.sales_availability_alert_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id text := public.get_my_workspace();
  v_requested_muted_until timestamptz := case
    when p_channel is null then null
    else p_muted_until
  end;
  v_channel_is_muted boolean;
  v_row public.sales_availability_alert_preferences%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if v_workspace_id is null
     or not exists (
       select 1
       from public.profiles profile
       join public.profile_workspaces membership
         on membership.profile_id = profile.id
        and membership.workspace_id = v_workspace_id
       where profile.id = v_user_id
         and profile.is_active = true
     ) then
    raise exception 'active workspace membership required'
      using errcode = '42501';
  end if;

  if p_channel is not null and p_channel not in ('sms', 'eight_by_eight') then
    raise exception 'channel must be sms, eight_by_eight, or null'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_workspace_id || ':' || v_user_id::text, 834)
  );

  insert into public.sales_availability_alert_preferences as preference (
    workspace_id,
    user_id,
    muted_channel,
    muted_until
  ) values (
    v_workspace_id,
    v_user_id,
    p_channel,
    v_requested_muted_until
  )
  on conflict (workspace_id, user_id) do update
    set muted_channel = excluded.muted_channel,
        muted_until = excluded.muted_until
    where preference.muted_channel is distinct from excluded.muted_channel
       or preference.muted_until is distinct from excluded.muted_until
  returning * into v_row;

  -- An unchanged preference intentionally produces no UPSERT result. Return
  -- the existing row while still allowing the transition-only reconciliation
  -- below to repair a genuinely stale delivery (for example, an expired
  -- timed mute) without disturbing already-correct schedules.
  if not found then
    select preference.*
    into v_row
    from public.sales_availability_alert_preferences preference
    where preference.workspace_id = v_workspace_id
      and preference.user_id = v_user_id;

    if not found then
      raise exception 'availability alert preference was not persisted';
    end if;
  end if;

  v_channel_is_muted := p_channel is not null
    and (v_requested_muted_until is null or v_requested_muted_until > now());

  update public.sales_availability_alert_deliveries delivery
  set status = case
        when v_channel_is_muted and delivery.channel = p_channel then 'muted'
        else 'queued'
      end,
      next_attempt_at = case
        when v_channel_is_muted and delivery.channel = p_channel then null
        else now()
      end,
      metadata = delivery.metadata || jsonb_build_object(
        'mute_evaluated_at', now(),
        'mute_changed_by', v_user_id
      )
  where delivery.workspace_id = v_workspace_id
    and delivery.recipient_user_id = v_user_id
    and (
      (
        v_channel_is_muted
        and delivery.channel = p_channel
        and delivery.status in ('queued', 'failed')
      )
      or (
        not (v_channel_is_muted and delivery.channel = p_channel)
        and delivery.status = 'muted'
      )
    );

  return v_row;
end;
$$;

comment on function public.set_sales_availability_alert_mute(text, timestamptz) is
  'SA8 user preference: idempotently mute at most one of SMS or 8x8, optionally until a timestamp; NULL channel restores both without resetting unchanged delivery schedules.';

revoke all on function public.set_sales_availability_alert_mute(text, timestamptz)
  from public, anon, service_role;
grant execute on function public.set_sales_availability_alert_mute(text, timestamptz)
  to authenticated;

create or replace function public.reconcile_my_sales_availability_alert_mute_expiry()
returns public.sales_availability_alert_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id text := public.get_my_workspace();
  v_row public.sales_availability_alert_preferences%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if v_workspace_id is null
     or not exists (
       select 1
       from public.profiles profile
       join public.profile_workspaces membership
         on membership.profile_id = profile.id
        and membership.workspace_id = v_workspace_id
       where profile.id = v_user_id
         and profile.is_active = true
     ) then
    raise exception 'active workspace membership required'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_workspace_id || ':' || v_user_id::text, 834)
  );

  select preference.*
  into v_row
  from public.sales_availability_alert_preferences preference
  where preference.workspace_id = v_workspace_id
    and preference.user_id = v_user_id;

  if not found then
    return null;
  end if;

  if v_row.muted_channel is null
     or v_row.muted_until is null
     or v_row.muted_until > now() then
    return v_row;
  end if;

  update public.sales_availability_alert_preferences preference
  set muted_channel = null,
      muted_until = null
  where preference.id = v_row.id
    and preference.muted_channel = v_row.muted_channel
    and preference.muted_until = v_row.muted_until
    and preference.muted_until <= now()
  returning * into v_row;

  if not found then
    select preference.*
    into v_row
    from public.sales_availability_alert_preferences preference
    where preference.workspace_id = v_workspace_id
      and preference.user_id = v_user_id;
    return v_row;
  end if;

  update public.sales_availability_alert_deliveries delivery
  set status = 'queued',
      next_attempt_at = now(),
      metadata = delivery.metadata || jsonb_build_object(
        'mute_expired_at', now(),
        'mute_expiry_reconciled_by', v_user_id
      )
  where delivery.workspace_id = v_workspace_id
    and delivery.recipient_user_id = v_user_id
    and delivery.status = 'muted';

  return v_row;
end;
$$;

comment on function public.reconcile_my_sales_availability_alert_mute_expiry() is
  'SA8 caller-scoped, server-time reconciliation for an expired temporary alert mute. The current preference is rechecked under the same lock used by enqueue and mute changes.';

revoke all on function public.reconcile_my_sales_availability_alert_mute_expiry()
  from public, anon, service_role;
grant execute on function public.reconcile_my_sales_availability_alert_mute_expiry()
  to authenticated;

create or replace function public.reconcile_expired_sales_availability_alert_mutes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preference record;
  v_reconciled integer := 0;
begin
  for v_preference in
    select
      preference.id,
      preference.workspace_id,
      preference.user_id,
      preference.muted_channel,
      preference.muted_until
    from public.sales_availability_alert_preferences preference
    where preference.muted_channel is not null
      and preference.muted_until is not null
      and preference.muted_until <= now()
    order by preference.workspace_id, preference.user_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_preference.workspace_id || ':' || v_preference.user_id::text,
        834
      )
    );

    update public.sales_availability_alert_preferences preference
    set muted_channel = null,
        muted_until = null
    where preference.id = v_preference.id
      and preference.muted_channel = v_preference.muted_channel
      and preference.muted_until = v_preference.muted_until
      and preference.muted_until <= now();

    if found then
      update public.sales_availability_alert_deliveries delivery
      set status = 'queued',
          next_attempt_at = now(),
          metadata = delivery.metadata || jsonb_build_object(
            'mute_expired_at', now(),
            'mute_expiry_reconciled_by', 'server'
          )
      where delivery.workspace_id = v_preference.workspace_id
        and delivery.recipient_user_id = v_preference.user_id
        and delivery.status = 'muted';

      v_reconciled := v_reconciled + 1;
    end if;
  end loop;

  return v_reconciled;
end;
$$;

comment on function public.reconcile_expired_sales_availability_alert_mutes() is
  'SA8 server-time sweep for expired temporary mutes. Rechecks each stored preference under the enqueue/mute advisory lock and requeues only rows that remain muted.';

revoke all on function public.reconcile_expired_sales_availability_alert_mutes()
  from public, anon, authenticated;
grant execute on function public.reconcile_expired_sales_availability_alert_mutes()
  to service_role;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping sales availability mute expiry cron: pg_cron not available.';
    return;
  end if;

  if exists (
    select 1 from cron.job
    where jobname = 'sales-availability-mute-expiry'
  ) then
    perform cron.unschedule('sales-availability-mute-expiry');
  end if;

  perform cron.schedule(
    'sales-availability-mute-expiry',
    '* * * * *',
    $job$select public.reconcile_expired_sales_availability_alert_mutes();$job$
  );
exception
  when others then
    raise notice 'Skipping sales availability mute expiry cron: %', sqlerrm;
end $$;

commit;

-- Rollback / fix-forward posture:
--   The RPC signatures are unchanged, so rolling back the frontend remains
--   compatible with this migration. Keep this database correction live.
--   Any reversal must be a new numbered fix-forward migration; never restore
--   migration 831's broad delivery refresh, which reintroduced retry churn.
