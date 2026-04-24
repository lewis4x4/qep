-- QEP UI overhaul role normalization.
--
-- Decisions locked 2026-04-24:
-- - Brian, Ryan, and Rylee land on Owner home.
-- - Sales Team lands on Sales Rep home.
-- - Angela Land is Parts Manager.
-- - The shared Parts Team account is Parts Counter.
--
-- profiles.iron_role is the canonical profile column for home routing. The
-- active blend is kept in sync because /floor resolves through
-- getEffectiveIronRole(), which intentionally reads the blend first.

with desired_roles(id, iron_role) as (
  values
    ('b8da7fa8-aa61-4743-abb4-5c5159c93bd3'::uuid, 'iron_owner'),
    ('3162f130-021a-45d4-a13c-be98f357a38b'::uuid, 'iron_owner'),
    ('16f60dc8-0efe-4cdc-9ab7-7b5b1d017e53'::uuid, 'iron_owner'),
    ('a5d1c0b5-0f7f-4260-9c93-ffafeb59fce3'::uuid, 'iron_advisor'),
    ('42f4c3fc-e469-41b1-9fad-ff225c9a9d6d'::uuid, 'iron_parts_manager'),
    ('ba288edb-d722-4e27-a6fd-afbdcd3d6e46'::uuid, 'iron_parts_counter')
),
changed_profiles as (
  update public.profiles p
  set iron_role = desired_roles.iron_role
  from desired_roles
  where p.id = desired_roles.id
    and p.iron_role is distinct from desired_roles.iron_role
  returning p.id, p.iron_role
),
normalized_profiles as (
  select p.id, p.iron_role
  from public.profiles p
  join desired_roles on desired_roles.id = p.id
  where p.iron_role = desired_roles.iron_role
),
closed_blends as (
  update public.profile_role_blend b
  set effective_to = now()
  from normalized_profiles
  where b.profile_id = normalized_profiles.id
    and b.effective_to is null
    and b.iron_role is distinct from normalized_profiles.iron_role
  returning b.profile_id
)
insert into public.profile_role_blend (profile_id, iron_role, weight, effective_from, effective_to, reason)
select normalized_profiles.id,
       normalized_profiles.iron_role,
       1.0,
       now(),
       null,
       'QEP UI overhaul role normalization'
from normalized_profiles
where not exists (
  select 1
  from public.profile_role_blend b
  where b.profile_id = normalized_profiles.id
    and b.iron_role = normalized_profiles.iron_role
    and b.effective_to is null
);
