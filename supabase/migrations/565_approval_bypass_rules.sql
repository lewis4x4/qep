-- ============================================================================
-- Migration 565: approval bypass rules for aged/hot inventory
-- ============================================================================

create table if not exists public.approval_bypass_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  rule_name text not null,
  active boolean not null default true,
  min_stock_age_days integer,
  requires_in_stock boolean not null default false,
  requires_hot_list boolean not null default false,
  min_margin_pct numeric(6,2),
  max_discount_pct numeric(6,2),
  bypass_to_status text not null default 'approved',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_approval_bypass_rules_workspace_active
  on public.approval_bypass_rules (workspace_id, active)
  where deleted_at is null;

alter table public.approval_bypass_rules enable row level security;

drop policy if exists "approval_bypass_rules_select_workspace" on public.approval_bypass_rules;
create policy "approval_bypass_rules_select_workspace"
  on public.approval_bypass_rules
  for select
  using (
    (select public.get_my_workspace()) is not null
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

drop policy if exists "approval_bypass_rules_write_manager_owner_admin" on public.approval_bypass_rules;
create policy "approval_bypass_rules_write_manager_owner_admin"
  on public.approval_bypass_rules
  for all
  using (
    (select public.get_my_workspace()) is not null
    and workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('manager', 'owner', 'admin')
  )
  with check (
    (select public.get_my_workspace()) is not null
    and workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('manager', 'owner', 'admin')
  );

insert into public.approval_bypass_rules (
  workspace_id,
  rule_name,
  active,
  min_stock_age_days,
  requires_in_stock,
  requires_hot_list,
  min_margin_pct,
  bypass_to_status,
  metadata
)
select
  p.active_workspace_id,
  'Aged stocked inventory auto-approve',
  true,
  365,
  true,
  false,
  8.00,
  'approved',
  jsonb_build_object('seeded_by', '565_approval_bypass_rules')
from public.profiles p
where p.active_workspace_id is not null
  and p.role in ('owner', 'admin')
  and not exists (
    select 1
    from public.approval_bypass_rules r
    where r.workspace_id = p.active_workspace_id
      and r.rule_name = 'Aged stocked inventory auto-approve'
      and r.deleted_at is null
  );
