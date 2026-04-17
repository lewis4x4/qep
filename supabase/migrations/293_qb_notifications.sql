-- ============================================================================
-- Migration 293: QB Notifications + pg_cron Guard
--
-- Creates qb_notifications table (used by qb-rebate-deadlines-cron edge fn).
-- Registers daily pg_cron job at 11:00 UTC with a NULL URL guard — silent
-- no-op until the real edge function URL is wired via app.settings.
--
-- Applied to staging (iciddijgonywtxoelous) during Slice 03 execution.
-- SQL file was missing from outer repo — this reconstructs it from live DB.
-- CREATE TABLE IF NOT EXISTS + policy DO blocks: fully idempotent.
--
-- TODO (Slice 07 / infra pass): wire real edge function URL for
-- qb-rebate-deadline-check cron via app.settings — currently NULL (silent
-- no-op):
--   update cron.job set command = '...' where jobname = ''qb-rebate-deadline-check'';
-- ============================================================================

create table if not exists public.qb_notifications (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id text        not null default 'default',
  user_id      uuid        references auth.users(id) on delete cascade,
  type         text        not null,
  title        text        not null,
  body         text        not null,
  metadata     jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_qb_notifications_user_unread
  on public.qb_notifications(user_id, created_at desc)
  where read_at is null;

create index if not exists idx_qb_notifications_workspace
  on public.qb_notifications(workspace_id, created_at desc);

alter table public.qb_notifications enable row level security;

-- ── RLS policies (idempotent via DO blocks) ───────────────────────────────────

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'qb_notifications'
      and policyname = 'qb_notifications service role bypass'
  ) then
    execute '
      create policy "qb_notifications service role bypass"
        on public.qb_notifications
        for all
        using (auth.role() = ''service_role'')
    ';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'qb_notifications'
      and policyname = 'qb_notifications read own'
  ) then
    execute '
      create policy "qb_notifications read own"
        on public.qb_notifications
        for select
        using (auth.uid() = user_id and get_my_workspace() = workspace_id)
    ';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'qb_notifications'
      and policyname = 'qb_notifications elevated read'
  ) then
    execute '
      create policy "qb_notifications elevated read"
        on public.qb_notifications
        for select
        using (
          get_my_workspace() = workspace_id
          and get_my_role() in (''admin'', ''manager'', ''owner'')
        )
    ';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'qb_notifications'
      and policyname = 'qb_notifications mark read'
  ) then
    execute '
      create policy "qb_notifications mark read"
        on public.qb_notifications
        for update
        using (auth.uid() = user_id)
        with check (auth.uid() = user_id)
    ';
  end if;
end $$;

-- ── pg_cron guard ─────────────────────────────────────────────────────────────
-- Registers the daily rebate deadline check cron job.
-- url := NULL is intentional — silent no-op until wired with real URL.
-- Silent no-op if pg_cron extension is not installed.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Schedule only if not already registered
    if not exists (select 1 from cron.job where jobname = 'qb-rebate-deadline-check') then
      perform cron.schedule(
        'qb-rebate-deadline-check',
        '0 11 * * *',
        $cron$
          select net.http_post(
            url     := NULL,
            headers := '{"Content-Type":"application/json","Authorization":"Bearer " || current_setting(''app.service_role_key'', true)}'::jsonb
          );
        $cron$
      );
    end if;
  end if;
exception when others then
  null; -- transient error registering cron — non-fatal
end $$;
