-- 526_intellidealer_crm_cross_cutting_non_must.sql
--
-- Non-must CRM/Cross-Cutting gap-audit cleanup.
-- Additive only: preference storage, traffic monthly completion report view,
-- and central record-change-history trigger wiring for operational backbone
-- tables with uuid primary keys.

create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  traffic_calendar_display_settings jsonb not null default jsonb_build_object(
    'city', true,
    'time', true,
    'type', true,
    'salesperson', true,
    'make_model', true,
    'stock_number', true,
    'group', true,
    'job_site', true,
    'customer_name', true,
    'machine_serial', true,
    'unit_description', true
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, user_id)
);

comment on table public.user_preferences is
  'Per-user workspace preferences for operational UI parity settings.';
comment on column public.user_preferences.traffic_calendar_display_settings is
  'Traffic Weekly/Monthly calendar tile display toggles for city/time/type, salesperson, unit identity, customer, and job-site fields.';

create index if not exists idx_user_preferences_user
  on public.user_preferences (workspace_id, user_id)
  where deleted_at is null;

alter table public.user_preferences enable row level security;

drop policy if exists "user_preferences_service_all" on public.user_preferences;
create policy "user_preferences_service_all"
  on public.user_preferences for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "user_preferences_own_scope" on public.user_preferences;
create policy "user_preferences_own_scope"
  on public.user_preferences for all
  using (
    workspace_id = (select public.get_my_workspace())
    and user_id = (select auth.uid())
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and user_id = (select auth.uid())
  );

drop policy if exists "user_preferences_elevated_read" on public.user_preferences;
create policy "user_preferences_elevated_read"
  on public.user_preferences for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  );

drop trigger if exists set_user_preferences_updated_at on public.user_preferences;
create trigger set_user_preferences_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

create or replace view public.v_traffic_receipts_completed_this_month
with (security_invoker = true)
as
select
  t.id,
  t.workspace_id,
  t.receipt_number,
  t.status,
  t.completed_at,
  t.shipping_date,
  t.ticket_type,
  t.receipt_type,
  t.department,
  t.company_id,
  t.to_customer_id,
  t.stock_number,
  t.unit_description_snapshot,
  t.from_location,
  t.to_location,
  t.created_at,
  t.updated_at
from public.traffic_tickets t
where t.status = 'completed'
  and coalesce(t.completed_at, t.shipping_date::timestamptz) >= date_trunc('month', now())
  and coalesce(t.completed_at, t.shipping_date::timestamptz) < date_trunc('month', now()) + interval '1 month';

comment on view public.v_traffic_receipts_completed_this_month is
  'Traffic Management report equivalent for receipts/deliveries completed in the current calendar month.';

create or replace function public.record_change_history_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_changed jsonb;
  v_workspace_id text;
  v_record_id uuid;
  v_actor_text text;
  v_actor_user_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_before := to_jsonb(old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_after := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' and v_before = v_after then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(
      jsonb_object_agg(
        n.key,
        jsonb_build_object('old', o.value, 'new', n.value)
      ),
      '{}'::jsonb
    )
    into v_changed
    from jsonb_each(v_after) n
    left join jsonb_each(v_before) o on o.key = n.key
    where n.value is distinct from o.value
      and n.key not in ('updated_at');

    if v_changed = '{}'::jsonb then
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    v_changed := coalesce(v_after - 'updated_at', '{}'::jsonb);
  else
    v_changed := coalesce(v_before - 'updated_at', '{}'::jsonb);
  end if;

  v_workspace_id := coalesce(v_after ->> 'workspace_id', v_before ->> 'workspace_id', public.get_my_workspace());
  v_record_id := coalesce((v_after ->> 'id')::uuid, (v_before ->> 'id')::uuid);
  v_actor_text := coalesce(
    v_after ->> 'created_by',
    v_after ->> 'created_by_user_id',
    v_after ->> 'requested_by',
    v_before ->> 'created_by',
    v_before ->> 'created_by_user_id',
    v_before ->> 'requested_by',
    auth.uid()::text
  );

  if v_actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_actor_user_id := v_actor_text::uuid;
  end if;

  insert into public.record_change_history (
    workspace_id,
    table_name,
    record_id,
    actor_user_id,
    action,
    changed_fields,
    before_snapshot,
    after_snapshot
  )
  values (
    v_workspace_id,
    tg_table_name,
    v_record_id,
    v_actor_user_id,
    lower(tg_op),
    v_changed,
    v_before,
    v_after
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.record_change_history_capture() is
  'Generic field-level audit trigger writer for workspace tables with uuid id columns.';

do $$
declare
  v_table_name text;
  v_trigger_name text;
begin
  foreach v_table_name in array array[
    'branches',
    'traffic_tickets',
    'qrm_companies',
    'crm_equipment',
    'qrm_equipment',
    'service_jobs',
    'rental_contracts'
  ] loop
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_table_name
        and c.relkind in ('r', 'p')
    ) then
      v_trigger_name := 'trg_rch_' || v_table_name;
      execute format('drop trigger if exists %I on public.%I', v_trigger_name, v_table_name);
      execute format(
        'create trigger %I after insert or update or delete on public.%I ' ||
        'for each row execute function public.record_change_history_capture()',
        v_trigger_name,
        v_table_name
      );
    end if;
  end loop;
end $$;
