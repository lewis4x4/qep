-- ============================================================================
-- Migration 098: Service Engine — Security hardening & haul linkage
--
-- 1. traffic_ticket_id FK on service_jobs (integrity vs billing_comments parsing)
-- 2. Tighten RLS: only rep/admin/manager/owner may insert/update service_jobs
-- ============================================================================

-- ── Haul linkage column ───────────────────────────────────────────────────────

alter table public.service_jobs
  add column if not exists traffic_ticket_id uuid references public.traffic_tickets(id) on delete set null;

create index if not exists idx_svc_jobs_traffic_ticket
  on public.service_jobs(traffic_ticket_id)
  where traffic_ticket_id is not null;

comment on column public.service_jobs.traffic_ticket_id is
  'Traffic ticket for service haul. Preferred link over parsing billing_comments.';

-- ── RLS: restrict mutating roles on service_jobs ─────────────────────────────

drop policy if exists "svc_jobs_insert" on public.service_jobs;
drop policy if exists "svc_jobs_update" on public.service_jobs;

create policy "svc_jobs_insert" on public.service_jobs for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "svc_jobs_update" on public.service_jobs for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

-- Allow replanning: delete incomplete parts actions (parts planner)
drop policy if exists "spa_delete" on public.service_parts_actions;
create policy "spa_delete" on public.service_parts_actions for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );
