-- PERF-QEP-004: Fix RLS infinite-recursion on 6+ tables
--
-- Problem (Finding #4): Policies in migrations 002 and 003 use:
--   EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN (...))
-- This pattern triggers profiles RLS evaluation, which may re-trigger the same
-- policy → infinite recursion under certain query patterns, killing the connection.
--
-- Migration 005 fixed this for the profiles table itself by introducing get_my_role()
-- (a SECURITY DEFINER function that bypasses RLS for the role lookup).
-- This migration applies the same fix to all remaining tables.
--
-- Tables affected:
--   hubspot_connections    (002)
--   follow_up_sequences    (002) — sequences_write_elevated
--   follow_up_steps        (002) — steps_write_elevated
--   sequence_enrollments   (002) — enrollments_select_elevated
--   activity_log           (002) — activity_log_select_elevated
--   voice_captures         (003) — voice_captures_select, voice_captures_update
--   storage.objects        (003) — voice_recordings_select

-- ─── hubspot_connections ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "hubspot_connections_owner" ON public.hubspot_connections;
CREATE POLICY "hubspot_connections_owner" ON public.hubspot_connections
  FOR ALL USING (
    user_id = auth.uid()
    OR public.get_my_role() IN ('owner', 'manager')
  );

-- ─── follow_up_sequences ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "sequences_write_elevated" ON public.follow_up_sequences;
CREATE POLICY "sequences_write_elevated" ON public.follow_up_sequences
  FOR ALL USING (
    public.get_my_role() IN ('admin', 'manager', 'owner')
  );

-- ─── follow_up_steps ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "steps_write_elevated" ON public.follow_up_steps;
CREATE POLICY "steps_write_elevated" ON public.follow_up_steps
  FOR ALL USING (
    public.get_my_role() IN ('admin', 'manager', 'owner')
  );

-- ─── sequence_enrollments ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "enrollments_select_elevated" ON public.sequence_enrollments;
CREATE POLICY "enrollments_select_elevated" ON public.sequence_enrollments
  FOR SELECT USING (
    public.get_my_role() IN ('admin', 'manager', 'owner')
  );

-- ─── activity_log ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "activity_log_select_elevated" ON public.activity_log;
CREATE POLICY "activity_log_select_elevated" ON public.activity_log
  FOR SELECT USING (
    public.get_my_role() IN ('admin', 'manager', 'owner')
  );

-- ─── voice_captures ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "voice_captures_select" ON public.voice_captures;
CREATE POLICY "voice_captures_select" ON public.voice_captures
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.get_my_role() IN ('manager', 'owner')
  );

DROP POLICY IF EXISTS "voice_captures_update" ON public.voice_captures;
CREATE POLICY "voice_captures_update" ON public.voice_captures
  FOR UPDATE USING (
    user_id = auth.uid()
    OR public.get_my_role() IN ('manager', 'owner')
  );

-- ─── storage.objects (voice-recordings bucket) ────────────────────────────────

DROP POLICY IF EXISTS "voice_recordings_select" ON storage.objects;
CREATE POLICY "voice_recordings_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'voice-recordings'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.get_my_role() IN ('manager', 'owner')
    )
  );
