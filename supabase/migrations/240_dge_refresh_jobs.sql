-- DGE refresh queue for snapshot-first runtime hardening.
-- Adds a workspace-scoped deferred refresh queue plus helper RPCs for
-- enqueue, claim, and completion flows.
--
-- Rollback DDL is documented at the bottom.

create table if not exists public.dge_refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  job_type text not null check (
    job_type in (
      'customer_profile_refresh',
      'market_valuation_refresh',
      'economic_sync_refresh'
    )
  ),
  dedupe_key text not null,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  priority integer not null default 100,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  requested_by uuid references public.profiles(id) on delete set null,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.dge_refresh_jobs enable row level security;

create unique index if not exists uq_dge_refresh_jobs_open_dedupe
  on public.dge_refresh_jobs (workspace_id, dedupe_key)
  where status in ('queued', 'running') and deleted_at is null;

create index if not exists idx_dge_refresh_jobs_scan
  on public.dge_refresh_jobs (workspace_id, status, priority, created_at)
  where deleted_at is null;

create index if not exists idx_dge_refresh_jobs_lease_expiry
  on public.dge_refresh_jobs (status, lease_expires_at)
  where status = 'running' and deleted_at is null;

drop policy if exists "dge_refresh_jobs_select_workspace" on public.dge_refresh_jobs;
drop policy if exists "dge_refresh_jobs_insert_workspace" on public.dge_refresh_jobs;
drop policy if exists "dge_refresh_jobs_update_service" on public.dge_refresh_jobs;
drop policy if exists "dge_refresh_jobs_service_all" on public.dge_refresh_jobs;

create policy "dge_refresh_jobs_select_workspace"
  on public.dge_refresh_jobs
  for select
  using (
    workspace_id = public.get_my_workspace()
    and (
      public.get_my_role() in ('admin', 'manager', 'owner')
      or (
        public.get_my_role() = 'rep'
        and requested_by = auth.uid()
      )
    )
  );

create policy "dge_refresh_jobs_insert_workspace"
  on public.dge_refresh_jobs
  for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
    and coalesce(requested_by, auth.uid()) = auth.uid()
  );

create policy "dge_refresh_jobs_update_service"
  on public.dge_refresh_jobs
  for update
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "dge_refresh_jobs_service_all"
  on public.dge_refresh_jobs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists set_dge_refresh_jobs_updated_at on public.dge_refresh_jobs;
create trigger set_dge_refresh_jobs_updated_at
  before update on public.dge_refresh_jobs
  for each row
  execute function public.set_updated_at();

create or replace function public.enqueue_dge_refresh_job(
  p_workspace_id text,
  p_job_type text,
  p_dedupe_key text,
  p_request_payload jsonb default '{}'::jsonb,
  p_requested_by uuid default auth.uid(),
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
begin
  if p_workspace_id is null or btrim(p_workspace_id) = '' then
    raise exception 'workspace_id is required';
  end if;

  if p_job_type not in (
    'customer_profile_refresh',
    'market_valuation_refresh',
    'economic_sync_refresh'
  ) then
    raise exception 'unsupported job_type: %', p_job_type;
  end if;

  if p_dedupe_key is null or btrim(p_dedupe_key) = '' then
    raise exception 'dedupe_key is required';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_workspace_id), hashtext(p_dedupe_key));

  select *
  into v_job
  from public.dge_refresh_jobs
  where workspace_id = p_workspace_id
    and dedupe_key = p_dedupe_key
    and status in ('queued', 'running')
    and deleted_at is null
  order by created_at desc
  limit 1
  for update;

  if found then
    return query
    select v_job.id, v_job.status, false;
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
  )
  values (
    p_workspace_id,
    p_job_type,
    p_dedupe_key,
    'queued',
    coalesce(p_priority, 100),
    coalesce(p_request_payload, '{}'::jsonb),
    coalesce(p_requested_by, auth.uid())
  )
  returning *
  into v_job;

  return query
  select v_job.id, v_job.status, true;
end;
$$;

create or replace function public.claim_dge_refresh_job(
  p_lease_seconds integer default 60
)
returns table (
  job_id uuid,
  workspace_id text,
  job_type text,
  dedupe_key text,
  request_payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.dge_refresh_jobs%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
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
    order by priority asc, created_at asc
    limit 1
    for update skip locked
  )
  update public.dge_refresh_jobs job
  set status = 'running',
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 60), 15)),
      started_at = coalesce(job.started_at, now()),
      attempt_count = job.attempt_count + 1,
      last_error = null
  from candidate
  where job.id = candidate.id
  returning job.*
  into v_job;

  if not found then
    return;
  end if;

  return query
  select
    v_job.id,
    v_job.workspace_id,
    v_job.job_type,
    v_job.dedupe_key,
    v_job.request_payload,
    v_job.attempt_count;
end;
$$;

create or replace function public.complete_dge_refresh_job(
  p_job_id uuid,
  p_status text,
  p_result_payload jsonb default '{}'::jsonb,
  p_last_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  if p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'terminal status required';
  end if;

  update public.dge_refresh_jobs
  set status = p_status,
      result_payload = coalesce(p_result_payload, '{}'::jsonb),
      last_error = p_last_error,
      finished_at = now(),
      lease_token = null,
      lease_expires_at = null
  where id = p_job_id;
end;
$$;

grant execute on function public.enqueue_dge_refresh_job(text, text, text, jsonb, uuid, integer)
  to authenticated, service_role;
grant execute on function public.claim_dge_refresh_job(integer) to service_role;
grant execute on function public.complete_dge_refresh_job(uuid, text, jsonb, text) to service_role;

-- Rollback (manual):
-- drop function if exists public.complete_dge_refresh_job(uuid, text, jsonb, text);
-- drop function if exists public.claim_dge_refresh_job(integer);
-- drop function if exists public.enqueue_dge_refresh_job(text, text, text, jsonb, uuid, integer);
-- drop trigger if exists set_dge_refresh_jobs_updated_at on public.dge_refresh_jobs;
-- drop policy if exists "dge_refresh_jobs_service_all" on public.dge_refresh_jobs;
-- drop policy if exists "dge_refresh_jobs_update_service" on public.dge_refresh_jobs;
-- drop policy if exists "dge_refresh_jobs_insert_workspace" on public.dge_refresh_jobs;
-- drop policy if exists "dge_refresh_jobs_select_workspace" on public.dge_refresh_jobs;
-- drop table if exists public.dge_refresh_jobs;
