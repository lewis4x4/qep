-- ============================================================================
-- Migration 561: historical PDI actuals + rolling average view
--
-- Supports quote step prefill using real historical prep costs by make/model.
-- ============================================================================

create table if not exists public.pdi_actuals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  make text not null,
  model text not null,
  model_year integer,
  stock_number text,
  service_order_number text,
  completed_at timestamptz not null default now(),
  pdi_cost numeric(12,2) not null check (pdi_cost >= 0),
  notes text,
  source text not null default 'manual_entry',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_pdi_actuals_workspace_model
  on public.pdi_actuals (workspace_id, lower(make), lower(model), completed_at desc)
  where deleted_at is null;

create index if not exists idx_pdi_actuals_workspace_completed
  on public.pdi_actuals (workspace_id, completed_at desc)
  where deleted_at is null;

create or replace view public.pdi_average_by_model as
with scoped as (
  select
    workspace_id,
    lower(trim(make)) as make_key,
    lower(trim(model)) as model_key,
    make,
    model,
    pdi_cost,
    completed_at
  from public.pdi_actuals
  where deleted_at is null
)
select
  workspace_id,
  make_key as make,
  model_key as model,
  round(avg(pdi_cost)::numeric, 2) as avg_pdi_cost,
  count(*)::integer as sample_count,
  max(completed_at) as last_completed_at
from scoped
group by workspace_id, make_key, model_key;

alter table public.pdi_actuals enable row level security;

drop policy if exists "pdi_actuals_select_workspace" on public.pdi_actuals;
create policy "pdi_actuals_select_workspace"
  on public.pdi_actuals
  for select
  using (
    (select public.get_my_workspace()) is not null
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

drop policy if exists "pdi_actuals_write_manager_owner_admin" on public.pdi_actuals;
create policy "pdi_actuals_write_manager_owner_admin"
  on public.pdi_actuals
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

comment on table public.pdi_actuals is
  'Historical actual prep/PDI costs used to prefill quote pricing with model-specific rolling averages.';

comment on view public.pdi_average_by_model is
  'Workspace-scoped rolling average PDI cost by make/model for quote prefill.';
