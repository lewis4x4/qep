-- ============================================================================
-- Migration 307: Schedule qb-price-sheet-watchdog via pg_cron
--
-- Slice 16 shipped the watchdog edge function with two invocation modes:
--   - Manual "Check now" from the admin UI (Slice 16 CP5, live today).
--   - Batch mode: empty body → function loads all active sources and
--     processes the ones past their check_freq_hours cadence.
--
-- The batch mode was deliberately not wired to a schedule in Slice 16 to
-- keep the main PR scoped to the detect/diff/impact loop. This migration
-- closes that gap: every 15 minutes pg_cron pokes the function with an
-- empty body, which triggers a sweep of due sources.
--
-- Why 15 minutes?
--   - The minimum cadence a source can have is 1 hour (CHECK constraint
--     in migration 306). A 15-minute tick means a newly-added 1h source
--     waits at most ~15 min for its first poll.
--   - The function's own isOverdue() filter short-circuits sources that
--     aren't yet due, so a 15m tick does NOT mean 15m polls — only
--     actually-due sources get hit. A 24h-cadence source gets hit at
--     most once per tick AFTER 24h elapses since its last check.
--   - Under typical load (5–20 sources, most 24h cadence) this tick
--     issues zero-to-one HTTP requests per firing.
--
-- Auth path: x-internal-service-secret (modern cron pattern from 212).
-- The edge function accepts this via _shared/cron-auth.isServiceRoleCaller
-- as of the companion edge fn redeploy.
--
-- ── Dollar-quoting note ─────────────────────────────────────────────────────
-- Same pattern as migration 212: $do$ for the outer block, $tag1$/$tag2$
-- for secret extraction, $cmd$ for the format() command template.
-- ============================================================================

do $do$
declare
  v_secret text;
  v_url_base constant text := 'https://iciddijgonywtxoelous.supabase.co';
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise exception 'pg_cron is not installed; cannot schedule qb-price-sheet-watchdog';
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise exception 'pg_net is not installed; cannot schedule qb-price-sheet-watchdog';
  end if;

  -- Extract shared internal-service-secret from flow-runner (canonical
  -- pattern — same approach migrations 205 + 212 use).
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

  -- Idempotent re-register — always drop + re-add so the migration is safe
  -- to re-apply after edits (e.g. cadence change).
  if exists (select 1 from cron.job where jobname = 'qb-price-sheet-watchdog-periodic') then
    perform cron.unschedule('qb-price-sheet-watchdog-periodic');
    raise notice 'Unscheduled existing qb-price-sheet-watchdog-periodic';
  end if;

  perform cron.schedule(
    'qb-price-sheet-watchdog-periodic',
    '*/15 * * * *',
    format(
      $cmd$select net.http_post(
        url := '%s/functions/v1/qb-price-sheet-watchdog',
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
  raise notice 'Scheduled qb-price-sheet-watchdog-periodic at */15 * * * *';
end;
$do$;
