-- PERF-QEP-010: Move rate_limit_log cleanup from per-request to scheduled pg_cron job
--
-- Problem (Finding #10): check_rate_limit() DELETEs expired rows on every single
-- API call. Under concurrent load this creates write amplification, WAL pressure,
-- and lock contention on the rate_limit_log table.
--
-- Fix: Remove the DELETE from check_rate_limit() and schedule a pg_cron job to
-- purge expired rows every 5 minutes. The count query already has a created_at
-- range filter supported by rate_limit_log_lookup_idx, so no DELETE is needed
-- for correctness — only expired rows accumulate, and cron cleans them up.
--
-- Rollback:
--   SELECT cron.unschedule('clean-rate-limits');
--   Restore the DELETE line inside check_rate_limit().

-- Replace check_rate_limit without the per-request DELETE
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id        uuid,
  p_endpoint       text,
  p_max_requests   int,
  p_window_seconds int
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window_start timestamptz;
  v_count        int;
BEGIN
  v_window_start := now() - (p_window_seconds || ' seconds')::interval;

  -- Count requests still in the window (no DELETE — cron handles cleanup)
  SELECT count(*) INTO v_count
  FROM public.rate_limit_log
  WHERE user_id  = p_user_id
    AND endpoint = p_endpoint
    AND created_at >= v_window_start;

  IF v_count >= p_max_requests THEN
    RETURN false;
  END IF;

  -- Record this request
  INSERT INTO public.rate_limit_log (user_id, endpoint)
  VALUES (p_user_id, p_endpoint);

  RETURN true;
END;
$$;

-- Schedule a pg_cron job to purge entries older than 5 minutes every 5 minutes.
-- Requires pg_cron extension (enabled by default on Supabase).
-- The 5-minute window matches the longest rate-limit window in the app (voice-capture).
-- Adjust if longer windows are added.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_namespace
    WHERE nspname = 'cron'
  ) THEN
    PERFORM cron.schedule(
      'clean-rate-limits',
      '*/5 * * * *',
      $sql$
        DELETE FROM public.rate_limit_log
        WHERE created_at < now() - interval '5 minutes';
      $sql$
    );
  ELSE
    RAISE NOTICE 'Skipping clean-rate-limits cron job because pg_cron is not available in this environment.';
  END IF;
END;
$$;
