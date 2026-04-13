-- ============================================================
-- 248 · Extend get_auth_user_metadata() to include email + raw_user_meta_data
-- ============================================================
-- Needed by admin-users list to auto-backfill missing profiles
-- for auth users created outside the normal invite flow.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_auth_user_metadata();

CREATE OR REPLACE FUNCTION public.get_auth_user_metadata()
RETURNS TABLE (
  id                 uuid,
  email              text,
  last_sign_in_at    timestamptz,
  email_confirmed_at timestamptz,
  banned_until       timestamptz,
  raw_user_meta_data jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT u.id, u.email, u.last_sign_in_at, u.email_confirmed_at, u.banned_until, u.raw_user_meta_data
  FROM auth.users u;
$$;

-- Lock down: only service_role can call this
REVOKE ALL ON FUNCTION public.get_auth_user_metadata() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_metadata() TO service_role;

NOTIFY pgrst, 'reload schema';
