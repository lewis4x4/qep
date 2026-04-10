-- ============================================================================
-- Migration 229: Track 7A.1 — Handoff Trust Ledger Closeout
--
-- Completes the partially shipped handoff ledger by:
--   1. adding deterministic seam ingestion from real deal-scoped role handoffs
--   2. extending handoff_events with explainability + source fingerprinting
--   3. tightening read access to manager/owner only
--   4. scheduling the nightly scorer
--   5. backfilling the last 30 days from deal approval/verification seams
-- ============================================================================

alter table public.handoff_events
  add column if not exists subject_label text,
  add column if not exists source_table text,
  add column if not exists source_status_from text,
  add column if not exists source_status_to text,
  add column if not exists source_fingerprint text,
  add column if not exists evidence jsonb not null default '{}'::jsonb;

create unique index if not exists idx_handoff_events_source_fingerprint_uq
  on public.handoff_events (workspace_id, source_fingerprint)
  where source_fingerprint is not null;

comment on column public.handoff_events.subject_label is
  'Human-readable subject label shown in manager-facing seam review surfaces.';
comment on column public.handoff_events.source_table is
  'Source table that produced the seam event (crm_deals, deposits, trade_valuations, demos).';
comment on column public.handoff_events.source_status_from is
  'Source-state value before the seam occurred.';
comment on column public.handoff_events.source_status_to is
  'Source-state value after the seam occurred.';
comment on column public.handoff_events.source_fingerprint is
  'Deterministic source transition fingerprint used to dedupe seam-event inserts.';
comment on column public.handoff_events.evidence is
  'Scorer evidence payload: sender activity count, first recipient action, delay, and other seam evidence.';

drop policy if exists "handoff_events_select_elevated" on public.handoff_events;
create policy "handoff_events_select_manager_owner"
  on public.handoff_events for select
  using (public.get_my_role() in ('manager', 'owner'));

drop policy if exists "handoff_seam_scores_select_elevated" on public.handoff_role_seam_scores;
create policy "handoff_seam_scores_select_manager_owner"
  on public.handoff_role_seam_scores for select
  using (public.get_my_role() in ('manager', 'owner'));

create or replace function public.record_handoff_event(
  p_workspace_id text,
  p_subject_type text,
  p_subject_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_handoff_reason text,
  p_handoff_at timestamptz default now(),
  p_source_table text default null,
  p_source_status_from text default null,
  p_source_status_to text default null,
  p_source_fingerprint text default null,
  p_source_event_id uuid default null,
  p_subject_label text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_role text;
  v_to_role text;
  v_subject_label text;
  v_event_id uuid;
begin
  if p_subject_id is null
     or p_from_user_id is null
     or p_to_user_id is null
     or p_from_user_id = p_to_user_id then
    return null;
  end if;

  select b.iron_role
    into v_from_role
  from public.profile_role_blend b
  where b.profile_id = p_from_user_id
    and b.effective_to is null
  order by b.weight desc, b.effective_from desc
  limit 1;

  if v_from_role is null then
    select p.iron_role into v_from_role
    from public.profiles p
    where p.id = p_from_user_id;
  end if;

  select b.iron_role
    into v_to_role
  from public.profile_role_blend b
  where b.profile_id = p_to_user_id
    and b.effective_to is null
  order by b.weight desc, b.effective_from desc
  limit 1;

  if v_to_role is null then
    select p.iron_role into v_to_role
    from public.profiles p
    where p.id = p_to_user_id;
  end if;

  if v_from_role is null
     or v_to_role is null
     or v_from_role = v_to_role then
    return null;
  end if;

  v_subject_label := nullif(trim(coalesce(p_subject_label, '')), '');
  if v_subject_label is null and p_subject_type = 'deal' then
    select d.name into v_subject_label
    from public.crm_deals d
    where d.id = p_subject_id;
  end if;

  begin
    insert into public.handoff_events (
      workspace_id,
      subject_type,
      subject_id,
      subject_label,
      from_user_id,
      from_iron_role,
      to_user_id,
      to_iron_role,
      handoff_at,
      handoff_reason,
      source_event_id,
      source_table,
      source_status_from,
      source_status_to,
      source_fingerprint,
      evidence
    )
    values (
      coalesce(p_workspace_id, 'default'),
      p_subject_type,
      p_subject_id,
      v_subject_label,
      p_from_user_id,
      v_from_role,
      p_to_user_id,
      v_to_role,
      coalesce(p_handoff_at, now()),
      p_handoff_reason,
      p_source_event_id,
      p_source_table,
      p_source_status_from,
      p_source_status_to,
      p_source_fingerprint,
      '{}'::jsonb
    )
    returning id into v_event_id;
  exception
    when unique_violation then
      return null;
  end;

  return v_event_id;
end;
$$;

comment on function public.record_handoff_event(text, text, uuid, uuid, uuid, text, timestamptz, text, text, text, text, uuid, text) is
  'Track 7A.1: insert one deterministic cross-role handoff ledger row when a real role seam occurs. No-ops when users or Iron roles do not form a valid seam.';

create or replace function public.stamp_deposit_verification_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.status = 'verified' and OLD.status is distinct from NEW.status then
    if NEW.verified_at is null then
      NEW.verified_at := now();
    end if;
    if NEW.verified_by is null and auth.uid() is not null then
      NEW.verified_by := auth.uid();
    end if;
  end if;

  return NEW;
end;
$$;

create or replace function public.log_deposit_handoff_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.status = 'verified' and OLD.status is distinct from NEW.status then
    perform public.record_handoff_event(
      NEW.workspace_id,
      'deal',
      NEW.deal_id,
      NEW.created_by,
      NEW.verified_by,
      'deposit_verification',
      coalesce(NEW.verified_at, NEW.updated_at, now()),
      'deposits',
      OLD.status,
      NEW.status,
      format('deposits:%s:%s', NEW.id, NEW.status),
      null,
      null
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_deposits_stamp_verifier on public.deposits;
create trigger trg_deposits_stamp_verifier
  before update on public.deposits
  for each row
  execute function public.stamp_deposit_verification_actor();

drop trigger if exists trg_deposits_handoff_event on public.deposits;
create trigger trg_deposits_handoff_event
  after update on public.deposits
  for each row
  execute function public.log_deposit_handoff_event();

create or replace function public.stamp_trade_decision_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if OLD.status = 'manager_review'
     and NEW.status in ('approved', 'rejected')
     and NEW.status is distinct from OLD.status
     and NEW.approved_by is null
     and auth.uid() is not null then
    NEW.approved_by := auth.uid();
  end if;

  return NEW;
end;
$$;

create or replace function public.log_trade_handoff_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if OLD.status = 'manager_review'
     and NEW.status in ('approved', 'rejected')
     and NEW.status is distinct from OLD.status then
    perform public.record_handoff_event(
      NEW.workspace_id,
      'deal',
      NEW.deal_id,
      NEW.created_by,
      NEW.approved_by,
      'trade_approval',
      coalesce(NEW.updated_at, now()),
      'trade_valuations',
      OLD.status,
      NEW.status,
      format('trade_valuations:%s:%s', NEW.id, NEW.status),
      null,
      null
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_trade_valuations_stamp_approver on public.trade_valuations;
create trigger trg_trade_valuations_stamp_approver
  before update on public.trade_valuations
  for each row
  execute function public.stamp_trade_decision_actor();

drop trigger if exists trg_trade_valuations_handoff_event on public.trade_valuations;
create trigger trg_trade_valuations_handoff_event
  after update on public.trade_valuations
  for each row
  execute function public.log_trade_handoff_event();

create or replace function public.stamp_demo_decision_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if OLD.status = 'requested'
     and NEW.status in ('approved', 'denied')
     and NEW.status is distinct from OLD.status then
    if NEW.approved_by is null and auth.uid() is not null then
      NEW.approved_by := auth.uid();
    end if;
    if NEW.approved_at is null then
      NEW.approved_at := now();
    end if;
  end if;

  return NEW;
end;
$$;

create or replace function public.log_demo_handoff_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if OLD.status = 'requested'
     and NEW.status in ('approved', 'denied')
     and NEW.status is distinct from OLD.status then
    perform public.record_handoff_event(
      NEW.workspace_id,
      'deal',
      NEW.deal_id,
      NEW.requested_by,
      NEW.approved_by,
      'demo_approval',
      coalesce(NEW.approved_at, NEW.updated_at, now()),
      'demos',
      OLD.status,
      NEW.status,
      format('demos:%s:%s', NEW.id, NEW.status),
      null,
      null
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_demos_stamp_approver on public.demos;
create trigger trg_demos_stamp_approver
  before update on public.demos
  for each row
  execute function public.stamp_demo_decision_actor();

drop trigger if exists trg_demos_handoff_event on public.demos;
create trigger trg_demos_handoff_event
  after update on public.demos
  for each row
  execute function public.log_demo_handoff_event();

create or replace function public.log_deal_reassignment_handoff_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.assigned_rep_id is distinct from OLD.assigned_rep_id then
    perform public.record_handoff_event(
      NEW.workspace_id,
      'deal',
      NEW.id,
      OLD.assigned_rep_id,
      NEW.assigned_rep_id,
      'deal_reassignment',
      coalesce(NEW.updated_at, now()),
      'crm_deals',
      coalesce(OLD.assigned_rep_id::text, 'unassigned'),
      coalesce(NEW.assigned_rep_id::text, 'unassigned'),
      format(
        'crm_deals:%s:assigned_rep:%s:%s:%s',
        NEW.id,
        coalesce(OLD.assigned_rep_id::text, 'null'),
        coalesce(NEW.assigned_rep_id::text, 'null'),
        coalesce(NEW.updated_at::text, now()::text)
      ),
      null,
      NEW.name
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_crm_deals_handoff_event on public.crm_deals;
create trigger trg_crm_deals_handoff_event
  after update of assigned_rep_id on public.crm_deals
  for each row
  execute function public.log_deal_reassignment_handoff_event();

select public.record_handoff_event(
  d.workspace_id,
  'deal',
  d.deal_id,
  d.created_by,
  d.verified_by,
  'deposit_verification',
  coalesce(d.verified_at, d.updated_at, d.created_at),
  'deposits',
  'requested',
  'verified',
  format('deposits:%s:%s', d.id, d.status),
  null,
  cd.name
)
from public.deposits d
join public.crm_deals cd on cd.id = d.deal_id
where d.status = 'verified'
  and d.created_by is not null
  and d.verified_by is not null
  and coalesce(d.verified_at, d.updated_at, d.created_at) >= now() - interval '30 days';

select public.record_handoff_event(
  tv.workspace_id,
  'deal',
  tv.deal_id,
  tv.created_by,
  tv.approved_by,
  'trade_approval',
  coalesce(tv.updated_at, tv.created_at),
  'trade_valuations',
  'manager_review',
  tv.status,
  format('trade_valuations:%s:%s', tv.id, tv.status),
  null,
  cd.name
)
from public.trade_valuations tv
join public.crm_deals cd on cd.id = tv.deal_id
where tv.status in ('approved', 'rejected')
  and tv.created_by is not null
  and tv.approved_by is not null
  and coalesce(tv.updated_at, tv.created_at) >= now() - interval '30 days';

select public.record_handoff_event(
  demo.workspace_id,
  'deal',
  demo.deal_id,
  demo.requested_by,
  demo.approved_by,
  'demo_approval',
  coalesce(demo.approved_at, demo.updated_at, demo.created_at),
  'demos',
  'requested',
  demo.status,
  format('demos:%s:%s', demo.id, demo.status),
  null,
  cd.name
)
from public.demos demo
join public.crm_deals cd on cd.id = demo.deal_id
where demo.status in ('approved', 'denied')
  and demo.requested_by is not null
  and demo.approved_by is not null
  and coalesce(demo.approved_at, demo.updated_at, demo.created_at) >= now() - interval '30 days';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      perform cron.unschedule('handoff-trust-scorer-nightly');
    exception
      when others then null;
    end;

    perform cron.schedule(
      'handoff-trust-scorer-nightly',
      '15 6 * * *',
      format(
        $sql$
        select net.http_post(
          url := '%s/functions/v1/handoff-trust-scorer',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', format('Bearer %s', current_setting('app.settings.service_role_key', true))
          ),
          body := '{"source":"cron"}'::jsonb
        );
        $sql$,
        current_setting('app.settings.supabase_url', true),
        current_setting('app.settings.service_role_key', true)
      )
    );
  else
    raise notice 'Skipping handoff-trust-scorer cron: pg_cron or pg_net not available.';
  end if;
end $$;
