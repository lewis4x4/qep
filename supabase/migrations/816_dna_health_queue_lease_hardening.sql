-- Migration 816: Fix-forward DNA identity, alert dedupe, refresh leases, and
-- bounded health-score scheduling. Migration 814 is already deployed and is
-- intentionally not amended.

begin;

-- External identities are workspace-scoped and normalized. This registry is
-- the database uniqueness backstop that the global legacy profile table lacks.
create table public.customer_dna_profile_identities (
  workspace_id text not null,
  identity_type text not null check (
    identity_type in ('hubspot_contact', 'intellidealer_customer')
  ),
  normalized_identifier text not null check (
    normalized_identifier = lower(btrim(normalized_identifier))
    and normalized_identifier <> ''
  ),
  customer_profile_id uuid not null
    references public.customer_profiles_extended(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, identity_type, normalized_identifier)
);

alter table public.customer_dna_profile_identities enable row level security;

create policy "customer_dna_profile_identities_service"
  on public.customer_dna_profile_identities
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create index idx_customer_dna_profile_identities_profile
  on public.customer_dna_profile_identities (customer_profile_id);

-- Deal-history rows were originally attached only through the global profile
-- UUID. Stamp their authoritative tenant so service-client reads can enforce a
-- direct workspace predicate as a second backstop.
alter table public.customer_deal_history
  add column workspace_id text;

update public.customer_deal_history history
set workspace_id = company.workspace_id
from public.customer_profiles_extended profile
join public.crm_companies company
  on company.id = profile.crm_company_id
 and company.deleted_at is null
where history.customer_profile_id = profile.id
  and history.workspace_id is null;

with unambiguous_contact_workspaces as (
  select contact.dge_customer_profile_id as customer_profile_id,
         (array_agg(
           distinct contact.workspace_id order by contact.workspace_id
         ))[1] as workspace_id
  from public.crm_contacts contact
  where contact.dge_customer_profile_id is not null
    and contact.deleted_at is null
  group by contact.dge_customer_profile_id
  having count(distinct contact.workspace_id) = 1
)
update public.customer_deal_history history
set workspace_id = owner.workspace_id
from unambiguous_contact_workspaces owner
where history.customer_profile_id = owner.customer_profile_id
  and history.workspace_id is null;

create index idx_customer_deal_history_workspace_profile_date
  on public.customer_deal_history (
    workspace_id, customer_profile_id, deal_date desc
  );

create function public.stamp_customer_deal_history_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspaces text[];
  v_workspace_id text;
begin
  select array_agg(distinct candidate.workspace_id order by candidate.workspace_id)
  into v_workspaces
  from (
    select company.workspace_id
    from public.customer_profiles_extended profile
    join public.crm_companies company
      on company.id = profile.crm_company_id
     and company.deleted_at is null
    where profile.id = new.customer_profile_id
    union
    select contact.workspace_id
    from public.crm_contacts contact
    where contact.dge_customer_profile_id = new.customer_profile_id
      and contact.deleted_at is null
  ) candidate;
  if coalesce(cardinality(v_workspaces), 0) <> 1 then
    raise exception 'customer deal history profile lacks one authoritative workspace'
      using errcode = '23514';
  end if;
  v_workspace_id := v_workspaces[1];
  if new.workspace_id is not null and btrim(new.workspace_id) <> v_workspace_id then
    raise exception 'customer deal history workspace conflicts with profile owner'
      using errcode = '23514';
  end if;
  new.workspace_id := v_workspace_id;
  return new;
end;
$$;

create trigger stamp_customer_deal_history_workspace_trg
  before insert or update of customer_profile_id, workspace_id
  on public.customer_deal_history
  for each row execute function public.stamp_customer_deal_history_workspace();

revoke all on function public.stamp_customer_deal_history_workspace()
  from public, anon, authenticated;

-- Backfill only unambiguous workspace identities. Ambiguous legacy identity
-- collisions remain unregistered so the wrapper below fails closed when the
-- old resolver observes more than one profile.
with profile_workspaces as (
  select profile.id as customer_profile_id, company.workspace_id
  from public.customer_profiles_extended profile
  join public.crm_companies company
    on company.id = profile.crm_company_id
   and company.deleted_at is null
  union
  select profile.id, contact.workspace_id
  from public.customer_profiles_extended profile
  join public.crm_contacts contact
    on contact.dge_customer_profile_id = profile.id
   and contact.deleted_at is null
), candidates as (
  select workspace.workspace_id,
         'hubspot_contact'::text as identity_type,
         lower(btrim(profile.hubspot_contact_id)) as normalized_identifier,
         profile.id as customer_profile_id
  from public.customer_profiles_extended profile
  join profile_workspaces workspace on workspace.customer_profile_id = profile.id
  where nullif(btrim(profile.hubspot_contact_id), '') is not null
  union all
  select workspace.workspace_id,
         'intellidealer_customer'::text,
         lower(btrim(profile.intellidealer_customer_id)),
         profile.id
  from public.customer_profiles_extended profile
  join profile_workspaces workspace on workspace.customer_profile_id = profile.id
  where nullif(btrim(profile.intellidealer_customer_id), '') is not null
), unambiguous as (
  select workspace_id,
         identity_type,
         normalized_identifier,
         (array_agg(
           distinct customer_profile_id order by customer_profile_id
         ))[1] as customer_profile_id
  from candidates
  group by workspace_id, identity_type, normalized_identifier
  having count(distinct customer_profile_id) = 1
)
insert into public.customer_dna_profile_identities (
  workspace_id,
  identity_type,
  normalized_identifier,
  customer_profile_id
)
select workspace_id, identity_type, normalized_identifier, customer_profile_id
from unambiguous
on conflict do nothing;

-- Preserve migration 814's implementation as an owner-only internal helper.
alter function public.get_or_create_customer_dna_profile(text, uuid, uuid, text, text)
  rename to get_or_create_customer_dna_profile_contact_locked_814;

revoke all on function public.get_or_create_customer_dna_profile_contact_locked_814(text, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

create function public.get_or_create_customer_dna_profile(
  p_workspace_id text,
  p_contact_id uuid,
  p_existing_profile_id uuid default null,
  p_hubspot_contact_id text default null,
  p_intellidealer_customer_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id text := nullif(btrim(p_workspace_id), '');
  v_contact_hubspot text;
  v_hubspot_raw text := nullif(btrim(p_hubspot_contact_id), '');
  v_hubspot_normalized text;
  v_intellidealer_raw text := nullif(btrim(p_intellidealer_customer_id), '');
  v_intellidealer_normalized text;
  v_identity_key text;
  v_identity_profile_ids uuid[];
  v_identity_profile_id uuid;
  v_profile_id uuid;
  v_mismatches integer;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'customer DNA profile identity mutation requires service_role'
      using errcode = '42501';
  end if;
  if v_workspace_id is null or p_contact_id is null then
    raise exception 'workspace and contact are required for customer DNA profile identity mutation'
      using errcode = '22023';
  end if;

  -- Read only the identity needed to establish deterministic locks. Migration
  -- 814's helper re-reads and row-locks this contact after all identity locks.
  select contact.hubspot_contact_id
  into v_contact_hubspot
  from public.crm_contacts contact
  where contact.id = p_contact_id
    and contact.workspace_id = v_workspace_id
    and contact.deleted_at is null;
  if not found then
    raise exception 'active customer DNA contact was not found in the requested workspace'
      using errcode = 'P0002';
  end if;

  if v_hubspot_raw is not null
     and v_contact_hubspot is not null
     and lower(btrim(v_hubspot_raw)) <> lower(btrim(v_contact_hubspot)) then
    raise exception 'customer DNA HubSpot identifier conflicts with the contact'
      using errcode = '23514';
  end if;
  v_hubspot_raw := coalesce(v_contact_hubspot, v_hubspot_raw);
  v_hubspot_normalized := lower(btrim(v_hubspot_raw));
  v_intellidealer_normalized := lower(btrim(v_intellidealer_raw));

  -- All callers lock normalized external identities in lexical order before
  -- migration 814's contact-specific lock. Different contacts sharing an
  -- external identifier can no longer both create a profile.
  for v_identity_key in
    select key
    from unnest(array[
      case when v_hubspot_normalized is not null
        then 'hubspot_contact:' || v_hubspot_normalized end,
      case when v_intellidealer_normalized is not null
        then 'intellidealer_customer:' || v_intellidealer_normalized end
    ]) as identity_keys(key)
    where key is not null
    order by key
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'qep:customer-dna-external:' || v_workspace_id || ':' || v_identity_key,
        0
      )
    );
  end loop;

  select array_agg(distinct identity.customer_profile_id order by identity.customer_profile_id)
  into v_identity_profile_ids
  from public.customer_dna_profile_identities identity
  where identity.workspace_id = v_workspace_id
    and (
      (identity.identity_type = 'hubspot_contact'
        and identity.normalized_identifier = v_hubspot_normalized)
      or
      (identity.identity_type = 'intellidealer_customer'
        and identity.normalized_identifier = v_intellidealer_normalized)
    );

  if coalesce(cardinality(v_identity_profile_ids), 0) > 1 then
    raise exception 'customer DNA external identifiers map to multiple profiles'
      using errcode = '21000';
  end if;
  v_identity_profile_id := v_identity_profile_ids[1];
  if p_existing_profile_id is not null
     and v_identity_profile_id is not null
     and p_existing_profile_id <> v_identity_profile_id then
    raise exception 'customer DNA pre-resolved profile conflicts with external identity registry'
      using errcode = '23514';
  end if;

  -- Canonicalize case/whitespace variants while the normalized identity locks
  -- are held. Migration 814's original integrity checks compare raw text, so
  -- both the contact and any selected legacy profile must use the same stored
  -- representation before entering that helper.
  if v_hubspot_normalized is not null then
    update public.crm_contacts
    set hubspot_contact_id = v_hubspot_normalized,
        updated_at = now()
    where id = p_contact_id
      and workspace_id = v_workspace_id
      and deleted_at is null
      and lower(btrim(hubspot_contact_id)) = v_hubspot_normalized
      and hubspot_contact_id is distinct from v_hubspot_normalized;
  end if;
  if coalesce(v_identity_profile_id, p_existing_profile_id) is not null then
    update public.customer_profiles_extended
    set hubspot_contact_id = case
          when v_hubspot_normalized is not null
            and lower(btrim(hubspot_contact_id)) = v_hubspot_normalized
            then v_hubspot_normalized
          else hubspot_contact_id
        end,
        intellidealer_customer_id = case
          when v_intellidealer_normalized is not null
            and lower(btrim(intellidealer_customer_id)) =
              v_intellidealer_normalized
            then v_intellidealer_normalized
          else intellidealer_customer_id
        end,
        updated_at = now()
    where id = coalesce(v_identity_profile_id, p_existing_profile_id);
  end if;
  v_hubspot_raw := v_hubspot_normalized;
  v_intellidealer_raw := v_intellidealer_normalized;

  v_profile_id := public.get_or_create_customer_dna_profile_contact_locked_814(
    v_workspace_id,
    p_contact_id,
    coalesce(v_identity_profile_id, p_existing_profile_id),
    v_hubspot_raw,
    v_intellidealer_raw
  );

  if v_hubspot_normalized is not null then
    insert into public.customer_dna_profile_identities (
      workspace_id, identity_type, normalized_identifier, customer_profile_id
    ) values (
      v_workspace_id, 'hubspot_contact', v_hubspot_normalized, v_profile_id
    ) on conflict do nothing;
  end if;
  if v_intellidealer_normalized is not null then
    insert into public.customer_dna_profile_identities (
      workspace_id, identity_type, normalized_identifier, customer_profile_id
    ) values (
      v_workspace_id,
      'intellidealer_customer',
      v_intellidealer_normalized,
      v_profile_id
    ) on conflict do nothing;
  end if;

  select count(*)
  into v_mismatches
  from public.customer_dna_profile_identities identity
  where identity.workspace_id = v_workspace_id
    and (
      (identity.identity_type = 'hubspot_contact'
        and identity.normalized_identifier = v_hubspot_normalized)
      or
      (identity.identity_type = 'intellidealer_customer'
        and identity.normalized_identifier = v_intellidealer_normalized)
    )
    and identity.customer_profile_id <> v_profile_id;
  if v_mismatches > 0 then
    raise exception 'customer DNA external identity was concurrently assigned to another profile'
      using errcode = '23505';
  end if;

  return v_profile_id;
end;
$$;

comment on function public.get_or_create_customer_dna_profile(text, uuid, uuid, text, text) is
  'Service-only DNA identity wrapper. Locks normalized workspace external identities before the contact and persists their unique profile mapping.';

revoke all on function public.get_or_create_customer_dna_profile(text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.get_or_create_customer_dna_profile(text, uuid, uuid, text, text)
  to service_role;

-- Give generated alerts a non-null, stable dedupe identity. Nullable customer
-- profile IDs remain useful context but are no longer uniqueness keys.
alter table public.cross_department_alerts
  add column dedupe_entity_key text;

update public.cross_department_alerts
set dedupe_entity_key = coalesce(
  case when customer_profile_id is not null
    then 'customer_profile:' || customer_profile_id::text end,
  case when context_entity_type is not null and context_entity_id is not null
    then lower(context_entity_type) || ':' || context_entity_id::text end,
  'legacy_alert:' || id::text
);

alter table public.cross_department_alerts
  alter column dedupe_entity_key set not null;

-- Legacy nullable-key uniqueness allowed multiple pending alerts for the same
-- stable entity. Keep the oldest row pending and retain every loser as a
-- resolved audit record before enforcing the new key.
with ranked_pending as (
  select alert.id,
         row_number() over (
           partition by alert.workspace_id,
                        alert.dedupe_entity_key,
                        alert.alert_type,
                        alert.source_department
           order by alert.created_at, alert.id
         ) as duplicate_rank
  from public.cross_department_alerts alert
  where alert.status = 'pending'
)
update public.cross_department_alerts alert
set status = 'resolved',
    resolved_at = coalesce(alert.resolved_at, now()),
    resolution_notes = concat_ws(
      E'\n',
      nullif(btrim(alert.resolution_notes), ''),
      '[migration 816] Resolved duplicate pending alert after stable entity-key backfill.'
    ),
    updated_at = now()
from ranked_pending ranked
where alert.id = ranked.id
  and ranked.duplicate_rank > 1;

drop index if exists public.uq_xdept_alerts_dedup;
create unique index uq_xdept_alerts_dedup_entity
  on public.cross_department_alerts (
    workspace_id, dedupe_entity_key, alert_type, source_department
  )
  where status = 'pending';

create or replace function public.generate_cross_department_alerts(
  p_workspace_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id text := nullif(btrim(p_workspace_id), '');
  v_count integer := 0;
  v_inserted integer := 0;
  v_rec record;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'cross-department alert generation requires service_role'
      using errcode = '42501';
  end if;
  if v_workspace_id is null then
    raise exception 'workspace is required for cross-department alert generation'
      using errcode = '22023';
  end if;

  for v_rec in
    select ci.portal_customer_id,
           contact.dge_customer_profile_id as customer_profile_id,
           sum(ci.balance_due) as total_overdue,
           pc.first_name || ' ' || pc.last_name as customer_name
    from public.customer_invoices ci
    join public.portal_customers pc
      on pc.id = ci.portal_customer_id
     and pc.workspace_id = v_workspace_id
    left join public.crm_contacts contact
      on contact.id = pc.crm_contact_id
     and contact.workspace_id = v_workspace_id
     and contact.deleted_at is null
    where ci.workspace_id = v_workspace_id
      and ci.status in ('pending', 'sent', 'overdue')
      and ci.due_date < current_date - interval '60 days'
    group by ci.portal_customer_id,
             contact.dge_customer_profile_id,
             pc.first_name,
             pc.last_name
    having sum(ci.balance_due) > 0
  loop
    insert into public.cross_department_alerts (
      workspace_id, source_department, target_department, alert_type,
      severity, customer_profile_id, title, body, context_entity_type,
      context_entity_id, dedupe_entity_key
    ) values (
      v_workspace_id, 'finance', 'sales', 'overdue_ar', 'critical',
      v_rec.customer_profile_id,
      'Hold quoting: ' || v_rec.customer_name || ' has $' ||
        v_rec.total_overdue::int || ' past due',
      'Customer has invoices past 60 days. Collect outstanding balance before processing new quotes.',
      'portal_customer', v_rec.portal_customer_id,
      'portal_customer:' || v_rec.portal_customer_id::text
    ) on conflict (
      workspace_id, dedupe_entity_key, alert_type, source_department
    ) where status = 'pending' do nothing;
    get diagnostics v_inserted = row_count;
    v_count := v_count + v_inserted;
  end loop;

  for v_rec in
    select cf.id as fleet_item_id,
           cf.portal_customer_id,
           contact.dge_customer_profile_id as customer_profile_id,
           pc.first_name || ' ' || pc.last_name as customer_name,
           cf.make,
           cf.model
    from public.customer_fleet cf
    join public.portal_customers pc
      on pc.id = cf.portal_customer_id
     and pc.workspace_id = v_workspace_id
    left join public.crm_contacts contact
      on contact.id = pc.crm_contact_id
     and contact.workspace_id = v_workspace_id
     and contact.deleted_at is null
    where cf.workspace_id = v_workspace_id
      and cf.trade_in_interest = true
      and cf.is_active = true
  loop
    insert into public.cross_department_alerts (
      workspace_id, source_department, target_department, alert_type,
      severity, customer_profile_id, title, body, context_entity_type,
      context_entity_id, dedupe_entity_key
    ) values (
      v_workspace_id, 'portal', 'sales', 'trade_in_interest', 'warning',
      v_rec.customer_profile_id,
      v_rec.customer_name || ' wants to trade ' || v_rec.make || ' ' || v_rec.model,
      'Customer flagged trade-in interest via portal. Contact with valuation and replacement options.',
      'fleet_item', v_rec.fleet_item_id,
      'fleet_item:' || v_rec.fleet_item_id::text
    ) on conflict (
      workspace_id, dedupe_entity_key, alert_type, source_department
    ) where status = 'pending' do nothing;
    get diagnostics v_inserted = row_count;
    v_count := v_count + v_inserted;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.generate_cross_department_alerts(text)
  from public, anon, authenticated;
grant execute on function public.generate_cross_department_alerts(text)
  to service_role;

-- Heartbeats extend only a currently owned, unexpired DGE job lease.
create function public.renew_dge_refresh_job_lease(
  p_job_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 300
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'DGE refresh lease renewal requires service_role'
      using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_token is null then
    raise exception 'job_id and lease_token are required' using errcode = '22023';
  end if;

  update public.dge_refresh_jobs
  set lease_expires_at = now() + make_interval(
        secs => least(greatest(coalesce(p_lease_seconds, 300), 60), 900)
      ),
      updated_at = now()
  where id = p_job_id
    and status = 'running'
    and lease_token = p_lease_token
    and lease_expires_at > now()
    and deleted_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'DGE refresh renewal lease is stale or not owned'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.renew_dge_refresh_job_lease(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.renew_dge_refresh_job_lease(uuid, uuid, integer)
  to service_role;

-- Durable per-workspace health work. One daily row advances through bounded
-- score and DNA phases, retaining cursors across edge invocations.
create table public.health_score_refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  refresh_on date not null,
  snapshot_at timestamptz not null default now(),
  status text not null default 'queued' check (
    status in ('queued', 'running', 'succeeded', 'failed')
  ),
  phase text not null default 'scores' check (phase in ('scores', 'dna')),
  score_cursor_updated_at timestamptz,
  score_cursor_id uuid,
  dna_cursor_id uuid,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  failure_count integer not null default 0,
  last_error text,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, refresh_on)
);

alter table public.health_score_refresh_jobs enable row level security;
create policy "health_score_refresh_jobs_service"
  on public.health_score_refresh_jobs
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create index idx_health_score_refresh_jobs_claim
  on public.health_score_refresh_jobs (available_at, refresh_on, workspace_id)
  where status in ('queued', 'running');

create function public.enqueue_health_score_refresh_jobs(
  p_refresh_on date default current_date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'health refresh enqueue requires service_role'
      using errcode = '42501';
  end if;

  insert into public.health_score_refresh_jobs (workspace_id, refresh_on)
  select candidate.workspace_id, coalesce(p_refresh_on, current_date)
  from (
    select profile.active_workspace_id as workspace_id
    from public.profiles profile
    where nullif(btrim(profile.active_workspace_id), '') is not null
    union
    select company.workspace_id
    from public.crm_companies company
    where company.deleted_at is null
      and nullif(btrim(company.workspace_id), '') is not null
  ) candidate
  on conflict (workspace_id, refresh_on) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create function public.claim_health_score_refresh_jobs(
  p_limit integer default 2,
  p_lease_seconds integer default 300
)
returns table (
  job_id uuid,
  workspace_id text,
  snapshot_at timestamptz,
  phase text,
  score_cursor_updated_at timestamptz,
  score_cursor_id uuid,
  dna_cursor_id uuid,
  attempt_count integer,
  failure_count integer,
  lease_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'health refresh claim requires service_role'
      using errcode = '42501';
  end if;

  return query
  with candidates as (
    select job.id
    from public.health_score_refresh_jobs job
    where job.available_at <= now()
      and (
        job.status = 'queued'
        or (
          job.status = 'running'
          and job.lease_expires_at is not null
          and job.lease_expires_at <= now()
        )
      )
    order by job.available_at, job.refresh_on, job.workspace_id, job.id
    limit least(greatest(coalesce(p_limit, 2), 1), 10)
    for update skip locked
  ), claimed as (
    update public.health_score_refresh_jobs job
    set status = 'running',
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(
          secs => least(greatest(coalesce(p_lease_seconds, 300), 60), 900)
        ),
        attempt_count = job.attempt_count + 1,
        last_error = null,
        updated_at = now()
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select claimed.id,
         claimed.workspace_id,
         claimed.snapshot_at,
         claimed.phase,
         claimed.score_cursor_updated_at,
         claimed.score_cursor_id,
         claimed.dna_cursor_id,
         claimed.attempt_count,
         claimed.failure_count,
         claimed.lease_token
  from claimed
  order by claimed.workspace_id, claimed.id;
end;
$$;

create function public.complete_health_score_refresh_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_status text,
  p_phase text,
  p_score_cursor_updated_at timestamptz default null,
  p_score_cursor_id uuid default null,
  p_dna_cursor_id uuid default null,
  p_last_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'health refresh completion requires service_role'
      using errcode = '42501';
  end if;
  if p_status not in ('queued', 'succeeded', 'failed')
     or p_phase not in ('scores', 'dna') then
    raise exception 'invalid health refresh completion state'
      using errcode = '22023';
  end if;

  update public.health_score_refresh_jobs
  set status = p_status,
      phase = p_phase,
      score_cursor_updated_at = p_score_cursor_updated_at,
      score_cursor_id = p_score_cursor_id,
      dna_cursor_id = p_dna_cursor_id,
      available_at = case when p_status = 'queued'
        then now() + interval '30 seconds' else available_at end,
      lease_token = null,
      lease_expires_at = null,
      last_error = p_last_error,
      failure_count = case
        when p_last_error is not null then failure_count + 1
        else 0
      end,
      finished_at = case when p_status in ('succeeded', 'failed')
        then now() else null end,
      updated_at = now()
  where id = p_job_id
    and status = 'running'
    and lease_token = p_lease_token
    and lease_expires_at > now();
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'health refresh completion lease is stale or not owned'
      using errcode = 'P0002';
  end if;
end;
$$;

create function public.list_customer_health_profiles_page(
  p_workspace_id text,
  p_snapshot_at timestamptz,
  p_after_updated_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 21
)
returns table (
  id uuid,
  crm_company_id uuid,
  health_score numeric,
  customer_name text,
  health_score_updated_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_workspace_id text := nullif(btrim(p_workspace_id), '');
  v_limit integer := least(greatest(coalesce(p_limit, 21), 1), 100);
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'workspace health profile page requires service_role'
      using errcode = '42501';
  end if;
  if v_workspace_id is null or p_snapshot_at is null then
    raise exception 'workspace and snapshot are required for health profile page'
      using errcode = '22023';
  end if;

  return query
  select profile.id,
         profile.crm_company_id,
         profile.health_score,
         profile.customer_name,
         profile.health_score_updated_at
  from public.customer_profiles_extended profile
  where (
    (
      profile.crm_company_id is not null
      and exists (
        select 1 from public.crm_companies company
        where company.id = profile.crm_company_id
          and company.workspace_id = v_workspace_id
          and company.deleted_at is null
      )
    ) or (
      profile.crm_company_id is null
      and exists (
        select 1 from public.crm_contacts contact
        where contact.dge_customer_profile_id = profile.id
          and contact.workspace_id = v_workspace_id
          and contact.deleted_at is null
      )
      and not exists (
        select 1 from public.crm_contacts contact_other
        where contact_other.dge_customer_profile_id = profile.id
          and contact_other.workspace_id <> v_workspace_id
          and contact_other.deleted_at is null
      )
    )
  )
    and coalesce(profile.health_score_updated_at, '-infinity'::timestamptz)
      < p_snapshot_at
    and (
      p_after_id is null
      or (
        coalesce(profile.health_score_updated_at, '-infinity'::timestamptz),
        profile.id
      ) > (
        coalesce(p_after_updated_at, '-infinity'::timestamptz),
        p_after_id
      )
    )
  order by coalesce(profile.health_score_updated_at, '-infinity'::timestamptz),
           profile.id
  limit v_limit;
end;
$$;

create index if not exists idx_customer_profiles_health_stale_page
  on public.customer_profiles_extended (
    coalesce(health_score_updated_at, '-infinity'::timestamptz), id
  );

-- Hot-path support for the activity EXISTS probes below. Partial predicates
-- keep the indexes small while matching the exact tenant/company/time access
-- pattern used by every health continuation slice.
create index if not exists idx_parts_orders_health_dna_activity
  on public.parts_orders (workspace_id, crm_company_id, created_at desc)
  where crm_company_id is not null;

create index if not exists idx_customer_invoices_health_dna_activity
  on public.customer_invoices (workspace_id, crm_company_id, created_at desc)
  where crm_company_id is not null;

-- crm_deals is a security_invoker view over qrm_deals; indexes must land on
-- the physical table (same fix-forward lesson as m814 / crm_contacts).
create index if not exists idx_qrm_deals_health_dna_activity
  on public.qrm_deals (workspace_id, company_id, updated_at desc)
  where company_id is not null and deleted_at is null;

create index if not exists idx_rental_contracts_health_dna_company
  on public.rental_contracts (workspace_id, qrm_company_id, id)
  where qrm_company_id is not null;

create index if not exists idx_rental_invoices_health_dna_activity
  on public.rental_invoices (
    workspace_id, rental_contract_id, created_at desc
  )
  where deleted_at is null;

-- Keyset-page active DNA profiles entirely in SQL. EXISTS predicates preserve
-- the complete workspace activity set without application-side 500-row or
-- 200-company truncation, and the snapshot bound makes continuation stable.
create function public.list_active_customer_dna_profiles_page(
  p_workspace_id text,
  p_snapshot_at timestamptz,
  p_after_id uuid default null,
  p_limit integer default 6
)
returns table (id uuid)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_workspace_id text := nullif(btrim(p_workspace_id), '');
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 100);
  v_since timestamptz;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'workspace active DNA profile page requires service_role'
      using errcode = '42501';
  end if;
  if v_workspace_id is null or p_snapshot_at is null then
    raise exception 'workspace and snapshot are required for active DNA profile page'
      using errcode = '22023';
  end if;
  v_since := p_snapshot_at - interval '36 hours';

  return query
  select profile.id
  from public.customer_profiles_extended profile
  join public.crm_companies company
    on company.id = profile.crm_company_id
   and company.workspace_id = v_workspace_id
   and company.deleted_at is null
  where (p_after_id is null or profile.id > p_after_id)
    and (
      exists (
        select 1
        from public.parts_orders parts_order
        where parts_order.workspace_id = v_workspace_id
          and parts_order.crm_company_id = profile.crm_company_id
          and parts_order.created_at > v_since
          and parts_order.created_at <= p_snapshot_at
      )
      or exists (
        select 1
        from public.customer_invoices invoice
        where invoice.workspace_id = v_workspace_id
          and invoice.crm_company_id = profile.crm_company_id
          and invoice.created_at > v_since
          and invoice.created_at <= p_snapshot_at
      )
      or exists (
        select 1
        from public.qrm_deals deal
        where deal.workspace_id = v_workspace_id
          and deal.company_id = profile.crm_company_id
          and deal.updated_at > v_since
          and deal.updated_at <= p_snapshot_at
          and deal.deleted_at is null
      )
      or exists (
        select 1
        from public.rental_invoices rental_invoice
        join public.rental_contracts rental_contract
          on rental_contract.id = rental_invoice.rental_contract_id
         and rental_contract.workspace_id = v_workspace_id
         and rental_contract.qrm_company_id = profile.crm_company_id
        where rental_invoice.workspace_id = v_workspace_id
          and rental_invoice.created_at > v_since
          and rental_invoice.created_at <= p_snapshot_at
          and rental_invoice.deleted_at is null
      )
    )
  order by profile.id
  limit v_limit;
end;
$$;

revoke all on function public.enqueue_health_score_refresh_jobs(date)
  from public, anon, authenticated;
revoke all on function public.claim_health_score_refresh_jobs(integer, integer)
  from public, anon, authenticated;
revoke all on function public.complete_health_score_refresh_job(uuid, uuid, text, text, timestamptz, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.list_customer_health_profiles_page(text, timestamptz, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.list_active_customer_dna_profiles_page(text, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_health_score_refresh_jobs(date)
  to service_role;
grant execute on function public.claim_health_score_refresh_jobs(integer, integer)
  to service_role;
grant execute on function public.complete_health_score_refresh_job(uuid, uuid, text, text, timestamptz, uuid, uuid, text)
  to service_role;
grant execute on function public.list_customer_health_profiles_page(text, timestamptz, timestamptz, uuid, integer)
  to service_role;
grant execute on function public.list_active_customer_dna_profiles_page(text, timestamptz, uuid, integer)
  to service_role;

-- A frequent bounded worker invocation drains the durable daily queue. Calling
-- enqueue repeatedly is idempotent because workspace/date is unique.
--
-- Use the vault internal-service-secret pattern (N5.1 / m787-m788). Managed
-- Supabase does not expose the legacy app-settings service-role / URL GUCs,
-- so the m221 bearer cron path never authenticates in production.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'Skipping health-score-refresh cron: pg_cron/pg_net unavailable.';
    return;
  end if;

  if not exists (
    select 1 from vault.decrypted_secrets where name = 'INTERNAL_SERVICE_SECRET'
  ) then
    raise notice
      'Skipping health-score-refresh cron: INTERNAL_SERVICE_SECRET not in vault.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'health-score-refresh') then
    perform cron.unschedule('health-score-refresh');
  end if;

  perform cron.schedule(
    'health-score-refresh',
    '* * * * *',
    $cron$
    select net.http_post(
      url := 'https://iciddijgonywtxoelous.supabase.co/functions/v1/health-score-refresh',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-service-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'INTERNAL_SERVICE_SECRET'
        )
      ),
      body := '{"source":"cron"}'::jsonb
    );
    $cron$
  );
exception
  when others then
    raise notice 'health-score-refresh cron registration failed: %', sqlerrm;
end $$;

commit;
