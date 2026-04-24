-- 391_owner_floor_layout_option_a.sql
--
-- Updates the role-default floor_layouts row for iron_owner to match the
-- Option A design approved 2026-04-24.
--
-- Changes from the prior row:
--   - Drop exec.owner-brief widget (narrative now lives in the zone 01
--     NARRATIVE section directly, rendered by FloorPage from the
--     owner-morning-brief edge function).
--   - Add exec.bu-pulse widget (NEW, wide) showing four business-unit
--     tiles: Equipment, Parts, Service, Rentals.
--   - Keep: nervous.customer-health, exec.revenue-pace, iron.owner-large-deals.
--   - Quick action labels normalized to title case to match Option A.
--
-- Idempotent: only updates the workspace='default' role-default row for
-- iron_owner (user_id IS NULL). Per-user overrides untouched.

update public.floor_layouts
set
  layout_json = jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'nervous.customer-health', 'order', 0),
      jsonb_build_object('id', 'exec.revenue-pace',       'order', 1),
      jsonb_build_object('id', 'exec.bu-pulse',           'order', 2),
      jsonb_build_object('id', 'iron.owner-large-deals',  'order', 3)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'ask_iron',       'label', 'Ask Iron',       'route', '/chat',                 'icon', 'sparkles'),
      jsonb_build_object('id', 'open_pipeline',  'label', 'Open Pipeline',  'route', '/qrm',                  'icon', 'activity'),
      jsonb_build_object('id', 'monthly_report', 'label', 'Monthly Report', 'route', '/admin/deal-economics', 'icon', 'trending')
    ),
    'showNarrative', true
  ),
  updated_at = now()
where workspace_id = 'default'
  and iron_role   = 'iron_owner'
  and user_id     is null;
