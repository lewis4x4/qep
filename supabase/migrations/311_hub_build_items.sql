-- ============================================================================
-- Migration 311: Hub — build items
--
-- The canonical catalog of things being built for QEP OS. Every stakeholder
-- view in /brief (dashboard tiles, feedback link-back, decision cross-refs,
-- changelog context) resolves to a row in hub_build_items.
--
-- Scope:
--   * Status lifecycle: planned → in_progress → needs_feedback → in_review → shipped.
--   * Module enum covers every QEP OS vertical (CRM, parts, service, rental,
--     financial) plus meta-modules (hub itself, DGE).
--   * demo_url: deep link a stakeholder can tap to "Try it now" against the
--     live feature. read-only when opened from /brief (banner enforced client-side).
--   * paperclip_issue_id / source_commit_sha: wire into the existing ticketing
--     and git trail so build items stay auditable back to their origin.
--
-- RLS:
--   * Stakeholders: read everything in their workspace. They cannot write.
--   * Internal admin/owner: full CRUD.
--   * Service role: unrestricted (edge functions seed and mutate).
-- ============================================================================

create table if not exists public.hub_build_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  module text not null check (module in (
    'crm', 'sales', 'parts', 'service', 'rental', 'financial', 'hub', 'dge'
  )),
  title text not null,
  description text,
  status text not null default 'planned' check (status in (
    'planned', 'in_progress', 'needs_feedback', 'in_review', 'shipped'
  )),
  sprint_number integer,
  paperclip_issue_id text,
  demo_url text,
  source_commit_sha text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  shipped_at timestamptz,
  deleted_at timestamptz
);

comment on table public.hub_build_items is
  'Stakeholder Build Hub: catalog of in-flight and shipped build items. '
  'Drives /brief dashboard tiles, feedback link-back, and changelog context.';

create index if not exists idx_hub_build_items_workspace_status
  on public.hub_build_items (workspace_id, status)
  where deleted_at is null;

create index if not exists idx_hub_build_items_module
  on public.hub_build_items (workspace_id, module)
  where deleted_at is null;

create index if not exists idx_hub_build_items_shipped_at
  on public.hub_build_items (workspace_id, shipped_at desc)
  where deleted_at is null and status = 'shipped';

drop trigger if exists set_hub_build_items_updated_at on public.hub_build_items;
create trigger set_hub_build_items_updated_at
  before update on public.hub_build_items
  for each row execute function public.set_updated_at();

alter table public.hub_build_items enable row level security;

create policy hub_build_items_service_all on public.hub_build_items
  for all to service_role using (true) with check (true);

-- Internal + stakeholder: read within own workspace
create policy hub_build_items_workspace_read on public.hub_build_items
  for select
  using (
    workspace_id = public.get_my_workspace()
    and deleted_at is null
  );

-- Writes: internal admin/owner only
create policy hub_build_items_admin_insert on public.hub_build_items
  for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_audience() = 'internal'
    and public.get_my_role() in ('admin', 'owner')
  );

create policy hub_build_items_admin_update on public.hub_build_items
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

grant select on public.hub_build_items to authenticated;
grant insert, update on public.hub_build_items to authenticated;
