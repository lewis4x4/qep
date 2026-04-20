-- ============================================================================
-- Migration 311: Slice 3 cron schedules — recommender + news scan
--
-- Two scheduled sweeps that keep the Today surface fresh without human input:
--
--   1. qrm-recommend-moves-periodic (*/5 * * * *)
--      Every 5 minutes, pokes the recommend-moves edge function. The function
--      pulls signals from the last 24h, runs the deterministic rule ruleset,
--      and creates deduped moves. Under normal load most ticks are a no-op
--      because the signal batch is empty or every candidate already has an
--      open move.
--
--   2. qrm-news-mention-scan-periodic (5 * * * *)
--      Every hour at :05, pokes news-mention-scan to sweep each workspace's
--      top-N companies through Tavily and ingest `news_mention` signals.
--      The :05 offset keeps it out of the :00 thundering-herd window and
--      away from the 5-minute recommender beat so the recommender sees the
--      fresh signals on its *next* tick rather than racing ingest in-flight.
--
-- Both functions resolve auth via `x-internal-service-secret`. They are
-- deployed with verify_jwt = false (see supabase/config.toml) so the
-- gateway doesn't reject the header — see the CRITICAL OPS NOTE in
-- supabase/functions/_shared/cron-auth.ts for the audit that discovered
-- this pattern failure on legacy cron fns.
--
-- ── Dollar-quoting note ───────────────────────────────────────────────────
-- Same convention migrations 205/212/307 use: $do$ for the outer block,
-- $tag1$/$tag2$ for secret extraction, $cmd$ for the format() command.
-- ============================================================================

do $do$
declare
  v_secret text;
  v_url_base constant text := 'https://iciddijgonywtxoelous.supabase.co';
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise exception 'pg_cron is not installed; cannot schedule QRM signal crons';
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise exception 'pg_net is not installed; cannot schedule QRM signal crons';
  end if;

  -- Extract shared internal-service-secret from the flow-runner cron command,
  -- the canonical pattern established in migrations 205 and 212. This keeps
  -- all cron jobs using one rotated secret rather than each migration
  -- independently re-reading an app.settings GUC that may not exist on this
  -- Supabase project anymore.
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
      'Register flow-runner first or set the secret manually.';
  end if;

  raise notice 'Resolved internal-service-secret from flow-runner (% chars)', length(v_secret);

  -- ── 1. recommend-moves every 5 minutes ──────────────────────────────────
  if exists (select 1 from cron.job where jobname = 'qrm-recommend-moves-periodic') then
    perform cron.unschedule('qrm-recommend-moves-periodic');
    raise notice 'Unscheduled existing qrm-recommend-moves-periodic';
  end if;

  perform cron.schedule(
    'qrm-recommend-moves-periodic',
    '*/5 * * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/recommend-moves',
        headers := jsonb_build_object(
          'x-internal-service-secret', '%s',
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      )$cmd$,
      v_url_base, v_secret
    )
  );
  raise notice 'Scheduled qrm-recommend-moves-periodic at */5 * * * *';

  -- ── 2. news-mention-scan hourly at :05 ──────────────────────────────────
  if exists (select 1 from cron.job where jobname = 'qrm-news-mention-scan-periodic') then
    perform cron.unschedule('qrm-news-mention-scan-periodic');
    raise notice 'Unscheduled existing qrm-news-mention-scan-periodic';
  end if;

  perform cron.schedule(
    'qrm-news-mention-scan-periodic',
    '5 * * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/news-mention-scan',
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
  raise notice 'Scheduled qrm-news-mention-scan-periodic at 5 * * * *';
end;
$do$;
