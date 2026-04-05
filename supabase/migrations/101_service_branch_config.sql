-- ============================================================================
-- Migration 101: Branch-level service routing configuration
--
-- Supports role-based routing pools (advisor / tech) per branch.
-- ============================================================================

create table if not exists public.service_branch_config (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  branch_id text not null,
  default_advisor_pool jsonb not null default '[]'::jsonb,
  default_technician_pool jsonb not null default '[]'::jsonb,
  parts_team_notify_user_ids jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, branch_id)
);

comment on table public.service_branch_config is
  'Per-branch routing: advisor/tech UUID pools for load-balancing and reassignment.';

alter table public.service_branch_config enable row level security;

create policy "sbc_select" on public.service_branch_config for select
  using (workspace_id = public.get_my_workspace());

create policy "sbc_insert" on public.service_branch_config for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "sbc_update" on public.service_branch_config for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "sbc_delete" on public.service_branch_config for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "sbc_service_all" on public.service_branch_config for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_service_branch_config_workspace on public.service_branch_config(workspace_id);

create trigger set_service_branch_config_updated_at
  before update on public.service_branch_config for each row
  execute function public.set_updated_at();
