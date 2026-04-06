-- ============================================================================
-- Migration 170: CRM → QRM table rename + backwards-compat views (Tier 4)
--
-- Per ownership decision: the product is QRM. Every database table gets
-- renamed from crm_* to qrm_*. To keep zero-downtime / zero-blast-radius
-- semantics during the cutover, this migration ALSO creates compatibility
-- views named with the old crm_* identifiers that select from the renamed
-- qrm_* tables. Simple unfiltered SELECT views are AUTOMATICALLY updatable
-- by Postgres, so existing edge functions and code continue to work
-- through the compat views without modification.
--
-- Compat views are temporary scaffolding. A future migration will drop
-- them after every consumer has been updated to query the qrm_* names
-- directly. For now they exist so the rename is non-breaking.
--
-- All 26 tables in scope:
--   crm_activities, crm_activity_templates, crm_auth_audit_events,
--   crm_companies, crm_contact_companies, crm_contact_tags,
--   crm_contact_territories, crm_contacts, crm_custom_field_definitions,
--   crm_custom_field_values, crm_deal_equipment, crm_deal_stages,
--   crm_deals, crm_duplicate_candidates, crm_embeddings, crm_equipment,
--   crm_external_id_map, crm_geofences, crm_hubspot_import_errors,
--   crm_hubspot_import_runs, crm_in_app_notifications,
--   crm_merge_audit_events, crm_quote_audit_events,
--   crm_reminder_instances, crm_tags, crm_territories
--
-- Notes on what is NOT touched here:
--   - Indexes, triggers, FKs, RLS policies follow the table on rename
--     automatically. Their NAMES still contain "crm_" but they apply
--     correctly to the renamed table. Cleanup of identifier strings is
--     a Tier 5 cosmetic pass.
--   - Function bodies that hardcode `from crm_x` continue to work via
--     the compat views.
--   - The compat views inherit RLS from the underlying qrm_* tables
--     (security_invoker semantics for views are honored when the
--     security_invoker flag is set; we set it explicitly below).
-- ============================================================================

-- Helper: macro to rename one table + create its compat view, idempotently.
do $$
declare
  tbl text;
  tbls text[] := array[
    'activities', 'activity_templates', 'auth_audit_events', 'companies',
    'contact_companies', 'contact_tags', 'contact_territories', 'contacts',
    'custom_field_definitions', 'custom_field_values', 'deal_equipment',
    'deal_stages', 'deals', 'duplicate_candidates', 'embeddings',
    'equipment', 'external_id_map', 'geofences', 'hubspot_import_errors',
    'hubspot_import_runs', 'in_app_notifications', 'merge_audit_events',
    'quote_audit_events', 'reminder_instances', 'tags', 'territories'
  ];
begin
  foreach tbl in array tbls loop
    -- Skip if the qrm_ table already exists (idempotent re-run)
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'qrm_' || tbl and c.relkind = 'r'
    ) then
      -- Only rename if the crm_ table actually exists as a table (not a view)
      if exists (
        select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'crm_' || tbl and c.relkind = 'r'
      ) then
        execute format('alter table public.crm_%I rename to qrm_%I', tbl, tbl);
      end if;
    end if;

    -- Create compat view if the qrm_ table now exists and the crm_ name is free
    if exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'qrm_' || tbl and c.relkind = 'r'
    ) and not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'crm_' || tbl
    ) then
      execute format(
        'create view public.crm_%I as select * from public.qrm_%I',
        tbl, tbl
      );
      execute format(
        'alter view public.crm_%I set (security_invoker = true)',
        tbl
      );
      execute format(
        'comment on view public.crm_%I is %L',
        tbl,
        'DEPRECATED COMPATIBILITY VIEW (mig 170). Reads/writes pass through to qrm_' || tbl || '. Update consumers to query qrm_' || tbl || ' directly. This view will be dropped in a future migration.'
      );
    end if;
  end loop;
end $$;

-- Surface a one-row "rename complete" marker so we can detect post-rename state.
create table if not exists public.qrm_rename_marker (
  id int primary key default 1,
  renamed_at timestamptz not null default now(),
  source_migration text not null default '170_qrm_rename_tables_and_compat_views'
);
insert into public.qrm_rename_marker (id) values (1)
  on conflict (id) do update set renamed_at = excluded.renamed_at;

comment on table public.qrm_rename_marker is 'Single-row sentinel proving the CRM→QRM table rename ran. Used by code to detect post-rename state.';
