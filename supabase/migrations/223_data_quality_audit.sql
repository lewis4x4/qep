-- ============================================================================
-- Migration 223: Data Quality Audit Infrastructure (Track 5, Slice 5.8)
--
-- Replaces the legacy exec_data_quality_summary view with a persisted summary
-- table for nightly audit results and schedules the data-quality-audit edge
-- function.
-- ============================================================================

drop view if exists public.exec_data_quality_summary;

create table if not exists public.exec_data_quality_summary (
  workspace_id text not null default 'default',
  issue_class text primary key,
  description text not null,
  open_count integer not null default 0,
  severity text not null check (severity in ('critical', 'warning', 'info')),
  suggested_action text,
  updated_at timestamptz not null default now()
);

alter table public.exec_data_quality_summary enable row level security;

create policy "Authenticated users can view data quality summary"
  on public.exec_data_quality_summary for select
  to authenticated using (true);

create policy "Service role full access"
  on public.exec_data_quality_summary for all
  to service_role using (true) with check (true);

-- Schedule nightly audit at 04:00 UTC (before health-score-refresh at 05:00)
do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'data-quality-audit') then
    perform cron.unschedule('data-quality-audit');
  end if;

  perform cron.schedule(
    'data-quality-audit',
    '0 4 * * *',
    format(
      $sql$
      select net.http_post(
        url := '%s/functions/v1/data-quality-audit',
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
exception
  when undefined_function then
    raise notice 'Skipping data-quality-audit cron: pg_cron or pg_net unavailable.';
end
$cron$;
