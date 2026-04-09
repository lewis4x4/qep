-- ============================================================================
-- Migration 223: Data Quality Audit Infrastructure (Track 5, Slice 5.8)
--
-- Creates the exec_data_quality_summary table for persisting nightly
-- audit results and schedules the data-quality-audit edge function.
-- ============================================================================

create table if not exists public.exec_data_quality_summary (
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
select cron.schedule(
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
