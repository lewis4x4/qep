-- PERF-QEP-005: Fix remaining EXISTS-on-profiles pattern in documents RLS
--
-- Migration 009 fixed the same recursion-prone pattern on 7 tables (hubspot_connections,
-- follow_up_sequences, follow_up_steps, sequence_enrollments, activity_log,
-- voice_captures, storage.objects) but did not update public.documents.
--
-- The documents_all_elevated policy uses:
--   EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN (...))
-- This sub-selects profiles on every qualifying documents row, adding an extra round-trip
-- and, under high concurrency, competing with profile lookups triggered by other RLS
-- policies (including those using get_my_role()). Replace with the same
-- get_my_role() helper used everywhere else.
--
-- documents_select_rep checked whether ANY profile existed for the caller — effectively
-- "is this user authenticated with a profile". Replaced with get_my_role() IS NOT NULL,
-- which is semantically equivalent (NULL = no profile / no role).

-- ─── documents ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "documents_all_elevated" ON public.documents;
CREATE POLICY "documents_all_elevated" ON public.documents
  FOR ALL USING (
    public.get_my_role() IN ('admin', 'manager', 'owner')
  );

DROP POLICY IF EXISTS "documents_select_rep" ON public.documents;
CREATE POLICY "documents_select_rep" ON public.documents
  FOR SELECT USING (
    is_active = true
    AND public.get_my_role() IS NOT NULL
  );
