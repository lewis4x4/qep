-- ============================================================================
-- Migration 152: SOP Engine
--
-- Moonshot 7: Turn static SOPs into executable workflows.
-- Ryan: "I took all those processes, dumped them all in Cowork,
--        and then it flipped them over to the QEP SOP template."
--
-- This makes those SOPs live inside QEP OS — executable, trackable,
-- compliance-measurable.
-- ============================================================================

-- ── 1. SOP Templates ────────────────────────────────────────────────────────

create table public.sop_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  title text not null,
  description text,
  department text not null check (department in ('sales', 'service', 'parts', 'admin', 'all')),
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),

  -- Authorship
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,

  -- Link to ingested document for RAG context
  document_id uuid references public.documents(id) on delete set null,

  tags jsonb default '[]',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.sop_templates is 'SOP templates. Ingested from Ryan''s existing SOP documents, made executable.';

alter table public.sop_templates enable row level security;
create policy "sop_templates_workspace" on public.sop_templates for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "sop_templates_service" on public.sop_templates for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_sop_templates_workspace on public.sop_templates(workspace_id);
create index idx_sop_templates_dept_status on public.sop_templates(department, status) where status = 'active';

-- ── 2. SOP Steps ────────────────────────────────────────────────────────────

create table public.sop_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  sop_template_id uuid not null references public.sop_templates(id) on delete cascade,
  sort_order integer not null,
  title text not null,
  instructions text,
  required_role text, -- 'iron_advisor', 'iron_woman', etc.
  estimated_duration_minutes integer,
  is_decision_point boolean default false,
  decision_options jsonb, -- [{ label, next_step_id }]
  attachment_urls jsonb default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sop_steps enable row level security;

create or replace function public.sop_step_in_my_workspace(p_template_id uuid)
returns boolean
language sql security definer stable set search_path = ''
as $$
  select exists (
    select 1 from public.sop_templates t where t.id = p_template_id
    and t.workspace_id = public.get_my_workspace()
  );
$$;
revoke execute on function public.sop_step_in_my_workspace(uuid) from public;
grant execute on function public.sop_step_in_my_workspace(uuid) to authenticated;

create policy "sop_steps_workspace" on public.sop_steps for all
  using (public.sop_step_in_my_workspace(sop_template_id))
  with check (public.sop_step_in_my_workspace(sop_template_id));
create policy "sop_steps_service" on public.sop_steps for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_sop_steps_template on public.sop_steps(sop_template_id, sort_order);

-- ── 3. SOP Executions ───────────────────────────────────────────────────────

create table public.sop_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  sop_template_id uuid not null references public.sop_templates(id) on delete cascade,
  started_by uuid references public.profiles(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,

  -- Context: what entity this SOP is running against
  context_entity_type text, -- 'deal', 'service_job', 'equipment_intake', 'rental_return'
  context_entity_id uuid,

  status text not null default 'in_progress' check (status in (
    'in_progress', 'completed', 'abandoned', 'blocked'
  )),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sop_executions enable row level security;
create policy "sop_executions_workspace" on public.sop_executions for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "sop_executions_service" on public.sop_executions for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_sop_executions_workspace_status on public.sop_executions(workspace_id, status)
  where status = 'in_progress';
create index idx_sop_executions_assigned on public.sop_executions(assigned_to, status)
  where status = 'in_progress';

-- ── 4. SOP Step Completions ─────────────────────────────────────────────────

create table public.sop_step_completions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  sop_execution_id uuid not null references public.sop_executions(id) on delete cascade,
  sop_step_id uuid not null references public.sop_steps(id) on delete cascade,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz not null default now(),
  decision_taken text,
  notes text,
  evidence_urls jsonb default '[]',
  duration_minutes integer,
  created_at timestamptz not null default now()
);

alter table public.sop_step_completions enable row level security;

create or replace function public.sop_completion_in_my_workspace(p_execution_id uuid)
returns boolean
language sql security definer stable set search_path = ''
as $$
  select exists (
    select 1 from public.sop_executions e where e.id = p_execution_id
    and e.workspace_id = public.get_my_workspace()
  );
$$;
revoke execute on function public.sop_completion_in_my_workspace(uuid) from public;
grant execute on function public.sop_completion_in_my_workspace(uuid) to authenticated;

create policy "sop_completions_workspace" on public.sop_step_completions for all
  using (public.sop_completion_in_my_workspace(sop_execution_id))
  with check (public.sop_completion_in_my_workspace(sop_execution_id));
create policy "sop_completions_service" on public.sop_step_completions for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_sop_completions_execution on public.sop_step_completions(sop_execution_id);

-- ── 5. SOP Template Versions (audit trail) ──────────────────────────────────

create table public.sop_template_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  sop_template_id uuid not null references public.sop_templates(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null, -- full template + steps as JSONB
  change_summary text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_sop_versions_template on public.sop_template_versions(sop_template_id, version desc);

-- ── 6. Auto-version on publish ──────────────────────────────────────────────

create or replace function public.sop_auto_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
begin
  -- When status changes to 'active', capture version snapshot
  if OLD.status != 'active' and NEW.status = 'active' then
    NEW.version := OLD.version + 1;
    NEW.approved_at := now();

    -- Build snapshot of template + steps
    select jsonb_build_object(
      'template', to_jsonb(NEW),
      'steps', coalesce((
        select jsonb_agg(to_jsonb(s.*) order by s.sort_order)
        from public.sop_steps s where s.sop_template_id = NEW.id
      ), '[]'::jsonb)
    ) into v_snapshot;

    insert into public.sop_template_versions (
      workspace_id, sop_template_id, version, snapshot, created_by
    ) values (
      NEW.workspace_id, NEW.id, NEW.version, v_snapshot, NEW.approved_by
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists sop_auto_version on public.sop_templates;
create trigger sop_auto_version
  before update of status on public.sop_templates
  for each row execute function public.sop_auto_version();

-- ── 7. Compliance summary view ──────────────────────────────────────────────

create or replace view public.sop_compliance_summary as
select
  t.id as template_id,
  t.title,
  t.department,
  t.version,
  count(e.id) as total_executions,
  count(e.id) filter (where e.status = 'completed') as completed_executions,
  count(e.id) filter (where e.status = 'abandoned') as abandoned_executions,
  round(
    count(e.id) filter (where e.status = 'completed')::numeric /
    nullif(count(e.id), 0) * 100, 1
  ) as completion_rate_pct,
  avg(extract(epoch from (e.completed_at - e.started_at)) / 60)
    filter (where e.status = 'completed') as avg_duration_minutes
from public.sop_templates t
left join public.sop_executions e on e.sop_template_id = t.id
where t.status = 'active' and t.deleted_at is null
group by t.id, t.title, t.department, t.version;

comment on view public.sop_compliance_summary is 'SOP compliance metrics: completion rates, avg duration, abandonment by template.';

-- ── 8. Triggers ─────────────────────────────────────────────────────────────

create trigger set_sop_templates_updated_at before update on public.sop_templates for each row execute function public.set_updated_at();
create trigger set_sop_steps_updated_at before update on public.sop_steps for each row execute function public.set_updated_at();
create trigger set_sop_executions_updated_at before update on public.sop_executions for each row execute function public.set_updated_at();
