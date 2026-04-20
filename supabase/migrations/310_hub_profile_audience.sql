-- ============================================================================
-- Migration 310: Hub — profile audience + get_my_audience() helper
--
-- Foundation for the Stakeholder Build Hub (/brief). Extends the existing
-- role-based model to support a second population: external client
-- stakeholders (Ryan, Rylee, Juan, Angela at QEP USA) who need a narrow,
-- audience-gated view of build progress, feedback, and decisions.
--
-- Design decisions (locked in plan review):
--   * Single-tenant preserved: workspace_id stays 'default'. No new workspace.
--   * Audience is a new independent axis on profiles:
--       audience = 'internal' (reps/managers/owners/admins at QEP USA that
--                              operate the platform) or 'stakeholder' (the
--                              four named QEP OS build observers).
--   * New role 'client_stakeholder' added to user_role so RLS can gate
--     write operations (they can only insert feedback + comments).
--   * stakeholder_subrole drives briefing personalization downstream
--     (owner = Ryan, primary_contact = Rylee, technical = Juan, admin = Angela).
--   * get_my_audience() mirrors get_my_role() — SECURITY DEFINER, stable,
--     reads profiles.audience without triggering RLS recursion.
--
-- NOTE: 'client_stakeholder' is added to the enum here but is intentionally
-- NOT referenced in this migration. Subsequent migrations (311-315) use
-- get_my_audience() in policies, not direct role comparisons, so the
-- "new enum value can't be used in the same transaction" PG constraint
-- is avoided.
-- ============================================================================

-- ── 1. Extend user_role enum ────────────────────────────────────────────────

alter type public.user_role add value if not exists 'client_stakeholder';

-- ── 2. Add audience + subrole to profiles ───────────────────────────────────

alter table public.profiles
  add column if not exists audience text not null default 'internal'
    check (audience in ('internal', 'stakeholder'));

alter table public.profiles
  add column if not exists stakeholder_subrole text
    check (stakeholder_subrole is null or stakeholder_subrole in (
      'owner', 'primary_contact', 'technical', 'admin'
    ));

comment on column public.profiles.audience is
  'Audience classification for the Stakeholder Build Hub. '
  'internal = QEP USA operator (reps/managers/owners/admins). '
  'stakeholder = external client observer (Ryan/Rylee/Juan/Angela). '
  'Gated via public.get_my_audience() in /brief routes.';

comment on column public.profiles.stakeholder_subrole is
  'Subrole within audience=stakeholder. Drives personalized morning briefs: '
  'owner=executive/financial framing, primary_contact=UX/flow, '
  'technical=integration/data, admin=operations. Null for internal audience.';

-- ── 3. Helper: get_my_audience() ────────────────────────────────────────────
-- Same shape as get_my_role() in migration 005. SECURITY DEFINER bypasses
-- RLS so policies can call it without recursion.

create or replace function public.get_my_audience()
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select audience from public.profiles where id = auth.uid();
$$;

comment on function public.get_my_audience() is
  'Returns the authenticated caller''s audience classification '
  '(''internal'' or ''stakeholder'') without triggering RLS recursion. '
  'Used by hub_* RLS policies to gate stakeholder-facing surfaces.';

grant execute on function public.get_my_audience() to authenticated, service_role;

-- ── 4. Helper: get_my_stakeholder_subrole() ─────────────────────────────────
-- Lets edge functions (stakeholder-morning-brief) personalize without a
-- second round-trip to profiles. Returns null for internal audience.

create or replace function public.get_my_stakeholder_subrole()
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select stakeholder_subrole from public.profiles where id = auth.uid();
$$;

grant execute on function public.get_my_stakeholder_subrole() to authenticated, service_role;
