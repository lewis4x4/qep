-- ============================================================
-- 249 · backfill_profile() — atomic profile + workspace creation
-- ============================================================
-- Solves the chicken-and-egg: profile_workspaces FK requires
-- profiles(id), but the validate_profile_active_workspace trigger
-- requires a profile_workspaces row. This function disables the
-- validation trigger, inserts both rows, then re-enables it.
-- Service-role only.
-- ============================================================

CREATE OR REPLACE FUNCTION public.backfill_profile(
  p_id         uuid,
  p_email      text,
  p_full_name  text DEFAULT NULL,
  p_role       text DEFAULT 'rep',
  p_iron_role  text DEFAULT NULL,
  p_workspace  text DEFAULT 'default'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Temporarily disable the validation trigger
  ALTER TABLE public.profiles DISABLE TRIGGER validate_profile_active_workspace;

  -- Insert profile first (no validation)
  INSERT INTO public.profiles (id, email, full_name, role, iron_role, active_workspace_id, is_active)
  VALUES (p_id, p_email, COALESCE(p_full_name, p_email), p_role::public.user_role, p_iron_role, p_workspace, true)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    role = EXCLUDED.role,
    iron_role = COALESCE(EXCLUDED.iron_role, public.profiles.iron_role),
    active_workspace_id = EXCLUDED.active_workspace_id,
    is_active = true;

  -- Now insert workspace membership (FK to profiles is satisfied)
  INSERT INTO public.profile_workspaces (profile_id, workspace_id)
  VALUES (p_id, p_workspace)
  ON CONFLICT DO NOTHING;

  -- Re-enable the trigger
  ALTER TABLE public.profiles ENABLE TRIGGER validate_profile_active_workspace;

EXCEPTION WHEN OTHERS THEN
  -- Always re-enable trigger even on error
  ALTER TABLE public.profiles ENABLE TRIGGER validate_profile_active_workspace;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_profile(uuid, text, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_profile(uuid, text, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
