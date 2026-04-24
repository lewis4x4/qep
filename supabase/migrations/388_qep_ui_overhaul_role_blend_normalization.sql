-- QEP UI overhaul role blend normalization repair.
--
-- Migration 387 normalized profiles.iron_role, but production still had active
-- profile_role_blend rows from migration 067 for some named accounts. /floor
-- resolves blend-first, so close stale active blends and insert the locked role.

with desired_roles(id, iron_role) as (
  values
    ('b8da7fa8-aa61-4743-abb4-5c5159c93bd3'::uuid, 'iron_owner'),
    ('3162f130-021a-45d4-a13c-be98f357a38b'::uuid, 'iron_owner'),
    ('16f60dc8-0efe-4cdc-9ab7-7b5b1d017e53'::uuid, 'iron_owner'),
    ('a5d1c0b5-0f7f-4260-9c93-ffafeb59fce3'::uuid, 'iron_advisor'),
    ('42f4c3fc-e469-41b1-9fad-ff225c9a9d6d'::uuid, 'iron_parts_manager'),
    ('ba288edb-d722-4e27-a6fd-afbdcd3d6e46'::uuid, 'iron_parts_counter')
)
update public.profiles p
set iron_role = desired_roles.iron_role
from desired_roles
where p.id = desired_roles.id
  and p.iron_role is distinct from desired_roles.iron_role;

with desired_roles(id, iron_role) as (
  values
    ('b8da7fa8-aa61-4743-abb4-5c5159c93bd3'::uuid, 'iron_owner'),
    ('3162f130-021a-45d4-a13c-be98f357a38b'::uuid, 'iron_owner'),
    ('16f60dc8-0efe-4cdc-9ab7-7b5b1d017e53'::uuid, 'iron_owner'),
    ('a5d1c0b5-0f7f-4260-9c93-ffafeb59fce3'::uuid, 'iron_advisor'),
    ('42f4c3fc-e469-41b1-9fad-ff225c9a9d6d'::uuid, 'iron_parts_manager'),
    ('ba288edb-d722-4e27-a6fd-afbdcd3d6e46'::uuid, 'iron_parts_counter')
)
update public.profile_role_blend b
set effective_to = now()
from desired_roles
where b.profile_id = desired_roles.id
  and b.effective_to is null
  and b.iron_role is distinct from desired_roles.iron_role;

with desired_roles(id, iron_role) as (
  values
    ('b8da7fa8-aa61-4743-abb4-5c5159c93bd3'::uuid, 'iron_owner'),
    ('3162f130-021a-45d4-a13c-be98f357a38b'::uuid, 'iron_owner'),
    ('16f60dc8-0efe-4cdc-9ab7-7b5b1d017e53'::uuid, 'iron_owner'),
    ('a5d1c0b5-0f7f-4260-9c93-ffafeb59fce3'::uuid, 'iron_advisor'),
    ('42f4c3fc-e469-41b1-9fad-ff225c9a9d6d'::uuid, 'iron_parts_manager'),
    ('ba288edb-d722-4e27-a6fd-afbdcd3d6e46'::uuid, 'iron_parts_counter')
)
insert into public.profile_role_blend (profile_id, iron_role, weight, effective_from, effective_to, reason)
select desired_roles.id,
       desired_roles.iron_role,
       1.0,
       now(),
       null,
       'QEP UI overhaul role blend normalization'
from desired_roles
where not exists (
  select 1
  from public.profile_role_blend b
  where b.profile_id = desired_roles.id
    and b.iron_role = desired_roles.iron_role
    and b.effective_to is null
);
