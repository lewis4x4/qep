-- 534_intellidealer_universal_created_by_audit.sql
--
-- Follow-on for docs/intellidealer-gap-audit/cross-cutting.yaml#audit.created_by.
-- Extends the existing record_change_history compatibility layer across
-- workspace-scoped operational tables without rewriting table schemas.

do $$
declare
  v_table record;
  v_trigger_name text;
  v_installed_count integer := 0;
begin
  if to_regclass('public.record_change_history') is null
     or to_regprocedure('public.record_change_history_capture()') is null then
    raise notice 'record_change_history foundation is unavailable; skipping universal audit trigger install';
    return;
  end if;

  for v_table in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and exists (
        select 1
        from pg_attribute a
        where a.attrelid = c.oid
          and a.attname = 'id'
          and a.atttypid = 'uuid'::regtype
          and not a.attisdropped
      )
      and exists (
        select 1
        from pg_attribute a
        where a.attrelid = c.oid
          and a.attname = 'workspace_id'
          and not a.attisdropped
      )
      and c.relname <> 'record_change_history'
      and c.relname !~ '(^|_)audit($|_)'
      and c.relname !~ '(_events$|_event$|_logs$|_log$|_runs$|_run$|_snapshots$|_snapshot$|_embeddings$|_embedding$)'
      and c.relname not in (
        'analytics_action_log',
        'analytics_events',
        'analytics_alerts',
        'data_quality_audit',
        'document_audit_events',
        'document_visibility_audit',
        'flare_reports',
        'integration_status_credential_audit_events',
        'qrm_auth_audit_events',
        'qrm_hubspot_import_errors',
        'qrm_hubspot_import_runs',
        'qrm_merge_audit_events',
        'qrm_quote_audit_events',
        'service_cron_runs'
      )
    order by c.relname
  loop
    v_trigger_name := 'trg_rch_' || v_table.table_name;
    execute format('drop trigger if exists %I on public.%I', v_trigger_name, v_table.table_name);
    execute format(
      'create trigger %I after insert or update or delete on public.%I ' ||
      'for each row execute function public.record_change_history_capture()',
      v_trigger_name,
      v_table.table_name
    );
    v_installed_count := v_installed_count + 1;
  end loop;

  raise notice 'installed record_change_history triggers on % operational tables', v_installed_count;
end $$;

comment on view public.v_record_created_by is
  'Created-by rollup from the first insert audit event per workspace/table/record. Trigger coverage is installed broadly on workspace-scoped operational tables with uuid id columns.';

comment on view public.v_audit_record_changes is
  'Compatibility audit view exposing record_change_history.actor_user_id as created_by for IntelliDealer-style audit consumers across workspace-scoped operational tables.';
