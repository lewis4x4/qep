-- 536_purge_demo_seed_data.sql
--
-- Hard-stop cleanup for legacy demo/seed rows. Earlier migrations and demo
-- tools inserted deterministic CRM, service, rental, and parts records for
-- presentation data. Production/shared environments must be import-backed.
--
-- This migration targets only deterministic seed UUID ranges and explicit
-- demo metadata. It is safe to re-run.

begin;

-- Child/dependent rows first.
delete from public.qrm_activities
where id::text like '71000000-0000-4000-8000-%'
   or metadata ? 'demoSeedBatchId'
   or metadata ? 'demoCleanupSafe'
   or deal_id in (
      select id from public.qrm_deals
      where id::text like '51000000-0000-4000-8000-%'
         or id::text like 'c1000000-%'
         or metadata ? 'demoSeedBatchId'
         or metadata ? 'demoCleanupSafe'
    )
   or contact_id in (
      select id from public.qrm_contacts
      where id::text like '21000000-0000-4000-8000-%'
         or id::text like 'd1000000-%'
         or metadata ? 'demoSeedBatchId'
         or metadata ? 'demoCleanupSafe'
    )
   or company_id in (
      select id from public.qrm_companies
      where id::text like '11000000-0000-4000-8000-%'
         or id::text like 'c1000000-%'
         or id = 'e5000000-0000-4000-8000-000000000001'::uuid
         or metadata ? 'demoSeedBatchId'
         or metadata ? 'demoCleanupSafe'
    );

delete from public.crm_contact_companies
where id::text like '22000000-0000-4000-8000-%';

delete from public.crm_contact_territories
where id::text like '32000000-0000-4000-8000-%';

delete from public.crm_custom_field_values
where id::text like '42000000-0000-4000-8000-%';

delete from public.customer_deal_history
where id::text like '62000000-0000-4000-8000-%';

delete from public.quotes
where id::text like '81000000-0000-4000-8000-%';

delete from public.crm_hubspot_import_errors
where id::text like '99000000-0000-4000-8000-%';

delete from public.crm_hubspot_import_runs
where id::text like '98000000-0000-4000-8000-%'
   or metadata ? 'demo_seed_batch_id';

delete from public.crm_duplicate_candidates
where id::text like '91000000-0000-4000-8000-%';

delete from public.crm_activity_templates
where id::text like '88000000-0000-4000-8000-%';
-- [2026-07-07] schema-drift repair: qrm_activity_templates no longer carries a
-- metadata column upstream; the deterministic UUID prefix predicate stands alone.

delete from public.crm_custom_field_definitions
where id::text like '41000000-0000-4000-8000-%';

delete from public.crm_territories
where id::text like '31000000-0000-4000-8000-%';

delete from public.crm_deal_equipment
where deal_id in (
  select id from public.qrm_deals
  where id::text like '51000000-0000-4000-8000-%'
     or metadata ? 'demoSeedBatchId'
     or metadata ? 'demoCleanupSafe'
);

delete from public.qrm_deals
where id::text like '51000000-0000-4000-8000-%'
   or id::text like 'c1000000-%'
   or metadata ? 'demoSeedBatchId'
   or metadata ? 'demoCleanupSafe';

delete from public.qrm_equipment
where id::text like '33000000-0000-4000-8000-%'
   or id::text like 'f1000000-%'
   or id = 'e6000000-0000-4000-8000-000000000001'::uuid
   or metadata ? 'demoSeedBatchId'
   or metadata ? 'demoCleanupSafe';

delete from public.qrm_contacts
where id::text like '21000000-0000-4000-8000-%'
   or id::text like 'd1000000-%'
   or metadata ? 'demoSeedBatchId'
   or metadata ? 'demoCleanupSafe';

delete from public.customer_profiles_extended
where id::text like '61000000-0000-4000-8000-%';

delete from public.qrm_companies
where id::text like '11000000-0000-4000-8000-%'
   or id::text like 'c1000000-%'
   or id = 'e5000000-0000-4000-8000-000000000001'::uuid
   or metadata ? 'demoSeedBatchId'
   or metadata ? 'demoCleanupSafe';

-- BU Pulse and service/parts seed rows. These are deterministic smoke/demo ids.
delete from public.customer_invoices
where id::text like '52000000-0000-7000-8000-0000000003%';

delete from public.service_internal_billing_line_staging
where id::text like 'f000000b-%';

delete from public.service_parts_inventory_overrides
where id::text like 'f000000a-%';

delete from public.parts_fulfillment_events
where id::text like 'f0000007-%';

delete from public.parts_order_events
where id::text like 'f0000018-%';

delete from public.parts_order_lines
where id::text like 'f0000012-%'
   or id::text like 'f0000020-0000-4000-8000-00000000001%';

delete from public.service_parts_requirements
where id::text like 'f0000005-%'
   or id::text like 'f000000e-%';

delete from public.service_jobs
where id::text like 'f0000004-%'
   or id::text like 'f000000d-%'
   or id::text like '22000000-0000-4000-8000-%'
   or id = 'd4000000-0000-4000-8000-000000000001'::uuid;

delete from public.parts_fulfillment_runs
where id::text like 'f0000006-%';

delete from public.parts_orders
where id::text like 'f0000009-%'
   or id::text like 'f0000011-%'
   or id::text like 'f0000020-%'
   or id::text like '51000000-0000-7000-8000-0000000003%'
   or id = 'c3000000-0000-4000-8000-000000000001'::uuid;

delete from public.parts_auto_replenish_queue
where id::text like 'f0000016-0000-4000-8000-00000000000%';

delete from public.parts_replenishment_rules
where id = 'f0000016-0000-4000-8000-000000000010'::uuid;

delete from public.parts_transfer_recommendations
where id::text like 'f0000021-%';

delete from public.parts_predictive_kits
where id::text like 'f0000019-%';

delete from public.customer_parts_intelligence
where id::text like 'f0000022-%';

delete from public.vendor_part_catalog
where id::text like 'f0000017-%';

delete from public.parts_cross_references
where id::text like 'f0000015-%';

delete from public.parts_demand_forecasts
where id::text like 'f0000014-%';

delete from public.parts_reorder_profiles
where id::text like 'f0000013-%';

delete from public.parts_inventory
where id::text like 'f0000003-%';

delete from public.parts_catalog
where id::text like 'f0000010-%';

-- [2026-07-07] schema-drift repair: the extensions FK is rental_contract_id.
delete from public.rental_contract_extensions
where rental_contract_id in (
  select id from public.rental_contracts
  where id::text like '53000000-0000-7000-8000-0000000003%'
     or id::text like 'f000000e-%'
);

delete from public.rental_contracts
where id::text like '53000000-0000-7000-8000-0000000003%'
   or id::text like 'f000000e-%';

delete from public.vendor_escalations
where id::text like 'f000000c-%';

delete from public.vendor_escalation_policies
where id::text like 'f000000c-%';

delete from public.vendor_profiles
where id::text like 'f0000002-%';

delete from public.portal_customers
where id::text like 'f0000008-%'
   or id = 'a1000000-0000-4000-8000-000000000001'::uuid;

delete from public.service_branch_config
where id::text like 'f0000001-%';

delete from public.branches
where id::text like 'f0000030-%';

-- Clear nullable audit/uploader references so demo auth/profile rows can be
-- fully removed instead of retained as disabled accounts.
update public.documents
set uploaded_by = null
where uploaded_by::text like '10000000-0000-4000-8000-%';

update public.customer_attachments
set uploaded_by = null
where uploaded_by::text like '10000000-0000-4000-8000-%';

update public.equipment_documents
set uploaded_by = null
where uploaded_by::text like '10000000-0000-4000-8000-%';

update public.parts_import_runs
set uploaded_by = null
where uploaded_by::text like '10000000-0000-4000-8000-%';

update public.sop_ingestion_runs
set uploaded_by = null
where uploaded_by::text like '10000000-0000-4000-8000-%';

update public.qb_price_sheets
set
  uploaded_by = null,
  reviewed_by = null
where uploaded_by::text like '10000000-0000-4000-8000-%'
   or reviewed_by::text like '10000000-0000-4000-8000-%';

-- Remove legacy QA tenant data from shared/live environments.
update public.anomaly_alerts
set assigned_to = null
where assigned_to = 'a0000000-0000-0000-0000-000000000002'::uuid;

update public.flow_events
set suggested_owner = null
where suggested_owner = 'a0000000-0000-0000-0000-000000000002'::uuid;

update public.qrm_honesty_observations
set attributed_user_id = null
where attributed_user_id = 'a0000000-0000-0000-0000-000000000002'::uuid;

update public.record_change_history
set actor_user_id = null
where actor_user_id = 'a0000000-0000-0000-0000-000000000002'::uuid;

delete from public.crm_in_app_notifications
where user_id = 'a0000000-0000-0000-0000-000000000002'::uuid;

delete from public.morning_briefings
where user_id = 'a0000000-0000-0000-0000-000000000002'::uuid;

delete from public.profile_role_blend
where profile_id = 'a0000000-0000-0000-0000-000000000002'::uuid;

delete from public.qb_notifications
where user_id = 'a0000000-0000-0000-0000-000000000002'::uuid;

delete from public.qrm_absence_engine_rep_snapshots
where rep_id = 'a0000000-0000-0000-0000-000000000002'::uuid;

delete from public.qrm_in_app_notifications
where user_id = 'a0000000-0000-0000-0000-000000000002'::uuid;

delete from public.profiles
where id::text like '10000000-0000-4000-8000-%'
   or id = 'a0000000-0000-0000-0000-000000000002'::uuid
   or email like '%@test.qep.local';

delete from auth.users
where id::text like '10000000-0000-4000-8000-%'
   or id = 'a0000000-0000-0000-0000-000000000002'::uuid
   or email like 'demo.%@qep-demo.local'
   or email like '%@test.qep.local';

select public.refresh_wave4_materialized_views();

commit;
