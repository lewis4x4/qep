-- ============================================================================
-- Migration 109: Job code template suggestions, cron run log, escalation steps check
-- ============================================================================

-- ── Learner writes here; admin merge promotes to job_codes.parts_template
create table if not exists public.job_code_template_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  job_code_id uuid not null references public.job_codes(id) on delete cascade,
  suggested_parts_template jsonb not null default '[]'::jsonb,
  suggested_common_add_ons jsonb not null default '[]'::jsonb,
  observation_count integer not null default 0,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.job_code_template_suggestions is
  'Pending job_code template changes from service-jobcode-learner; merge to job_codes after review.';

create unique index if not exists idx_jcts_one_pending_per_job_code
  on public.job_code_template_suggestions(job_code_id)
  where review_status = 'pending';

alter table public.job_code_template_suggestions enable row level security;

create policy "jcts_select" on public.job_code_template_suggestions for select
  using (workspace_id = public.get_my_workspace());

create policy "jcts_insert" on public.job_code_template_suggestions for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "jcts_update" on public.job_code_template_suggestions for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "jcts_service_all" on public.job_code_template_suggestions for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_jcts_workspace on public.job_code_template_suggestions(workspace_id);

create trigger set_job_code_template_suggestions_updated_at
  before update on public.job_code_template_suggestions for each row
  execute function public.set_updated_at();

-- ── Optional observability for cron POST workers
create table if not exists public.service_cron_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  job_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean not null default false,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.service_cron_runs is
  'Edge cron worker execution log (optional; written by workers when enabled).';

alter table public.service_cron_runs enable row level security;

create policy "scr_select" on public.service_cron_runs for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "scr_service_all" on public.service_cron_runs for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_service_cron_runs_ws_started on public.service_cron_runs(workspace_id, started_at desc);

-- ── Validate vendor_escalation_policies.steps on write
create or replace function public.enforce_vendor_escalation_policy_steps()
returns trigger
language plpgsql
as $$
declare
  elem jsonb;
  act text;
begin
  if jsonb_typeof(new.steps) <> 'array' then
    raise exception 'vendor_escalation_policies.steps must be a JSON array';
  end if;
  for elem in select value from jsonb_array_elements(new.steps) as t(value)
  loop
    act := coalesce(elem->>'action', elem->>'type', elem->>'step_action');
    if act is null or length(trim(act)) = 0 then
      raise exception 'each escalation step requires action, type, or step_action';
    end if;
    if lower(trim(act)) = 'switch_alt_vendor' then
      if not (elem ? 'alt_vendor_id') and not (elem ? 'alternate_vendor_id') then
        raise exception 'switch_alt_vendor steps require alt_vendor_id or alternate_vendor_id';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_vendor_escalation_policies_steps on public.vendor_escalation_policies;
create trigger trg_vendor_escalation_policies_steps
  before insert or update on public.vendor_escalation_policies
  for each row execute function public.enforce_vendor_escalation_policy_steps();
