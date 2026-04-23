-- ============================================================================
-- Migration 375: The Floor — role-optimized default layouts (v2)
--
-- Supersedes the v1 seed inserts from migration 374. The original seeds
-- were picked by the initial build pass without role-specific review;
-- Brian's feedback on the live surface called them out as generic and
-- missing critical widgets (notably a CRM customer-search surface).
--
-- This migration does ONE thing: upsert each of the 7 role layouts in
-- the `default` workspace with a new, role-optimized widget + quick-
-- action mix. Every layout stays within the 6-widget / 3-quick-action
-- cap enforced by the CHECK constraints from migration 374.
--
-- Design lens (per role):
--
--   iron_owner (Ryan) — "What I need to know about the business today"
--     wide narrative brief, at-risk customers, approvals the owner
--     has to sign, aged fleet, revenue pace (new stub), deal velocity
--     (new stub). Quick actions jump to strategic surfaces.
--
--   iron_manager (Rylee) — "Team management + approvals"
--     morning brief, approvals queue (wide), team pipeline, commission
--     pace, aged fleet, customer search. Quick actions: approvals,
--     quote, search.
--
--   iron_advisor (David) — "My day, mobile-first"
--     AI briefing (wide), follow-up queue, action items, commission
--     pace, Deal Copilot signals, customer search. Quick actions:
--     quote, voice, visit. Action-items beats day-summary mid-day —
--     a rep needs "what to do now" not "what I've done so far".
--
--   iron_woman (Tina/Angela) — "Working the orders"
--     order processing (wide), deposits, credit apps, intake, pending
--     invoices (new stub), customer search. Quick actions: credit app,
--     deposit, search.
--
--   iron_man (service tech) — "Today's work"
--     prep queue (wide), PDI checklists, demo schedule, open service
--     tickets (new stub), parts hub strip, return inspections. Quick
--     actions: next job, PDI, parts pickup.
--
--   iron_parts_counter (Juan) — "Serial, quote, done"
--     serial-first (wide), quote drafts, order status, customer intel,
--     replenishment queue, customer search. Quick actions: new parts
--     quote, lookup by serial, open drafts.
--
--   iron_parts_manager (Norman) — "Stock health + team"
--     demand forecast (wide), inventory health, replenishment queue,
--     order status, lost parts sales (new stub), supplier health
--     (new stub). Quick actions: replenish, variance, supplier status.
--     Supplier-health chosen over inventory-aging — Norman's pain is
--     PO fulfillment + vendor reliability, not equipment aging (which
--     Rylee and Ryan already own).
--
-- New widget ids referenced below (all registered in
-- apps/web/src/features/floor/lib/floor-widget-registry.tsx):
--   crm.customer-search               (real component — CrmCustomerSearchWidget)
--   exec.revenue-pace                 (stub — wired in a later slice)
--   exec.deal-velocity                (stub)
--   iron-woman.pending-invoices       (stub)
--   iron-man.open-service-tickets     (stub)
--   parts.lost-sales                  (stub)
--   parts.supplier-health             (stub)
-- ============================================================================

-- Owner (Ryan) ---------------------------------------------------------------
insert into public.floor_layouts (workspace_id, iron_role, layout_json)
values
  ('default', 'iron_owner', jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'exec.owner-brief',       'order', 0),
      jsonb_build_object('id', 'nervous.customer-health','order', 1),
      jsonb_build_object('id', 'iron.approval-queue',    'order', 2),
      jsonb_build_object('id', 'iron.inventory-aging',   'order', 3),
      jsonb_build_object('id', 'exec.revenue-pace',      'order', 4),
      jsonb_build_object('id', 'exec.deal-velocity',     'order', 5)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'ask_iron',       'label', 'ASK IRON',       'route', '/iron'),
      jsonb_build_object('id', 'open_pipeline',  'label', 'OPEN PIPELINE',  'route', '/qrm'),
      jsonb_build_object('id', 'monthly_report', 'label', 'MONTHLY REPORT', 'route', '/admin/deal-economics')
    ),
    'showNarrative', true
  ))
on conflict (workspace_id, iron_role) do update
  set layout_json = excluded.layout_json,
      updated_at  = now();

-- Sales Manager (Rylee) ------------------------------------------------------
insert into public.floor_layouts (workspace_id, iron_role, layout_json)
values
  ('default', 'iron_manager', jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'exec.morning-brief',        'order', 0),
      jsonb_build_object('id', 'iron.approval-queue',       'order', 1),
      jsonb_build_object('id', 'iron.pipeline-by-rep',      'order', 2),
      jsonb_build_object('id', 'sales.commission-to-date',  'order', 3),
      jsonb_build_object('id', 'iron.inventory-aging',      'order', 4),
      jsonb_build_object('id', 'crm.customer-search',       'order', 5)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'open_approvals', 'label', 'OPEN APPROVALS', 'route', '/qrm/approvals'),
      jsonb_build_object('id', 'new_quote',      'label', 'NEW QUOTE',      'route', '/quote-v2'),
      jsonb_build_object('id', 'search_customer','label', 'SEARCH CUSTOMER','route', '/qrm/companies')
    ),
    'showNarrative', true
  ))
on conflict (workspace_id, iron_role) do update
  set layout_json = excluded.layout_json,
      updated_at  = now();

-- Sales Rep (David) ----------------------------------------------------------
insert into public.floor_layouts (workspace_id, iron_role, layout_json)
values
  ('default', 'iron_advisor', jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'sales.ai-briefing',           'order', 0),
      jsonb_build_object('id', 'qrm.follow-up-queue',         'order', 1),
      jsonb_build_object('id', 'sales.action-items',          'order', 2),
      jsonb_build_object('id', 'sales.commission-to-date',    'order', 3),
      jsonb_build_object('id', 'quote.deal-copilot-summary',  'order', 4),
      jsonb_build_object('id', 'crm.customer-search',         'order', 5)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'new_quote',     'label', 'NEW QUOTE',     'route', '/quote-v2'),
      jsonb_build_object('id', 'voice_capture', 'label', 'VOICE',         'route', '/voice'),
      jsonb_build_object('id', 'log_visit',     'label', 'LOG VISIT',     'route', '/qrm/visits/new')
    ),
    'showNarrative', true
  ))
on conflict (workspace_id, iron_role) do update
  set layout_json = excluded.layout_json,
      updated_at  = now();

-- Deal Desk (Tina/Angela) ----------------------------------------------------
insert into public.floor_layouts (workspace_id, iron_role, layout_json)
values
  ('default', 'iron_woman', jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'iron.order-processing',        'order', 0),
      jsonb_build_object('id', 'iron.deposit-tracker',         'order', 1),
      jsonb_build_object('id', 'iron.credit-applications',     'order', 2),
      jsonb_build_object('id', 'iron.intake-progress',         'order', 3),
      jsonb_build_object('id', 'iron-woman.pending-invoices',  'order', 4),
      jsonb_build_object('id', 'crm.customer-search',          'order', 5)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'new_credit_app', 'label', 'CREDIT APP',      'route', '/credit/new'),
      jsonb_build_object('id', 'deposit_entry',  'label', 'DEPOSIT',         'route', '/deposits/new'),
      jsonb_build_object('id', 'search_customer','label', 'SEARCH CUSTOMER', 'route', '/qrm/companies')
    ),
    'showNarrative', true
  ))
on conflict (workspace_id, iron_role) do update
  set layout_json = excluded.layout_json,
      updated_at  = now();

-- Prep / Service tech --------------------------------------------------------
insert into public.floor_layouts (workspace_id, iron_role, layout_json)
values
  ('default', 'iron_man', jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'iron.prep-queue',                'order', 0),
      jsonb_build_object('id', 'iron.pdi-checklists',            'order', 1),
      jsonb_build_object('id', 'iron.demo-schedule',             'order', 2),
      jsonb_build_object('id', 'iron-man.open-service-tickets',  'order', 3),
      jsonb_build_object('id', 'service.parts-hub-strip',        'order', 4),
      jsonb_build_object('id', 'iron.return-inspections',        'order', 5)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'next_job',      'label', 'NEXT JOB',      'route', '/service/queue'),
      jsonb_build_object('id', 'pdi_checklist', 'label', 'PDI CHECKLIST', 'route', '/ops/pdi'),
      jsonb_build_object('id', 'parts_pickup',  'label', 'PARTS PICKUP',  'route', '/parts/orders?status=ready')
    ),
    'showNarrative', true
  ))
on conflict (workspace_id, iron_role) do update
  set layout_json = excluded.layout_json,
      updated_at  = now();

-- Parts Counter (Juan/Bobby) -------------------------------------------------
insert into public.floor_layouts (workspace_id, iron_role, layout_json)
values
  ('default', 'iron_parts_counter', jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'parts.serial-first',      'order', 0),
      jsonb_build_object('id', 'parts.quote-drafts',      'order', 1),
      jsonb_build_object('id', 'parts.order-status',      'order', 2),
      jsonb_build_object('id', 'parts.customer-intel',    'order', 3),
      jsonb_build_object('id', 'parts.replenish-queue',   'order', 4),
      jsonb_build_object('id', 'crm.customer-search',     'order', 5)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'new_parts_quote', 'label', 'NEW PARTS QUOTE',  'route', '/parts/new'),
      jsonb_build_object('id', 'lookup_serial',   'label', 'LOOKUP BY SERIAL', 'route', '/parts/lookup'),
      jsonb_build_object('id', 'open_drafts',     'label', 'OPEN DRAFTS',      'route', '/parts/drafts')
    ),
    'showNarrative', true
  ))
on conflict (workspace_id, iron_role) do update
  set layout_json = excluded.layout_json,
      updated_at  = now();

-- Parts Manager (Norman) -----------------------------------------------------
insert into public.floor_layouts (workspace_id, iron_role, layout_json)
values
  ('default', 'iron_parts_manager', jsonb_build_object(
    'widgets', jsonb_build_array(
      jsonb_build_object('id', 'parts.demand-forecast',  'order', 0),
      jsonb_build_object('id', 'parts.inventory-health', 'order', 1),
      jsonb_build_object('id', 'parts.replenish-queue',  'order', 2),
      jsonb_build_object('id', 'parts.order-status',     'order', 3),
      jsonb_build_object('id', 'parts.lost-sales',       'order', 4),
      jsonb_build_object('id', 'parts.supplier-health',  'order', 5)
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id', 'review_replen', 'label', 'REVIEW REPLEN',   'route', '/parts/replenish'),
      jsonb_build_object('id', 'stock_variance','label', 'STOCK VARIANCE',  'route', '/parts/variance'),
      jsonb_build_object('id', 'supplier_status','label','SUPPLIER STATUS', 'route', '/parts/suppliers')
    ),
    'showNarrative', true
  ))
on conflict (workspace_id, iron_role) do update
  set layout_json = excluded.layout_json,
      updated_at  = now();
