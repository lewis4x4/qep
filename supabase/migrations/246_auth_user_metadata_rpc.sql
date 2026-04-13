-- ============================================================
-- 246 · get_auth_user_metadata() — service-role-only RPC
-- ============================================================
-- Replaces the GoTrue admin HTTP listUsers() call with a direct
-- SQL query against auth.users.  This avoids the intermittent
-- "Database error finding users" from GoTrue's admin API.
-- Only callable by service_role (the admin edge function).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_auth_user_metadata()
RETURNS TABLE (
  id            uuid,
  last_sign_in_at  timestamptz,
  email_confirmed_at timestamptz,
  banned_until     timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT u.id, u.last_sign_in_at, u.email_confirmed_at, u.banned_until
  FROM auth.users u;
$$;

-- Lock down: only service_role can call this
REVOKE ALL ON FUNCTION public.get_auth_user_metadata() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_metadata() TO service_role;

-- Notify PostgREST to pick up new RPC endpoint
NOTIFY pgrst, 'reload schema';
