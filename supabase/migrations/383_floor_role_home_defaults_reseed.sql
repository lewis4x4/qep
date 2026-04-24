-- ============================================================================
-- 383_floor_role_home_defaults_reseed.sql
--
-- The Floor role-home defaults changed after the original Phase 1 seed rows.
-- The app always prefers public.floor_layouts over hardcoded defaults, so stale
-- database rows can make production look like the old dashboard even when the
-- deployed bundle is current. This migration refreshes role-default layouts
-- only (user_id is null) and preserves any per-user overrides.
-- ============================================================================

insert into public.floor_layouts (workspace_id, iron_role, user_id, layout_json, updated_by)
values
  ('default', 'iron_owner', null, jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'exec.owner-brief',        'order', 0),
      jsonb_build_object('id', 'exec.revenue-pace',       'order', 1),
      jsonb_build_object('id', 'nervous.customer-health', 'order', 2),
      jsonb_build_object('id', 'iron.owner-large-deals',  'order', 3)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'ask_iron',       'label', 'ASK IRON',       'route', '/iron',                 'icon', 'sparkles'),
      jsonb_build_object('id', 'open_pipeline',  'label', 'OPEN PIPELINE',  'route', '/qrm',                  'icon', 'activity'),
      jsonb_build_object('id', 'monthly_report', 'label', 'MONTHLY REPORT', 'route', '/admin/deal-economics', 'icon', 'trending')
    ),
    'showNarrative', true
  ), null),

  ('default', 'iron_manager', null, jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'iron.pipeline-by-rep',   'order', 0),
      jsonb_build_object('id', 'iron.approval-queue',    'order', 1),
      jsonb_build_object('id', 'iron.margin-trend',      'order', 2),
      jsonb_build_object('id', 'iron.aging-deals-team',  'order', 3)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'open_approvals', 'label', 'OPEN APPROVALS', 'route', '/qrm/approvals',          'icon', 'approve'),
      jsonb_build_object('id', 'new_quote',      'label', 'NEW QUOTE',      'route', '/quote-v2',               'icon', 'quote'),
      jsonb_build_object('id', 'nudge_rep',      'label', 'NUDGE REP',      'route', '/qrm/deals?stalled=true', 'icon', 'users')
    ),
    'showNarrative', true
  ), null),

  ('default', 'iron_advisor', null, jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'sales.my-quotes-by-status',   'order', 0),
      jsonb_build_object('id', 'sales.ai-briefing',           'order', 1),
      jsonb_build_object('id', 'sales.action-items',          'order', 2),
      jsonb_build_object('id', 'qrm.follow-up-queue',         'order', 3),
      jsonb_build_object('id', 'quote.deal-copilot-summary',  'order', 4)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'new_quote',   'label', 'NEW QUOTE',   'route', '/quote-v2',                    'icon', 'quote'),
      jsonb_build_object('id', 'voice_note',  'label', 'VOICE NOTE',  'route', '/voice-qrm',                   'icon', 'voice'),
      jsonb_build_object('id', 'my_pipeline', 'label', 'MY PIPELINE', 'route', '/qrm/deals?assigned_to=me',     'icon', 'activity')
    ),
    'showNarrative', true
  ), null),

  ('default', 'iron_woman', null, jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'iron.approval-queue',        'order', 0),
      jsonb_build_object('id', 'iron.credit-applications',   'order', 1),
      jsonb_build_object('id', 'iron-woman.sla-performance', 'order', 2),
      jsonb_build_object('id', 'iron.order-processing',      'order', 3),
      jsonb_build_object('id', 'iron-woman.recent-decisions','order', 4)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'approval_queue', 'label', 'APPROVAL QUEUE', 'route', '/qrm/approvals?role=deal_desk',      'icon', 'approve'),
      jsonb_build_object('id', 'credit_apps',    'label', 'CREDIT APPS',    'route', '/qrm/approvals?filter=credit',       'icon', 'credit'),
      jsonb_build_object('id', 'margin_reviews', 'label', 'MARGIN REVIEWS', 'route', '/qrm/approvals?filter=margin_exception', 'icon', 'trending')
    ),
    'showNarrative', true
  ), null),

  ('default', 'iron_man', null, jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'iron.prep-queue',           'order', 0),
      jsonb_build_object('id', 'iron.pdi-checklists',       'order', 1),
      jsonb_build_object('id', 'iron.demo-schedule',        'order', 2),
      jsonb_build_object('id', 'service.parts-hub-strip',   'order', 3),
      jsonb_build_object('id', 'service.delivery-schedule', 'order', 4)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'next_job',     'label', 'NEXT JOB',      'route', '/service/wip',         'icon', 'wrench'),
      jsonb_build_object('id', 'pdi_checklist','label', 'PDI CHECKLIST', 'route', '/service/inspections', 'icon', 'check'),
      jsonb_build_object('id', 'todays_demos', 'label', 'TODAY''S DEMOS','route', '/qrm/deals?demo=today','icon', 'activity')
    ),
    'showNarrative', true
  ), null),

  ('default', 'iron_parts_counter', null, jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'parts.serial-first',      'order', 0),
      jsonb_build_object('id', 'parts.order-status',      'order', 1),
      jsonb_build_object('id', 'parts.customer-intel',    'order', 2),
      jsonb_build_object('id', 'parts.quote-drafts',      'order', 3),
      jsonb_build_object('id', 'parts.counter-inquiries', 'order', 4)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'new_parts_quote', 'label', 'NEW PARTS QUOTE', 'route', '/parts/orders/new',          'icon', 'parts'),
      jsonb_build_object('id', 'open_drafts',     'label', 'OPEN DRAFTS',     'route', '/parts/orders?status=draft', 'icon', 'drafts')
    ),
    'showNarrative', true
  ), null),

  ('default', 'iron_parts_manager', null, jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'parts.demand-forecast',  'order', 0),
      jsonb_build_object('id', 'parts.inventory-health', 'order', 1),
      jsonb_build_object('id', 'parts.replenish-queue',  'order', 2),
      jsonb_build_object('id', 'parts.order-status',     'order', 3),
      jsonb_build_object('id', 'parts.lost-sales',       'order', 4),
      jsonb_build_object('id', 'parts.supplier-health',  'order', 5)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'review_replen',    'label', 'REVIEW REPLEN',   'route', '/parts/companion/replenish', 'icon', 'parts'),
      jsonb_build_object('id', 'inventory_health', 'label', 'INVENTORY',       'route', '/parts/inventory',           'icon', 'box'),
      jsonb_build_object('id', 'supplier_status',  'label', 'SUPPLIER STATUS', 'route', '/parts/companion/suppliers', 'icon', 'activity')
    ),
    'showNarrative', true
  ), null)
on conflict (workspace_id, iron_role) where user_id is null
do update set
  layout_json = excluded.layout_json,
  updated_by = null,
  updated_at = now();
