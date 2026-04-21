-- ============================================================================
-- Migration 313: Hub — decisions log
--
-- The provenance layer. Every hub_build_items row that represents a deliberate
-- product choice (vs. routine maintenance) links to one or more hub_decisions
-- rows, which themselves link to a NotebookLM source (the meeting transcript,
-- email thread, or spec where the decision was actually made).
--
-- This is the moonshot differentiator: "why was this built?" always has a
-- receipt. Decisions are interrogable, not frozen.
--
-- Design decisions (locked):
--   * notebooklm_source_id is a soft FK to hub_knowledge_source (migration 314).
--     We don't hard-FK because sources are mirrored from Drive on a cron and
--     may lag behind decisions logged in the hub.
--   * decided_by is text[] not uuid[] — decisions often involve stakeholders
--     who aren't users in this system (a Brian + Rylee + Ryan call produces
--     a decision even though only Brian has a profile).
--   * related_build_item_ids is an array, not a junction table — keeps the
--     v1 simple. Promote to a junction when we need many-to-many queries.
--
-- RLS:
--   * Everyone in workspace reads.
--   * Internal admin/owner writes.
-- ============================================================================

create table if not exists public.hub_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  title text not null,
  context text not null,
  decision text not null,
  decided_by text[] not null default '{}',
  affects_modules text[] not null default '{}',
  notebooklm_source_id uuid,
  related_build_item_ids uuid[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.hub_decisions is
  'Stakeholder Build Hub: decision log. Every meaningful build choice links '
  'back to a decision here, which links to the NotebookLM source of truth '
  '(transcript/email/spec). Enables "why was this built?" provenance.';

comment on column public.hub_decisions.notebooklm_source_id is
  'Soft reference to hub_knowledge_source.id. Not a hard FK because sources '
  'are mirrored from Google Drive on a cron and may lag behind decisions.';

create index if not exists idx_hub_decisions_workspace_created
  on public.hub_decisions (workspace_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_hub_decisions_source
  on public.hub_decisions (notebooklm_source_id)
  where deleted_at is null and notebooklm_source_id is not null;

-- GIN index for the array columns — lets us query "decisions that affect
-- the parts module" or "decisions that touched build item X" efficiently.
create index if not exists idx_hub_decisions_affects_modules_gin
  on public.hub_decisions using gin (affects_modules);

create index if not exists idx_hub_decisions_related_items_gin
  on public.hub_decisions using gin (related_build_item_ids);

drop trigger if exists set_hub_decisions_updated_at on public.hub_decisions;
create trigger set_hub_decisions_updated_at
  before update on public.hub_decisions
  for each row execute function public.set_updated_at();

alter table public.hub_decisions enable row level security;

create policy hub_decisions_service_all on public.hub_decisions
  for all to service_role using (true) with check (true);

create policy hub_decisions_workspace_read on public.hub_decisions
  for select
  using (
    workspace_id = public.get_my_workspace()
    and deleted_at is null
  );

create policy hub_decisions_admin_insert on public.hub_decisions
  for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_audience() = 'internal'
    and public.get_my_role() in ('admin', 'owner')
  );

create policy hub_decisions_admin_update on public.hub_decisions
  for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_audience() = 'internal'
    and public.get_my_role() in ('admin', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_audience() = 'internal'
    and public.get_my_role() in ('admin', 'owner')
  );

grant select on public.hub_decisions to authenticated;
grant insert, update on public.hub_decisions to authenticated;
