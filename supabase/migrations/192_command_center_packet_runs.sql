-- ============================================================================
-- Migration 192: QEP Moonshot Command Center — Exec Packet Runs (Slice 6)
--
-- Audit table for executive packet generation. Each call to
-- exec-packet-generator inserts a row with the assembled markdown +
-- structured JSON snapshot of every KPI/alert at packet time. This is
-- the "frozen moment" the packet refers to so historical packets stay
-- legible even after underlying snapshots churn.
-- ============================================================================

create table if not exists public.exec_packet_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  role text not null check (role in ('ceo', 'cfo', 'coo')),
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now(),
  period_start date,
  period_end date,
  packet_md text not null,
  packet_json jsonb not null default '{}'::jsonb,
  metrics_count int not null default 0,
  alerts_count int not null default 0,
  delivery_target text,
  delivery_status text default 'generated' check (delivery_status in ('generated', 'previewed', 'downloaded', 'emailed')),
  delivered_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.exec_packet_runs is
  'QEP Command Center: audit + cache for exec-packet-generator runs. The packet_md and packet_json freeze the moment so historical packets stay readable.';

create index if not exists idx_epr_workspace_generated
  on public.exec_packet_runs(workspace_id, generated_at desc);
create index if not exists idx_epr_role_generated
  on public.exec_packet_runs(role, generated_at desc);
create index if not exists idx_epr_user
  on public.exec_packet_runs(generated_by, generated_at desc);

alter table public.exec_packet_runs enable row level security;

create policy "epr_owner_read" on public.exec_packet_runs
  for select using (
    public.get_my_role() = 'owner'
    and workspace_id = public.get_my_workspace()
  );

create policy "epr_owner_insert" on public.exec_packet_runs
  for insert with check (
    public.get_my_role() = 'owner'
    and workspace_id = public.get_my_workspace()
  );

create policy "epr_service_all" on public.exec_packet_runs
  for all to service_role using (true) with check (true);
