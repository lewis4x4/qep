-- ============================================================================
-- Migration 787: Linear sync pending-row sweeper (review follow-up, Stream N)
--
--   The roadmap→Linear mirror is driven by the per-row DB webhook trigger
--   "qep-roadmap-tasks-to-linear2" (AFTER INSERT OR UPDATE → pg_net →
--   sync-roadmap-linear edge function). pg_net delivery is fire-and-forget:
--   if the invocation is aborted (timeout under concurrency, rate limit,
--   transient network) before syncOne() writes back, the row is stranded at
--   linear_sync_status='pending' (or 'error') with nothing ever retrying it.
--
--   This is not hypothetical: the 2026-07-08 Stream M/N seed (migrations
--   784/786) fired 16 concurrent webhook invocations off one INSERT and
--   stranded 13 of 16 rows at 'pending' / attempt_count 0. They had to be
--   drained by hand.
--
--   The sweeper closes the loop with plain SQL — no HTTP, no secrets; the
--   webhook trigger already carries auth. Every 5 minutes it revives up to
--   3 rows stuck in 'pending'/'error' for more than 10 minutes:
--     - SET linear_sync_status='pending' revives 'error' rows (a
--       bookkeeping-only write, so fn_qep_roadmap_tasks_mark_linear_pending
--       leaves content columns alone) and is a same-value write for rows
--       already 'pending'; either way the AFTER UPDATE webhook re-fires.
--     - linear_sync_attempt_count increments each sweep and rows are
--       dropped from the sweep at 8 attempts, so a permanently failing row
--       cannot generate unbounded Linear calls (syncOne resets the counter
--       to 0 on success, and writes linear_sync_error for diagnosis).
--     - qep_roadmap_tasks_touch_updated_at resets updated_at on each sweep,
--       so the >10min staleness check spaces retries per row.
--     - LIMIT 3 keeps concurrent webhook invocations far below the 16-wide
--       stampede that caused the original strand.
--
--   Fail-safe like 046/782: skips with a NOTICE when pg_cron is
--   unavailable; never fails the migration.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'Skipping qep-linear-sync-pending-sweeper: pg_cron not available.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'qep-linear-sync-pending-sweeper') THEN
    PERFORM cron.unschedule('qep-linear-sync-pending-sweeper');
  END IF;

  PERFORM cron.schedule(
    'qep-linear-sync-pending-sweeper',
    '*/5 * * * *',
    $job$
      UPDATE public.qep_roadmap_tasks
      SET linear_sync_status = 'pending',
          linear_sync_attempt_count = linear_sync_attempt_count + 1
      WHERE id IN (
        SELECT id FROM public.qep_roadmap_tasks
        WHERE linear_sync_status IN ('pending', 'error')
          AND updated_at < now() - interval '10 minutes'
          AND linear_sync_attempt_count < 8
        ORDER BY updated_at ASC
        LIMIT 3
      );
    $job$
  );
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Skipping qep-linear-sync-pending-sweeper: %', SQLERRM;
END $$;

COMMIT;
