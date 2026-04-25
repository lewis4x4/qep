-- 395_iron_manager_floor_layout.sql
--
-- Updates the role-default floor_layouts row for iron_manager to match
-- the Sales Manager home composition shipped 2026-04-24.
--
-- Changes from the prior row:
--   - Order is now explicit so the new ManagerFloorGrid can resolve
--     widgets in the right slots: pipeline-by-rep hero (2/3),
--     approval-queue + margin-trend stacked rail (1/3), aging-deals-
--     team below fold full width.
--   - quickActions untouched in DB (top-bar still maps OPEN APPROVALS
--     / NEW QUOTE / NUDGE REP); the page now renders the rich
--     ManagerActionCards on top of those for the 02 Actions section.
--
-- Idempotent: only updates the workspace='default' role-default row
-- (user_id IS NULL). Per-user overrides untouched.

update public.floor_layouts
set
  layout_json = jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'iron.pipeline-by-rep',  'order', 0),
      jsonb_build_object('id', 'iron.approval-queue',   'order', 1),
      jsonb_build_object('id', 'iron.margin-trend',     'order', 2),
      jsonb_build_object('id', 'iron.aging-deals-team', 'order', 3)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'open_approvals', 'label', 'OPEN APPROVALS', 'route', '/qrm/approvals',          'icon', 'approve'),
      jsonb_build_object('id', 'new_quote',      'label', 'NEW QUOTE',      'route', '/quote-v2',               'icon', 'quote'),
      jsonb_build_object('id', 'nudge_rep',      'label', 'NUDGE REP',      'route', '/qrm/deals?stalled=true', 'icon', 'users')
    ),
    'showNarrative', true
  ),
  updated_at = now()
where workspace_id = 'default'
  and iron_role   = 'iron_manager'
  and user_id     is null;
