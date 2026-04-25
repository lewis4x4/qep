-- 396_iron_manager_floor_layout_v2.sql
--
-- Reseeds the role-default floor_layouts row for iron_manager to use
-- the new dense-table composition shipped 2026-04-24:
--
--   * iron.team-pipeline-table  (NEW) — replaces iron.pipeline-by-rep
--     bar-chart hero with a dense rep table sorted by attention.
--   * iron.manager-forecast     (NEW) — weighted forecast card,
--     pulls forecastDeals data already fetched but unrendered.
--   * iron.manager-stalled-deals (NEW) — replaces iron.aging-deals-team
--     with a sortable, fuller stalled-deals table.
--   * iron.owner-large-deals    (existing widget; allowedRoles now
--     includes iron_manager) — top deals ≥ $250K below fold.
--   * iron.approval-queue + iron.margin-trend stay in the rail.
--
-- Quick actions are unchanged in DB; the page now renders rich
-- ManagerActionCards on top of those for the 02 Actions section.
--
-- Idempotent: only updates the workspace='default' role-default row
-- (user_id IS NULL). Per-user overrides are not touched.

update public.floor_layouts
set
  layout_json = jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'iron.team-pipeline-table',   'order', 0),
      jsonb_build_object('id', 'iron.approval-queue',        'order', 1),
      jsonb_build_object('id', 'iron.manager-forecast',      'order', 2),
      jsonb_build_object('id', 'iron.margin-trend',          'order', 3),
      jsonb_build_object('id', 'iron.manager-stalled-deals', 'order', 4),
      jsonb_build_object('id', 'iron.owner-large-deals',     'order', 5)
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
