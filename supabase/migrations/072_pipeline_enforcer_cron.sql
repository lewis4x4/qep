-- ============================================================================
-- Migration 072: Pipeline Enforcer & Follow-Up Engine Cron Schedules
--
-- Adds two new cron jobs using the same pg_net pattern from migration 059:
--   1. pipeline-enforcer: every 5 minutes, checks SLA violations + gate enforcement
--   2. follow-up-engine: every hour, processes due touchpoints + generates AI content
-- ============================================================================

-- ── 1. Pipeline Enforcer — every 5 minutes ──────────────────────────────────

select cron.schedule(
  'pipeline-enforcer-periodic',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/pipeline-enforcer',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"source": "cron"}'::jsonb
  );
  $$
);

-- ── 2. Follow-Up Engine — every hour ────────────────────────────────────────

select cron.schedule(
  'follow-up-engine-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/follow-up-engine',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"source": "cron", "batch_size": 50}'::jsonb
  );
  $$
);
