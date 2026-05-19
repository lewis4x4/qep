-- ============================================================================
-- Migration 580: QRM Approval Digest — tracking table + daily cron
--
-- Phase 3C of the quote-approval feedback-loop work. Adds a per-day idempotency
-- log so the qrm-approval-digest edge function can guarantee one email per
-- manager per day, and registers the pg_cron tick that drives it.
--
-- Schedule: 13:00 UTC daily (~ 9am ET in summer, 8am ET in winter — close
-- enough to "morning" for the field without trying to honor per-workspace TZ).
-- The function itself defaults to UTC for the (user_id, sent_on) date key
-- because profiles.timezone does not exist on this project.
--
-- Uses the canonical iron_cron_schedules / m365_token_refresh pattern:
--   • DO block guarded by pg_namespace checks for cron + net
--   • Resolves base URL + internal-service-secret from an existing cron row so
--     we never bake creds into a migration
--   • cron.unschedule before cron.schedule so re-runs are safe
-- ============================================================================

-- ── 1. Tracking table ───────────────────────────────────────────────────────
create table if not exists public.qrm_approval_digest_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  sent_on date not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists qrm_approval_digest_log_user_day_uk
  on public.qrm_approval_digest_log (user_id, sent_on);

create index if not exists qrm_approval_digest_log_sent_at_idx
  on public.qrm_approval_digest_log (sent_at desc);

comment on table public.qrm_approval_digest_log is
  'Per-day idempotency log for qrm-approval-digest. One row per (user, UTC day) — UNIQUE constraint enforces single-send.';

alter table public.qrm_approval_digest_log enable row level security;

-- Service role: full access (used by the edge function itself).
drop policy if exists qrm_approval_digest_log_service_all on public.qrm_approval_digest_log;
create policy qrm_approval_digest_log_service_all
  on public.qrm_approval_digest_log
  for all
  to service_role
  using (true)
  with check (true);

-- Authenticated users may read their own digest history (transparency:
-- "did I get one today?"). No insert/update/delete from authenticated.
drop policy if exists qrm_approval_digest_log_self_select on public.qrm_approval_digest_log;
create policy qrm_approval_digest_log_self_select
  on public.qrm_approval_digest_log
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ── 2. Cron registration ────────────────────────────────────────────────────
do $cron$
declare
  v_source_command text;
  v_url_base text;
  v_secret text;
  v_command text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping qrm-approval-digest-daily: pg_cron not installed.';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise notice 'Skipping qrm-approval-digest-daily: pg_net not installed.';
    return;
  end if;

  -- Bootstrap URL + secret from an existing cron command — same pattern as
  -- migration 567 (m365 token refresh). Prefer flow-runner; fall back to any
  -- row that calls /functions/v1/ with x-internal-service-secret.
  select command
    into v_source_command
    from cron.job
    where jobname = 'flow-runner'
    limit 1;

  if v_source_command is null then
    select command
      into v_source_command
      from cron.job
      where command like '%x-internal-service-secret%'
        and command like '%/functions/v1/%'
      order by jobid asc
      limit 1;
  end if;

  if v_source_command is null then
    raise notice 'Skipping qrm-approval-digest-daily: no existing cron command found to harvest URL + secret from.';
    return;
  end if;

  select substring(v_source_command from '(https://[^''[:space:]]+)/functions/v1/')
    into v_url_base;
  if v_url_base is null or v_url_base = '' then
    raise notice 'Skipping qrm-approval-digest-daily: could not resolve URL base from existing cron command.';
    return;
  end if;

  v_secret := split_part(
    split_part(v_source_command, $tag1$x-internal-service-secret', '$tag1$, 2),
    $tag2$'$tag2$,
    1
  );
  if v_secret is null or v_secret = '' then
    raise notice 'Skipping qrm-approval-digest-daily: could not resolve internal-service-secret from existing cron command.';
    return;
  end if;

  v_command := format(
    $cmd$select net.http_post(
      url := '%s/functions/v1/qrm-approval-digest',
      headers := jsonb_build_object(
        'x-internal-service-secret', '%s',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    )$cmd$,
    v_url_base, v_secret
  );

  perform cron.unschedule('qrm-approval-digest-daily')
    where exists (select 1 from cron.job where jobname = 'qrm-approval-digest-daily');

  perform cron.schedule(
    'qrm-approval-digest-daily',
    '0 13 * * *',
    v_command
  );

  raise notice 'Scheduled qrm-approval-digest-daily at 13:00 UTC.';
end;
$cron$;
