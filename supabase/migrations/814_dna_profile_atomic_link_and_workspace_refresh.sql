-- Migration 814: Customer-DNA profile identity integrity.
--
-- A profile row and its CRM contact link previously used two independent
-- PostgREST writes. Concurrent first refreshes could create duplicate profiles,
-- while a failed contact update could leave an unowned global profile behind.
-- This service-only RPC serializes on the workspace/contact identity and keeps
-- resolve, create, backfill, and link in one database transaction.

begin;

create or replace function public.get_or_create_customer_dna_profile(
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
  v_workspace_id text := nullif(trim(p_workspace_id), '');
  v_contact public.crm_contacts%rowtype;
  v_profile public.customer_profiles_extended%rowtype;
  v_profile_id uuid;
  v_candidate_ids uuid[];
  v_company_name text;
  v_rows integer;
  v_hubspot_contact_id text := nullif(trim(p_hubspot_contact_id), '');
  v_intellidealer_customer_id text := nullif(trim(p_intellidealer_customer_id), '');
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'customer DNA profile identity mutation requires service_role'
      using errcode = '42501';
  end if;
  if v_workspace_id is null or p_contact_id is null then
    raise exception 'workspace and contact are required for customer DNA profile identity mutation'
      using errcode = '22023';
  end if;

  -- Every caller takes locks in this order. The transaction advisory lock
  -- serializes two first-refresh requests before either can observe/create a
  -- profile; the row lock then protects the durable contact link.
  perform pg_advisory_xact_lock(
    hashtextextended('qep:customer-dna-profile:' || v_workspace_id || ':' || p_contact_id::text, 0)
  );

  select c.*
  into v_contact
  from public.crm_contacts c
  where c.id = p_contact_id
    and c.workspace_id = v_workspace_id
    and c.deleted_at is null
  for update;

  if not found then
    raise exception 'active customer DNA contact was not found in the requested workspace'
      using errcode = 'P0002';
  end if;

  if v_contact.primary_company_id is not null then
    select c.name
    into v_company_name
    from public.crm_companies c
    where c.id = v_contact.primary_company_id
      and c.workspace_id = v_workspace_id
      and c.deleted_at is null;
    if not found then
      raise exception 'customer DNA contact company is outside the requested workspace'
        using errcode = '42501';
    end if;
  end if;

  if v_hubspot_contact_id is not null
     and v_contact.hubspot_contact_id is not null
     and v_hubspot_contact_id is distinct from v_contact.hubspot_contact_id then
    raise exception 'customer DNA HubSpot identifier conflicts with the locked contact'
      using errcode = '23514';
  end if;
  v_hubspot_contact_id := coalesce(v_hubspot_contact_id, v_contact.hubspot_contact_id);

  -- A link created by a concurrent request is authoritative, but a caller that
  -- supplied a different pre-resolved profile must not be silently redirected.
  if v_contact.dge_customer_profile_id is not null then
    if p_existing_profile_id is not null
       and p_existing_profile_id is distinct from v_contact.dge_customer_profile_id then
      raise exception 'customer DNA contact link conflicts with the requested profile'
        using errcode = '23514';
    end if;
    v_profile_id := v_contact.dge_customer_profile_id;
  elsif p_existing_profile_id is not null then
    v_profile_id := p_existing_profile_id;
  else
    -- Re-resolve under the lock. This closes the stale-read window between the
    -- edge resolver and this transaction, including identifier-based profiles
    -- already anchored to the same workspace.
    select array_agg(distinct p.id order by p.id)
    into v_candidate_ids
    from public.customer_profiles_extended p
    where (
        (v_hubspot_contact_id is not null and p.hubspot_contact_id = v_hubspot_contact_id)
        or
        (v_intellidealer_customer_id is not null
          and p.intellidealer_customer_id = v_intellidealer_customer_id)
      )
      and (
        (
          p.crm_company_id is not null
          and exists (
            select 1
            from public.crm_companies company
            where company.id = p.crm_company_id
              and company.workspace_id = v_workspace_id
              and company.deleted_at is null
          )
        )
        or
        (
          p.crm_company_id is null
          and exists (
            select 1
            from public.crm_contacts linked
            where linked.dge_customer_profile_id = p.id
              and linked.workspace_id = v_workspace_id
              and linked.deleted_at is null
          )
          and not exists (
            select 1
            from public.crm_contacts linked_other
            where linked_other.dge_customer_profile_id = p.id
              and linked_other.workspace_id <> v_workspace_id
              and linked_other.deleted_at is null
          )
        )
      );

    if coalesce(cardinality(v_candidate_ids), 0) > 1 then
      raise exception 'customer DNA identifiers resolve to multiple profiles in the requested workspace'
        using errcode = '21000';
    end if;
    v_profile_id := v_candidate_ids[1];
  end if;

  if v_profile_id is not null then
    select p.*
    into v_profile
    from public.customer_profiles_extended p
    where p.id = v_profile_id
      and (
        (
          p.crm_company_id is not null
          and exists (
            select 1
            from public.crm_companies company
            where company.id = p.crm_company_id
              and company.workspace_id = v_workspace_id
              and company.deleted_at is null
          )
        )
        or
        (
          p.crm_company_id is null
          and (
            p.id = v_contact.dge_customer_profile_id
            or exists (
              select 1
              from public.crm_contacts linked
              where linked.dge_customer_profile_id = p.id
                and linked.workspace_id = v_workspace_id
                and linked.deleted_at is null
            )
          )
          and not exists (
            select 1
            from public.crm_contacts linked_other
            where linked_other.dge_customer_profile_id = p.id
              and linked_other.workspace_id <> v_workspace_id
              and linked_other.deleted_at is null
          )
        )
      )
    for update;

    if not found then
      raise exception 'customer DNA profile is outside the requested workspace'
        using errcode = '42501';
    end if;
    if v_profile.hubspot_contact_id is not null
       and v_hubspot_contact_id is not null
       and v_profile.hubspot_contact_id is distinct from v_hubspot_contact_id then
      raise exception 'customer DNA profile HubSpot identity conflicts with the requested identity'
        using errcode = '23514';
    end if;
    if v_profile.intellidealer_customer_id is not null
       and v_intellidealer_customer_id is not null
       and v_profile.intellidealer_customer_id is distinct from v_intellidealer_customer_id then
      raise exception 'customer DNA profile IntelliDealer identity conflicts with the requested identity'
        using errcode = '23514';
    end if;
    if v_contact.primary_company_id is null
       and v_profile.crm_company_id is not null then
      raise exception 'companyless customer DNA contacts cannot adopt company-anchored profiles'
        using errcode = '23514';
    end if;
    if v_profile.crm_company_id is not null
       and v_contact.primary_company_id is not null
       and v_profile.crm_company_id is distinct from v_contact.primary_company_id then
      raise exception 'customer DNA profile and contact have conflicting company anchors'
        using errcode = '23514';
    end if;

    update public.customer_profiles_extended
    set hubspot_contact_id = coalesce(hubspot_contact_id, v_hubspot_contact_id),
        intellidealer_customer_id = coalesce(
          intellidealer_customer_id,
          v_intellidealer_customer_id
        ),
        crm_company_id = coalesce(crm_company_id, v_contact.primary_company_id),
        company_name = coalesce(company_name, v_company_name),
        updated_at = now()
    where id = v_profile_id
      and (
        (hubspot_contact_id is null and v_hubspot_contact_id is not null)
        or (intellidealer_customer_id is null and v_intellidealer_customer_id is not null)
        or (crm_company_id is null and v_contact.primary_company_id is not null)
        or (company_name is null and v_company_name is not null)
      );
  else
    insert into public.customer_profiles_extended (
      hubspot_contact_id,
      intellidealer_customer_id,
      customer_name,
      company_name,
      crm_company_id,
      metadata
    ) values (
      v_hubspot_contact_id,
      v_intellidealer_customer_id,
      trim(coalesce(nullif(trim(v_contact.first_name), ''), 'Unknown') || ' ' ||
        coalesce(nullif(trim(v_contact.last_name), ''), 'Customer')),
      v_company_name,
      v_contact.primary_company_id,
      jsonb_build_object(
        'data_badges', jsonb_build_array('DEMO'),
        'persona_reasoning', 'Profile created from partial identifiers.'
      )
    )
    returning id into v_profile_id;
  end if;

  if v_contact.dge_customer_profile_id is null then
    update public.crm_contacts
    set dge_customer_profile_id = v_profile_id,
        updated_at = now()
    where id = v_contact.id
      and workspace_id = v_workspace_id
      and deleted_at is null
      and dge_customer_profile_id is null;
    get diagnostics v_rows = row_count;
  else
    v_rows := 1;
  end if;
  if v_rows <> 1 then
    -- Any exception rolls the profile insert/backfill back with this failed
    -- link, so an unowned global profile cannot escape the transaction.
    raise exception 'customer DNA contact link changed during profile mutation'
      using errcode = '40001';
  end if;

  return v_profile_id;
end;
$$;

comment on function public.get_or_create_customer_dna_profile(text, uuid, uuid, text, text) is
  'Service-only atomic customer-DNA identity mutation. Serializes by workspace/contact, validates company tenancy, reuses or creates one profile, and links the contact in the same transaction.';

revoke all on function public.get_or_create_customer_dna_profile(text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.get_or_create_customer_dna_profile(text, uuid, uuid, text, text)
  to service_role;

create index if not exists idx_customer_profiles_extended_crm_company
  on public.customer_profiles_extended (crm_company_id)
  where crm_company_id is not null;

-- crm_contacts is a simple, writable view over qrm_contacts in production but
-- remains a table in some local/test schemas. Index the physical relation that
-- actually stores the contact anchors so view-backed deployments stay valid.
do $$
declare
  v_crm_contacts_kind "char";
  v_qrm_contacts_kind "char";
begin
  select relation.relkind
  into v_crm_contacts_kind
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'crm_contacts';

  if v_crm_contacts_kind in ('r', 'p') then
    execute 'create index if not exists idx_crm_contacts_workspace_dna_profile_active
      on public.crm_contacts (workspace_id, dge_customer_profile_id)
      where dge_customer_profile_id is not null and deleted_at is null';
    return;
  end if;

  if v_crm_contacts_kind = 'v' then
    select relation.relkind
    into v_qrm_contacts_kind
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'qrm_contacts';

    if v_qrm_contacts_kind in ('r', 'p') then
      execute 'create index if not exists idx_qrm_contacts_workspace_dna_profile_active
        on public.qrm_contacts (workspace_id, dge_customer_profile_id)
        where dge_customer_profile_id is not null and deleted_at is null';
      return;
    end if;
  end if;

  raise exception 'crm_contacts is not an indexable table or a supported qrm_contacts-backed view';
end $$;

-- customer_profiles_extended has no workspace_id column. Replace its original
-- role-only policies with authoritative company/contact anchor predicates.
create or replace function public.customer_profile_visible_in_current_workspace(
  p_profile_id uuid
)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id text;
begin
  if coalesce((select auth.role()), '') <> 'authenticated'
     or v_user_id is null then
    return false;
  end if;

  select nullif(trim(profile.active_workspace_id), '')
  into v_workspace_id
  from public.profiles profile
  where profile.id = v_user_id;
  if v_workspace_id is null then return false; end if;

  return exists (
    select 1
    from public.customer_profiles_extended profile
    where profile.id = p_profile_id
      and (
        (
          profile.crm_company_id is not null
          and exists (
            select 1
            from public.crm_companies company
            where company.id = profile.crm_company_id
              and company.workspace_id = v_workspace_id
              and company.deleted_at is null
          )
        )
        or
        (
          profile.crm_company_id is null
          and exists (
            select 1
            from public.crm_contacts contact
            where contact.dge_customer_profile_id = profile.id
              and contact.workspace_id = v_workspace_id
              and contact.deleted_at is null
          )
          and not exists (
            select 1
            from public.crm_contacts contact_other
            where contact_other.dge_customer_profile_id = profile.id
              and contact_other.workspace_id <> v_workspace_id
              and contact_other.deleted_at is null
          )
        )
      )
  );
end;
$$;

revoke all on function public.customer_profile_visible_in_current_workspace(uuid)
  from public, anon;
grant execute on function public.customer_profile_visible_in_current_workspace(uuid)
  to authenticated, service_role;

drop policy if exists "customer_profiles_ext_select" on public.customer_profiles_extended;
drop policy if exists "customer_profiles_ext_insert" on public.customer_profiles_extended;
drop policy if exists "customer_profiles_ext_update" on public.customer_profiles_extended;
drop policy if exists "customer_profiles_ext_service" on public.customer_profiles_extended;
drop policy if exists "customer_profiles_ext_select_workspace" on public.customer_profiles_extended;

create policy "customer_profiles_ext_select_workspace"
  on public.customer_profiles_extended
  for select
  to authenticated
  using (
    (select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner')
    and public.customer_profile_visible_in_current_workspace(id)
  );

create policy "customer_profiles_ext_service"
  on public.customer_profiles_extended
  for all
  to service_role
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

revoke all on table public.customer_profiles_extended from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.customer_profiles_extended from authenticated;
grant select on table public.customer_profiles_extended to authenticated;
grant select, insert, update, delete on table public.customer_profiles_extended to service_role;

-- Health scores are written through workspace-validated service paths only.
revoke execute on function public.compute_customer_health_score(uuid)
  from public, anon, authenticated;
grant execute on function public.compute_customer_health_score(uuid)
  to service_role;

-- The application already enqueues with an admin client. Remove the old
-- authenticated definer surface, validate requested_by against current profile
-- truth, and stamp reserved payload fields from authoritative parameters.
drop policy if exists "dge_refresh_jobs_insert_workspace" on public.dge_refresh_jobs;
revoke insert, update, delete on table public.dge_refresh_jobs from authenticated;

create or replace function public.enqueue_dge_refresh_job(
  p_workspace_id text,
  p_job_type text,
  p_dedupe_key text,
  p_request_payload jsonb default '{}'::jsonb,
  p_requested_by uuid default null,
  p_priority integer default 100
)
returns table (
  job_id uuid,
  job_status text,
  enqueued boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.dge_refresh_jobs%rowtype;
  v_workspace_id text := nullif(trim(p_workspace_id), '');
  v_job_type text := lower(nullif(trim(p_job_type), ''));
  v_dedupe_key text := lower(nullif(trim(p_dedupe_key), ''));
  v_payload jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'DGE refresh enqueue requires service_role'
      using errcode = '42501';
  end if;
  if v_workspace_id is null then
    raise exception 'workspace_id is required' using errcode = '22023';
  end if;
  if v_job_type not in (
    'customer_profile_refresh',
    'market_valuation_refresh',
    'economic_sync_refresh'
  ) then
    raise exception 'unsupported job_type: %', p_job_type using errcode = '22023';
  end if;
  if v_dedupe_key is null then
    raise exception 'dedupe_key is required' using errcode = '22023';
  end if;
  if p_request_payload is not null
     and jsonb_typeof(p_request_payload) <> 'object' then
    raise exception 'request_payload must be a JSON object' using errcode = '22023';
  end if;
  if p_requested_by is not null
     and not exists (
       select 1
       from public.profiles profile
       where profile.id = p_requested_by
         and profile.active_workspace_id = v_workspace_id
     ) then
    raise exception 'requested_by is not active in the requested workspace'
      using errcode = '42501';
  end if;

  v_payload :=
    (coalesce(p_request_payload, '{}'::jsonb)
      - 'workspace_id' - 'requested_by' - 'job_type' - 'dedupe_key')
    || jsonb_build_object(
      'workspace_id', v_workspace_id,
      'job_type', v_job_type,
      'dedupe_key', v_dedupe_key
    )
    || case
      when p_requested_by is null then '{}'::jsonb
      else jsonb_build_object('requested_by', p_requested_by)
    end;

  perform pg_advisory_xact_lock(
    hashtext(v_workspace_id),
    hashtext(v_dedupe_key)
  );

  select *
  into v_job
  from public.dge_refresh_jobs
  where workspace_id = v_workspace_id
    and dedupe_key = v_dedupe_key
    and status in ('queued', 'running')
    and deleted_at is null
  order by created_at desc
  limit 1
  for update;

  if found then
    return query select v_job.id, v_job.status, false;
    return;
  end if;

  insert into public.dge_refresh_jobs (
    workspace_id,
    job_type,
    dedupe_key,
    status,
    priority,
    request_payload,
    requested_by
  ) values (
    v_workspace_id,
    v_job_type,
    v_dedupe_key,
    'queued',
    least(greatest(coalesce(p_priority, 100), 1), 1000),
    v_payload,
    p_requested_by
  )
  returning * into v_job;

  return query select v_job.id, v_job.status, true;
end;
$$;

revoke all on function public.enqueue_dge_refresh_job(text, text, text, jsonb, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_dge_refresh_job(text, text, text, jsonb, uuid, integer)
  to service_role;

revoke all on function public.claim_dge_refresh_job(integer)
  from public, anon, authenticated, service_role;
drop function public.claim_dge_refresh_job(integer);

create function public.claim_dge_refresh_job(
  p_lease_seconds integer default 60
)
returns table (
  job_id uuid,
  workspace_id text,
  job_type text,
  dedupe_key text,
  request_payload jsonb,
  attempt_count integer,
  lease_token uuid,
  requested_by uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.dge_refresh_jobs%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'DGE refresh claim requires service_role'
      using errcode = '42501';
  end if;

  with candidate as (
    select id
    from public.dge_refresh_jobs
    where deleted_at is null
      and (
        status = 'queued'
        or (
          status = 'running'
          and lease_expires_at is not null
          and lease_expires_at <= now()
        )
      )
    order by priority asc, created_at asc, id asc
    limit 1
    for update skip locked
  )
  update public.dge_refresh_jobs job
  set status = 'running',
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(
        secs => least(greatest(coalesce(p_lease_seconds, 60), 15), 900)
      ),
      started_at = coalesce(job.started_at, now()),
      attempt_count = job.attempt_count + 1,
      last_error = null
  from candidate
  where job.id = candidate.id
  returning job.* into v_job;

  if not found then return; end if;

  return query
  select v_job.id,
         v_job.workspace_id,
         v_job.job_type,
         v_job.dedupe_key,
         v_job.request_payload,
         v_job.attempt_count,
         v_job.lease_token,
         v_job.requested_by;
end;
$$;

revoke all on function public.claim_dge_refresh_job(integer)
  from public, anon, authenticated;
grant execute on function public.claim_dge_refresh_job(integer) to service_role;

revoke all on function public.complete_dge_refresh_job(uuid, text, jsonb, text)
  from public, anon, authenticated, service_role;
drop function public.complete_dge_refresh_job(uuid, text, jsonb, text);

create function public.complete_dge_refresh_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_status text,
  p_result_payload jsonb default '{}'::jsonb,
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
    raise exception 'DGE refresh completion requires service_role'
      using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_token is null then
    raise exception 'job_id and lease_token are required' using errcode = '22023';
  end if;
  if p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'terminal status required' using errcode = '22023';
  end if;

  update public.dge_refresh_jobs
  set status = p_status,
      result_payload = coalesce(p_result_payload, '{}'::jsonb),
      last_error = p_last_error,
      finished_at = now(),
      lease_token = null,
      lease_expires_at = null
  where id = p_job_id
    and status = 'running'
    and lease_token = p_lease_token
    and lease_expires_at > now()
    and deleted_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'DGE refresh completion lease is stale or does not own the running job'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.complete_dge_refresh_job(uuid, uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.complete_dge_refresh_job(uuid, uuid, text, jsonb, text)
  to service_role;

create or replace function public.list_health_score_refresh_workspaces()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'health workspace discovery requires service_role'
      using errcode = '42501';
  end if;

  return (
    select coalesce(
      jsonb_agg(candidate.workspace_id order by candidate.workspace_id),
      '[]'::jsonb
    )
    from (
      select profile.active_workspace_id as workspace_id
      from public.profiles profile
      where profile.active_workspace_id is not null
        and trim(profile.active_workspace_id) <> ''
      union
      select company.workspace_id
      from public.crm_companies company
      where company.deleted_at is null
        and trim(company.workspace_id) <> ''
    ) candidate
  );
end;
$$;

revoke all on function public.list_health_score_refresh_workspaces()
  from public, anon, authenticated;
grant execute on function public.list_health_score_refresh_workspaces()
  to service_role;

create or replace function public.list_customer_health_profiles_for_workspace(
  p_workspace_id text,
  p_order text default 'stale_asc',
  p_limit integer default 200
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
  v_workspace_id text := nullif(trim(p_workspace_id), '');
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'workspace health profile listing requires service_role'
      using errcode = '42501';
  end if;
  if v_workspace_id is null then
    raise exception 'workspace is required for health profile listing'
      using errcode = '22023';
  end if;
  if p_order not in ('score_desc', 'stale_asc') then
    raise exception 'unsupported health profile order'
      using errcode = '22023';
  end if;

  if p_order = 'score_desc' then
    return query
    select profile.id,
           profile.crm_company_id,
           profile.health_score,
           profile.customer_name,
           profile.health_score_updated_at
    from public.customer_profiles_extended profile
    where (
      profile.crm_company_id is not null
      and exists (
        select 1
        from public.crm_companies company
        where company.id = profile.crm_company_id
          and company.workspace_id = v_workspace_id
          and company.deleted_at is null
      )
    ) or (
      profile.crm_company_id is null
      and exists (
        select 1
        from public.crm_contacts contact
        where contact.dge_customer_profile_id = profile.id
          and contact.workspace_id = v_workspace_id
          and contact.deleted_at is null
      )
      and not exists (
        select 1
        from public.crm_contacts contact_other
        where contact_other.dge_customer_profile_id = profile.id
          and contact_other.workspace_id <> v_workspace_id
          and contact_other.deleted_at is null
      )
    )
    order by profile.health_score desc nulls last, profile.id
    limit v_limit;
  else
    return query
    select profile.id,
           profile.crm_company_id,
           profile.health_score,
           profile.customer_name,
           profile.health_score_updated_at
    from public.customer_profiles_extended profile
    where (
      profile.crm_company_id is not null
      and exists (
        select 1
        from public.crm_companies company
        where company.id = profile.crm_company_id
          and company.workspace_id = v_workspace_id
          and company.deleted_at is null
      )
    ) or (
      profile.crm_company_id is null
      and exists (
        select 1
        from public.crm_contacts contact
        where contact.dge_customer_profile_id = profile.id
          and contact.workspace_id = v_workspace_id
          and contact.deleted_at is null
      )
      and not exists (
        select 1
        from public.crm_contacts contact_other
        where contact_other.dge_customer_profile_id = profile.id
          and contact_other.workspace_id <> v_workspace_id
          and contact_other.deleted_at is null
      )
    )
    order by profile.health_score_updated_at asc nulls first, profile.id
    limit v_limit;
  end if;
end;
$$;

comment on function public.list_customer_health_profiles_for_workspace(text, text, integer) is
  'Service-only tenant resolver for health-score GET/POST. Company anchors are authoritative; active contact links admit only legacy unanchored profiles.';

revoke all on function public.list_customer_health_profiles_for_workspace(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.list_customer_health_profiles_for_workspace(text, text, integer)
  to service_role;

-- health-score-refresh invokes this RPC after selecting one explicit tenant.
-- The original trade-interest arm omitted its workspace predicate and could
-- copy another tenant's customer signal into the requested tenant's alert
-- queue. Keep both source arms tenant-bound inside the security-definer RPC.
create or replace function public.generate_cross_department_alerts(
  p_workspace_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id text := nullif(trim(p_workspace_id), '');
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
           pc.crm_contact_id,
           sum(ci.balance_due) as total_overdue,
           pc.first_name || ' ' || pc.last_name as customer_name
    from public.customer_invoices ci
    join public.portal_customers pc
      on pc.id = ci.portal_customer_id
     and pc.workspace_id = v_workspace_id
    where ci.workspace_id = v_workspace_id
      and ci.status in ('pending', 'sent', 'overdue')
      and ci.due_date < current_date - interval '60 days'
    group by ci.portal_customer_id, pc.crm_contact_id, pc.first_name, pc.last_name
    having sum(ci.balance_due) > 0
  loop
    insert into public.cross_department_alerts (
      workspace_id,
      source_department,
      target_department,
      alert_type,
      severity,
      title,
      body,
      context_entity_type
    ) values (
      v_workspace_id,
      'finance',
      'sales',
      'overdue_ar',
      'critical',
      'Hold quoting: ' || v_rec.customer_name || ' has $' || v_rec.total_overdue::int || ' past due',
      'Customer has invoices past 60 days. Collect outstanding balance before processing new quotes.',
      'invoice'
    ) on conflict (
      workspace_id,
      customer_profile_id,
      alert_type,
      source_department
    ) where status = 'pending' do nothing;
    get diagnostics v_inserted = row_count;
    v_count := v_count + v_inserted;
  end loop;

  for v_rec in
    select cf.portal_customer_id,
           pc.first_name || ' ' || pc.last_name as customer_name,
           cf.make,
           cf.model
    from public.customer_fleet cf
    join public.portal_customers pc
      on pc.id = cf.portal_customer_id
     and pc.workspace_id = v_workspace_id
    where cf.workspace_id = v_workspace_id
      and cf.trade_in_interest = true
      and cf.is_active = true
  loop
    insert into public.cross_department_alerts (
      workspace_id,
      source_department,
      target_department,
      alert_type,
      severity,
      title,
      body,
      context_entity_type
    ) values (
      v_workspace_id,
      'portal',
      'sales',
      'trade_in_interest',
      'warning',
      v_rec.customer_name || ' wants to trade ' || v_rec.make || ' ' || v_rec.model,
      'Customer flagged trade-in interest via portal. Contact with valuation and replacement options.',
      'fleet_item'
    ) on conflict (
      workspace_id,
      customer_profile_id,
      alert_type,
      source_department
    ) where status = 'pending' do nothing;
    get diagnostics v_inserted = row_count;
    v_count := v_count + v_inserted;
  end loop;

  return v_count;
end;
$$;

comment on function public.generate_cross_department_alerts(text) is
  'Service-only workspace-scoped health refresh alert generation. Both AR and trade-interest source reads are tenant-bound.';

revoke all on function public.generate_cross_department_alerts(text)
  from public, anon, authenticated;
grant execute on function public.generate_cross_department_alerts(text)
  to service_role;

commit;
