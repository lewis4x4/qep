-- ============================================================================
-- Migration 782: Fix follow-up reminder cron schedule (code review defect RF)
--
--   Migration 046 registered cron job 'crm-dispatch-follow-up-reminders'
--   with the schedule string '10 minutes', which is not valid pg_cron
--   syntax (pg_cron accepts 5-field cron expressions or 'N seconds'
--   intervals only). cron.schedule() rejected it, 046's exception handler
--   downgraded the error to a NOTICE, and the job was never registered —
--   so due follow-up reminders were never dispatched.
--
--   The job command is a direct SQL call to
--   public.crm_dispatch_due_follow_up_reminders(75) (rewritten in 384,
--   granted to service_role/postgres) — no edge function and no internal
--   service secret involved; the crm-reminder-dispatcher edge function is
--   only the HTTP fallback when pg_cron is unavailable. Re-register the
--   same command under a valid '*/10 * * * *' schedule.
--
--   Fail-safe like 046: skips with a NOTICE when pg_cron is unavailable;
--   never fails the migration.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'Skipping crm-dispatch-follow-up-reminders cron fix: pg_cron not available.';
    RETURN;
  END IF;

  -- 046's registration normally errored before creating the job, but drop
  -- any stale row defensively before re-registering.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-dispatch-follow-up-reminders') THEN
    PERFORM cron.unschedule('crm-dispatch-follow-up-reminders');
  END IF;

  PERFORM cron.schedule(
    'crm-dispatch-follow-up-reminders',
    '*/10 * * * *',
    $job$select public.crm_dispatch_due_follow_up_reminders(75);$job$
  );
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Skipping crm-dispatch-follow-up-reminders cron fix: %', SQLERRM;
END $$;

COMMIT;
