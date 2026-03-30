-- Sprint 3 (1B): Deal pipeline schema delta + weighted pipeline view.
-- Adds follow-up/close/loss fields, denormalized last_activity_at maintenance,
-- and rep-safe weighted pipeline read surface.

-- ── crm_deals schema delta ───────────────────────────────────────────────────
alter table public.crm_deals
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists last_activity_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists loss_reason text,
  add column if not exists competitor text;

create index if not exists idx_crm_deals_follow_up
  on public.crm_deals(workspace_id, next_follow_up_at)
  where deleted_at is null;

create index if not exists idx_crm_deals_last_activity
  on public.crm_deals(workspace_id, last_activity_at desc)
  where deleted_at is null;

create index if not exists idx_crm_deals_closed_at
  on public.crm_deals(workspace_id, closed_at desc)
  where deleted_at is null;

-- Backfill denormalized last activity from existing non-deleted activities.
update public.crm_deals d
set last_activity_at = a.last_activity_at
from (
  select deal_id, max(occurred_at) as last_activity_at
  from public.crm_activities
  where deal_id is not null
    and deleted_at is null
  group by deal_id
) a
where d.id = a.deal_id;

-- ── last_activity_at maintenance from crm_activities ────────────────────────
create or replace function public.crm_refresh_deal_last_activity(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_activity_at timestamptz;
begin
  if p_deal_id is null then
    return;
  end if;

  select max(a.occurred_at)
  into v_last_activity_at
  from public.crm_activities a
  where a.deal_id = p_deal_id
    and a.deleted_at is null;

  update public.crm_deals d
  set last_activity_at = v_last_activity_at
  where d.id = p_deal_id;
end;
$$;

create or replace function public.crm_sync_deal_last_activity_from_activities()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.crm_refresh_deal_last_activity(old.deal_id);
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.deal_id is not null then
      perform public.crm_refresh_deal_last_activity(old.deal_id);
    end if;

    if new.deal_id is not null and (
      new.deal_id is distinct from old.deal_id
      or new.occurred_at is distinct from old.occurred_at
      or new.deleted_at is distinct from old.deleted_at
    ) then
      perform public.crm_refresh_deal_last_activity(new.deal_id);
    end if;

    return new;
  end if;

  perform public.crm_refresh_deal_last_activity(new.deal_id);
  return new;
end;
$$;

revoke execute on function public.crm_refresh_deal_last_activity(uuid) from public;
revoke execute on function public.crm_refresh_deal_last_activity(uuid) from authenticated;
revoke execute on function public.crm_sync_deal_last_activity_from_activities() from public;
revoke execute on function public.crm_sync_deal_last_activity_from_activities() from authenticated;
grant execute on function public.crm_refresh_deal_last_activity(uuid) to service_role;
grant execute on function public.crm_sync_deal_last_activity_from_activities() to service_role;

drop trigger if exists crm_sync_deal_last_activity_from_activities on public.crm_activities;
create trigger crm_sync_deal_last_activity_from_activities
  after insert or update or delete on public.crm_activities
  for each row execute function public.crm_sync_deal_last_activity_from_activities();

-- ── Deal read surfaces / weighted pipeline ──────────────────────────────────
-- Drop/recreate to avoid CREATE OR REPLACE column-shape constraints across
-- environments that may have a prior view signature.
drop view if exists public.crm_deals_rep_safe;
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
  d.next_follow_up_at,
  d.last_activity_at,
  d.closed_at,
  d.created_at,
  d.updated_at,
  d.deleted_at
from public.crm_deals d
where d.deleted_at is null
  and (
    public.get_my_role() in ('admin', 'manager', 'owner')
    or (public.get_my_role() = 'rep' and public.crm_rep_can_access_deal(d.id))
  );

drop view if exists public.crm_deals_elevated_full;
create view public.crm_deals_elevated_full as
select d.*
from public.crm_deals d
where d.deleted_at is null
  and public.get_my_role() in ('admin', 'manager', 'owner');

drop view if exists public.crm_deals_weighted;
create view public.crm_deals_weighted with (security_barrier = true) as
select
  d.id,
  d.workspace_id,
  d.name,
  d.stage_id,
  s.name as stage_name,
  s.probability as stage_probability,
  d.primary_contact_id,
  d.company_id,
  d.assigned_rep_id,
  d.amount,
  (d.amount * (coalesce(s.probability, 0)::numeric / 100.0))::numeric(14,2) as weighted_amount,
  d.expected_close_on,
  d.next_follow_up_at,
  d.last_activity_at,
  d.closed_at,
  d.hubspot_deal_id,
  d.created_at,
  d.updated_at
from public.crm_deals d
join public.crm_deal_stages s on s.id = d.stage_id
where d.deleted_at is null
  and not s.is_closed_won
  and not s.is_closed_lost
  and (
    public.get_my_role() in ('admin', 'manager', 'owner')
    or (public.get_my_role() = 'rep' and public.crm_rep_can_access_deal(d.id))
  );

comment on view public.crm_deals_weighted is
  'Open-deal weighted pipeline projection using stage probability and deal amount.';

grant select on public.crm_deals_rep_safe to authenticated;
grant select on public.crm_deals_elevated_full to authenticated;
grant select on public.crm_deals_weighted to authenticated;

-- Keep sensitive close-loss fields elevated/service only until QUA-217 clears.
revoke select (loss_reason, competitor) on table public.crm_deals from authenticated;
grant select (loss_reason, competitor) on table public.crm_deals to service_role;

-- ── Rollback DDL (manual, reverse dependency order) ─────────────────────────
-- grant select (loss_reason, competitor) on table public.crm_deals to authenticated;
--
-- drop trigger if exists crm_sync_deal_last_activity_from_activities on public.crm_activities;
-- drop function if exists public.crm_sync_deal_last_activity_from_activities();
-- drop function if exists public.crm_refresh_deal_last_activity(uuid);
--
-- drop view if exists public.crm_deals_weighted;
-- create or replace view public.crm_deals_rep_safe with (security_barrier = true) as
-- select
--   d.id,
--   d.workspace_id,
--   d.name,
--   d.stage_id,
--   d.primary_contact_id,
--   d.company_id,
--   d.assigned_rep_id,
--   d.amount,
--   d.expected_close_on,
--   d.hubspot_deal_id,
--   d.created_at,
--   d.updated_at,
--   d.deleted_at
-- from public.crm_deals d
-- where d.deleted_at is null
--   and (
--     public.get_my_role() in ('admin', 'manager', 'owner')
--     or (public.get_my_role() = 'rep' and public.crm_rep_can_access_deal(d.id))
--   );
--
-- create or replace view public.crm_deals_elevated_full as
-- select d.*
-- from public.crm_deals d
-- where d.deleted_at is null
--   and public.get_my_role() in ('admin', 'manager', 'owner');
--
-- drop index if exists idx_crm_deals_closed_at;
-- drop index if exists idx_crm_deals_last_activity;
-- drop index if exists idx_crm_deals_follow_up;
--
-- alter table public.crm_deals
--   drop column if exists competitor,
--   drop column if exists loss_reason,
--   drop column if exists closed_at,
--   drop column if exists last_activity_at,
--   drop column if exists next_follow_up_at;
