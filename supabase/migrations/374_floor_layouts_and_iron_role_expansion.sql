-- ============================================================================
-- Migration 374: The Floor — layouts table, floor_mode flag, and Iron role
--                expansion to cover owner, parts_counter, parts_manager.
--
-- The Floor (Slice 21-follow-on) is a simplified, role-aware landing surface
-- that sits alongside the existing per-role Iron dashboards. Brian curates
-- each role's Floor from the existing widget registry (no widget code
-- changes); the layout is stored per (workspace_id, iron_role) and gated
-- to a hard cap of 6 widgets so the surface can never drift back into
-- IntelliDealer density.
--
-- This migration does four things:
--
--   1. Extends the `iron_role` enum-like CHECK constraint on the two places
--      it lives (profiles, profile_role_blend) to add `iron_owner`,
--      `iron_parts_counter`, and `iron_parts_manager`. These cover QEP team
--      members the 4-role model couldn't — Ryan (owner), Juan/Bobby (parts
--      counter), Norman (parts manager).
--
--   2. Adds `profiles.floor_mode boolean` — when true, the user lands on
--      /floor (simplified) instead of /dashboard (existing dense Iron
--      dashboard). Default false preserves current behavior; Brian flips
--      it per-user as reps onboard to The Floor.
--
--   3. Creates `public.floor_layouts` — one row per (workspace, iron_role),
--      holding a jsonb `layout_json` with widget ids + quick actions.
--      A CHECK constraint hard-caps the widget array at 6 elements so the
--      Floor can never balloon regardless of UI state.
--
--   4. RLS: any workspace member can SELECT their own layout (so the Floor
--      can render for them), only admin/owner can write. Service role
--      bypass for future edge-function composers.
--
-- Naming note: the IRON role system uses the IronRole TS literal union on
-- the frontend (apps/web/src/features/qrm/lib/iron-roles.ts). This
-- migration's CHECK values are the source of truth; the frontend union
-- must be updated in the same slice to keep them in sync.
-- ============================================================================

-- ── 1. Extend iron_role CHECK constraints ────────────────────────────────────

-- The iron_role column on profiles was added in migration 067 with a 4-role
-- CHECK. Postgres doesn't let us ALTER a CHECK by name cleanly, so we drop
-- the implicit constraint (generated name) by reissuing the column spec,
-- then add a named constraint so future migrations can target it precisely.
--
-- Drop any existing check constraint on iron_role (auto-named by migration
-- 067). We look up the constraint name dynamically — the auto-generated
-- name varies across environments, so a hardcoded DROP CONSTRAINT by name
-- is unsafe.

do $$
declare
  v_constraint_name text;
begin
  select conname
    into v_constraint_name
  from pg_constraint
  where conrelid = 'public.profiles'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%iron_role%';

  if v_constraint_name is not null then
    execute format('alter table public.profiles drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.profiles
  add constraint profiles_iron_role_check
  check (iron_role in (
    'iron_manager',
    'iron_advisor',
    'iron_woman',
    'iron_man',
    'iron_owner',
    'iron_parts_counter',
    'iron_parts_manager'
  ));

comment on constraint profiles_iron_role_check on public.profiles is
  'Allowed iron_role values. Extended in migration 374 to cover owner + parts roles for QEP team.';

-- Same extension on profile_role_blend (migration 210). This table's
-- constraint IS named in its original migration, so we can drop by name.

alter table public.profile_role_blend
  drop constraint if exists profile_role_blend_iron_role_check;

-- The original constraint in 210 was inline, so it was auto-named. Same
-- lookup pattern to drop safely.
do $$
declare
  v_constraint_name text;
begin
  select conname
    into v_constraint_name
  from pg_constraint
  where conrelid = 'public.profile_role_blend'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%iron_role%';

  if v_constraint_name is not null then
    execute format('alter table public.profile_role_blend drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.profile_role_blend
  add constraint profile_role_blend_iron_role_check
  check (iron_role in (
    'iron_manager',
    'iron_advisor',
    'iron_woman',
    'iron_man',
    'iron_owner',
    'iron_parts_counter',
    'iron_parts_manager'
  ));

comment on constraint profile_role_blend_iron_role_check on public.profile_role_blend is
  'Allowed iron_role values — kept in sync with profiles_iron_role_check.';

-- ── 2. profiles.floor_mode flag ──────────────────────────────────────────────

alter table public.profiles
  add column if not exists floor_mode boolean not null default false;

comment on column public.profiles.floor_mode is
  'When true, user lands on /floor (simplified, Brian-curated) instead of /dashboard (Iron per-role dense). Default false; Brian flips per-user as reps onboard to The Floor. Slice: The Floor.';

-- Index — the router checks this on every dashboard load. Small cardinality
-- (boolean), so a filtered partial index keeps it compact.
create index if not exists idx_profiles_floor_mode
  on public.profiles (floor_mode)
  where floor_mode = true;

-- ── 3. floor_layouts table ───────────────────────────────────────────────────

create table if not exists public.floor_layouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),

  -- One layout per (workspace, role). The entire QEP sales-manager team
  -- shares one layout in v1; per-user layouts are a Phase-2 item.
  iron_role text not null
    check (iron_role in (
      'iron_manager',
      'iron_advisor',
      'iron_woman',
      'iron_man',
      'iron_owner',
      'iron_parts_counter',
      'iron_parts_manager'
    )),

  -- The layout payload. Shape is frontend-enforced via TS types, but the
  -- DB guards two invariants with CHECK constraints below:
  --   1. `widgets` is an array (jsonb type check).
  --   2. `widgets` length <= 6 (the Floor's simplicity cap).
  --
  -- Example shape:
  --   {
  --     "widgets": [
  --       { "id": "iron.approval-queue", "order": 0 },
  --       { "id": "iron.pipeline-by-rep", "order": 1 }
  --     ],
  --     "quickActions": [
  --       { "id": "new_quote", "label": "NEW QUOTE", "route": "/quote-v2" }
  --     ],
  --     "showNarrative": true
  --   }
  layout_json jsonb not null default '{}'::jsonb,

  -- Who last edited — used to surface "Rylee edited this 2d ago" in the
  -- composer. Null-safe on user deletion.
  updated_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, iron_role),

  -- Hard cap: max 6 widgets per role layout. Enforced in the DB so the
  -- invariant survives any UI bug or direct SQL insert. The `coalesce`
  -- handles empty-object default: `{}` has no `widgets` key, so
  -- `layout_json -> 'widgets'` is null, and `jsonb_array_length(null)`
  -- would error.
  constraint floor_layouts_widget_cap_6
    check (
      layout_json -> 'widgets' is null
      or jsonb_typeof(layout_json -> 'widgets') = 'array'
      and jsonb_array_length(layout_json -> 'widgets') <= 6
    ),

  -- Same guard for quickActions — cap at 3. The visual-language spec calls
  -- for 2 or 3 oversized buttons; past that, the hero zone loses impact.
  constraint floor_layouts_quick_actions_cap_3
    check (
      layout_json -> 'quickActions' is null
      or jsonb_typeof(layout_json -> 'quickActions') = 'array'
      and jsonb_array_length(layout_json -> 'quickActions') <= 3
    )
);

comment on table public.floor_layouts is
  'Per-(workspace, iron_role) Floor layout. Brian-curated widget list + quick actions. Hard-capped at 6 widgets + 3 quick actions via CHECK constraints. Slice: The Floor.';

comment on column public.floor_layouts.workspace_id is
  'Workspace scope. Defaults to get_my_workspace() — admin writes land in the caller''s workspace automatically.';
comment on column public.floor_layouts.iron_role is
  'Target role. One row per (workspace, role).';
comment on column public.floor_layouts.layout_json is
  'Layout payload: { widgets: [{id, order}], quickActions: [{id, label, route}], showNarrative: bool }. Widgets capped at 6, quickActions at 3.';
comment on column public.floor_layouts.updated_by is
  'Last editor — surfaced in the composer as audit context.';

-- updated_at trigger (reuses the project-wide set_updated_at function from
-- migration 001).
create trigger trg_floor_layouts_updated_at
  before update on public.floor_layouts
  for each row execute function public.set_updated_at();

-- Primary lookup: the Floor page loads one (workspace, role) row on every
-- render. The unique constraint creates the index implicitly, so no extra
-- explicit index needed for that path.

-- Secondary index for admin composer listing all roles in a workspace.
create index if not exists idx_floor_layouts_workspace_updated
  on public.floor_layouts (workspace_id, updated_at desc);

-- ── 4. RLS ───────────────────────────────────────────────────────────────────

alter table public.floor_layouts enable row level security;

-- Select: any authenticated user in the workspace can read their layout.
-- Role-gating happens in app logic (the router loads the user's own
-- iron_role), not in RLS — if a rep tried to query another role's layout
-- via PostgREST they'd succeed, and that's fine: layouts are not
-- sensitive data, they're UI configuration.
create policy "floor_layouts_select"
  on public.floor_layouts
  for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

-- Manage: only admin/manager/owner can edit. Reps never compose.
create policy "floor_layouts_manage"
  on public.floor_layouts
  for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

-- Service role bypass — future edge-function composers (e.g. a "reset to
-- defaults" batch job) run under service_role.
create policy "floor_layouts_service_all"
  on public.floor_layouts
  for all to service_role
  using (true) with check (true);

grant select, insert, update, delete on public.floor_layouts to authenticated;

-- ── 5. Seed the default workspace with hardcoded role defaults ──────────────
--
-- Mirror the starting layouts documented in docs/floor/widget-inventory.md
-- so any workspace that enables floor_mode has something coherent on
-- day one. Admins can then edit via /floor/compose.

insert into public.floor_layouts (workspace_id, iron_role, layout_json)
values
  ('default', 'iron_owner', jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'exec.owner-brief', 'order', 0),
      jsonb_build_object('id', 'nervous.customer-health', 'order', 1),
      jsonb_build_object('id', 'iron.inventory-aging', 'order', 2),
      jsonb_build_object('id', 'iron.approval-queue', 'order', 3)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'ask_iron', 'label', 'ASK IRON', 'route', '/iron'),
      jsonb_build_object('id', 'open_pipeline', 'label', 'OPEN PIPELINE', 'route', '/qrm')
    ),
    'showNarrative', true
  )),
  ('default', 'iron_manager', jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'exec.morning-brief', 'order', 0),
      jsonb_build_object('id', 'iron.approval-queue', 'order', 1),
      jsonb_build_object('id', 'iron.pipeline-by-rep', 'order', 2),
      jsonb_build_object('id', 'qrm.decision-room-scoreboard', 'order', 3),
      jsonb_build_object('id', 'iron.inventory-aging', 'order', 4)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'open_approvals', 'label', 'OPEN APPROVALS', 'route', '/qrm/approvals'),
      jsonb_build_object('id', 'new_quote', 'label', 'NEW QUOTE', 'route', '/quote-v2')
    ),
    'showNarrative', true
  )),
  ('default', 'iron_advisor', jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'sales.ai-briefing', 'order', 0),
      jsonb_build_object('id', 'sales.action-items', 'order', 1),
      jsonb_build_object('id', 'qrm.follow-up-queue', 'order', 2),
      jsonb_build_object('id', 'sales.day-summary', 'order', 3),
      jsonb_build_object('id', 'quote.deal-copilot-summary', 'order', 4)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'new_quote', 'label', 'NEW QUOTE', 'route', '/quote-v2'),
      jsonb_build_object('id', 'voice_capture', 'label', 'VOICE', 'route', '/voice'),
      jsonb_build_object('id', 'log_visit', 'label', 'LOG VISIT', 'route', '/qrm/visits/new')
    ),
    'showNarrative', true
  )),
  ('default', 'iron_parts_counter', jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'parts.serial-first', 'order', 0),
      jsonb_build_object('id', 'parts.quote-drafts', 'order', 1),
      jsonb_build_object('id', 'parts.order-status', 'order', 2),
      jsonb_build_object('id', 'parts.customer-intel', 'order', 3),
      jsonb_build_object('id', 'parts.replenish-queue', 'order', 4)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'new_parts_quote', 'label', 'NEW PARTS QUOTE', 'route', '/parts/new'),
      jsonb_build_object('id', 'lookup_serial', 'label', 'LOOKUP BY SERIAL', 'route', '/parts/lookup'),
      jsonb_build_object('id', 'open_drafts', 'label', 'OPEN DRAFTS', 'route', '/parts/drafts')
    ),
    'showNarrative', true
  )),
  ('default', 'iron_parts_manager', jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'parts.demand-forecast', 'order', 0),
      jsonb_build_object('id', 'parts.inventory-health', 'order', 1),
      jsonb_build_object('id', 'parts.replenish-queue', 'order', 2),
      jsonb_build_object('id', 'parts.order-status', 'order', 3),
      jsonb_build_object('id', 'iron.inventory-aging', 'order', 4)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'review_replenishments', 'label', 'REVIEW REPLEN', 'route', '/parts/replenish'),
      jsonb_build_object('id', 'stock_variance', 'label', 'STOCK VARIANCE', 'route', '/parts/variance')
    ),
    'showNarrative', true
  )),
  ('default', 'iron_woman', jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'iron.order-processing', 'order', 0),
      jsonb_build_object('id', 'iron.deposit-tracker', 'order', 1),
      jsonb_build_object('id', 'iron.credit-applications', 'order', 2),
      jsonb_build_object('id', 'iron.intake-progress', 'order', 3),
      jsonb_build_object('id', 'iron.approval-queue', 'order', 4)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'new_credit_app', 'label', 'CREDIT APP', 'route', '/credit/new'),
      jsonb_build_object('id', 'deposit_entry', 'label', 'DEPOSIT', 'route', '/deposits/new')
    ),
    'showNarrative', true
  )),
  ('default', 'iron_man', jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'iron.prep-queue', 'order', 0),
      jsonb_build_object('id', 'iron.pdi-checklists', 'order', 1),
      jsonb_build_object('id', 'iron.demo-schedule', 'order', 2),
      jsonb_build_object('id', 'iron.return-inspections', 'order', 3),
      jsonb_build_object('id', 'service.parts-hub-strip', 'order', 4)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'next_job', 'label', 'NEXT JOB', 'route', '/service/queue'),
      jsonb_build_object('id', 'pdi_checklist', 'label', 'PDI CHECKLIST', 'route', '/ops/pdi')
    ),
    'showNarrative', true
  ))
on conflict (workspace_id, iron_role) do nothing;
