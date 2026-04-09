-- ============================================================================
-- Migration 220: Predictive Visit Generator Cron (Slice 3.2)
--
-- Schedules the predictive-visit-generator edge function to run nightly
-- at 06:00 UTC (approx 1am EST / 11pm PST) — before morning briefing.
-- ============================================================================

select cron.schedule(
  'predictive-visit-generator',
  '0 6 * * *',
  format(
    $sql$
    select net.http_post(
      url := '%s/functions/v1/predictive-visit-generator',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', format('Bearer %s', current_setting('app.settings.service_role_key', true))
      ),
      body := '{}'::jsonb
    );
    $sql$,
    current_setting('app.settings.supabase_url', true),
    current_setting('app.settings.service_role_key', true)
  )
);
