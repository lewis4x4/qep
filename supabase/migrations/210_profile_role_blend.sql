-- ============================================================================
-- Migration 210: Profile Role Blend (Phase 0 P0.5)
--
-- The QRM Moonshot roadmap requires a "role blend" — operators are not
-- exclusively one Iron role at a time. A manager covering an absent advisor
-- is BOTH iron_manager and iron_advisor for the duration of the cover. A
-- service writer pulled into a parts-approval flow is BOTH iron_woman and
-- iron_man for that case. Slice 1's ranker, the future Department Queues,
-- and the role-opinionated default views (Slices 3.31/3.32 in the addendum
-- merge) all need a weighted, time-bounded blend rather than the single
-- `profiles.iron_role` text column from migration 067.
--
-- This migration introduces the blend WITHOUT removing the existing
-- `profiles.iron_role` column. The single-role column remains the
-- backwards-compat shim until Phase 0 Day 9 (frontend adoption) and Phase 4
-- (full retirement). The trigger that auto-syncs `iron_role` from
-- `role + is_support` is extended here to ALSO upsert a row into
-- `profile_role_blend`, so the two stay in lock-step until the column is
-- retired.
--
-- ── Contract ────────────────────────────────────────────────────────────────
--
-- A row in profile_role_blend means: profile P holds iron_role R with
-- weight W during the time window [effective_from, effective_to). When
-- effective_to is null, the assignment is open-ended (currently active).
--
-- The sum of active weights for a single profile SHOULD be 1.0 but is NOT
-- enforced in SQL. Drift from 1.0 will be a P0.6 honesty probe in a later
-- slice. We deliberately do not block writes here because the blend table
-- has to support partial updates during cover-handoff transitions where
-- the sum is briefly off-balance.
--
-- ── Security model ──────────────────────────────────────────────────────────
--
-- Reads:
--   - Users can read their own blend rows.
--   - Managers / owners / admins can read all blend rows (workspace
--     scoping is enforced at the application layer via the active_workspace
--     filter on the joined profiles row, mirroring the prediction-ledger
--     RLS pattern in migration 208).
--
-- Writes:
--   - Service role only. The auto-sync trigger runs as security definer
--     and writes via the table owner. No direct user writes.
--
-- ── Cutover ─────────────────────────────────────────────────────────────────
--
-- Day 8 (this migration): backend substrate + auto-sync trigger.
-- Day 9: frontend (RoleVariantShell, ranker) consumes the blend.
-- Phase 4: profiles.iron_role column is retired in favor of the dominant
--          blend row computed via getDominantIronRoleFromBlend().
-- ============================================================================

-- ── 1. Create the blend table ───────────────────────────────────────────────

create table public.profile_role_blend (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,

  iron_role text not null
    check (iron_role in ('iron_manager', 'iron_advisor', 'iron_woman', 'iron_man')),

  -- Weight in [0, 1]. Sum across active rows for one profile SHOULD be 1.0
  -- but is intentionally not enforced — see header comment.
  weight numeric not null check (weight >= 0 and weight <= 1),

  -- Time window. effective_to NULL = open-ended / currently active.
  effective_from timestamptz not null default now(),
  effective_to timestamptz,

  -- Free-text reason explaining why the assignment exists (for the audit
  -- trail and for the future "why am I covering this?" UI).
  reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Window must be non-degenerate.
  constraint profile_role_blend_window_valid
    check (effective_to is null or effective_to > effective_from)
);

comment on table public.profile_role_blend is
  'Phase 0 P0.5: weighted, time-bounded role assignments per profile. Replaces the single profiles.iron_role column over Phase 0 Day 9 + Phase 4. Sum of active weights should equal 1.0 but is not enforced in SQL — drift becomes a P0.6 honesty probe.';
comment on column public.profile_role_blend.weight is
  'Weight in [0, 1]. Sum across active rows for one profile should equal 1.0 (not enforced).';
comment on column public.profile_role_blend.effective_to is
  'NULL means open-ended / currently active. Closed rows are kept for audit history.';
comment on column public.profile_role_blend.reason is
  'Free-text explanation of why this blend row exists (e.g. "covering for J.Smith PTO 2026-04-08 to 2026-04-15").';

-- ── 2. Indexes ──────────────────────────────────────────────────────────────

-- Primary lookup: "get the active blend for profile P at time T"
create index idx_profile_role_blend_profile_time
  on public.profile_role_blend (profile_id, effective_from desc);

-- Hot path: "get currently active rows for profile P"
create index idx_profile_role_blend_profile_active
  on public.profile_role_blend (profile_id)
  where effective_to is null;

-- Reverse lookup: "who currently holds iron_role R?"
create index idx_profile_role_blend_role_active
  on public.profile_role_blend (iron_role)
  where effective_to is null;

-- ── 3. updated_at trigger (reuses set_updated_at from migration 001) ────────

create trigger profile_role_blend_set_updated_at
  before update on public.profile_role_blend
  for each row
  execute function public.set_updated_at();

-- ── 4. RLS policies ─────────────────────────────────────────────────────────

alter table public.profile_role_blend enable row level security;

-- Self-read: a user can see their own blend rows.
create policy "profile_role_blend_select_self"
  on public.profile_role_blend for select
  using (profile_id = auth.uid());

-- Elevated read: managers / owners / admins see all blend rows. Workspace
-- scoping is enforced at the app layer (mirrors qrm_predictions in 208).
create policy "profile_role_blend_select_elevated"
  on public.profile_role_blend for select
  using (public.get_my_role() in ('manager', 'owner', 'admin'));

-- Service role: full access (for the auto-sync trigger and admin tooling).
create policy "profile_role_blend_service_all"
  on public.profile_role_blend for all
  using (auth.role() = 'service_role');

-- ── 5. Backfill from existing profiles.iron_role ────────────────────────────
--
-- Every profile that already has a non-null iron_role gets a single
-- weight=1.0 open-ended row. This makes the blend table immediately
-- readable by Day 9's frontend without requiring any operator input.

insert into public.profile_role_blend (profile_id, iron_role, weight, effective_from, effective_to, reason)
select
  p.id,
  p.iron_role,
  1.0,
  coalesce(p.created_at, now()),
  null,
  'backfill from migration 067 single-role column'
from public.profiles p
where p.iron_role is not null
  and not exists (
    select 1
    from public.profile_role_blend b
    where b.profile_id = p.id
      and b.effective_to is null
  );

-- ── 6. Currently-active blend view (security_invoker inherits RLS) ──────────
--
-- Day 9 frontend reads from this view rather than the raw table. The view
-- only exposes currently-active rows (effective_to is null) and includes
-- the joined display string for convenience.

create or replace view public.v_profile_active_role_blend
with (security_invoker = true)
as
select
  b.id,
  b.profile_id,
  b.iron_role,
  b.weight,
  b.effective_from,
  b.effective_to,
  b.reason,
  case b.iron_role
    when 'iron_manager' then 'Iron Manager'
    when 'iron_advisor' then 'Iron Advisor'
    when 'iron_woman'   then 'Iron Woman'
    when 'iron_man'     then 'Iron Man'
  end as iron_role_display
from public.profile_role_blend b
where b.effective_to is null;

comment on view public.v_profile_active_role_blend is
  'Phase 0 P0.5: currently-active role blend rows per profile (effective_to IS NULL). security_invoker = true so RLS on profile_role_blend applies.';

-- ── 7. Extend sync_iron_role() to also upsert profile_role_blend ────────────
--
-- The migration 067 trigger only updated profiles.iron_role and
-- iron_role_display. Day 8 extends it to ALSO close the previous active
-- blend row (if any) and insert a new weight=1.0 row whenever the derived
-- iron_role changes. This guarantees the two stay in lock-step without any
-- application-layer coupling.
--
-- The trigger only writes a new blend row when the derived iron_role
-- ACTUALLY changes — a no-op profile update does not pollute the blend
-- history.

create or replace function public.sync_iron_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_iron_role text;
  next_iron_role_display text;
  prev_iron_role text;
begin
  -- Compute the new iron_role from role + is_support (same logic as migration 067).
  next_iron_role := case
    when NEW.role = 'manager' then 'iron_manager'
    when NEW.role = 'owner' then 'iron_manager'
    when NEW.role = 'admin' then 'iron_woman'
    when NEW.role = 'rep' and NEW.is_support = true then 'iron_man'
    when NEW.role = 'rep' then 'iron_advisor'
  end;
  next_iron_role_display := case
    when NEW.role = 'manager' then 'Iron Manager'
    when NEW.role = 'owner' then 'Iron Manager'
    when NEW.role = 'admin' then 'Iron Woman'
    when NEW.role = 'rep' and NEW.is_support = true then 'Iron Man'
    when NEW.role = 'rep' then 'Iron Advisor'
  end;

  prev_iron_role := OLD.iron_role;

  NEW.iron_role := next_iron_role;
  NEW.iron_role_display := next_iron_role_display;

  -- Only touch profile_role_blend when the derived role actually changes
  -- OR on INSERT (where OLD is null). This keeps the blend history clean.
  if (TG_OP = 'INSERT') or (prev_iron_role is distinct from next_iron_role) then
    -- Close any currently-active rows for this profile.
    update public.profile_role_blend
    set effective_to = now()
    where profile_id = NEW.id
      and effective_to is null;

    -- Insert the new active row at weight=1.0. The blend always rebases to
    -- a single dominant role on a profiles change — explicit cover-handoff
    -- workflows that produce non-1.0 splits live in a later slice and
    -- write to profile_role_blend directly, not via this trigger.
    insert into public.profile_role_blend (
      profile_id, iron_role, weight, effective_from, effective_to, reason
    ) values (
      NEW.id,
      next_iron_role,
      1.0,
      now(),
      null,
      case
        when TG_OP = 'INSERT' then 'auto-sync: profile created'
        else 'auto-sync: profiles.role or is_support changed'
      end
    );
  end if;

  return NEW;
end;
$$;

-- The trigger itself was created by migration 067; we only replaced the
-- function body above, so no DROP/CREATE TRIGGER is required here.
