-- ============================================================================
-- Migration 088: Post-Sale Automation Wiring
--
-- 1. Add email_draft_subject to escalation_tickets
-- 2. 2 PM nudge cron schedule for prospecting KPI enforcement
-- ============================================================================

-- ── 1. Escalation ticket email subject ──────────────────────────────────────

alter table public.escalation_tickets
  add column if not exists email_draft_subject text;

-- ── 2. 2 PM nudge cron (daily at 19:00 UTC = 2 PM ET) ──────────────────────

select cron.schedule(
  'prospecting-nudge-2pm',
  '0 19 * * 1-5',
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/nudge-scheduler',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"source": "cron"}'::jsonb
  );
  $$
);
