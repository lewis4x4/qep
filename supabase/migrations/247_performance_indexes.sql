-- ============================================================
-- 247 · Performance indexes for RLS + query hot paths
-- ============================================================
-- Addresses missing indexes flagged by the P1 performance audit:
--   1. crm_contact_territories(territory_id) — RLS reverse lookup
--   2. crm_activities(created_by) — activity feed by creator
--   3. parts_inventory(workspace_id, part_number) — N+1 inventory checks
-- ============================================================

-- 1. Territory reverse lookup for RLS in crm_rep_can_access_contact()
-- Note: table was renamed qrm_* in migration 170; crm_* is a compat view
CREATE INDEX IF NOT EXISTS idx_qrm_contact_territories_territory
  ON public.qrm_contact_territories (territory_id);

-- 2. Activity feed by creator (used in "my activities" views)
CREATE INDEX IF NOT EXISTS idx_qrm_activities_created_by
  ON public.qrm_activities (created_by)
  WHERE deleted_at IS NULL;

-- 3. Parts inventory lookup (compound) — avoids N+1 in voice-to-parts-order
CREATE INDEX IF NOT EXISTS idx_parts_inventory_ws_partnum
  ON public.parts_inventory (workspace_id, part_number);

NOTIFY pgrst, 'reload schema';
