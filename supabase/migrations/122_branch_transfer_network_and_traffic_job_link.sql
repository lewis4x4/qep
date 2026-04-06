-- ============================================================================
-- Migration 122: Branch transfer network (P0-A) + Traffic ↔ service job link
-- Planner uses edges for transfer lead times; parts transfer tickets reference job.
-- ============================================================================

create table if not exists public.branch_transfer_edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  from_branch text not null,
  to_branch text not null,
  lead_time_hours numeric(8, 2) not null default 8.0
    check (lead_time_hours >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, from_branch, to_branch)
);

comment on table public.branch_transfer_edges is
  'Directed edges for inter-branch parts transfer lead times (planner scoring).';

alter table public.branch_transfer_edges enable row level security;

create policy "bte_select" on public.branch_transfer_edges for select
  using (workspace_id = public.get_my_workspace());

create policy "bte_insert" on public.branch_transfer_edges for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "bte_update" on public.branch_transfer_edges for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "bte_delete" on public.branch_transfer_edges for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "bte_service_all" on public.branch_transfer_edges for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_branch_transfer_edges_ws on public.branch_transfer_edges(workspace_id)
  where active = true;

create trigger set_branch_transfer_edges_updated_at
  before update on public.branch_transfer_edges for each row
  execute function public.set_updated_at();

alter table public.traffic_tickets
  add column if not exists service_job_id uuid references public.service_jobs(id) on delete set null;

comment on column public.traffic_tickets.service_job_id is
  'Optional link when ticket is created for service/parts (e.g. inter-branch transfer).';

create index if not exists idx_traffic_tickets_service_job
  on public.traffic_tickets(service_job_id)
  where service_job_id is not null;
