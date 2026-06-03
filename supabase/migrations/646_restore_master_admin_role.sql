-- ============================================================================
-- Migration 646: restore master-admin role for the owner account
-- Target: QEP Supabase project (iciddijgonywtxoelous)
--
-- profiles.role for blewis@lewisinsurance.com was left as 'rep' (a leftover
-- from exercising the sales companion during the sales build-out). The app
-- routes by profiles.role (useAuth -> normalizeProfileRow -> resolveHomeRoute):
-- 'rep' -> /sales/today, whereas 'admin' -> /qrm. This restores admin access.
--
-- Idempotent: only updates when the row is not already 'admin'.
-- ============================================================================

BEGIN;

UPDATE public.profiles
SET role = 'admin'
WHERE email = 'blewis@lewisinsurance.com'
  AND role <> 'admin';

COMMIT;
