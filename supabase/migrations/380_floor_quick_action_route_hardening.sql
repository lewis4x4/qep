-- ============================================================================
-- Migration 380: The Floor — harden seeded quick-action routes.
--
-- Migration 375 seeded several aspirational parts/service routes before the
-- current React route map was final. This migration rewrites only the
-- quickActions arrays on role-default rows to point at live routes.
-- ============================================================================

update public.floor_layouts
set layout_json = jsonb_set(
  layout_json,
  '{quickActions}',
  jsonb_build_array(
    jsonb_build_object('id', 'next_job',      'label', 'NEXT JOB',      'route', '/service/wip',         'icon', 'wrench'),
    jsonb_build_object('id', 'pdi_checklist', 'label', 'PDI CHECKLIST', 'route', '/service/inspections', 'icon', 'check'),
    jsonb_build_object('id', 'parts_pickup',  'label', 'PARTS PICKUP',  'route', '/parts/orders?status=ready', 'icon', 'parts')
  ),
  true
),
updated_at = now()
where workspace_id = 'default'
  and iron_role = 'iron_man'
  and user_id is null;

update public.floor_layouts
set layout_json = jsonb_set(
  layout_json,
  '{quickActions}',
  jsonb_build_array(
    jsonb_build_object('id', 'new_parts_quote', 'label', 'NEW PARTS QUOTE', 'route', '/parts/orders/new',       'icon', 'parts'),
    jsonb_build_object('id', 'lookup_serial',   'label', 'LOOKUP SERIAL',   'route', '/parts/companion/lookup', 'icon', 'search'),
    jsonb_build_object('id', 'open_drafts',     'label', 'OPEN DRAFTS',     'route', '/parts/orders?status=draft', 'icon', 'drafts')
  ),
  true
),
updated_at = now()
where workspace_id = 'default'
  and iron_role = 'iron_parts_counter'
  and user_id is null;

update public.floor_layouts
set layout_json = jsonb_set(
  layout_json,
  '{quickActions}',
  jsonb_build_array(
    jsonb_build_object('id', 'review_replen',    'label', 'REVIEW REPLEN',    'route', '/parts/companion/replenish', 'icon', 'parts'),
    jsonb_build_object('id', 'inventory_health', 'label', 'INVENTORY',        'route', '/parts/inventory',           'icon', 'box'),
    jsonb_build_object('id', 'supplier_status',  'label', 'SUPPLIER STATUS',  'route', '/parts/companion/suppliers', 'icon', 'activity')
  ),
  true
),
updated_at = now()
where workspace_id = 'default'
  and iron_role = 'iron_parts_manager'
  and user_id is null;
