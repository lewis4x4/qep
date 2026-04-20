-- ============================================================================
-- Migration 317: Hub — knowledge-sync cron (every 4h)
--
-- Keeps hub_knowledge_source + hub_knowledge_chunk fresh as hub_changelog,
-- hub_decisions, and shipped hub_build_items rows accumulate. When
-- GOOGLE_SERVICE_ACCOUNT_KEY + HUB_DRIVE_FOLDER_ID are set in edge-function
-- secrets, the same fn also pushes markdown files to the Drive folder
-- NotebookLM watches (so citations stay round-trippable). Zero-blocking
-- otherwise — Supabase mirror keeps working regardless of Drive state.
--
-- Follows the migration 205/316 pattern (secret extracted from flow-runner's
-- command, not embedded in this file).
-- ============================================================================

do $do$
declare
  v_secret text;
  v_url_base constant text := 'https://iciddijgonywtxoelous.supabase.co';
  v_command text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise exception 'pg_cron is not installed; cannot schedule hub-knowledge-sync';
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise exception 'pg_net is not installed; cannot schedule hub-knowledge-sync';
  end if;

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
    raise exception 'Could not extract internal-service-secret from flow-runner cron command. Register flow-runner first.';
  end if;

  v_command := format(
    $cmd$select net.http_post(
      url := '%s/functions/v1/hub-knowledge-sync',
      headers := jsonb_build_object(
        'x-internal-service-secret', '%s',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 240000
    )$cmd$,
    v_url_base, v_secret
  );

  if exists (select 1 from cron.job where jobname = 'hub-knowledge-sync-every-4h') then
    perform cron.unschedule('hub-knowledge-sync-every-4h');
    raise notice 'Unscheduled existing hub-knowledge-sync-every-4h';
  end if;

  perform cron.schedule(
    'hub-knowledge-sync-every-4h',
    '7 */4 * * *',  -- at :07 past each 4-hour boundary (offset from other crons)
    v_command
  );
  raise notice 'Scheduled hub-knowledge-sync-every-4h (every 4h at :07)';

end;
$do$;
