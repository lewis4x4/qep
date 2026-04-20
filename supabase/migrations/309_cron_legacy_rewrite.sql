-- ============================================================================
-- Migration 309: Rewrite 7 broken legacy cron commands to modern pattern
--
-- Context: during the 2026-04-20 cron audit (post PR #25), seven
-- scheduled jobs were found to use the legacy dge-era pattern:
--
--   url     := '/functions/v1/<name>'                              -- relative, no host
--   headers := jsonb_build_object(
--     'Authorization', format('Bearer ', current_setting(...))      -- missing %s placeholder!
--   )
--
-- Three compounding bugs killed them silently:
--   1. Relative URL in pg_net.http_post → request never leaves the
--      database layer cleanly (error, not a real HTTP call).
--   2. format('Bearer ', <value>) has NO %s, so the secret is never
--      interpolated; the header literal is 'Bearer ' with a trailing
--      space.
--   3. current_setting('app.settings.service_role_key', true) — the
--      GUC that migration 212 explicitly migrated off of; modern
--      Supabase projects don't expose it, so it returns NULL here
--      anyway.
--
-- Net effect: these 7 analytics-ish cron jobs have been no-ops for
-- weeks/months. No logs to show for it (pg_net never completes a
-- round trip), so it looked like they were running.
--
-- This migration rewrites all 7 to the modern pattern from migration
-- 205 + 212:
--
--   url     := '<hardcoded-host>/functions/v1/<name>'
--   headers := jsonb_build_object(
--     'x-internal-service-secret', '<resolved-secret>',
--     'Content-Type', 'application/json'
--   )
--
-- Paired with the same PR's edge-function changes (adds
-- isServiceRoleCaller to the 6 target fns that didn't have it, and
-- flips verify_jwt=false on all 7 via redeploy).
--
-- Cadences preserved verbatim from the existing cron.job rows —
-- nobody's operations schedule changes.
-- ============================================================================

do $do$
declare
  v_secret text;
  v_url_base constant text := 'https://iciddijgonywtxoelous.supabase.co';
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise exception 'pg_cron is not installed; cannot rewrite legacy cron jobs';
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise exception 'pg_net is not installed; cannot rewrite legacy cron jobs';
  end if;

  -- Canonical pattern for pulling the shared internal-service-secret —
  -- lifted from flow-runner's command literal. Matches migrations 205,
  -- 212, 307. Avoids hardcoding the value in source control.
  v_secret := split_part(
    split_part(
      (select command from cron.job where jobname = 'flow-runner' limit 1),
      $tag1$x-internal-service-secret', '$tag1$,
      2
    ),
    $tag2$'$tag2$,
    1
  );

  if v_secret is null or v_secret = '' then
    raise exception
      'Could not extract internal-service-secret from flow-runner cron command. '
      'Register flow-runner first (migration 205) or set the secret manually.';
  end if;

  raise notice 'Resolved internal-service-secret from flow-runner (% chars)', length(v_secret);

  -- ── data-quality-audit: daily at 04:00 ──────────────────────────────────
  if exists (select 1 from cron.job where jobname = 'data-quality-audit') then
    perform cron.unschedule('data-quality-audit');
  end if;
  perform cron.schedule(
    'data-quality-audit',
    '0 4 * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/data-quality-audit',
        headers := jsonb_build_object(
          'x-internal-service-secret', '%s',
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      )$cmd$,
      v_url_base, v_secret
    )
  );

  -- ── handoff-trust-scorer-nightly: daily at 06:15 ────────────────────────
  if exists (select 1 from cron.job where jobname = 'handoff-trust-scorer-nightly') then
    perform cron.unschedule('handoff-trust-scorer-nightly');
  end if;
  perform cron.schedule(
    'handoff-trust-scorer-nightly',
    '15 6 * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/handoff-trust-scorer',
        headers := jsonb_build_object(
          'x-internal-service-secret', '%s',
          'Content-Type', 'application/json'
        ),
        body := '{"source":"cron"}'::jsonb,
        timeout_milliseconds := 180000
      )$cmd$,
      v_url_base, v_secret
    )
  );

  -- ── health-score-refresh: daily at 05:00 ────────────────────────────────
  if exists (select 1 from cron.job where jobname = 'health-score-refresh') then
    perform cron.unschedule('health-score-refresh');
  end if;
  perform cron.schedule(
    'health-score-refresh',
    '0 5 * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/health-score-refresh',
        headers := jsonb_build_object(
          'x-internal-service-secret', '%s',
          'Content-Type', 'application/json'
        ),
        body := '{"source":"cron"}'::jsonb,
        timeout_milliseconds := 120000
      )$cmd$,
      v_url_base, v_secret
    )
  );

  -- ── portal-notification-refresh: hourly at :15 ──────────────────────────
  if exists (select 1 from cron.job where jobname = 'portal-notification-refresh') then
    perform cron.unschedule('portal-notification-refresh');
  end if;
  perform cron.schedule(
    'portal-notification-refresh',
    '15 * * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/portal-notification-refresh',
        headers := jsonb_build_object(
          'x-internal-service-secret', '%s',
          'Content-Type', 'application/json'
        ),
        body := '{"source":"cron"}'::jsonb,
        timeout_milliseconds := 60000
      )$cmd$,
      v_url_base, v_secret
    )
  );

  -- ── predictive-visit-generator: daily at 06:00 ──────────────────────────
  if exists (select 1 from cron.job where jobname = 'predictive-visit-generator') then
    perform cron.unschedule('predictive-visit-generator');
  end if;
  perform cron.schedule(
    'predictive-visit-generator',
    '0 6 * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/predictive-visit-generator',
        headers := jsonb_build_object(
          'x-internal-service-secret', '%s',
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 180000
      )$cmd$,
      v_url_base, v_secret
    )
  );

  -- ── qrm-absence-engine-nightly: daily at 04:30 ──────────────────────────
  if exists (select 1 from cron.job where jobname = 'qrm-absence-engine-nightly') then
    perform cron.unschedule('qrm-absence-engine-nightly');
  end if;
  perform cron.schedule(
    'qrm-absence-engine-nightly',
    '30 4 * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/qrm-absence-engine-nightly',
        headers := jsonb_build_object(
          'x-internal-service-secret', '%s',
          'Content-Type', 'application/json'
        ),
        body := '{"source":"cron"}'::jsonb,
        timeout_milliseconds := 180000
      )$cmd$,
      v_url_base, v_secret
    )
  );

  -- ── revenue-attribution-compute-nightly: daily at 04:40 ─────────────────
  -- Note: this fn exposes a sub-route /scan-recent-wins that does the
  -- actual cron work; preserve the path suffix.
  if exists (select 1 from cron.job where jobname = 'revenue-attribution-compute-nightly') then
    perform cron.unschedule('revenue-attribution-compute-nightly');
  end if;
  perform cron.schedule(
    'revenue-attribution-compute-nightly',
    '40 4 * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/revenue-attribution-compute/scan-recent-wins',
        headers := jsonb_build_object(
          'x-internal-service-secret', '%s',
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 180000
      )$cmd$,
      v_url_base, v_secret
    )
  );

  raise notice '[309] Rewrote 7 legacy cron commands to modern pattern. '
               'All 7 target fns must be redeployed with verify_jwt=false and '
               'have isServiceRoleCaller in their auth guard — see PR for details.';
end;
$do$;
