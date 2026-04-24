-- 394_iron_advisor_floor_layout.sql
--
-- Updates the role-default floor_layouts row for iron_advisor to match the
-- Sales Rep home spec approved 2026-04-24 (docs/sales-rep-home-handoff.md).
--
-- Changes from the prior row:
--   - Drop quote.deal-copilot-summary (belongs on deal detail, not home).
--   - Add sales.recent-activity (NEW — last 5 touches + customer quote
--     "viewed_at" buying signals from quote_packages).
--   - Reorder so the hero (sales.my-quotes-by-status) stays at order 0,
--     followed by the right rail (ai-briefing, action-items, recent-activity),
--     then the below-fold pipeline (qrm.follow-up-queue).
--   - Quick actions untouched (NEW QUOTE, VOICE NOTE, MY PIPELINE).
--
-- Idempotent: only updates the workspace='default' role-default row
-- (user_id IS NULL). Per-user overrides untouched.

update public.floor_layouts
set
  layout_json = jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'sales.my-quotes-by-status', 'order', 0),
      jsonb_build_object('id', 'sales.ai-briefing',         'order', 1),
      jsonb_build_object('id', 'sales.action-items',        'order', 2),
      jsonb_build_object('id', 'sales.recent-activity',     'order', 3),
      jsonb_build_object('id', 'qrm.follow-up-queue',       'order', 4)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'new_quote',   'label', 'NEW QUOTE',   'route', '/quote-v2',                 'icon', 'quote'),
      jsonb_build_object('id', 'voice_note',  'label', 'VOICE NOTE',  'route', '/voice-qrm',                'icon', 'voice'),
      jsonb_build_object('id', 'my_pipeline', 'label', 'MY PIPELINE', 'route', '/qrm/deals?assigned_to=me', 'icon', 'activity')
    ),
    'showNarrative', true
  ),
  updated_at = now()
where workspace_id = 'default'
  and iron_role   = 'iron_advisor'
  and user_id     is null;
