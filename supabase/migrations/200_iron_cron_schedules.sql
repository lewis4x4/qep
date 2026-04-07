-- ============================================================================
-- Migration 200: Wave 7 Iron Companion — pg_cron registrations
--
-- Closes the loop on v1.3 (pattern mining) and v1.5 (red-team nightly) by
-- registering both as scheduled jobs. Uses the canonical
-- service-tat-monitor / service-stage-enforcer pattern from migration 097:
--
--   • DO block guarded by pg_namespace checks for cron + net so the
--     migration is a safe no-op on environments without the extensions
--   • Reads app.settings.supabase_url and app.settings.service_role_key
--     GUCs (operator-configured per environment)
--   • cron.unschedule before cron.schedule so re-runs are idempotent
--   • Posts to the edge function with Authorization: Bearer <service_key>
--
-- Both Iron cron functions (iron-pattern-mining, iron-redteam-nightly)
-- accept the service role key directly as a Bearer token in their
-- isAuthorizedCaller helpers (added in this same slice).
--
-- Schedule:
--   iron-pattern-mining-nightly  → 02:00 UTC daily
--   iron-redteam-nightly         → 03:00 UTC daily
--
-- The 1-hour gap is intentional: pattern mining can write a row that the
-- red-team run will then test against, but more importantly the gap keeps
-- both jobs from competing for the same Anthropic rate limit window.
-- ============================================================================

do $cron$
declare
  _base_url text;
  _service_key text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping iron cron jobs: pg_cron not available.';
    return;
  end if;

  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping iron cron jobs: pg_net not available.';
    return;
  end if;

  _base_url := current_setting('app.settings.supabase_url', true);
  if _base_url is null or _base_url = '' then
    raise notice 'Skipping iron cron jobs: app.settings.supabase_url not configured.';
    return;
  end if;

  _service_key := coalesce(current_setting('app.settings.service_role_key', true), '');
  if _service_key = '' then
    raise notice 'Skipping iron cron jobs: app.settings.service_role_key not configured.';
    return;
  end if;

  -- ── iron-pattern-mining: nightly at 02:00 UTC ────────────────────────────
  perform cron.unschedule('iron-pattern-mining-nightly')
    where exists (select 1 from cron.job where jobname = 'iron-pattern-mining-nightly');

  perform cron.schedule(
    'iron-pattern-mining-nightly',
    '0 2 * * *',
    format(
      $sql$select net.http_post(
        url := '%s/functions/v1/iron-pattern-mining',
        headers := jsonb_build_object(
          'Authorization', 'Bearer %s',
          'Content-Type', 'application/json'
        ),
        body := '{"source":"cron"}'::jsonb
      );$sql$,
      _base_url,
      _service_key
    )
  );

  -- ── iron-redteam-nightly: nightly at 03:00 UTC ───────────────────────────
  perform cron.unschedule('iron-redteam-nightly')
    where exists (select 1 from cron.job where jobname = 'iron-redteam-nightly');

  perform cron.schedule(
    'iron-redteam-nightly',
    '0 3 * * *',
    format(
      $sql$select net.http_post(
        url := '%s/functions/v1/iron-redteam-nightly',
        headers := jsonb_build_object(
          'Authorization', 'Bearer %s',
          'Content-Type', 'application/json'
        ),
        body := '{"source":"cron"}'::jsonb
      );$sql$,
      _base_url,
      _service_key
    )
  );

  raise notice 'Iron cron jobs registered: iron-pattern-mining-nightly (02:00 UTC), iron-redteam-nightly (03:00 UTC).';
end;
$cron$;
