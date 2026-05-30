-- ============================================================================
-- Migration 641: J1.1 Workforce performance appraisal backend
--
-- Adds Service Advisor + Technician appraisal scorecards from the owner's
-- workbooks, 1-10 scoring across seven equal-weight categories, banding,
-- manager summary/signatures, and Cost of Living + Performance raise math.
-- Uses constrained text instead of new enums to avoid enum ADD VALUE coupling.
-- ============================================================================

-- ── Scorecard source-of-truth categories -------------------------------------

create table if not exists public.employee_appraisal_scorecard_categories (
  id uuid primary key default gen_random_uuid(),
  scorecard_role text not null,
  category_key text not null,
  display_order integer not null,
  category_name text not null,
  criteria jsonb not null default '[]'::jsonb,
  source_document text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scorecard_role, category_key),
  unique (scorecard_role, display_order)
);

comment on table public.employee_appraisal_scorecard_categories is
  'J1.1 scorecard definitions transcribed from the owner performance-appraisal workbooks. Seven active equal-weight categories per role.';
comment on column public.employee_appraisal_scorecard_categories.scorecard_role is
  'service_advisor or technician. Service Advisor maps to H13 service_writer subjects.';
comment on column public.employee_appraisal_scorecard_categories.criteria is
  'Workbook row labels beneath the category, retained for exact backend/API rendering without building the UI yet.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employee_appraisal_scorecard_role_chk') then
    alter table public.employee_appraisal_scorecard_categories
      add constraint employee_appraisal_scorecard_role_chk
      check (scorecard_role in ('service_advisor', 'technician')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employee_appraisal_scorecard_order_chk') then
    alter table public.employee_appraisal_scorecard_categories
      add constraint employee_appraisal_scorecard_order_chk
      check (display_order between 1 and 7) not valid;
  end if;
end $$;

insert into public.employee_appraisal_scorecard_categories (
  scorecard_role,
  category_key,
  display_order,
  category_name,
  criteria,
  source_document
)
values
  (
    'service_advisor',
    'attendance_reliability_time_management',
    1,
    'Attendance, Reliability & Time Management',
    '["Reports to work on time and ready to work", "Maintains consistent availability during business hours", "Manages daily workload efficinelty", "Responds to requests in a timely mannner", "Follows through on commitments and deadlines"]'::jsonb,
    'Performance Appraisal - Service Advisor.xlsx / Sheet1 (2)'
  ),
  (
    'service_advisor',
    'customer_service_communication',
    2,
    'Customer Service & Communication',
    '["Communicates clearly and professionally with customers", "Sets accurate expectations on timing, cost, and scope", "Clarity of communication when explaining repairs, timelines, and costs", "Tone and attitude is polite, patient, empathetic", "Follow-up habits — updates customers throughout their repair"]'::jsonb,
    'Performance Appraisal - Service Advisor.xlsx / Sheet1 (2)'
  ),
  (
    'service_advisor',
    'work_order_quality_accuracy',
    3,
    'Work Order Quality & Accuracy',
    '["Creates clear, complete, and accurate work orders", "Accurately captures customer concerns and job details", "Ensures labor, parts, and notes are properly documented", "Reviews work orders for accuracy before closing", "Minimizes errors that lead to rework or billing issues"]'::jsonb,
    'Performance Appraisal - Service Advisor.xlsx / Sheet1 (2)'
  ),
  (
    'service_advisor',
    'workflow_job_coordination',
    4,
    'Workflow & Job Coordination',
    '["Coordinates effectively between customers, technicians, and parts", "Prioritizes jobs based on urgency and shop capacity", "Keeps jobs moving through the shop without unnecessary delays", "Proactively addresses scheduling conflicts or delays", "Maintains awareness of job status and next steps at all times"]'::jsonb,
    'Performance Appraisal - Service Advisor.xlsx / Sheet1 (2)'
  ),
  (
    'service_advisor',
    'parts_billing_awareness',
    5,
    'Parts & Billing Awareness',
    '["Works with parts to ensure correct and timely ordering", "Understands basic parts availability and lead times", "Ensures accurate billing of labor, parts, and misc. charges", "Minimizes missed billable items", "Verifies completed work is properly invoiced"]'::jsonb,
    'Performance Appraisal - Service Advisor.xlsx / Sheet1 (2)'
  ),
  (
    'service_advisor',
    'professionalism_teamwork',
    6,
    'Professionalism & Teamwork',
    '["Works effectively with technicians, parts, and management", "Positive attitude with coworkers", "Communicates respectfully and constructively with others", "Accepts feedback and applies it appropriately", "Takes ownership of mistakes and works toward resolution"]'::jsonb,
    'Performance Appraisal - Service Advisor.xlsx / Sheet1 (2)'
  ),
  (
    'service_advisor',
    'initiative_problem_solving',
    7,
    'Initiative & Problem Solving',
    '["Takes action to move jobs forward without being prompted", "Identifies and resolves issues before they escalate", "Shows initiative to improve processes or quality", "Adapts to new equipment, technology, or procedures", "Demonstrates readiness for increased responsibility"]'::jsonb,
    'Performance Appraisal - Service Advisor.xlsx / Sheet1 (2)'
  ),
  (
    'technician',
    'attendance_reliability_time_management',
    1,
    'Attendance, Reliability & Time Management',
    '["Reports to work on time and ready to work", "Follows assigned schedule (shop hours, dispatch assignments, build timelines)", "Manages time efficiently during the workday", "Minimizes unproductive or idle time", "Uses overtime appropriately and with approval", "Reliable availability for assigned duties (road calls, builds, shop work)"]'::jsonb,
    'Copy of Performance Appraisal - Tech.xlsx / Sheet1 (2)'
  ),
  (
    'technician',
    'work_quality_technical_execution',
    2,
    'Work Quality & Technical Execution',
    '["Completes repairs accurately the first time", "Follows manufacturer specs and company procedures", "Demonstrates appropriate diagnostic skills for assigned work", "Performs clean, professional workmanship", "Uses proper tools and equipment correctly", "Verifies repairs before releasing equipment to prevent rework"]'::jsonb,
    'Copy of Performance Appraisal - Tech.xlsx / Sheet1 (2)'
  ),
  (
    'technician',
    'safety_compliance_equipment_care',
    3,
    'Safety, Compliance & Equipment Care',
    '["Follows all safety procedures and PPE requirements", "Uses tools and equipment safely and as intended", "Maintains a clean and safe work area (shop, field, or build area)", "Properly secures equipment, tools, and materials", "Reports hazards, near misses, and incidents promptly", "Cares for company and customer equipment"]'::jsonb,
    'Copy of Performance Appraisal - Tech.xlsx / Sheet1 (2)'
  ),
  (
    'technician',
    'productivity_job_management',
    4,
    'Productivity & Job Management',
    '["Completes jobs within reasonable or estimated labor time", "Manages assigned tasks with minimal supervision", "Stays focused on assigned work and avoids unnecessary rework", "Uses downtime productively", "Adjusts work approach based on job complexity and priorities"]'::jsonb,
    'Copy of Performance Appraisal - Tech.xlsx / Sheet1 (2)'
  ),
  (
    'technician',
    'documentation_communication',
    5,
    'Documentation & Communication',
    '["Completes work orders accurately and thoroughly", "Documents diagnostics, labor, and repairs clearly", "Communicates issues, delays, or additional repair needs promptly", "Coordinates effectively with service writers, managers, and parts", "Closes work orders in a timely manner"]'::jsonb,
    'Copy of Performance Appraisal - Tech.xlsx / Sheet1 (2)'
  ),
  (
    'technician',
    'professional_conduct_teamwork',
    6,
    'Professional Conduct & Teamwork',
    '["Maintains a professional attitude and conduct", "Accepts direction and feedback constructively", "Works cooperatively with coworkers and other departments", "Takes responsibility for mistakes and works to correct them", "Represents the company professionally when interacting with others"]'::jsonb,
    'Copy of Performance Appraisal - Tech.xlsx / Sheet1 (2)'
  ),
  (
    'technician',
    'technical_growth_initiative',
    7,
    'Technical Growth & Initiative',
    '["Demonstrates willingness to learn and improve skills", "Seeks training or certifications when applicable", "Shows initiative to improve processes or quality", "Adapts to new equipment, technology, or procedures", "Demonstrates readiness for increased responsibility"]'::jsonb,
    'Copy of Performance Appraisal - Tech.xlsx / Sheet1 (2)'
  )
on conflict (scorecard_role, category_key) do update
set
  display_order = excluded.display_order,
  category_name = excluded.category_name,
  criteria = excluded.criteria,
  source_document = excluded.source_document,
  active = true,
  updated_at = now();

-- ── Appraisal records and score rows -----------------------------------------

create table if not exists public.employee_performance_appraisals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  subject_employee_id uuid not null references public.employees(id) on delete restrict,
  subject_profile_id uuid not null references public.profiles(id) on delete restrict,
  reviewer_profile_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  scorecard_role text not null,
  review_type text not null,
  review_period_start date not null,
  review_period_end date not null,
  status text not null default 'draft',
  manager_summary text,
  key_strengths jsonb not null default '[]'::jsonb,
  improvement_areas jsonb not null default '[]'::jsonb,
  goals_next_period jsonb not null default '[]'::jsonb,
  employee_comments text,
  category_count integer not null default 0,
  overall_score numeric(4, 2),
  performance_band text,
  cost_of_living_raise_pct numeric(6, 2) not null default 0,
  performance_raise_pct numeric(6, 2),
  recommended_raise_pct numeric(6, 2),
  finalized_by uuid references public.profiles(id) on delete set null,
  finalized_at timestamptz,
  manager_signed_by uuid references public.profiles(id) on delete set null,
  manager_signed_at timestamptz,
  manager_signature_name text,
  employee_acknowledged_by uuid references public.profiles(id) on delete set null,
  employee_acknowledged_at timestamptz,
  employee_signature_name text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.employee_performance_appraisals is
  'J1.1 HR-sensitive Service Advisor/Technician appraisal header: draft/finalized, seven-category score rollup, manager summary, signatures, and COL + Performance raise recommendation.';
comment on column public.employee_performance_appraisals.performance_band is
  'Workbook banding: Sub-Par <4, Normal 4 to <8, Excellent >=8.';
comment on column public.employee_performance_appraisals.recommended_raise_pct is
  'Payroll-facing recommendation from workbook mechanic: Cost of Living + Performance.';
comment on column public.employee_performance_appraisals.employee_acknowledged_at is
  'Employee signature/acknowledgment timestamp. Acknowledgment confirms receipt/discussion, not agreement.';

create table if not exists public.employee_performance_appraisal_scores (
  id uuid primary key default gen_random_uuid(),
  appraisal_id uuid not null references public.employee_performance_appraisals(id) on delete cascade,
  workspace_id text not null default public.get_my_workspace(),
  scorecard_role text not null,
  category_key text not null,
  display_order integer not null,
  category_name text not null,
  criteria jsonb not null default '[]'::jsonb,
  score integer,
  band text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appraisal_id, category_key)
);

comment on table public.employee_performance_appraisal_scores is
  'J1.1 score snapshot rows. Exactly seven active category rows are seeded from the workbook definitions when an appraisal is created.';
comment on column public.employee_performance_appraisal_scores.score is
  'Category score, 1-10. All seven categories are equal weight in overall_score.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employee_performance_appraisals_role_chk') then
    alter table public.employee_performance_appraisals
      add constraint employee_performance_appraisals_role_chk
      check (scorecard_role in ('service_advisor', 'technician')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employee_performance_appraisals_review_type_chk') then
    alter table public.employee_performance_appraisals
      add constraint employee_performance_appraisals_review_type_chk
      check (review_type in ('90-Day Review', 'Annual Performance Review', 'Merit Review')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employee_performance_appraisals_status_chk') then
    alter table public.employee_performance_appraisals
      add constraint employee_performance_appraisals_status_chk
      check (status in ('draft', 'finalized')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employee_performance_appraisals_period_chk') then
    alter table public.employee_performance_appraisals
      add constraint employee_performance_appraisals_period_chk
      check (review_period_start <= review_period_end) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employee_performance_appraisals_score_rollup_chk') then
    alter table public.employee_performance_appraisals
      add constraint employee_performance_appraisals_score_rollup_chk
      check (
        (overall_score is null or (overall_score >= 1 and overall_score <= 10))
        and category_count between 0 and 7
        and (performance_band is null or performance_band in ('Sub-Par', 'Normal', 'Excellent'))
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employee_performance_appraisals_raise_chk') then
    alter table public.employee_performance_appraisals
      add constraint employee_performance_appraisals_raise_chk
      check (
        cost_of_living_raise_pct >= 0
        and (performance_raise_pct is null or performance_raise_pct >= 0)
        and (recommended_raise_pct is null or recommended_raise_pct >= 0)
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employee_performance_appraisal_scores_role_chk') then
    alter table public.employee_performance_appraisal_scores
      add constraint employee_performance_appraisal_scores_role_chk
      check (scorecard_role in ('service_advisor', 'technician')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employee_performance_appraisal_scores_score_chk') then
    alter table public.employee_performance_appraisal_scores
      add constraint employee_performance_appraisal_scores_score_chk
      check (score is null or score between 1 and 10) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employee_performance_appraisal_scores_band_chk') then
    alter table public.employee_performance_appraisal_scores
      add constraint employee_performance_appraisal_scores_band_chk
      check (band is null or band in ('Sub-Par', 'Normal', 'Excellent')) not valid;
  end if;
end $$;

create index if not exists idx_employee_perf_appraisals_subject
  on public.employee_performance_appraisals(workspace_id, subject_employee_id, review_period_end desc)
  where deleted_at is null;
comment on index public.idx_employee_perf_appraisals_subject is
  'Supports HR-sensitive employee self-view and manager direct-report appraisal history.';

create index if not exists idx_employee_perf_appraisals_reviewer
  on public.employee_performance_appraisals(workspace_id, reviewer_profile_id, status, updated_at desc)
  where deleted_at is null;
comment on index public.idx_employee_perf_appraisals_reviewer is
  'Supports manager appraisal queues by reviewer/status.';

create index if not exists idx_employee_perf_scores_appraisal_order
  on public.employee_performance_appraisal_scores(appraisal_id, display_order);
comment on index public.idx_employee_perf_scores_appraisal_order is
  'Supports scorecard rendering in workbook order.';

-- ── Deterministic scoring helpers --------------------------------------------

create or replace function public.employee_appraisal_score_band(p_score numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_score is null then null::text
    when p_score < 4 then 'Sub-Par'
    when p_score < 8 then 'Normal'
    else 'Excellent'
  end;
$$;

comment on function public.employee_appraisal_score_band(numeric) is
  'J1.1 workbook banding: Sub-Par <4, Normal 4 to <8, Excellent >=8.';

create or replace function public.employee_appraisal_performance_raise_pct(p_overall_score numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_overall_score is null then null::numeric
    else round(greatest(0, p_overall_score)::numeric, 2)
  end;
$$;

comment on function public.employee_appraisal_performance_raise_pct(numeric) is
  'J1.1 default Performance raise component. The workbook has a Performance addend and an overall 1-10 score; backend recommendation uses the overall score as the performance addend, then adds Cost of Living.';

create or replace function public.employee_appraisal_recommended_raise_pct(
  p_cost_of_living numeric,
  p_performance numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_cost_of_living is null or p_performance is null then null::numeric
    else round((greatest(0, p_cost_of_living) + greatest(0, p_performance))::numeric, 2)
  end;
$$;

comment on function public.employee_appraisal_recommended_raise_pct(numeric, numeric) is
  'J1.1 payroll formula from workbook cell G101: Cost of Living + Performance.';

create or replace function public.employee_appraisal_current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.workspace_id = (select public.get_my_workspace())
    and e.profile_id = (select auth.uid())
    and e.deleted_at is null
  order by e.termination_date nulls first, e.created_at desc
  limit 1;
$$;

comment on function public.employee_appraisal_current_employee_id() is
  'J1.1 RLS helper: maps the caller profile to the current workspace employee row without relying on employees RLS.';

create or replace function public.employee_appraisal_default_scorecard_role(p_subject_employee_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subject record;
begin
  select e.id, e.workspace_id, e.profile_id, p.role::text as profile_role
  into v_subject
  from public.employees e
  left join public.profiles p on p.id = e.profile_id
  where e.id = p_subject_employee_id
    and e.deleted_at is null;

  if not found then
    return null;
  end if;

  if v_subject.profile_role = 'service_writer' then
    return 'service_advisor';
  end if;

  if v_subject.profile_role = 'technician'
     or exists (
       select 1
       from public.technician_profiles tp
       where tp.workspace_id = v_subject.workspace_id
         and tp.user_id = v_subject.profile_id
     ) then
    return 'technician';
  end if;

  return null;
end;
$$;

comment on function public.employee_appraisal_default_scorecard_role(uuid) is
  'J1.1 maps H13 service_writer subjects to the Service Advisor scorecard and technician subjects/technician_profiles to the Technician scorecard.';

create or replace function public.employee_appraisal_can_manage(
  p_workspace_id text,
  p_subject_employee_id uuid,
  p_reviewer_profile_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce((select public.get_my_role())::text, '');
  v_caller uuid := (select auth.uid());
  v_caller_employee_id uuid;
begin
  if (select auth.role()) = 'service_role' then
    return true;
  end if;

  if p_workspace_id is distinct from (select public.get_my_workspace()) then
    return false;
  end if;

  if v_role in ('admin', 'owner') then
    return true;
  end if;

  if v_role <> 'manager' then
    return false;
  end if;

  v_caller_employee_id := public.employee_appraisal_current_employee_id();

  return exists (
    select 1
    from public.employees e
    where e.id = p_subject_employee_id
      and e.workspace_id = p_workspace_id
      and e.deleted_at is null
      and e.supervisor_id = v_caller_employee_id
  );
end;
$$;

comment on function public.employee_appraisal_can_manage(text, uuid, uuid) is
  'J1.1 HR-sensitive manager gate. Admin/owner see workspace-wide; managers see direct reports only.';

create or replace function public.employee_appraisal_can_read(
  p_workspace_id text,
  p_subject_employee_id uuid,
  p_subject_profile_id uuid,
  p_reviewer_profile_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.role()) = 'service_role'
    or (
      p_workspace_id = (select public.get_my_workspace())
      and (
        p_subject_profile_id = (select auth.uid())
        or public.employee_appraisal_can_manage(p_workspace_id, p_subject_employee_id, p_reviewer_profile_id)
      )
    );
$$;

comment on function public.employee_appraisal_can_read(text, uuid, uuid, uuid) is
  'J1.1 HR-sensitive read gate: employees see only their own appraisal; managers/admin/owners use employee_appraisal_can_manage.';

-- ── Trigger guards and rollups -----------------------------------------------

create or replace function public.prepare_employee_performance_appraisal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject record;
  v_role text;
begin
  select e.id, e.workspace_id, e.profile_id
  into v_subject
  from public.employees e
  where e.id = new.subject_employee_id
    and e.deleted_at is null;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Appraisal subject employee was not found.',
      detail = 'employee_appraisal_subject_not_found';
  end if;

  if new.workspace_id is null then
    new.workspace_id := v_subject.workspace_id;
  end if;

  if new.workspace_id is distinct from v_subject.workspace_id then
    raise exception using
      errcode = 'P0001',
      message = 'Appraisal subject must belong to the appraisal workspace.',
      detail = 'employee_appraisal_subject_workspace_guard';
  end if;

  if v_subject.profile_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Appraisal subject employee must be linked to a profile.',
      detail = 'employee_appraisal_subject_profile_required';
  end if;

  new.subject_profile_id := v_subject.profile_id;
  new.reviewer_profile_id := coalesce(new.reviewer_profile_id, (select auth.uid()));
  new.created_by := coalesce(new.created_by, (select auth.uid()));
  new.updated_at := now();

  if new.reviewer_profile_id is not null and new.reviewer_profile_id = new.subject_profile_id then
    raise exception using
      errcode = 'P0001',
      message = 'Self-review is not allowed for performance appraisals.',
      detail = 'employee_appraisal_self_review_guard';
  end if;

  v_role := coalesce(new.scorecard_role, public.employee_appraisal_default_scorecard_role(new.subject_employee_id));
  if v_role not in ('service_advisor', 'technician') then
    raise exception using
      errcode = 'P0001',
      message = 'Appraisal subject must resolve to a Service Advisor or Technician scorecard.',
      detail = 'employee_appraisal_scorecard_role_required';
  end if;

  new.scorecard_role := v_role;

  if new.overall_score is not null then
    new.performance_band := public.employee_appraisal_score_band(new.overall_score);
    new.performance_raise_pct := public.employee_appraisal_performance_raise_pct(new.overall_score);
  end if;

  new.recommended_raise_pct := public.employee_appraisal_recommended_raise_pct(
    new.cost_of_living_raise_pct,
    new.performance_raise_pct
  );

  return new;
end;
$$;

comment on function public.prepare_employee_performance_appraisal() is
  'J1.1 DB guard: backfills subject profile/role/workspace, blocks self-review, and keeps raise totals synchronized.';

drop trigger if exists employee_performance_appraisals_prepare_trg on public.employee_performance_appraisals;
create trigger employee_performance_appraisals_prepare_trg
  before insert or update on public.employee_performance_appraisals
  for each row execute function public.prepare_employee_performance_appraisal();

create or replace function public.prepare_employee_performance_appraisal_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appraisal record;
begin
  select id, workspace_id, scorecard_role, status
  into v_appraisal
  from public.employee_performance_appraisals
  where id = new.appraisal_id
    and deleted_at is null;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Score row must belong to an active appraisal.',
      detail = 'employee_appraisal_score_parent_required';
  end if;

  if v_appraisal.status <> 'draft' then
    raise exception using
      errcode = 'P0001',
      message = 'Finalized appraisal scores cannot be changed.',
      detail = 'employee_appraisal_score_finalized_guard';
  end if;

  new.workspace_id := v_appraisal.workspace_id;
  new.scorecard_role := v_appraisal.scorecard_role;
  new.band := public.employee_appraisal_score_band(new.score);
  new.updated_at := now();

  return new;
end;
$$;

comment on function public.prepare_employee_performance_appraisal_score() is
  'J1.1 score-row guard: inherits parent workspace/role, blocks finalized score edits, and bands each 1-10 category score.';

drop trigger if exists employee_performance_appraisal_scores_prepare_trg on public.employee_performance_appraisal_scores;
create trigger employee_performance_appraisal_scores_prepare_trg
  before insert or update on public.employee_performance_appraisal_scores
  for each row execute function public.prepare_employee_performance_appraisal_score();

create or replace function public.employee_performance_appraisal_recompute(p_appraisal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_overall numeric(4, 2);
  v_band text;
  v_performance_raise numeric(6, 2);
begin
  select count(score), round(avg(score)::numeric, 2)
  into v_count, v_overall
  from public.employee_performance_appraisal_scores
  where appraisal_id = p_appraisal_id
    and score is not null;

  if v_count = 7 then
    v_band := public.employee_appraisal_score_band(v_overall);
    v_performance_raise := public.employee_appraisal_performance_raise_pct(v_overall);
  else
    v_overall := null;
    v_band := null;
    v_performance_raise := null;
  end if;

  update public.employee_performance_appraisals a
  set
    category_count = v_count,
    overall_score = v_overall,
    performance_band = v_band,
    performance_raise_pct = v_performance_raise,
    recommended_raise_pct = public.employee_appraisal_recommended_raise_pct(a.cost_of_living_raise_pct, v_performance_raise),
    updated_at = now()
  where a.id = p_appraisal_id;
end;
$$;

comment on function public.employee_performance_appraisal_recompute(uuid) is
  'J1.1 equal-weight rollup. Overall is the average of the seven category scores; incomplete drafts do not emit band/raise recommendations.';

create or replace function public.employee_performance_appraisal_scores_recompute_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.employee_performance_appraisal_recompute(coalesce(new.appraisal_id, old.appraisal_id));

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists employee_performance_appraisal_scores_recompute_trg on public.employee_performance_appraisal_scores;
create trigger employee_performance_appraisal_scores_recompute_trg
  after insert or update or delete on public.employee_performance_appraisal_scores
  for each row execute function public.employee_performance_appraisal_scores_recompute_trg();

create or replace function public.enforce_employee_performance_appraisal_finalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score_count integer;
begin
  if new.status = 'finalized' and old.status is distinct from new.status then
    select count(*)
    into v_score_count
    from public.employee_performance_appraisal_scores s
    where s.appraisal_id = new.id
      and s.score is not null;

    if v_score_count <> 7 or new.overall_score is null or new.performance_band is null then
      raise exception using
        errcode = 'P0001',
        message = 'A finalized appraisal requires all seven category scores.',
        detail = 'employee_appraisal_finalize_scores_required';
    end if;

    if length(trim(coalesce(new.manager_summary, ''))) < 10 then
      raise exception using
        errcode = 'P0001',
        message = 'A finalized appraisal requires a Manager Summary.',
        detail = 'employee_appraisal_finalize_summary_required';
    end if;

    if new.manager_signed_by is null or new.manager_signed_at is null then
      raise exception using
        errcode = 'P0001',
        message = 'A finalized appraisal requires the manager signature timestamp.',
        detail = 'employee_appraisal_finalize_manager_signature_required';
    end if;
  end if;

  if old.status = 'finalized' and new.status <> 'finalized' then
    raise exception using
      errcode = 'P0001',
      message = 'Finalized appraisals cannot be returned to draft.',
      detail = 'employee_appraisal_finalized_immutable_status';
  end if;

  return new;
end;
$$;

comment on function public.enforce_employee_performance_appraisal_finalize() is
  'J1.1 finalization backstop: requires seven scores, rollup band, Manager Summary, and manager signature.';

drop trigger if exists employee_performance_appraisals_finalize_guard_trg on public.employee_performance_appraisals;
create trigger employee_performance_appraisals_finalize_guard_trg
  before update of status on public.employee_performance_appraisals
  for each row execute function public.enforce_employee_performance_appraisal_finalize();

-- ── RPC path for create -> score -> finalize -> sign -------------------------

create or replace function public.employee_appraisal_create(
  p_subject_employee_id uuid,
  p_review_type text,
  p_review_period_start date,
  p_review_period_end date,
  p_scorecard_role text default null,
  p_cost_of_living_raise_pct numeric default 0,
  p_manager_summary text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce((select public.get_my_role())::text, '');
  v_subject record;
  v_scorecard_role text;
  v_appraisal_id uuid;
begin
  if (select auth.role()) <> 'service_role' and v_role not in ('admin', 'manager', 'owner') then
    raise exception using errcode = '42501', message = 'Only managers, admins, and owners can create performance appraisals.';
  end if;

  select e.id, e.workspace_id, e.profile_id
  into v_subject
  from public.employees e
  where e.id = p_subject_employee_id
    and e.deleted_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'Subject employee not found.';
  end if;

  if (select auth.role()) <> 'service_role'
     and v_subject.workspace_id is distinct from (select public.get_my_workspace()) then
    raise exception using errcode = '42501', message = 'Subject employee is outside caller workspace.';
  end if;

  if v_subject.profile_id = (select auth.uid()) then
    raise exception using errcode = '42501', message = 'Self-review is not allowed for performance appraisals.';
  end if;

  if not public.employee_appraisal_can_manage(v_subject.workspace_id, v_subject.id, (select auth.uid())) then
    raise exception using errcode = '42501', message = 'Caller cannot manage this employee appraisal.';
  end if;

  v_scorecard_role := coalesce(p_scorecard_role, public.employee_appraisal_default_scorecard_role(p_subject_employee_id));
  if v_scorecard_role not in ('service_advisor', 'technician') then
    raise exception using errcode = 'P0001', message = 'Subject does not map to a Service Advisor or Technician scorecard.';
  end if;

  insert into public.employee_performance_appraisals (
    workspace_id,
    subject_employee_id,
    subject_profile_id,
    reviewer_profile_id,
    scorecard_role,
    review_type,
    review_period_start,
    review_period_end,
    manager_summary,
    cost_of_living_raise_pct,
    created_by
  ) values (
    v_subject.workspace_id,
    v_subject.id,
    v_subject.profile_id,
    (select auth.uid()),
    v_scorecard_role,
    p_review_type,
    p_review_period_start,
    p_review_period_end,
    p_manager_summary,
    coalesce(p_cost_of_living_raise_pct, 0),
    (select auth.uid())
  )
  returning id into v_appraisal_id;

  insert into public.employee_performance_appraisal_scores (
    appraisal_id,
    workspace_id,
    scorecard_role,
    category_key,
    display_order,
    category_name,
    criteria
  )
  select
    v_appraisal_id,
    v_subject.workspace_id,
    c.scorecard_role,
    c.category_key,
    c.display_order,
    c.category_name,
    c.criteria
  from public.employee_appraisal_scorecard_categories c
  where c.scorecard_role = v_scorecard_role
    and c.active = true
  order by c.display_order;

  if (
    select count(*)
    from public.employee_performance_appraisal_scores s
    where s.appraisal_id = v_appraisal_id
  ) <> 7 then
    raise exception using
      errcode = 'P0001',
      message = 'Exactly seven active scorecard categories are required to create an appraisal.',
      detail = 'employee_appraisal_scorecard_seed_count_guard';
  end if;

  return v_appraisal_id;
end;
$$;

comment on function public.employee_appraisal_create(uuid, text, date, date, text, numeric, text) is
  'J1.1 API RPC: creates a draft appraisal and seeds the seven workbook categories. Manager/admin/owner only; no self-review.';

create or replace function public.employee_appraisal_score(
  p_appraisal_id uuid,
  p_scores jsonb,
  p_manager_summary text default null,
  p_cost_of_living_raise_pct numeric default null,
  p_key_strengths jsonb default null,
  p_improvement_areas jsonb default null,
  p_goals_next_period jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appraisal record;
  v_item jsonb;
  v_category_key text;
  v_score integer;
  v_notes text;
begin
  select *
  into v_appraisal
  from public.employee_performance_appraisals a
  where a.id = p_appraisal_id
    and a.deleted_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'Appraisal not found.';
  end if;

  if v_appraisal.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'Only draft appraisals can be scored.';
  end if;

  if not public.employee_appraisal_can_manage(v_appraisal.workspace_id, v_appraisal.subject_employee_id, v_appraisal.reviewer_profile_id) then
    raise exception using errcode = '42501', message = 'Caller cannot score this appraisal.';
  end if;

  if jsonb_typeof(p_scores) <> 'array' then
    raise exception using errcode = 'P0001', message = 'p_scores must be a JSON array.';
  end if;

  for v_item in select value from jsonb_array_elements(p_scores) loop
    v_category_key := v_item ->> 'category_key';
    v_score := nullif(v_item ->> 'score', '')::integer;
    v_notes := v_item ->> 'notes';

    if v_score is null or v_score not between 1 and 10 then
      raise exception using errcode = 'P0001', message = 'Each score must be an integer from 1 to 10.';
    end if;

    update public.employee_performance_appraisal_scores s
    set score = v_score,
        notes = v_notes,
        updated_at = now()
    where s.appraisal_id = p_appraisal_id
      and s.category_key = v_category_key;

    if not found then
      raise exception using errcode = 'P0001', message = 'Unknown scorecard category key.';
    end if;
  end loop;

  update public.employee_performance_appraisals a
  set
    manager_summary = coalesce(p_manager_summary, a.manager_summary),
    cost_of_living_raise_pct = coalesce(p_cost_of_living_raise_pct, a.cost_of_living_raise_pct),
    key_strengths = coalesce(p_key_strengths, a.key_strengths),
    improvement_areas = coalesce(p_improvement_areas, a.improvement_areas),
    goals_next_period = coalesce(p_goals_next_period, a.goals_next_period),
    updated_at = now()
  where a.id = p_appraisal_id;

  perform public.employee_performance_appraisal_recompute(p_appraisal_id);
end;
$$;

comment on function public.employee_appraisal_score(uuid, jsonb, text, numeric, jsonb, jsonb, jsonb) is
  'J1.1 API RPC: manager/admin/owner updates 1-10 category scores and summary fields while the appraisal is draft.';

create or replace function public.employee_appraisal_finalize(
  p_appraisal_id uuid,
  p_manager_summary text default null,
  p_manager_signature_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appraisal record;
begin
  select *
  into v_appraisal
  from public.employee_performance_appraisals a
  where a.id = p_appraisal_id
    and a.deleted_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'Appraisal not found.';
  end if;

  if v_appraisal.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'Only draft appraisals can be finalized.';
  end if;

  if not public.employee_appraisal_can_manage(v_appraisal.workspace_id, v_appraisal.subject_employee_id, v_appraisal.reviewer_profile_id) then
    raise exception using errcode = '42501', message = 'Caller cannot finalize this appraisal.';
  end if;

  perform public.employee_performance_appraisal_recompute(p_appraisal_id);

  update public.employee_performance_appraisals a
  set
    manager_summary = coalesce(p_manager_summary, a.manager_summary),
    status = 'finalized',
    finalized_by = (select auth.uid()),
    finalized_at = now(),
    manager_signed_by = (select auth.uid()),
    manager_signed_at = now(),
    manager_signature_name = nullif(trim(coalesce(p_manager_signature_name, '')), ''),
    updated_at = now()
  where a.id = p_appraisal_id;
end;
$$;

comment on function public.employee_appraisal_finalize(uuid, text, text) is
  'J1.1 API RPC: manager/admin/owner finalizes a draft appraisal and records manager signature/timestamp.';

create or replace function public.employee_appraisal_acknowledge(
  p_appraisal_id uuid,
  p_employee_signature_name text default null,
  p_employee_comments text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appraisal record;
begin
  select *
  into v_appraisal
  from public.employee_performance_appraisals a
  where a.id = p_appraisal_id
    and a.deleted_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'Appraisal not found.';
  end if;

  if v_appraisal.status <> 'finalized' then
    raise exception using errcode = 'P0001', message = 'Only finalized appraisals can be acknowledged.';
  end if;

  if v_appraisal.subject_profile_id is distinct from (select auth.uid()) then
    raise exception using errcode = '42501', message = 'Only the subject employee can acknowledge this appraisal.';
  end if;

  update public.employee_performance_appraisals a
  set
    employee_acknowledged_by = (select auth.uid()),
    employee_acknowledged_at = now(),
    employee_signature_name = nullif(trim(coalesce(p_employee_signature_name, '')), ''),
    employee_comments = coalesce(p_employee_comments, a.employee_comments),
    updated_at = now()
  where a.id = p_appraisal_id;
end;
$$;

comment on function public.employee_appraisal_acknowledge(uuid, text, text) is
  'J1.1 API RPC: subject employee signs/acknowledges a finalized appraisal. Acknowledgment records receipt/discussion, not agreement.';

-- ── Security-invoker read view ------------------------------------------------

create or replace view public.v_employee_performance_appraisals
  with (security_invoker = true) as
select
  a.*,
  coalesce(e.display_name, p.full_name, p.email) as subject_display_name,
  p.email as subject_email,
  reviewer.full_name as reviewer_name,
  reviewer.email as reviewer_email,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'category_key', s.category_key,
        'display_order', s.display_order,
        'category_name', s.category_name,
        'criteria', s.criteria,
        'score', s.score,
        'band', s.band,
        'notes', s.notes
      ) order by s.display_order
    ) filter (where s.id is not null),
    '[]'::jsonb
  ) as scores
from public.employee_performance_appraisals a
join public.employees e on e.id = a.subject_employee_id
join public.profiles p on p.id = a.subject_profile_id
left join public.profiles reviewer on reviewer.id = a.reviewer_profile_id
left join public.employee_performance_appraisal_scores s on s.appraisal_id = a.id
group by a.id, e.display_name, p.full_name, p.email, reviewer.full_name, reviewer.email;

comment on view public.v_employee_performance_appraisals is
  'J1.1 security_invoker view for appraisal entry/view fast-follow UI. RLS on underlying appraisal and score tables remains authoritative.';

grant select on public.v_employee_performance_appraisals to authenticated, service_role;

-- ── RLS ----------------------------------------------------------------------

alter table public.employee_appraisal_scorecard_categories enable row level security;
alter table public.employee_performance_appraisals enable row level security;
alter table public.employee_performance_appraisal_scores enable row level security;

drop policy if exists "employee_appraisal_categories_select" on public.employee_appraisal_scorecard_categories;
create policy "employee_appraisal_categories_select"
  on public.employee_appraisal_scorecard_categories for select
  using ((select auth.role()) in ('authenticated', 'service_role'));

drop policy if exists "employee_appraisal_categories_service_all" on public.employee_appraisal_scorecard_categories;
create policy "employee_appraisal_categories_service_all"
  on public.employee_appraisal_scorecard_categories for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "employee_appraisals_service_all" on public.employee_performance_appraisals;
create policy "employee_appraisals_service_all"
  on public.employee_performance_appraisals for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "employee_appraisals_select_hr_scoped" on public.employee_performance_appraisals;
create policy "employee_appraisals_select_hr_scoped"
  on public.employee_performance_appraisals for select
  using (
    deleted_at is null
    and public.employee_appraisal_can_read(workspace_id, subject_employee_id, subject_profile_id, reviewer_profile_id)
  );

drop policy if exists "employee_appraisals_insert_manager" on public.employee_performance_appraisals;
create policy "employee_appraisals_insert_manager"
  on public.employee_performance_appraisals for insert
  with check (
    status = 'draft'
    and reviewer_profile_id = (select auth.uid())
    and subject_profile_id is distinct from (select auth.uid())
    and public.employee_appraisal_can_manage(workspace_id, subject_employee_id, reviewer_profile_id)
  );

drop policy if exists "employee_appraisals_update_manager_draft" on public.employee_performance_appraisals;
create policy "employee_appraisals_update_manager_draft"
  on public.employee_performance_appraisals for update
  using (
    status = 'draft'
    and public.employee_appraisal_can_manage(workspace_id, subject_employee_id, reviewer_profile_id)
  )
  with check (
    public.employee_appraisal_can_manage(workspace_id, subject_employee_id, reviewer_profile_id)
  );

drop policy if exists "employee_appraisals_delete_manager_draft" on public.employee_performance_appraisals;
create policy "employee_appraisals_delete_manager_draft"
  on public.employee_performance_appraisals for delete
  using (
    status = 'draft'
    and public.employee_appraisal_can_manage(workspace_id, subject_employee_id, reviewer_profile_id)
  );

drop policy if exists "employee_appraisal_scores_service_all" on public.employee_performance_appraisal_scores;
create policy "employee_appraisal_scores_service_all"
  on public.employee_performance_appraisal_scores for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "employee_appraisal_scores_select_hr_scoped" on public.employee_performance_appraisal_scores;
create policy "employee_appraisal_scores_select_hr_scoped"
  on public.employee_performance_appraisal_scores for select
  using (
    exists (
      select 1
      from public.employee_performance_appraisals a
      where a.id = employee_performance_appraisal_scores.appraisal_id
        and a.deleted_at is null
        and public.employee_appraisal_can_read(a.workspace_id, a.subject_employee_id, a.subject_profile_id, a.reviewer_profile_id)
    )
  );

drop policy if exists "employee_appraisal_scores_insert_manager_draft" on public.employee_performance_appraisal_scores;
create policy "employee_appraisal_scores_insert_manager_draft"
  on public.employee_performance_appraisal_scores for insert
  with check (
    exists (
      select 1
      from public.employee_performance_appraisals a
      where a.id = employee_performance_appraisal_scores.appraisal_id
        and a.status = 'draft'
        and a.deleted_at is null
        and public.employee_appraisal_can_manage(a.workspace_id, a.subject_employee_id, a.reviewer_profile_id)
    )
  );

drop policy if exists "employee_appraisal_scores_update_manager_draft" on public.employee_performance_appraisal_scores;
create policy "employee_appraisal_scores_update_manager_draft"
  on public.employee_performance_appraisal_scores for update
  using (
    exists (
      select 1
      from public.employee_performance_appraisals a
      where a.id = employee_performance_appraisal_scores.appraisal_id
        and a.status = 'draft'
        and a.deleted_at is null
        and public.employee_appraisal_can_manage(a.workspace_id, a.subject_employee_id, a.reviewer_profile_id)
    )
  )
  with check (
    exists (
      select 1
      from public.employee_performance_appraisals a
      where a.id = employee_performance_appraisal_scores.appraisal_id
        and a.status = 'draft'
        and a.deleted_at is null
        and public.employee_appraisal_can_manage(a.workspace_id, a.subject_employee_id, a.reviewer_profile_id)
    )
  );

drop policy if exists "employee_appraisal_scores_delete_manager_draft" on public.employee_performance_appraisal_scores;
create policy "employee_appraisal_scores_delete_manager_draft"
  on public.employee_performance_appraisal_scores for delete
  using (
    exists (
      select 1
      from public.employee_performance_appraisals a
      where a.id = employee_performance_appraisal_scores.appraisal_id
        and a.status = 'draft'
        and a.deleted_at is null
        and public.employee_appraisal_can_manage(a.workspace_id, a.subject_employee_id, a.reviewer_profile_id)
    )
  );

-- ── Grants -------------------------------------------------------------------

grant select on public.employee_appraisal_scorecard_categories to authenticated, service_role;
grant select on public.employee_performance_appraisals to authenticated, service_role;
grant select on public.employee_performance_appraisal_scores to authenticated, service_role;
grant insert, update, delete on public.employee_performance_appraisals to service_role;
grant insert, update, delete on public.employee_performance_appraisal_scores to service_role;

grant execute on function public.employee_appraisal_score_band(numeric) to authenticated, service_role;
grant execute on function public.employee_appraisal_performance_raise_pct(numeric) to authenticated, service_role;
grant execute on function public.employee_appraisal_recommended_raise_pct(numeric, numeric) to authenticated, service_role;
grant execute on function public.employee_appraisal_current_employee_id() to authenticated, service_role;
grant execute on function public.employee_appraisal_default_scorecard_role(uuid) to authenticated, service_role;
grant execute on function public.employee_appraisal_can_manage(text, uuid, uuid) to authenticated, service_role;
grant execute on function public.employee_appraisal_can_read(text, uuid, uuid, uuid) to authenticated, service_role;
revoke execute on function public.prepare_employee_performance_appraisal() from public;
revoke execute on function public.prepare_employee_performance_appraisal_score() from public;
revoke execute on function public.employee_performance_appraisal_recompute(uuid) from public;
revoke execute on function public.employee_performance_appraisal_scores_recompute_trg() from public;
revoke execute on function public.enforce_employee_performance_appraisal_finalize() from public;
grant execute on function public.employee_performance_appraisal_recompute(uuid) to service_role;
grant execute on function public.employee_appraisal_create(uuid, text, date, date, text, numeric, text) to authenticated, service_role;
grant execute on function public.employee_appraisal_score(uuid, jsonb, text, numeric, jsonb, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.employee_appraisal_finalize(uuid, text, text) to authenticated, service_role;
grant execute on function public.employee_appraisal_acknowledge(uuid, text, text) to authenticated, service_role;
