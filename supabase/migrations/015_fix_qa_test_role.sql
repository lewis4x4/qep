-- Migration 015: Promote QA test account to owner role
-- Fixes BLOCKER from QUA-125: blewis@lewisinsurance.com has role=admin,
-- which blocks functional QA testing of the Integration Hub (owner-only).

UPDATE public.profiles p
SET role = 'owner', updated_at = now()
FROM auth.users u
WHERE u.id = p.id
  AND u.email = 'blewis@lewisinsurance.com'
  AND p.role != 'owner'; -- Idempotent: no-op if already owner

-- ── Rollback ────────────────────────────────────────────────────────────────
-- UPDATE public.profiles p
-- SET role = 'admin', updated_at = now()
-- FROM auth.users u
-- WHERE u.id = p.id AND u.email = 'blewis@lewisinsurance.com';
