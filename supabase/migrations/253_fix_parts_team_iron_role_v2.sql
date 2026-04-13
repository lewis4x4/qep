-- Migration 253: Broader fix for Parts Team iron_role
-- Previous migration was too narrow with role filter.
-- This matches any profile with "Parts" in name regardless of base role.

-- First, show what we're about to update (for debugging via NOTICE)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, full_name, role, iron_role
    FROM public.profiles
    WHERE lower(full_name) LIKE '%part%'
  LOOP
    RAISE NOTICE 'Found profile: id=%, name=%, role=%, iron_role=%',
      r.id, r.full_name, r.role, r.iron_role;
  END LOOP;
END $$;

-- Set iron_role for any "Parts" user who isn't already iron_woman
UPDATE public.profiles
SET iron_role = 'iron_woman',
    updated_at = now()
WHERE lower(full_name) LIKE '%part%'
  AND (iron_role IS NULL OR iron_role != 'iron_woman');

-- Also propagate to auth.users raw_app_meta_data so the next JWT picks it up
UPDATE auth.users au
SET raw_app_meta_data = au.raw_app_meta_data || jsonb_build_object('iron_role', 'iron_woman')
FROM public.profiles p
WHERE p.id = au.id
  AND lower(p.full_name) LIKE '%part%'
  AND p.iron_role = 'iron_woman';
