-- 832_service_owner_controls_and_grapple_release_evidence.sql
--
-- Places the remaining answered Service controls from SV7, SV11-SV12,
-- SV17, and SV20 without inventing the still-missing roster or retail rates.

begin;

-- ---------------------------------------------------------------------------
-- 1. SV7: the exact five owner-named hold reasons.
-- ---------------------------------------------------------------------------

alter table public.service_job_blockers
  drop constraint if exists service_job_blockers_hold_state_chk;

create or replace function public.service_normalize_hold_state(p_blocker_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  with normalized as (
    select lower(regexp_replace(trim(coalesce(p_blocker_type, '')), '[^a-z0-9]+', '_', 'g')) as value
  )
  select case
    when value in (
      'waiting_on_parts',
      'waiting_on_customer_approval',
      'waiting_on_warranty_authorization',
      'waiting_on_sublet',
      'waiting_on_payment_deposit'
    ) then value
    when value = 'waiting_on_parts_sublet'
      or value in ('waiting_parts', 'parts_shortage', 'parts_pending')
      or value like '%part%'
      then 'waiting_on_parts'
    when value in (
      'waiting_on_sublet', 'waiting_sublet', 'sublet', 'waiting_vendor',
      'vendor_wait', 'vendor', 'po_wait', 'waiting_po'
    ) or value like '%sublet%'
      or value like '%vendor%'
      or value like '%purchase_order%'
      or value like 'po\_%' escape '\'
      then 'waiting_on_sublet'
    when value in (
      'waiting_on_warranty_authorization', 'waiting_warranty_authorization',
      'warranty_authorization', 'warranty_auth', 'waiting_warranty',
      'warranty', 'oem_authorization', 'manufacturer_authorization'
    ) or value like '%warranty%'
      or value like '%oem%'
      or value like '%manufacturer%'
      then 'waiting_on_warranty_authorization'
    when value in (
      'waiting_on_customer_approval', 'waiting_on_approval',
      'waiting_approval', 'approval', 'authorization',
      'waiting_authorization', 'estimate_approval', 'customer_approval',
      'waiting_customer_approval', 'waiting_on_customer', 'waiting_customer',
      'customer', 'client', 'waiting_client', 'waiting_on_client', 'other'
    ) or value like '%approval%'
      or value like '%authorization%'
      or value like '%authorisation%'
      or value like '%estimate%'
      or value like '%customer%'
      or value like '%client%'
      then 'waiting_on_customer_approval'
    when value in (
      'waiting_on_payment_deposit', 'waiting_on_payment', 'waiting_payment',
      'payment', 'deposit', 'invoice_payment', 'ar_hold', 'accounts_receivable'
    ) or value like '%payment%'
      or value like '%deposit%'
      or value like '%invoice%'
      or value like '%receivable%'
      or value like '%billing%'
      then 'waiting_on_payment_deposit'
    else null
  end
  from normalized;
$$;

with mapped as (
  select
    b.id,
    b.blocker_type as original_type,
    case
      when b.blocker_type = 'waiting_on_parts_sublet'
       and coalesce(b.description, '') ~* '(sublet|vendor|purchase order|\mPO\M)'
        then 'waiting_on_sublet'
      else coalesce(
        public.service_normalize_hold_state(b.blocker_type),
        'waiting_on_customer_approval'
      )
    end as exact_type
  from public.service_job_blockers b
  where b.blocker_type not in (
    'waiting_on_parts',
    'waiting_on_customer_approval',
    'waiting_on_warranty_authorization',
    'waiting_on_sublet',
    'waiting_on_payment_deposit'
  )
)
update public.service_job_blockers b
set
  blocker_type = mapped.exact_type,
  description = nullif(trim(concat(
    '[Pre-SV7 hold: ', mapped.original_type, '] ', coalesce(b.description, '')
  )), '')
from mapped
where b.id = mapped.id;

alter table public.service_job_blockers
  add constraint service_job_blockers_hold_state_chk
  check (blocker_type in (
    'waiting_on_parts',
    'waiting_on_customer_approval',
    'waiting_on_warranty_authorization',
    'waiting_on_sublet',
    'waiting_on_payment_deposit'
  ));

comment on column public.service_job_blockers.blocker_type is
  'SV7 exact hold reason: parts, customer approval, warranty authorization, sublet, or payment/deposit.';

create or replace view public.v_service_job_hold_durations
  with (security_invoker = true) as
select
  b.workspace_id,
  b.id as blocker_id,
  b.job_id as service_job_id,
  b.blocker_type as hold_state,
  b.description,
  b.created_by,
  b.resolved_by,
  b.created_at as hold_started_at,
  b.resolved_at as hold_resolved_at,
  (b.resolved_at is null) as is_open,
  round((
    extract(epoch from (
      greatest(coalesce(b.resolved_at, now()), b.created_at) - b.created_at
    )) / 3600.0
  )::numeric, 4) as hold_duration_hours,
  b.hold_duration_seconds
from public.service_job_blockers b
where b.blocker_type in (
  'waiting_on_parts',
  'waiting_on_customer_approval',
  'waiting_on_warranty_authorization',
  'waiting_on_sublet',
  'waiting_on_payment_deposit'
);

-- ---------------------------------------------------------------------------
-- 2. SV11-SV12: Driver is a verified Service role with evidence, not an
--    incidental technician assignment. The unanswered roster is not seeded.
-- ---------------------------------------------------------------------------

create table public.service_driver_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  home_branch_id uuid references public.branches(id) on delete set null,
  license_class text,
  license_expires_on date,
  dot_medical_expires_on date,
  qualifications jsonb not null default '[]'::jsonb,
  vendor_logins_verified boolean not null default false,
  tenure_start_on date,
  work_restrictions text,
  is_dispatchable boolean not null default false,
  roster_verified_by uuid references public.profiles(id) on delete restrict,
  roster_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, profile_id),
  check (jsonb_typeof(qualifications) = 'array'),
  check ((roster_verified_at is null) = (roster_verified_by is null)),
  check (not is_dispatchable or roster_verified_at is not null)
);

comment on table public.service_driver_profiles is
  'SV11 dedicated Service Driver roster/qualification profile. No rows are guessed from technician assignments; the Service Manager must verify the supplied roster.';

create or replace function public.service_validate_driver_profile_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_verification_changed boolean := false;
begin
  if not exists (
    select 1
    from public.profiles p
    join public.profile_workspaces pw
      on pw.profile_id = p.id
     and pw.workspace_id = new.workspace_id
    where p.id = new.profile_id
      and p.is_active
  ) then
    raise exception 'Service Driver profile must reference an active member of its workspace';
  end if;

  if new.home_branch_id is not null and not exists (
    select 1
    from public.branches b
    where b.id = new.home_branch_id
      and b.workspace_id = new.workspace_id
      and b.deleted_at is null
  ) then
    raise exception 'Service Driver home branch must belong to the driver workspace';
  end if;

  if tg_op = 'INSERT' then
    v_verification_changed := new.roster_verified_by is not null
      or new.roster_verified_at is not null;
  else
    v_verification_changed := new.roster_verified_by is distinct from old.roster_verified_by
      or new.roster_verified_at is distinct from old.roster_verified_at
      or (
        new.roster_verified_by is not null
        and (
          new.workspace_id is distinct from old.workspace_id
          or new.profile_id is distinct from old.profile_id
          or (new.is_dispatchable and not old.is_dispatchable)
        )
      );
  end if;

  if v_verification_changed and new.roster_verified_by is not null then
    if (select auth.role()) is distinct from 'service_role' then
      if new.roster_verified_by is distinct from (select auth.uid()) then
        raise exception 'Service Driver verification must be attributed to the authenticated verifier';
      end if;
      new.roster_verified_at := now();
    else
      new.roster_verified_at := coalesce(new.roster_verified_at, now());
    end if;
  end if;

  if new.roster_verified_by is not null and not exists (
    select 1
    from public.profiles verifier
    join public.profile_workspaces pw
      on pw.profile_id = verifier.id
     and pw.workspace_id = new.workspace_id
    where verifier.id = new.roster_verified_by
      and verifier.is_active
      and verifier.role::text in ('admin', 'manager', 'owner')
  ) then
    raise exception 'Service Driver verifier must be an active manager in the driver workspace';
  end if;

  return new;
end;
$$;

create trigger service_driver_profiles_validate_provenance
  before insert or update of
    workspace_id, profile_id, home_branch_id, roster_verified_by,
    roster_verified_at, is_dispatchable
  on public.service_driver_profiles
  for each row execute function public.service_validate_driver_profile_provenance();

revoke all on function public.service_validate_driver_profile_provenance()
  from public, anon, authenticated, service_role;

alter table public.service_driver_profiles enable row level security;
alter table public.service_driver_profiles force row level security;

create policy "service_driver_profiles_workspace_read"
  on public.service_driver_profiles for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      profile_id = (select auth.uid())
      or coalesce((select public.get_my_role())::text, '') in (
        'service_writer', 'dispatch', 'admin', 'manager', 'owner'
      )
    )
  );

create policy "service_driver_profiles_manager_write"
  on public.service_driver_profiles for all
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
  );

create policy "service_driver_profiles_service_all"
  on public.service_driver_profiles for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

alter table public.traffic_tickets
  add column if not exists service_driver_profile_id uuid
    references public.service_driver_profiles(id) on delete restrict;

create index if not exists idx_traffic_tickets_service_driver_profile
  on public.traffic_tickets (service_driver_profile_id)
  where service_driver_profile_id is not null;

create or replace function public.service_validate_driver_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver public.service_driver_profiles;
begin
  if new.driver_id is null then
    new.service_driver_profile_id := null;
    return new;
  end if;

  -- service_driver_profile_id is derived evidence. Resolve it from the source
  -- driver on every assignment so a driver-only reassignment cannot retain the
  -- previous driver's profile id and callers never have to clear it manually.
  select d.* into v_driver
  from public.service_driver_profiles d
  join public.profiles p
    on p.id = d.profile_id
   and p.is_active
  join public.profile_workspaces pw
    on pw.profile_id = d.profile_id
   and pw.workspace_id = d.workspace_id
  where d.workspace_id = new.workspace_id
    and d.profile_id = new.driver_id
    and d.is_dispatchable
    and d.roster_verified_at is not null;

  if v_driver.id is null then
    raise exception 'driver assignment requires a verified dispatchable Service Driver profile';
  end if;
  new.service_driver_profile_id := v_driver.id;
  return new;
end;
$$;

create trigger traffic_tickets_service_driver_assignment
  before insert or update of workspace_id, driver_id, service_driver_profile_id
  on public.traffic_tickets
  for each row execute function public.service_validate_driver_assignment();

revoke all on function public.service_validate_driver_assignment()
  from public, anon, authenticated, service_role;

create table public.service_driver_accountability_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  traffic_ticket_id uuid not null references public.traffic_tickets(id) on delete restrict,
  service_driver_profile_id uuid not null references public.service_driver_profiles(id) on delete restrict,
  event_type text not null check (event_type in (
    'departure', 'arrival', 'customer_handoff', 'delivery_confirmation',
    'condition_before', 'condition_after', 'fuel_log', 'dot_log',
    'delay_exception'
  )),
  occurred_at timestamptz not null,
  mileage numeric(12, 2),
  duration_minutes integer,
  notes text,
  evidence jsonb not null default '{}'::jsonb,
  recorded_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  check (mileage is null or mileage >= 0),
  check (duration_minutes is null or duration_minutes >= 0),
  check (not (evidence ? 'route' or evidence ? 'route_geometry' or evidence ? 'breadcrumbs'))
);

comment on table public.service_driver_accountability_events is
  'SV12 append-only mileage/time/handoff/condition/fuel/DOT/exception evidence. Route taken is intentionally prohibited.';

create index idx_service_driver_events_workspace_ticket_time
  on public.service_driver_accountability_events (
    workspace_id, traffic_ticket_id, occurred_at desc
  );
create index idx_service_driver_events_workspace_driver_time
  on public.service_driver_accountability_events (
    workspace_id, service_driver_profile_id, occurred_at desc
  );

create or replace function public.service_driver_event_sync_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket record;
begin
  select tt.workspace_id, tt.service_driver_profile_id into v_ticket
  from public.traffic_tickets tt
  where tt.id = new.traffic_ticket_id;
  if not found or v_ticket.service_driver_profile_id is null then
    raise exception 'driver evidence requires an assigned Service Driver ticket';
  end if;
  if new.service_driver_profile_id is distinct from v_ticket.service_driver_profile_id then
    raise exception 'driver evidence profile must match the ticket assignment';
  end if;
  if new.recorded_by is null or not exists (
    select 1
    from public.profiles p
    join public.profile_workspaces pw
      on pw.profile_id = p.id
     and pw.workspace_id = v_ticket.workspace_id
    where p.id = new.recorded_by
      and p.is_active
  ) then
    raise exception 'driver evidence recorder must be an active member of the ticket workspace';
  end if;
  if (select auth.role()) is distinct from 'service_role'
     and new.recorded_by is distinct from (select auth.uid()) then
    raise exception 'driver evidence must be attributed to the authenticated recorder';
  end if;
  new.workspace_id := v_ticket.workspace_id;
  return new;
end;
$$;

create trigger service_driver_event_sync_assignment
  before insert on public.service_driver_accountability_events
  for each row execute function public.service_driver_event_sync_assignment();

create or replace function public.service_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'service evidence rows are append-only';
end;
$$;

create trigger service_driver_events_append_only
  before update or delete on public.service_driver_accountability_events
  for each row execute function public.service_append_only_guard();

alter table public.service_driver_accountability_events enable row level security;
alter table public.service_driver_accountability_events force row level security;

create policy "service_driver_events_workspace_read"
  on public.service_driver_accountability_events for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      exists (
        select 1
        from public.service_driver_profiles d
        where d.id = service_driver_profile_id
          and d.workspace_id = service_driver_accountability_events.workspace_id
          and d.profile_id = (select auth.uid())
      )
      or coalesce((select public.get_my_role())::text, '') in (
        'service_writer', 'dispatch', 'admin', 'manager', 'owner'
      )
    )
  );

create policy "service_driver_events_operations_insert"
  on public.service_driver_accountability_events for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'dispatch', 'service_writer', 'admin', 'manager', 'owner'
    )
  );

create policy "service_driver_events_service_insert"
  on public.service_driver_accountability_events for insert
  with check ((select auth.role()) = 'service_role');

create policy "service_driver_events_service_read"
  on public.service_driver_accountability_events for select
  using ((select auth.role()) = 'service_role');

grant select on public.service_driver_profiles to authenticated, service_role;
grant insert, update, delete on public.service_driver_profiles to authenticated, service_role;
grant select, insert on public.service_driver_accountability_events to authenticated, service_role;
revoke update, delete, truncate on public.service_driver_accountability_events
  from public, anon, authenticated, service_role;
revoke all on function public.service_driver_event_sync_assignment()
  from public, anon, authenticated, service_role;
revoke all on function public.service_append_only_guard()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. SV17: manual mileage remains zero-blocking, but every value is visible in
--    a review queue and decisions are append-only.
-- ---------------------------------------------------------------------------

create table public.service_manual_mileage_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  source_entity text not null check (source_entity in ('service_job', 'traffic_ticket')),
  source_id uuid not null,
  mileage numeric(12, 2) not null check (mileage > 0),
  decision text not null check (decision in ('approved', 'rejected')),
  review_note text not null check (length(trim(review_note)) >= 5),
  reviewed_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  source_snapshot jsonb not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

comment on table public.service_manual_mileage_reviews is
  'SV17 immutable manager review evidence for zero-blocking manual field/haul mileage.';

create index idx_service_manual_mileage_reviews_source
  on public.service_manual_mileage_reviews (
    workspace_id, source_entity, source_id, mileage, reviewed_at desc, id
  );

create trigger service_manual_mileage_reviews_append_only
  before update or delete on public.service_manual_mileage_reviews
  for each row execute function public.service_append_only_guard();

alter table public.service_manual_mileage_reviews enable row level security;
alter table public.service_manual_mileage_reviews force row level security;

create policy "service_manual_mileage_reviews_workspace_read"
  on public.service_manual_mileage_reviews for select
  using (workspace_id = (select public.get_my_workspace()));

create policy "service_manual_mileage_reviews_service_read"
  on public.service_manual_mileage_reviews for select
  using ((select auth.role()) = 'service_role');

create or replace function public.review_manual_service_mileage(
  p_workspace_id text,
  p_source_entity text,
  p_source_id uuid,
  p_decision text,
  p_review_note text,
  p_idempotency_key text,
  p_reviewer_id uuid
)
returns public.service_manual_mileage_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mileage numeric;
  v_snapshot jsonb;
  v_review public.service_manual_mileage_reviews;
  v_reviewer_id uuid;
  v_review_note text := trim(coalesce(p_review_note, ''));
  v_idempotency_key text := trim(coalesce(p_idempotency_key, ''));
begin
  if (select auth.role()) = 'service_role' then
    v_reviewer_id := p_reviewer_id;
  else
    v_reviewer_id := (select auth.uid());
    if p_workspace_id is distinct from public.get_my_workspace()
       or p_reviewer_id is distinct from v_reviewer_id then
      raise exception 'manual mileage review must be attributed to the authenticated reviewer';
    end if;
  end if;

  if v_reviewer_id is null or not exists (
    select 1
    from public.profiles p
    join public.profile_workspaces pw
      on pw.profile_id = p.id
     and pw.workspace_id = p_workspace_id
    where p.id = v_reviewer_id
      and p.is_active
      and p.role::text in ('admin', 'manager', 'owner')
  ) then
    raise exception 'manual mileage review requires an active manager in the source workspace';
  end if;

  if p_decision is null
     or p_decision not in ('approved', 'rejected')
     or length(v_review_note) < 5
     or nullif(v_idempotency_key, '') is null then
    raise exception 'manual mileage review requires decision, note, and idempotency key';
  end if;

  -- Resolve an existing request before consulting mutable mileage state. Exact
  -- retries return their immutable review; a reused key with changed caller
  -- evidence never masquerades as success.
  select * into v_review
  from public.service_manual_mileage_reviews r
  where r.workspace_id = p_workspace_id
    and r.idempotency_key = v_idempotency_key
  for update;

  if found then
    if v_review.source_entity is distinct from p_source_entity
       or v_review.source_id is distinct from p_source_id
       or v_review.decision is distinct from p_decision
       or v_review.review_note is distinct from v_review_note
       or v_review.reviewed_by is distinct from v_reviewer_id then
      raise exception 'manual mileage idempotency key belongs to a different review';
    end if;
    return v_review;
  end if;

  if p_source_entity = 'service_job' then
    select j.field_mileage_miles, jsonb_build_object(
      'source', j.field_mileage_source,
      'recorded_at', j.field_mileage_recorded_at,
      'provider', j.field_mileage_provider,
      'metadata', j.field_mileage_metadata
    ) into v_mileage, v_snapshot
    from public.service_jobs j
    where j.id = p_source_id
      and j.workspace_id = p_workspace_id
      and j.deleted_at is null
      and j.field_mileage_source = 'manual';
  elsif p_source_entity = 'traffic_ticket' then
    select tt.mileage_one_way, jsonb_build_object(
      'source', tt.mileage_source,
      'round_trip_miles', tt.round_trip_miles,
      'metadata', tt.mileage_metadata
    ) into v_mileage, v_snapshot
    from public.traffic_tickets tt
    where tt.id = p_source_id
      and tt.workspace_id = p_workspace_id
      and tt.mileage_source = 'manual';
  else
    raise exception 'manual mileage source entity is invalid';
  end if;

  if coalesce(v_mileage, 0) <= 0 then
    raise exception 'manual mileage source is missing, non-manual, or has no positive mileage';
  end if;

  insert into public.service_manual_mileage_reviews (
    workspace_id, source_entity, source_id, mileage, decision, review_note,
    reviewed_by, source_snapshot, idempotency_key
  ) values (
    p_workspace_id, p_source_entity, p_source_id, v_mileage, p_decision,
    v_review_note, v_reviewer_id, v_snapshot, v_idempotency_key
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning * into v_review;

  if v_review.id is null then
    select * into v_review
    from public.service_manual_mileage_reviews r
    where r.workspace_id = p_workspace_id
      and r.idempotency_key = v_idempotency_key
    for update;
    if v_review.source_entity is distinct from p_source_entity
       or v_review.source_id is distinct from p_source_id
       or v_review.decision is distinct from p_decision
       or v_review.review_note is distinct from v_review_note
       or v_review.reviewed_by is distinct from v_reviewer_id
       or v_review.mileage is distinct from v_mileage
       or v_review.source_snapshot is distinct from v_snapshot then
      raise exception 'manual mileage idempotency key belongs to a different review';
    end if;
  end if;
  return v_review;
end;
$$;

create or replace view public.v_service_manual_mileage_review_queue
  with (security_invoker = true) as
with sources as (
  select
    j.workspace_id,
    'service_job'::text as source_entity,
    j.id as source_id,
    j.field_mileage_miles as mileage,
    j.field_mileage_recorded_at as recorded_at
  from public.service_jobs j
  where j.deleted_at is null
    and j.field_mileage_source = 'manual'
    and coalesce(j.field_mileage_miles, 0) > 0

  union all

  select
    tt.workspace_id,
    'traffic_ticket'::text,
    tt.id,
    tt.mileage_one_way,
    tt.created_at
  from public.traffic_tickets tt
  where tt.mileage_source = 'manual'
    and coalesce(tt.mileage_one_way, 0) > 0
)
select
  s.*,
  coalesce(latest.decision, 'pending_review') as review_status,
  latest.review_note,
  latest.reviewed_by,
  latest.reviewed_at
from sources s
left join lateral (
  select r.*
  from public.service_manual_mileage_reviews r
  where r.workspace_id = s.workspace_id
    and r.source_entity = s.source_entity
    and r.source_id = s.source_id
    and r.mileage = s.mileage
  order by r.reviewed_at desc, r.id desc
  limit 1
) latest on true;

revoke insert, update, delete, truncate on public.service_manual_mileage_reviews
  from public, anon, authenticated, service_role;
grant select on public.service_manual_mileage_reviews to authenticated, service_role;
grant select on public.v_service_manual_mileage_review_queue to authenticated, service_role;
revoke all on function public.review_manual_service_mileage(text, text, uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.review_manual_service_mileage(text, text, uuid, text, text, text, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. SV20: supplemental release evidence and Service Manager approval. The
--    existing signed/pass Lead QC gate remains required as a separate control.
-- ---------------------------------------------------------------------------

create table public.grapple_build_service_manager_releases (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  build_id uuid not null references public.grapple_builds(id) on delete restrict,
  final_qc_checklist_id uuid not null references public.grapple_build_final_qc_checklists(id) on delete restrict,
  service_manager_id uuid not null references public.profiles(id) on delete restrict,
  completed_build_sheet_reference text not null,
  test_run_documentation jsonb not null,
  serial_component_records jsonb not null,
  finished_unit_photos jsonb not null,
  signoff_statement text not null,
  signed_at timestamptz not null default now(),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  check (length(trim(completed_build_sheet_reference)) >= 3),
  check (jsonb_typeof(test_run_documentation) in ('object', 'array')),
  check (test_run_documentation not in ('{}'::jsonb, '[]'::jsonb)),
  check (jsonb_typeof(serial_component_records) in ('object', 'array')),
  check (serial_component_records not in ('{}'::jsonb, '[]'::jsonb)),
  check (jsonb_typeof(finished_unit_photos) = 'array'),
  check (jsonb_array_length(finished_unit_photos) > 0),
  check (length(trim(signoff_statement)) >= 10)
);

comment on table public.grapple_build_service_manager_releases is
  'SV20 immutable Service Manager release approval with build sheet, test run, serial/component, and finished-unit photo evidence.';

create index idx_grapple_manager_releases_build_qc
  on public.grapple_build_service_manager_releases (
    workspace_id, build_id, final_qc_checklist_id, signed_at desc, id
  );

create trigger grapple_manager_releases_append_only
  before update or delete on public.grapple_build_service_manager_releases
  for each row execute function public.service_append_only_guard();

alter table public.grapple_build_service_manager_releases enable row level security;
alter table public.grapple_build_service_manager_releases force row level security;

create policy "grapple_manager_releases_workspace_read"
  on public.grapple_build_service_manager_releases for select
  using (workspace_id = (select public.get_my_workspace()));

create policy "grapple_manager_releases_service_read"
  on public.grapple_build_service_manager_releases for select
  using ((select auth.role()) = 'service_role');

create or replace function public.record_grapple_build_service_manager_release(
  p_workspace_id text,
  p_build_id uuid,
  p_final_qc_checklist_id uuid,
  p_service_manager_id uuid,
  p_completed_build_sheet_reference text,
  p_test_run_documentation jsonb,
  p_serial_component_records jsonb,
  p_finished_unit_photos jsonb,
  p_signoff_statement text,
  p_idempotency_key text
)
returns public.grapple_build_service_manager_releases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_release public.grapple_build_service_manager_releases;
begin
  if (select auth.role()) = 'service_role' then
    v_actor_id := p_service_manager_id;
  else
    v_actor_id := (select auth.uid());
    if p_workspace_id is distinct from public.get_my_workspace()
       or p_service_manager_id is distinct from v_actor_id
       or coalesce((select public.get_my_role())::text, '') not in ('admin', 'manager', 'owner') then
      raise exception 'grapple release requires the signing Service Manager in the build workspace';
    end if;
  end if;

  if v_actor_id is null or not exists (
    select 1
    from public.profiles p
    join public.profile_workspaces pw
      on pw.profile_id = p.id
     and pw.workspace_id = p_workspace_id
    where p.id = v_actor_id
      and p.is_active
      and p.role::text in ('admin', 'manager', 'owner')
  ) then
    raise exception 'active Service Manager profile is required';
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'grapple release requires a nonblank idempotency key';
  end if;

  if not exists (
    select 1
    from public.grapple_builds b
    join public.grapple_build_final_qc_checklists c
      on c.id = p_final_qc_checklist_id
     and c.build_id = b.id
     and c.workspace_id = b.workspace_id
     and c.deleted_at is null
     and c.status = 'signed'
     and c.overall_result = 'pass'
    where b.id = p_build_id
      and b.workspace_id = p_workspace_id
      and b.deleted_at is null
  ) then
    raise exception 'Service Manager release requires the build signed/pass final QC checklist';
  end if;

  insert into public.grapple_build_service_manager_releases (
    workspace_id, build_id, final_qc_checklist_id, service_manager_id,
    completed_build_sheet_reference, test_run_documentation,
    serial_component_records, finished_unit_photos, signoff_statement,
    idempotency_key
  ) values (
    p_workspace_id, p_build_id, p_final_qc_checklist_id, v_actor_id,
    trim(p_completed_build_sheet_reference), p_test_run_documentation,
    p_serial_component_records, p_finished_unit_photos,
    trim(p_signoff_statement), trim(p_idempotency_key)
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning * into v_release;

  if v_release.id is null then
    select * into v_release
    from public.grapple_build_service_manager_releases r
    where r.workspace_id = p_workspace_id
      and r.idempotency_key = trim(p_idempotency_key);
    if v_release.build_id is distinct from p_build_id
       or v_release.final_qc_checklist_id is distinct from p_final_qc_checklist_id
       or v_release.service_manager_id is distinct from v_actor_id
       or v_release.completed_build_sheet_reference is distinct from trim(p_completed_build_sheet_reference)
       or v_release.test_run_documentation is distinct from p_test_run_documentation
       or v_release.serial_component_records is distinct from p_serial_component_records
       or v_release.finished_unit_photos is distinct from p_finished_unit_photos
       or v_release.signoff_statement is distinct from trim(p_signoff_statement) then
      raise exception 'grapple release idempotency key belongs to different evidence';
    end if;
  end if;
  return v_release;
end;
$$;

create or replace function public.grapple_build_service_manager_release_gate(p_build_id uuid)
returns table (ok boolean, code text, reason text, missing jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_build record;
  v_checklist record;
  v_release record;
begin
  select b.id, b.workspace_id into v_build
  from public.grapple_builds b
  where b.id = p_build_id and b.deleted_at is null;
  if not found or (
    (select auth.role()) is distinct from 'service_role'
    and v_build.workspace_id is distinct from public.get_my_workspace()
  ) then
    return query select false, 'grapple_build_not_found',
      'Grapple build not found for Service Manager release gate.',
      jsonb_build_array(jsonb_build_object('scope', 'build', 'field', 'id'));
    return;
  end if;

  select c.id into v_checklist
  from public.grapple_build_final_qc_checklists c
  where c.build_id = p_build_id
    and c.workspace_id = v_build.workspace_id
    and c.deleted_at is null
    and c.status = 'signed'
    and c.overall_result = 'pass'
  order by c.lead_signed_at desc, c.id desc
  limit 1;

  if v_checklist.id is null then
    return query select false, 'final_qc_not_signed',
      'A signed/pass final QC checklist is required before Service Manager release.',
      jsonb_build_array(jsonb_build_object('scope', 'final_qc', 'field', 'status'));
    return;
  end if;

  select r.id into v_release
  from public.grapple_build_service_manager_releases r
  where r.workspace_id = v_build.workspace_id
    and r.build_id = p_build_id
    and r.final_qc_checklist_id = v_checklist.id
  order by r.signed_at desc, r.id desc
  limit 1;

  if v_release.id is null then
    return query select false, 'service_manager_evidence_missing',
      'Service Manager signoff with build sheet, test run, serial/component records, and finished-unit photos is required.',
      jsonb_build_array(
        jsonb_build_object('scope', 'release', 'field', 'service_manager_signoff'),
        jsonb_build_object('scope', 'release', 'field', 'completed_build_sheet'),
        jsonb_build_object('scope', 'release', 'field', 'test_run_documentation'),
        jsonb_build_object('scope', 'release', 'field', 'serial_component_records'),
        jsonb_build_object('scope', 'release', 'field', 'finished_unit_photos')
      );
    return;
  end if;

  return query select true, 'service_manager_release_ready',
    'Service Manager release evidence is complete.', '[]'::jsonb;
end;
$$;

create or replace function public.enforce_grapple_service_manager_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate record;
begin
  if new.production_stage = 'production_complete'
     and (
       tg_op = 'INSERT'
       or old.production_stage is distinct from new.production_stage
       or old.status is distinct from new.status
     ) then
    select * into v_gate
    from public.grapple_build_service_manager_release_gate(new.id)
    limit 1;
    if v_gate.ok is not true then
      raise exception using
        errcode = 'P0001',
        message = v_gate.reason,
        detail = v_gate.code;
    end if;
  end if;
  return new;
end;
$$;

create trigger zz_grapple_service_manager_release_gate
  before insert or update of production_stage, status
  on public.grapple_builds
  for each row execute function public.enforce_grapple_service_manager_release();

revoke insert, update, delete, truncate on public.grapple_build_service_manager_releases
  from public, anon, authenticated, service_role;
grant select on public.grapple_build_service_manager_releases to authenticated, service_role;
revoke all on function public.record_grapple_build_service_manager_release(
  text, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.record_grapple_build_service_manager_release(
  text, uuid, uuid, uuid, text, jsonb, jsonb, jsonb, text, text
) to authenticated, service_role;
revoke all on function public.grapple_build_service_manager_release_gate(uuid)
  from public, anon;
grant execute on function public.grapple_build_service_manager_release_gate(uuid)
  to authenticated, service_role;
revoke all on function public.enforce_grapple_service_manager_release()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Reconcile roadmap/Linear source truth with concrete implementation.
-- ---------------------------------------------------------------------------

update public.qep_roadmap_tasks
set
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''),
    'supabase/migrations/832_service_owner_controls_and_grapple_release_evidence.sql'),
  notes = coalesce(notes, '') || case task_id
    when 'H4.1' then E'\n[2026-07-20] SV7 correction: hold vocabulary is now exactly parts, customer approval, warranty authorization, sublet, and payment/deposit; combined legacy holds preserve provenance.'
    when 'H7.1' then E'\n[2026-07-20] SV11-SV12 backend control ready: haul assignment requires a verified dedicated Service Driver profile and append-only accountability evidence. Named-driver operation remains blocked until the Service Manager supplies and verifies the roster; no roster rows are inferred.'
    when 'H15.1' then E'\n[2026-07-20] SV17 backend control ready: manual mileage remains zero-blocking and is available through an immutable manager review queue/RPC. Manager-facing review UI remains follow-on work.'
    when 'I6.1' then E'\n[2026-07-20] SV20 backend gate ready: production release additionally requires Service Manager signoff plus build-sheet, function-test, serial/component, and finished-photo evidence. Staff evidence-capture UI remains follow-on work.'
    else ''
  end,
  updated_at = now()
where task_id in ('H4.1', 'H7.1', 'H15.1', 'I6.1');

insert into public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
select
  'reconcile',
  task_id,
  'update',
  jsonb_build_object(
    'reason', 'service_owner_answer_controls_2026_07_20',
    'migration', '832_service_owner_controls_and_grapple_release_evidence.sql',
    'implementation_state', case task_id
      when 'H7.1' then 'backend_ready_roster_required'
      when 'H15.1' then 'backend_ready_review_ui_follow_on'
      when 'I6.1' then 'backend_ready_capture_ui_follow_on'
      else 'backend_ready'
    end,
    'mission_alignment', 'pass: owner-defined service holds, driver accountability, reviewable zero-blocking mileage, and evidence-gated grapple release become auditable operating controls'
  ),
  'codex'
from (values ('H4.1'), ('H7.1'), ('H15.1'), ('I6.1')) v(task_id);

commit;

-- Rollback / fix-forward notes:
--   Revoke execute on driver, mileage-review, and grapple-release mutation RPCs
--   before disabling these controls. Preserve assignment events, manager
--   reviews, evidence rows, and release attestations. Reopen work with a later
--   auditable status transition; never delete provenance or bypass the final
--   Service Manager evidence gate.
