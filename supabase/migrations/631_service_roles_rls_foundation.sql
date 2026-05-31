-- ============================================================================
-- Migration 631: Service roles & RLS foundation for QEP OS
--
-- Uses enum values added in 630. Keeps legacy rep/admin/manager/owner access,
-- adds service-department role scopes, and prevents technicians from seeing
-- other technicians' assigned work.
-- ============================================================================

-- ── Sensitive finance helper -------------------------------------------------

create or replace function public.qrm_can_access_customer_financial()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.role() = 'service_role'
    or coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin');
$$;

comment on function public.qrm_can_access_customer_financial() is
  'Returns true for service callers and elevated QEP roles allowed to view/write sensitive customer finance and tax-routing fields.';

revoke execute on function public.qrm_can_access_customer_financial() from public;
grant execute on function public.qrm_can_access_customer_financial() to authenticated, service_role;

-- ── service_jobs -------------------------------------------------------------

drop policy if exists "svc_jobs_select" on public.service_jobs;
drop policy if exists "svc_jobs_insert" on public.service_jobs;
drop policy if exists "svc_jobs_update" on public.service_jobs;

create policy "svc_jobs_select" on public.service_jobs for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner',
        'service_writer', 'dispatch', 'parts_counter', 'finance_admin'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and technician_id = (select auth.uid())
      )
    )
  );

create policy "svc_jobs_insert" on public.service_jobs for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  );

create policy "svc_jobs_update" on public.service_jobs for update
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  );

-- ── service_job_events -------------------------------------------------------

drop policy if exists "svc_events_select" on public.service_job_events;
drop policy if exists "svc_events_insert" on public.service_job_events;

create policy "svc_events_select" on public.service_job_events for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1
          from public.service_jobs j
          where j.id = service_job_events.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );

create policy "svc_events_insert" on public.service_job_events for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'parts_counter'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1
          from public.service_jobs j
          where j.id = service_job_events.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );

-- ── service_job_blockers -----------------------------------------------------

drop policy if exists "svc_blockers_select" on public.service_job_blockers;
drop policy if exists "svc_blockers_insert" on public.service_job_blockers;
drop policy if exists "svc_blockers_update" on public.service_job_blockers;

create policy "svc_blockers_select" on public.service_job_blockers for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1
          from public.service_jobs j
          where j.id = service_job_blockers.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );

create policy "svc_blockers_insert" on public.service_job_blockers for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1
          from public.service_jobs j
          where j.id = service_job_blockers.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );

create policy "svc_blockers_update" on public.service_job_blockers for update
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1
          from public.service_jobs j
          where j.id = service_job_blockers.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1
          from public.service_jobs j
          where j.id = service_job_blockers.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );

-- ── service parts ------------------------------------------------------------

drop policy if exists "spr_select" on public.service_parts_requirements;
drop policy if exists "spr_insert" on public.service_parts_requirements;
drop policy if exists "spr_update" on public.service_parts_requirements;

drop policy if exists "spa_select" on public.service_parts_actions;
drop policy if exists "spa_insert" on public.service_parts_actions;
drop policy if exists "spa_update" on public.service_parts_actions;
drop policy if exists "spa_delete" on public.service_parts_actions;

drop policy if exists "sps_select" on public.service_parts_staging;
drop policy if exists "sps_insert" on public.service_parts_staging;

create policy "spr_select" on public.service_parts_requirements for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'parts_counter'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1 from public.service_jobs j
          where j.id = service_parts_requirements.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );

create policy "spr_insert" on public.service_parts_requirements for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'parts_counter'
    )
  );

create policy "spr_update" on public.service_parts_requirements for update
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'parts_counter'
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'parts_counter'
    )
  );

create policy "spa_select" on public.service_parts_actions for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'parts_counter'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1 from public.service_jobs j
          where j.id = service_parts_actions.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );

create policy "spa_insert" on public.service_parts_actions for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'parts_counter'
    )
  );

create policy "spa_update" on public.service_parts_actions for update
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'parts_counter'
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'parts_counter'
    )
  );

create policy "spa_delete" on public.service_parts_actions for delete
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'admin', 'manager', 'owner', 'service_writer', 'parts_counter'
    )
  );

create policy "sps_select" on public.service_parts_staging for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'parts_counter'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1 from public.service_jobs j
          where j.id = service_parts_staging.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );

create policy "sps_insert" on public.service_parts_staging for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'parts_counter'
    )
  );

-- ── quote / TAT / notification / completion surfaces ------------------------

drop policy if exists "sq_select" on public.service_quotes;
drop policy if exists "sq_insert" on public.service_quotes;
drop policy if exists "sq_update" on public.service_quotes;
drop policy if exists "sql_select" on public.service_quote_lines;
drop policy if exists "sql_insert" on public.service_quote_lines;
drop policy if exists "sql_update" on public.service_quote_lines;
drop policy if exists "sql_delete" on public.service_quote_lines;
drop policy if exists "sqa_select" on public.service_quote_approvals;
drop policy if exists "sqa_insert" on public.service_quote_approvals;
drop policy if exists "tat_select" on public.service_tat_metrics;
drop policy if exists "tat_insert" on public.service_tat_metrics;
drop policy if exists "tat_update" on public.service_tat_metrics;
drop policy if exists "scn_select" on public.service_customer_notifications;
drop policy if exists "scn_insert" on public.service_customer_notifications;
drop policy if exists "mkn_select" on public.machine_knowledge_notes;
drop policy if exists "mkn_insert" on public.machine_knowledge_notes;
drop policy if exists "scf_select" on public.service_completion_feedback;
drop policy if exists "scf_insert" on public.service_completion_feedback;
drop policy if exists "scf_update" on public.service_completion_feedback;

create policy "sq_select" on public.service_quotes for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'finance_admin'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1 from public.service_jobs j
          where j.id = service_quotes.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );
create policy "sq_insert" on public.service_quotes for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'finance_admin'
    )
  );
create policy "sq_update" on public.service_quotes for update
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'finance_admin'
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'finance_admin'
    )
  );

create policy "sql_select" on public.service_quote_lines for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'finance_admin'
    )
  );
create policy "sql_insert" on public.service_quote_lines for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'finance_admin'
    )
  );
create policy "sql_update" on public.service_quote_lines for update
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'finance_admin'
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'finance_admin'
    )
  );
create policy "sql_delete" on public.service_quote_lines for delete
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'finance_admin'
    )
  );

create policy "sqa_select" on public.service_quote_approvals for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'finance_admin'
    )
  );
create policy "sqa_insert" on public.service_quote_approvals for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'finance_admin'
    )
  );

create policy "tat_select" on public.service_tat_metrics for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1 from public.service_jobs j
          where j.id = service_tat_metrics.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );
create policy "tat_insert" on public.service_tat_metrics for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  );
create policy "tat_update" on public.service_tat_metrics for update
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  );

create policy "scn_select" on public.service_customer_notifications for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  );
create policy "scn_insert" on public.service_customer_notifications for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  );

create policy "mkn_select" on public.machine_knowledge_notes for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and (
          source_user_id = (select auth.uid())
          or exists (
            select 1 from public.service_jobs j
            where j.id = machine_knowledge_notes.job_id
              and j.workspace_id = (select public.get_my_workspace())
              and j.technician_id = (select auth.uid())
          )
        )
      )
    )
  );
create policy "mkn_insert" on public.machine_knowledge_notes for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and source_user_id = (select auth.uid())
        and (
          job_id is null
          or exists (
            select 1 from public.service_jobs j
            where j.id = machine_knowledge_notes.job_id
              and j.workspace_id = (select public.get_my_workspace())
              and j.technician_id = (select auth.uid())
          )
        )
      )
    )
  );

create policy "scf_select" on public.service_completion_feedback for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1 from public.service_jobs j
          where j.id = service_completion_feedback.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );
create policy "scf_insert" on public.service_completion_feedback for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and submitted_by = (select auth.uid())
        and exists (
          select 1 from public.service_jobs j
          where j.id = service_completion_feedback.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );
create policy "scf_update" on public.service_completion_feedback for update
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and submitted_by = (select auth.uid())
        and exists (
          select 1 from public.service_jobs j
          where j.id = service_completion_feedback.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and submitted_by = (select auth.uid())
        and exists (
          select 1 from public.service_jobs j
          where j.id = service_completion_feedback.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );

-- ── job-code observations and technician performance ------------------------

drop policy if exists "jco_select" on public.job_code_observations;
drop policy if exists "jco_insert" on public.job_code_observations;
drop policy if exists "tech_perf_select" on public.technician_job_performance;
drop policy if exists "tech_perf_insert" on public.technician_job_performance;

create policy "jco_select" on public.job_code_observations for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1 from public.service_jobs j
          where j.id = job_code_observations.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );

create policy "jco_insert" on public.job_code_observations for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and technician_id = (select auth.uid())
        and exists (
          select 1 from public.service_jobs j
          where j.id = job_code_observations.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );

create policy "tech_perf_select" on public.technician_job_performance for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'finance_admin'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1 from public.service_jobs j
          where j.id = technician_job_performance.job_id
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );

create policy "tech_perf_insert" on public.technician_job_performance for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  );

-- ── service_timecards --------------------------------------------------------

drop policy if exists "tc_workspace" on public.service_timecards;
drop policy if exists "tc_ops_all" on public.service_timecards;
drop policy if exists "tc_technician_own" on public.service_timecards;
drop policy if exists "tc_ops_select" on public.service_timecards;
drop policy if exists "tc_ops_insert" on public.service_timecards;
drop policy if exists "tc_ops_update" on public.service_timecards;
drop policy if exists "tc_ops_delete" on public.service_timecards;
drop policy if exists "tc_finance_select" on public.service_timecards;
drop policy if exists "tc_technician_select" on public.service_timecards;
drop policy if exists "tc_technician_insert" on public.service_timecards;
drop policy if exists "tc_technician_update" on public.service_timecards;

create policy "tc_ops_select" on public.service_timecards for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  );

create policy "tc_ops_insert" on public.service_timecards for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  );

create policy "tc_ops_update" on public.service_timecards for update
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  );

create policy "tc_ops_delete" on public.service_timecards for delete
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
  );

create policy "tc_finance_select" on public.service_timecards for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'finance_admin'
  );

create policy "tc_technician_select" on public.service_timecards for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'technician'
    and technician_id = (select auth.uid())
    and exists (
      select 1 from public.service_jobs j
      where j.id = service_timecards.service_job_id
        and j.workspace_id = (select public.get_my_workspace())
        and j.technician_id = (select auth.uid())
    )
  );

create policy "tc_technician_insert" on public.service_timecards for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'technician'
    and technician_id = (select auth.uid())
    and exists (
      select 1 from public.service_jobs j
      where j.id = service_timecards.service_job_id
        and j.workspace_id = (select public.get_my_workspace())
        and j.technician_id = (select auth.uid())
    )
  );

create policy "tc_technician_update" on public.service_timecards for update
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'technician'
    and technician_id = (select auth.uid())
    and exists (
      select 1 from public.service_jobs j
      where j.id = service_timecards.service_job_id
        and j.workspace_id = (select public.get_my_workspace())
        and j.technician_id = (select auth.uid())
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'technician'
    and technician_id = (select auth.uid())
    and exists (
      select 1 from public.service_jobs j
      where j.id = service_timecards.service_job_id
        and j.workspace_id = (select public.get_my_workspace())
        and j.technician_id = (select auth.uid())
    )
  );

-- ── service_job_segments -----------------------------------------------------

drop policy if exists "service_job_segments_service_ops_all" on public.service_job_segments;
drop policy if exists "service_job_segments_technician_select" on public.service_job_segments;
drop policy if exists "service_job_segments_finance_select" on public.service_job_segments;

create policy "service_job_segments_service_ops_all"
  on public.service_job_segments for all
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('service_writer', 'dispatch')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('service_writer', 'dispatch')
  );

create policy "service_job_segments_technician_select"
  on public.service_job_segments for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'technician'
    and exists (
      select 1 from public.service_jobs j
      where j.id = service_job_segments.service_job_id
        and j.workspace_id = (select public.get_my_workspace())
        and j.technician_id = (select auth.uid())
    )
  );

create policy "service_job_segments_finance_select"
  on public.service_job_segments for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'finance_admin'
  );

-- ── service billing ledgers --------------------------------------------------

drop policy if exists "service_labor_ledger_finance_all" on public.service_labor_ledger;
drop policy if exists "service_billing_rows_finance_all" on public.service_billing_rows;

create policy "service_labor_ledger_finance_all"
  on public.service_labor_ledger for all
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'finance_admin'
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'finance_admin'
  );

create policy "service_billing_rows_finance_all"
  on public.service_billing_rows for all
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'finance_admin'
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'finance_admin'
  );

-- ── consumed-parts billing staging and override audit -----------------------

drop policy if exists "spio_select" on public.service_parts_inventory_overrides;
drop policy if exists "spio_insert" on public.service_parts_inventory_overrides;
drop policy if exists "sibls_select" on public.service_internal_billing_line_staging;
drop policy if exists "sibls_insert" on public.service_internal_billing_line_staging;
drop policy if exists "sibls_update" on public.service_internal_billing_line_staging;
drop policy if exists "sibls_delete" on public.service_internal_billing_line_staging;

create policy "spio_select" on public.service_parts_inventory_overrides for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'parts_counter'
    )
  );

create policy "spio_insert" on public.service_parts_inventory_overrides for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
  );

create policy "sibls_select" on public.service_internal_billing_line_staging for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'parts_counter', 'finance_admin'
    )
  );

create policy "sibls_insert" on public.service_internal_billing_line_staging for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'parts_counter', 'finance_admin'
    )
  );

create policy "sibls_update" on public.service_internal_billing_line_staging for update
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'finance_admin'
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'finance_admin'
    )
  );

create policy "sibls_delete" on public.service_internal_billing_line_staging for delete
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
  );

-- ── customer invoices / invoice lines ---------------------------------------

drop policy if exists "invoices_internal" on public.customer_invoices;
drop policy if exists "cili_select" on public.customer_invoice_line_items;
drop policy if exists "cili_insert" on public.customer_invoice_line_items;
drop policy if exists "cili_update" on public.customer_invoice_line_items;
drop policy if exists "cili_delete" on public.customer_invoice_line_items;

create policy "invoices_internal" on public.customer_invoices for all
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'finance_admin'
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'finance_admin'
    )
  );

create policy "cili_select" on public.customer_invoice_line_items for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'finance_admin'
    )
  );

create policy "cili_insert" on public.customer_invoice_line_items for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'finance_admin'
    )
  );

create policy "cili_update" on public.customer_invoice_line_items for update
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'finance_admin'
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'finance_admin'
    )
  );

create policy "cili_delete" on public.customer_invoice_line_items for delete
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
  );
