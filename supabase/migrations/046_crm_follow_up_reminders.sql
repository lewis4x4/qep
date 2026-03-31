-- QEP native follow-up reminders: outbox rows + in-app notifications + dispatcher RPC.
-- Mission: reliable next-touch commitments beyond passive pipeline badges.

-- ── Enums ────────────────────────────────────────────────────────────────────
create type public.crm_reminder_status as enum (
  'scheduled',
  'fired',
  'dismissed',
  'superseded'
);

create type public.crm_reminder_source as enum (
  'pipeline_quick',
  'deal_detail',
  'voice',
  'system'
);

-- ── Tables ───────────────────────────────────────────────────────────────────
create table public.crm_reminder_instances (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  deal_id uuid not null references public.crm_deals (id) on delete cascade,
  assigned_user_id uuid not null references public.profiles (id) on delete restrict,
  due_at timestamptz not null,
  status public.crm_reminder_status not null default 'scheduled',
  source public.crm_reminder_source not null default 'system',
  idempotency_key text not null default gen_random_uuid()::text,
  task_activity_id uuid references public.crm_activities (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  fired_at timestamptz
);

create unique index crm_reminder_instances_one_scheduled_per_deal
  on public.crm_reminder_instances (deal_id)
  where status = 'scheduled' and deleted_at is null;

create index crm_reminder_instances_due_scheduled_idx
  on public.crm_reminder_instances (due_at asc)
  where status = 'scheduled' and deleted_at is null;

create table public.crm_in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'follow_up_due',
  title text not null,
  body text,
  deal_id uuid references public.crm_deals (id) on delete cascade,
  reminder_instance_id uuid references public.crm_reminder_instances (id) on delete set null,
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index crm_in_app_notifications_user_unread_idx
  on public.crm_in_app_notifications (user_id, created_at desc)
  where read_at is null;

create unique index crm_in_app_notifications_one_per_reminder
  on public.crm_in_app_notifications (reminder_instance_id)
  where reminder_instance_id is not null;

create trigger set_crm_reminder_instances_updated_at
  before update on public.crm_reminder_instances
  for each row execute function public.set_updated_at();

create trigger set_crm_in_app_notifications_updated_at
  before update on public.crm_in_app_notifications
  for each row execute function public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.crm_reminder_instances enable row level security;
alter table public.crm_in_app_notifications enable row level security;

create policy "crm_reminder_instances_service_all"
  on public.crm_reminder_instances for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "crm_reminder_instances_elevated_all"
  on public.crm_reminder_instances for all
  using (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  )
  with check (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  );

create policy "crm_reminder_instances_rep_select"
  on public.crm_reminder_instances for select
  using (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_deal(deal_id)
  );

create policy "crm_in_app_notifications_service_all"
  on public.crm_in_app_notifications for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "crm_in_app_notifications_select_own"
  on public.crm_in_app_notifications for select
  using (user_id = auth.uid());

create policy "crm_in_app_notifications_update_own"
  on public.crm_in_app_notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Schedule / supersede (invoked from CRM router after deal write) ─────────
create or replace function public.crm_schedule_follow_up_reminder(
  p_deal_id uuid,
  p_due_at timestamptz,
  p_source public.crm_reminder_source
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal record;
  v_assignee uuid;
  v_new_id uuid;
  v_key text;
  v_task_id uuid;
  r record;
begin
  select
    d.id,
    d.workspace_id,
    d.assigned_rep_id,
    d.deleted_at,
    d.closed_at,
    d.name
  into v_deal
  from public.crm_deals d
  where d.id = p_deal_id;

  if v_deal.id is null then
    raise exception 'DEAL_NOT_FOUND';
  end if;

  if not (
    (
      public.get_my_role() in ('admin', 'manager', 'owner')
      and v_deal.workspace_id = public.get_my_workspace()
    )
    or public.crm_rep_can_access_deal(p_deal_id)
  ) then
    raise exception 'FORBIDDEN';
  end if;

  for r in
    select id, task_activity_id
    from public.crm_reminder_instances
    where deal_id = p_deal_id
      and status = 'scheduled'
      and deleted_at is null
  loop
    update public.crm_reminder_instances
    set status = 'superseded', updated_at = now()
    where id = r.id;

    if r.task_activity_id is not null then
      update public.crm_activities
      set
        metadata = jsonb_set(
          coalesce(metadata, '{}'::jsonb),
          '{task,status}',
          '"completed"'::jsonb,
          true
        ),
        updated_at = now()
      where id = r.task_activity_id
        and deleted_at is null;
    end if;
  end loop;

  if p_due_at is null or v_deal.deleted_at is not null or v_deal.closed_at is not null then
    return null;
  end if;

  v_assignee := coalesce(v_deal.assigned_rep_id, auth.uid());
  if v_assignee is null then
    return null;
  end if;

  v_key :=
    p_deal_id::text
    || ':'
    || extract(epoch from date_trunc('second', p_due_at at time zone 'utc'))::text
    || ':'
    || gen_random_uuid()::text;

  insert into public.crm_reminder_instances (
    workspace_id,
    deal_id,
    assigned_user_id,
    due_at,
    status,
    source,
    idempotency_key
  )
  values (
    v_deal.workspace_id,
    p_deal_id,
    v_assignee,
    p_due_at,
    'scheduled',
    p_source,
    v_key
  )
  returning id into v_new_id;

  insert into public.crm_activities (
    workspace_id,
    activity_type,
    body,
    occurred_at,
    deal_id,
    created_by,
    metadata
  )
  values (
    v_deal.workspace_id,
    'task',
    'Follow up: ' || coalesce(v_deal.name, 'Deal'),
    now(),
    p_deal_id,
    auth.uid(),
    jsonb_build_object(
      'task',
      jsonb_build_object(
        'dueAt', to_jsonb(p_due_at),
        'status', 'open'
      ),
      'follow_up_reminder',
      jsonb_build_object('reminderId', v_new_id::text)
    )
  )
  returning id into v_task_id;

  update public.crm_reminder_instances
  set task_activity_id = v_task_id, updated_at = now()
  where id = v_new_id;

  return v_new_id;
end;
$$;

revoke execute on function public.crm_schedule_follow_up_reminder(uuid, timestamptz, public.crm_reminder_source) from public;
grant execute on function public.crm_schedule_follow_up_reminder(uuid, timestamptz, public.crm_reminder_source) to authenticated;

-- ── Dismiss scheduled reminder (task completed / operator) ─────────────────
create or replace function public.crm_dismiss_follow_up_reminder(p_reminder_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
begin
  update public.crm_reminder_instances ri
  set status = 'dismissed', updated_at = now()
  where ri.id = p_reminder_id
    and ri.status = 'scheduled'
    and ri.deleted_at is null
    and (
      ri.assigned_user_id = auth.uid()
      or public.get_my_role() in ('admin', 'manager', 'owner')
      or public.crm_rep_can_access_deal(ri.deal_id)
    );

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke execute on function public.crm_dismiss_follow_up_reminder(uuid) from public;
grant execute on function public.crm_dismiss_follow_up_reminder(uuid) to authenticated;

-- ── Dispatcher (service_role / cron); idempotent fire per row ────────────────
create or replace function public.crm_dispatch_due_follow_up_reminders(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_fired int := 0;
  v_updated int;
  v_title text;
begin
  if p_limit is null or p_limit < 1 then
    p_limit := 50;
  end if;

  for r in
    select
      ri.id as reminder_id,
      ri.deal_id,
      ri.assigned_user_id,
      ri.workspace_id,
      d.name as deal_name
    from public.crm_reminder_instances ri
    inner join public.crm_deals d on d.id = ri.deal_id
    where ri.status = 'scheduled'
      and ri.deleted_at is null
      and ri.due_at <= now()
      and d.deleted_at is null
      and d.closed_at is null
    order by ri.due_at asc
    limit p_limit
  loop
    update public.crm_reminder_instances
    set
      status = 'fired',
      fired_at = now(),
      updated_at = now()
    where id = r.reminder_id
      and status = 'scheduled';

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      continue;
    end if;

    v_fired := v_fired + 1;
    v_title := 'Follow-up due';
    insert into public.crm_in_app_notifications (
      workspace_id,
      user_id,
      kind,
      title,
      body,
      deal_id,
      reminder_instance_id
    )
    values (
      r.workspace_id,
      r.assigned_user_id,
      'follow_up_due',
      v_title,
      coalesce(r.deal_name, 'Deal'),
      r.deal_id,
      r.reminder_id
    )
    on conflict (reminder_instance_id) do nothing;
  end loop;

  return jsonb_build_object('fired', v_fired, 'at', now());
end;
$$;

revoke execute on function public.crm_dispatch_due_follow_up_reminders(integer) from public;
grant execute on function public.crm_dispatch_due_follow_up_reminders(integer) to service_role;

-- Allow pg_cron (runs as postgres in many Supabase environments) to invoke SQL dispatch.
grant execute on function public.crm_dispatch_due_follow_up_reminders(integer) to postgres;

-- ── Manager at-risk queue (elevated roles, workspace-scoped) ─────────────────
create or replace function public.crm_manager_at_risk_deals(p_limit integer default 50)
returns table (
  deal_id uuid,
  deal_name text,
  next_follow_up_at timestamptz,
  amount numeric,
  assigned_rep_id uuid,
  hours_overdue numeric
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    d.id,
    d.name,
    d.next_follow_up_at,
    d.amount,
    d.assigned_rep_id,
    extract(
      epoch from (now() - d.next_follow_up_at)
    ) / 3600.0
  from public.crm_deals d
  where d.workspace_id = public.get_my_workspace()
    and d.deleted_at is null
    and d.closed_at is null
    and d.next_follow_up_at is not null
    and d.next_follow_up_at < now() - interval '24 hours'
    and public.get_my_role() in ('admin', 'manager', 'owner')
  order by d.amount desc nulls last, d.next_follow_up_at asc
  limit coalesce(nullif(p_limit, 0), 50);
$$;

revoke execute on function public.crm_manager_at_risk_deals(integer) from public;
grant execute on function public.crm_manager_at_risk_deals(integer) to authenticated;

-- ── Optional pg_cron: same pattern as rate-limit cleanup ─────────────────────
do $cron$
begin
  if exists (
    select 1
    from pg_namespace
    where nspname = 'cron'
  ) then
    perform cron.schedule(
      'crm-dispatch-follow-up-reminders',
      '10 minutes',
      $job$select public.crm_dispatch_due_follow_up_reminders(75);$job$
    );
  else
    raise notice 'Skipping crm-dispatch-follow-up-reminders cron: pg_cron extension not available.';
  end if;
exception
  when undefined_object then
    raise notice 'Skipping crm-dispatch-follow-up-reminders cron: pg_cron not available.';
  when others then
    raise notice 'Skipping crm-dispatch-follow-up-reminders cron: %', sqlerrm;
end;
$cron$;

comment on table public.crm_reminder_instances is
  'Native follow-up outbox: one scheduled row per open deal; superseded when next_follow_up_at changes.';
comment on table public.crm_in_app_notifications is
  'In-app delivery for fired follow-up reminders; RLS restricts reads to recipient.';
comment on function public.crm_dispatch_due_follow_up_reminders(integer) is
  'Marks due scheduled reminders as fired and inserts in-app notifications. Idempotent per reminder.';

-- When a deal is closed or soft-deleted, clear scheduled native reminders (router may not run).
create or replace function public.crm_deal_supersede_scheduled_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.deleted_at is not null and (old.deleted_at is null or old.deleted_at is distinct from new.deleted_at))
     or (new.closed_at is not null and (old.closed_at is null or old.closed_at is distinct from new.closed_at))
  then
    update public.crm_reminder_instances
    set status = 'superseded', updated_at = now()
    where deal_id = new.id
      and status = 'scheduled'
      and deleted_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_deals_supersede_reminders_on_close_or_delete on public.crm_deals;
create trigger crm_deals_supersede_reminders_on_close_or_delete
  after update of deleted_at, closed_at on public.crm_deals
  for each row
  execute function public.crm_deal_supersede_scheduled_reminders();
