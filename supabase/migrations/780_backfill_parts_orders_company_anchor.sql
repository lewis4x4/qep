-- 780_backfill_parts_orders_company_anchor.sql
--
-- RF-008 (docs/reviews/2026-07-08-full-codebase-review.md): parts_orders has
-- an either/or customer anchor (132_parts_module_schema.sql), and portal-api
-- stamped only portal_customer_id on portal orders while counter sales stamp
-- only crm_company_id. Company-keyed lenses split as a result:
-- get_account_360's parts lens (joins via portal_customers) misses all
-- counter orders, and parts-network-optimizer's customer_parts_intelligence
-- (filters crm_company_id is not null) misses all portal orders — the same
-- company reads two different parts-spend numbers.
--
-- portal-api now stamps both anchors on new portal orders; this backfills
-- crm_company_id on historical portal orders from the portal customer's
-- company link. The exists guard mirrors the same-workspace / not-deleted
-- check in parts_orders_enforce_customer_workspace(), so a stale link skips
-- the row instead of aborting the migration. Idempotent: only touches rows
-- where crm_company_id is still null.

begin;

update public.parts_orders po
set crm_company_id = pc.crm_company_id
from public.portal_customers pc
where po.portal_customer_id = pc.id
  and po.crm_company_id is null
  and pc.crm_company_id is not null
  -- mirror BOTH halves of parts_orders_enforce_customer_workspace(): the
  -- trigger also re-validates portal_customer_id workspace on UPDATE, so a
  -- workspace-drifted portal customer must skip rather than abort the run
  and pc.workspace_id = po.workspace_id
  and exists (
    select 1 from public.crm_companies c
    where c.id = pc.crm_company_id
      and c.workspace_id = po.workspace_id
      and c.deleted_at is null
  );

commit;
