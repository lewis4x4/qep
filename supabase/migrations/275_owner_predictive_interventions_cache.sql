-- ============================================================================
-- Migration 275: owner_predictive_interventions_cache
--
-- 30-minute cache for the Claude-generated forward-scenario payload on /owner.
-- Keyed per workspace.
-- ============================================================================

create table if not exists public.owner_predictive_interventions_cache (
  workspace_id text primary key,
  payload jsonb not null,
  model text,
  tokens_in integer,
  tokens_out integer,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.owner_predictive_interventions_cache enable row level security;

drop policy if exists owner_predictive_interventions_cache_select
  on public.owner_predictive_interventions_cache;
create policy owner_predictive_interventions_cache_select
  on public.owner_predictive_interventions_cache
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('owner', 'admin', 'manager')
    )
  );

comment on table public.owner_predictive_interventions_cache is
  '30-min cache for Claude-generated forward scenarios on /owner. Keyed per workspace.';

grant select on public.owner_predictive_interventions_cache to authenticated;
