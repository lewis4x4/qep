-- ============================================================================
-- Migration 108: DB-backed TAT targets, parts_inventory MVP, planner rules JSON
-- ============================================================================

-- ── TAT targets per workspace + stage (fallback in edge code if no row)
create table if not exists public.service_tat_targets (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  current_stage text not null,
  target_hours numeric(10, 2) not null check (target_hours > 0),
  machine_down_target_hours numeric(10, 2) not null check (machine_down_target_hours > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, current_stage)
);

comment on table public.service_tat_targets is
  'Per-stage TAT hours; service-tat-monitor uses these when present, else built-in defaults.';

alter table public.service_tat_targets enable row level security;

create policy "stt_select" on public.service_tat_targets for select
  using (workspace_id = public.get_my_workspace());

create policy "stt_insert" on public.service_tat_targets for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "stt_update" on public.service_tat_targets for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "stt_delete" on public.service_tat_targets for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "stt_service_all" on public.service_tat_targets for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_service_tat_targets_ws on public.service_tat_targets(workspace_id);

create trigger set_service_tat_targets_updated_at
  before update on public.service_tat_targets for each row
  execute function public.set_updated_at();

-- ── Branch on-hand inventory (MVP for parts planner stock-first path)
create table if not exists public.parts_inventory (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  branch_id text not null,
  part_number text not null,
  qty_on_hand integer not null default 0 check (qty_on_hand >= 0),
  bin_location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, branch_id, part_number)
);

comment on table public.parts_inventory is
  'Minimal branch part stock for service parts planner (pick vs order).';

alter table public.parts_inventory enable row level security;

create policy "pi_select" on public.parts_inventory for select
  using (workspace_id = public.get_my_workspace());

create policy "pi_insert" on public.parts_inventory for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "pi_update" on public.parts_inventory for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "pi_delete" on public.parts_inventory for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "pi_service_all" on public.parts_inventory for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_parts_inventory_ws_branch on public.parts_inventory(workspace_id, branch_id)
  where deleted_at is null;

-- ── Planner rule JSON on branch config
alter table public.service_branch_config
  add column if not exists planner_rules jsonb not null default '{}'::jsonb;

comment on column public.service_branch_config.planner_rules is
  'Optional: priority order (stock vs transfer vs order), machine-down overrides; exposed in planner API metadata.';
