-- 506_wave4_refresh_support.sql
--
-- Wave 4 initial refresh support for materialized reporting views.
-- Uses the repo's safe pg_cron SQL-only pattern: schedule only when the cron
-- schema is present, and require no pg_net/external edge-function dependency.
--
-- Rollback notes:
--   select cron.unschedule('qep-wave4-report-refresh') where exists (select 1 from cron.job where jobname = 'qep-wave4-report-refresh');
--   drop function if exists public.refresh_wave4_materialized_views();

create or replace function public.refresh_wave4_materialized_views()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    refresh materialized view concurrently public.mv_service_jobs_wip;
  exception when feature_not_supported or invalid_table_definition or object_not_in_prerequisite_state then
    refresh materialized view public.mv_service_jobs_wip;
  end;

  begin
    refresh materialized view concurrently public.mv_service_wip_aging;
  exception when feature_not_supported or invalid_table_definition or object_not_in_prerequisite_state then
    refresh materialized view public.mv_service_wip_aging;
  end;

  begin
    refresh materialized view concurrently public.qrm_customer_profitability_mv;
  exception when feature_not_supported or invalid_table_definition or object_not_in_prerequisite_state then
    refresh materialized view public.qrm_customer_profitability_mv;
  end;

  begin
    refresh materialized view concurrently public.mv_customer_ar_aging;
  exception when feature_not_supported or invalid_table_definition or object_not_in_prerequisite_state then
    refresh materialized view public.mv_customer_ar_aging;
  end;

  begin
    refresh materialized view concurrently public.mv_customer_fiscal_ytd;
  exception when feature_not_supported or invalid_table_definition or object_not_in_prerequisite_state then
    refresh materialized view public.mv_customer_fiscal_ytd;
  end;
end;
$$;

comment on function public.refresh_wave4_materialized_views() is
  'Refreshes all Wave 4 IntelliDealer reporting materialized views. Safe for pg_cron because it has no external dependencies.';

revoke all on function public.refresh_wave4_materialized_views() from public;
grant execute on function public.refresh_wave4_materialized_views() to service_role;
grant execute on function public.refresh_wave4_materialized_views() to postgres;

-- Initial no-op-safe refresh after all Wave 4 MVs and unique indexes exist.
select public.refresh_wave4_materialized_views();

do $cron$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule('qep-wave4-report-refresh')
      where exists (select 1 from cron.job where jobname = 'qep-wave4-report-refresh');

    perform cron.schedule(
      'qep-wave4-report-refresh',
      '17 * * * *',
      'select public.refresh_wave4_materialized_views();'
    );
  else
    raise notice 'Skipping qep-wave4-report-refresh cron: pg_cron extension not available.';
  end if;
exception
  when undefined_object then
    raise notice 'Skipping qep-wave4-report-refresh cron: pg_cron not available.';
  when others then
    raise notice 'Skipping qep-wave4-report-refresh cron: %', sqlerrm;
end;
$cron$;
