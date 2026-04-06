-- ============================================================================
-- Migration 158: SOP Engine Completion
--
-- Gap closure for Moonshot 7:
-- - Skip rate tracking (sop_step_skips table)
-- - Enhanced compliance view with skip analysis
-- - SOP ingestion audit trail (track AI-parsed documents)
-- ============================================================================

-- ── 1. SOP step skips (tracks deviations from the process) ─────────────────

create table public.sop_step_skips (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  sop_execution_id uuid not null references public.sop_executions(id) on delete cascade,
  sop_step_id uuid not null references public.sop_steps(id) on delete cascade,
  skipped_by uuid references public.profiles(id) on delete set null,
  skip_reason text,
  skipped_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.sop_step_skips is 'Tracks which SOP steps get skipped. Enables "Step 4 skipped 60% of the time" analytics.';

alter table public.sop_step_skips enable row level security;
create policy "sop_skips_workspace" on public.sop_step_skips for all
  using (workspace_id = public.get_my_workspace())
  with check (workspace_id = public.get_my_workspace());
create policy "sop_skips_service" on public.sop_step_skips for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_sop_skips_execution on public.sop_step_skips(sop_execution_id);
create index idx_sop_skips_step on public.sop_step_skips(sop_step_id);

-- ── 2. SOP ingestion audit (tracks AI-parsed uploads) ──────────────────────

create table public.sop_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  document_id uuid references public.documents(id) on delete set null,
  source_filename text,
  sop_template_id uuid references public.sop_templates(id) on delete set null,

  -- Parse results
  steps_extracted integer default 0,
  ai_model text,
  parse_confidence numeric(3,2),
  parse_errors jsonb default '[]',

  -- Status
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'partial')),

  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.sop_ingestion_runs is 'Audit trail for AI-parsed SOP document ingestion. Ryan: "I took all those processes, dumped them in Cowork." Now QEP OS ingests them natively.';

alter table public.sop_ingestion_runs enable row level security;
create policy "sop_ingestion_workspace" on public.sop_ingestion_runs for all
  using (workspace_id = public.get_my_workspace())
  with check (workspace_id = public.get_my_workspace());
create policy "sop_ingestion_service" on public.sop_ingestion_runs for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_sop_ingestion_template on public.sop_ingestion_runs(sop_template_id) where sop_template_id is not null;

-- ── 3. Enhanced compliance view (includes skip rate per step) ──────────────

create or replace view public.sop_compliance_summary as
with step_execution_stats as (
  select
    s.id as step_id,
    s.sop_template_id,
    s.sort_order,
    s.title as step_title,
    -- Count executions that should have had this step completed
    (select count(*) from public.sop_executions e
     where e.sop_template_id = s.sop_template_id
       and e.status in ('completed', 'in_progress')) as eligible_executions,
    -- Actual completions
    (select count(*) from public.sop_step_completions sc
     where sc.sop_step_id = s.id) as completions,
    -- Explicit skips
    (select count(*) from public.sop_step_skips sk
     where sk.sop_step_id = s.id) as skips
  from public.sop_steps s
)
select
  t.id as template_id,
  t.title as template_title,
  t.department,
  t.version,
  -- Execution-level metrics
  count(distinct e.id) as total_executions,
  count(distinct e.id) filter (where e.status = 'completed') as completed_executions,
  count(distinct e.id) filter (where e.status = 'abandoned') as abandoned_executions,
  count(distinct e.id) filter (where e.status = 'blocked') as blocked_executions,
  round(
    count(distinct e.id) filter (where e.status = 'completed')::numeric /
    nullif(count(distinct e.id), 0) * 100, 1
  ) as completion_rate_pct,
  avg(extract(epoch from (e.completed_at - e.started_at)) / 60)
    filter (where e.status = 'completed') as avg_duration_minutes,
  -- Step-level skip analysis (the bottleneck identifier)
  (
    select jsonb_agg(
      jsonb_build_object(
        'step_id', ses.step_id,
        'sort_order', ses.sort_order,
        'step_title', ses.step_title,
        'completions', ses.completions,
        'skips', ses.skips,
        'skip_rate_pct', case
          when ses.eligible_executions > 0 then
            round(ses.skips::numeric / ses.eligible_executions * 100, 1)
          else 0
        end
      ) order by ses.sort_order
    )
    from step_execution_stats ses
    where ses.sop_template_id = t.id
  ) as step_analysis
from public.sop_templates t
left join public.sop_executions e on e.sop_template_id = t.id
where t.status = 'active' and t.deleted_at is null
group by t.id, t.title, t.department, t.version;

comment on view public.sop_compliance_summary is 'SOP compliance metrics with step-level skip analysis. Answers "which steps get skipped 60% of the time."';
