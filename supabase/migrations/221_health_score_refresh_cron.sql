-- ============================================================================
-- Migration 221: Health Score Refresh Cron (Slice 3.3)
--
-- Schedules the health-score-refresh edge function to run nightly
-- at 05:00 UTC (approx midnight EST) — before the morning briefing
-- and before the predictive-visit-generator runs at 06:00 UTC.
-- ============================================================================

select cron.schedule(
  'health-score-refresh',
  '0 5 * * *',
  format(
    $sql$
    select net.http_post(
      url := '%s/functions/v1/health-score-refresh',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', format('Bearer %s', current_setting('app.settings.service_role_key', true))
      ),
      body := '{"source":"cron"}'::jsonb
    );
    $sql$,
    current_setting('app.settings.supabase_url', true),
    current_setting('app.settings.service_role_key', true)
  )
);
