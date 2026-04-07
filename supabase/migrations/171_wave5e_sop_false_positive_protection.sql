-- ============================================================================
-- Migration 171: Wave 5E — SOP false-positive protection (Phase 2E)
--
-- Adds:
--   1. completion_state column on sop_step_completions distinguishing
--      completed / skipped / deferred / satisfied_elsewhere / not_applicable
--      (default 'completed' so existing rows keep current semantics)
--   2. confidence_score column for AI-mapped step matches
--   3. sop_suppression_queue table for low-confidence step mappings
--      that need manager review before counting against compliance
--   4. Updated compliance view that excludes 'not_applicable' from the
--      denominator and surfaces the new states separately
-- ============================================================================

-- ── 1. Extend sop_step_completions with state + confidence ────────────────

alter table public.sop_step_completions
  add column if not exists completion_state text not null default 'completed'
    check (completion_state in (
      'completed', 'skipped', 'deferred', 'satisfied_elsewhere', 'not_applicable'
    )),
  add column if not exists confidence_score numeric(3,2)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1));

create index if not exists idx_sop_completion_state on public.sop_step_completions(completion_state)
  where completion_state != 'completed';

comment on column public.sop_step_completions.completion_state is
  'completed | skipped | deferred | satisfied_elsewhere | not_applicable. NA rows are excluded from compliance denominators.';
comment on column public.sop_step_completions.confidence_score is
  'AI confidence in the step→evidence mapping. <0.6 routes the row to sop_suppression_queue for manager review.';

-- ── 2. Suppression queue ──────────────────────────────────────────────────

create table if not exists public.sop_suppression_queue (
  id uuid primary key default public.get_my_workspace_id_or_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  sop_execution_id uuid not null references public.sop_executions(id) on delete cascade,
  sop_step_id uuid not null references public.sop_steps(id) on delete cascade,
  proposed_state text not null check (proposed_state in (
    'completed', 'skipped', 'deferred', 'satisfied_elsewhere', 'not_applicable'
  )),
  proposed_evidence jsonb default '{}'::jsonb,
  confidence_score numeric(3,2) not null check (confidence_score >= 0 and confidence_score <= 1),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The custom default ID function above is paranoid; fall back to gen_random_uuid()
-- if the helper is missing.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'get_my_workspace_id_or_uuid') then
    alter table public.sop_suppression_queue
      alter column id set default gen_random_uuid();
  end if;
end $$;

comment on table public.sop_suppression_queue is
  'Low-confidence SOP step mappings (confidence < 0.6) staged for manager review. Approving moves them into sop_step_completions; rejecting drops them.';

alter table public.sop_suppression_queue enable row level security;

create policy "ssq_workspace" on public.sop_suppression_queue for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "ssq_service" on public.sop_suppression_queue for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_ssq_pending on public.sop_suppression_queue(workspace_id, status, created_at desc) where status = 'pending';
create index idx_ssq_execution on public.sop_suppression_queue(sop_execution_id);

create trigger set_ssq_updated_at
  before update on public.sop_suppression_queue
  for each row execute function public.set_updated_at();

-- ── 3. Compliance view excluding NA from denominator ─────────────────────

-- Refresh the existing sop_compliance_summary view to honor completion_state.
-- The view from mig 158 exists with security_invoker=true (set in 159).
-- Recreate it here with the v1 false-positive guards baked in.

create or replace view public.sop_compliance_summary as
with step_execution_stats as (
  select
    s.id as step_id,
    s.sop_template_id,
    s.sort_order,
    s.title as step_title,
    -- Eligible executions for this step (exclude executions where this step
    -- has been marked NA — those don't count against the denominator)
    (select count(*) from public.sop_executions e
      where e.sop_template_id = s.sop_template_id
        and e.status in ('completed', 'in_progress')
        and not exists (
          select 1 from public.sop_step_completions sc2
          where sc2.sop_execution_id = e.id
            and sc2.sop_step_id = s.id
            and sc2.completion_state = 'not_applicable'
        )
    ) as eligible_executions,
    (select count(*) from public.sop_step_completions sc
      where sc.sop_step_id = s.id
        and sc.completion_state = 'completed'
    ) as completions,
    (select count(*) from public.sop_step_skips sk
      where sk.sop_step_id = s.id
    ) as skips,
    (select count(*) from public.sop_step_completions sc
      where sc.sop_step_id = s.id
        and sc.completion_state = 'deferred'
    ) as deferred_count,
    (select count(*) from public.sop_step_completions sc
      where sc.sop_step_id = s.id
        and sc.completion_state = 'satisfied_elsewhere'
    ) as satisfied_elsewhere_count,
    (select count(*) from public.sop_step_completions sc
      where sc.sop_step_id = s.id
        and sc.completion_state = 'not_applicable'
    ) as na_count
  from public.sop_steps s
)
select
  t.id as template_id,
  t.title as template_title,
  t.department,
  t.version,
  count(distinct e.id) as total_executions,
  count(distinct e.id) filter (where e.status = 'completed') as completed_executions,
  count(distinct e.id) filter (where e.status = 'abandoned') as abandoned_executions,
  count(distinct e.id) filter (where e.status = 'blocked') as blocked_executions,
  round(
    count(distinct e.id) filter (where e.status = 'completed')::numeric /
    nullif(count(distinct e.id), 0) * 100, 1
  ) as completion_rate_pct,
  ses.step_id,
  ses.sort_order,
  ses.step_title,
  ses.eligible_executions,
  ses.completions,
  ses.skips,
  ses.deferred_count,
  ses.satisfied_elsewhere_count,
  ses.na_count,
  case
    when ses.eligible_executions > 0 then
      round(ses.completions::numeric / ses.eligible_executions * 100, 1)
    else null
  end as step_compliance_pct
from public.sop_templates t
left join public.sop_executions e on e.sop_template_id = t.id
left join step_execution_stats ses on ses.sop_template_id = t.id
where t.status != 'archived'
group by
  t.id, t.title, t.department, t.version,
  ses.step_id, ses.sort_order, ses.step_title,
  ses.eligible_executions, ses.completions, ses.skips,
  ses.deferred_count, ses.satisfied_elsewhere_count, ses.na_count;

alter view public.sop_compliance_summary set (security_invoker = true);

comment on view public.sop_compliance_summary is
  'SOP compliance with v1 false-positive guards. NA rows excluded from denominator; deferred/satisfied_elsewhere counted separately.';
