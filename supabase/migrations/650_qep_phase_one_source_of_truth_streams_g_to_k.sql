-- ============================================================================
-- Migration 650: QEP Phase One source of truth — Streams G-K
-- Purpose: promote Parts, Service, Grapple Production, Workforce, and Financials
--          from strategic/code domains into qep_roadmap_tasks source-of-truth.
--
-- Sources:
--   - QEP_PHASE3_PARTS_ROADMAP_SYNC_2026-05-26.sql (safe/additive section)
--   - QEP_SERVICE_ROADMAP_SYNC_2026-05-29.sql (PART 1 safe/additive only)
--   - QEP_EXECUTIVE_REVISION_PUSHBACK_2026-06-29.md Phase 1 orders
--
-- Safety envelope:
--   - Append-only migration; no destructive DDL.
--   - Adds enum labels G-K if absent.
--   - Upserts roadmap rows idempotently.
--   - Applies only the explicitly safe/additive source-of-truth updates.
--   - Does NOT run the gated duplicate-collapse / financial judgment blocks from
--     QEP_SERVICE_ROADMAP_SYNC_2026-05-29.sql PART 2.
-- ============================================================================

-- =============================================================================
-- QEP Phase 3 — Parts Department roadmap sync (v2 — schema-verified)
-- Run against QEP Supabase (iciddijgonywtxoelous), NOT control plane.
-- Generated 2026-05-26 from QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md.
--
-- Verified against real qep_roadmap_tasks schema:
--   id, task_id, stream (enum), wave, title, description,
--   ship_state (enum), owner, blocking_decision, depends_on,
--   evidence_link, notes, sort_order, ...linear_* (auto-synced)
--
-- Verified ship_state enum values: not_started | in_progress | blocked |
--   pending_decision | shipped | deferred | na
-- Verified stream enum values: A B C D E F  (G is added below)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1 — Add 'G' to the stream enum.
-- ALTER TYPE ... ADD VALUE must commit before the new value can be used in
-- the same script, so this runs first as its own statement.
-- -----------------------------------------------------------------------------

ALTER TYPE qep_roadmap_stream ADD VALUE IF NOT EXISTS 'G' AFTER 'F';

-- -----------------------------------------------------------------------------
-- STEP 2 — Unblock the 4 existing Parts gating tasks.
-- D3.6 and D3.7 move blocked -> not_started (real build can proceed).
-- E5.4 and E5.6 move blocked -> shipped (their content is absorbed into the
-- returned Discovery doc; no separate workshop session required).
-- -----------------------------------------------------------------------------

BEGIN;

UPDATE qep_roadmap_tasks
SET ship_state = 'not_started',
    blocking_decision = NULL,
    notes = CASE
      WHEN COALESCE(notes, '') LIKE '%[2026-05-26] Unblocked by QEP-returned Parts Department Discovery%'
        THEN notes
      ELSE COALESCE(notes, '') ||
        E'\n[2026-05-26] Unblocked by QEP-returned Parts Department Discovery (all 28 DPs answered). '
        'See QEP (1)/QEP_PARTS_DEPARTMENT_DISCOVERY_COMPLETED_2026-05-26.md and '
        'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md.'
    END,
    evidence_link = CASE
      WHEN COALESCE(evidence_link, '') LIKE '%QEP_PARTS_DEPARTMENT_DISCOVERY_COMPLETED_2026-05-26.md%'
        THEN evidence_link
      ELSE COALESCE(evidence_link, '') || ' | QEP_PARTS_DEPARTMENT_DISCOVERY_COMPLETED_2026-05-26.md'
    END,
    updated_at = now()
WHERE task_id IN ('D3.6', 'D3.7');

UPDATE qep_roadmap_tasks
SET ship_state = 'shipped',
    blocking_decision = NULL,
    notes = CASE
      WHEN COALESCE(notes, '') LIKE '%[2026-05-26] Closed by QEP-returned Parts Department Discovery%'
        THEN notes
      ELSE COALESCE(notes, '') ||
        E'\n[2026-05-26] Closed by QEP-returned Parts Department Discovery. '
        'Workshop content fully absorbed into the discovery doc; no separate '
        'session required. Bobby/Norman remain UAT participants for Phase 3 '
        'Counter POS (G3) and Lookup (G4) slices.'
    END,
    evidence_link = CASE
      WHEN COALESCE(evidence_link, '') LIKE '%QEP_PARTS_DEPARTMENT_DISCOVERY_COMPLETED_2026-05-26.md%'
        THEN evidence_link
      ELSE COALESCE(evidence_link, '') || ' | QEP_PARTS_DEPARTMENT_DISCOVERY_COMPLETED_2026-05-26.md'
    END,
    updated_at = now()
WHERE task_id IN ('E5.4', 'E5.6');

COMMIT;

-- -----------------------------------------------------------------------------
-- STEP 3 — Insert the 14 Phase 3 Parts G-slices.
-- Stream G = Phase 3 Parts Department. sort_order starts at 7000 (well above
-- existing max ~4506) to keep them grouped at the bottom of the roadmap.
-- -----------------------------------------------------------------------------

BEGIN;

INSERT INTO qep_roadmap_tasks
  (task_id, stream, wave, title, description, ship_state, owner,
   blocking_decision, evidence_link, notes, sort_order)
VALUES
('G1.1', 'G', 'G1', 'Phase 3 Parts schema foundation',
 'Apply Phase 3 Parts schema: parts, parts_locations, parts_bins, parts_stock, parts_by_machine, parts_kits/items, oem_portals, oem_portal_credentials, parts_documents/lines, purchase_orders/lines, parts_transfers/lines, core_ledger, customer_returns, vendor_returns, warranty_claims, cycle_counts/lines. Blocks every other G-slice.',
 'not_started', 'Architect → Engineer',
 NULL,
 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §1',
 '[2026-05-26] Created from Phase 3 Parts blueprint. Acceptance: migration applied to staging, RLS test matrix passes, supabase generate-types clean.',
 7001),

('G2.1', 'G', 'G2', 'OEM credential vault + launchpad',
 'DP 3.1 Phase 1. pgcrypto-encrypted credential vault for the 22-brand portal problem. Role-gated decrypt (parts_manager only). One-click launchpad UI under Admin > Integrations > OEM Portals. Direct ordering integration (Phase 2 of DP 3.1) ships per OEM later, aligned with Phase 9 SSO goal.',
 'blocked', 'Engineer + Security',
 'BLK-OEM-PORTAL-LIST',
 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §1.5, §2 /v1/oem/portals/launch',
 '[2026-05-26] Blocked: Norman + Rylee must supply the full 22-brand portal+login list securely before this can start.',
 7002),

('G3.1', 'G', 'G3', 'Counter POS — fast mode',
 'DP 1.1 + 1.2. Dedicated fast POS surface separate from order/work-order screens. Lookup → ticket → tender → receipt. Every ticket carries Cash/Charge classification badge; cash-class enforces pay-in-full before parts released, including account-on-file customers without approved credit. Cash→charge conversion requires Exec VP/President approval, handled by AR, never at counter.',
 'not_started', 'Engineer + Design',
 NULL,
 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §2 /v1/counter/tickets',
 '[2026-05-26] Created from Phase 3 Parts blueprint. Bobby is the UAT participant.',
 7003),

('G4.1', 'G', 'G4', 'Parts lookup engine — five paths',
 'DP 1.3. Unified /v1/parts/lookup supporting: part number, machine make/model/serial with parts diagrams (PRIORITY path), description/keyword, kit, supersession. Most customers know their machine, not the PN.',
 'not_started', 'Engineer',
 NULL,
 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §1.3, §2',
 '[2026-05-26] Created from Phase 3 Parts blueprint. Machine-serial path depends on OEM parts catalogs being loaded — coordinate with G2.1.',
 7004),

('G5.1', 'G', 'G5', 'Multi-location stock + inter-branch transfers',
 'DP 2.1 + 2.6. Per-location stock for Lake City + Belleview, cross-visible on every lookup. Branches run identical rules (Tier 3 DP 6.1). Inter-branch transfer flow: reserve on from-location, scheduled onto next branch run, counter sees both options (transfer-in-X-days vs OEM-order-in-Y) and customer chooses.',
 'not_started', 'Engineer',
 NULL,
 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §1.2, §1.8, §2',
 '[2026-05-26] Created from Phase 3 Parts blueprint.',
 7005),

('G6.1', 'G', 'G6', 'Reorder, POs, receiving, backorders',
 'DP 2.2 + 3.2 + 3.3 + 3.4 + 3.6. Min/max per part with reorder list. Stock vs emergency PO types (emergency cost flagged for visibility). Status + ETA on every PO line. Receive-against-PO with auto-notify to the special-order customer the moment their part is received. Backorder tracking with alternate-sourcing prompt (other branch / aftermarket / different supplier) when wait runs long.',
 'blocked', 'Engineer',
 'BLK-PARTS-USAGE-EXPORT',
 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §1.7, §2',
 '[2026-05-26] Blocked: IntelliDealer parts usage history export needed from DevOps via Norman to seed initial min/max. First numbers are expected to be rough and improve as QEP OS accumulates real demand data.',
 7006),

('G7.1', 'G', 'G7', 'Parts quotes + phone/email order capture',
 'DP 1.4 + 1.5. Parts Quote object: priced lines, short expiration, one-tap convert to order or counter sale (convert-don''t-rekey). Phone/email orders become tracked Parts Order objects with the cash-class payment-up-front-including-freight rule; freight estimated with vendor if unknown.',
 'not_started', 'Engineer',
 NULL,
 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §1.6, §2',
 '[2026-05-26] Created from Phase 3 Parts blueprint. Portal self-ordering (DP 1.4 Option C) deferred to customer portal phase.',
 7007),

('G8.1', 'G', 'G8', 'Pricing engine + 5% counter discount cap',
 'DP 1.6 + ADR-018. Sell at list, or at the Parts-Manager-set customer/volume price. 35% target margin, 25% floor. Counter staff have standing 5% discretionary discount; anything beyond 5% requires Parts Manager approval and blocks ticket close until approved. Parts Manager owns all customer-specific and volume pricing.',
 'not_started', 'Engineer',
 NULL,
 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §4 ADR-018',
 '[2026-05-26] DELIBERATE DEVIATION from recommended starting point (was list-only). 5% counter cap is QEP''s call.',
 7008),

('G9.1', 'G', 'G9', 'Cores, customer returns, vendor returns, warranty parts',
 'DP 4.1 + 4.2 + 4.3 + 4.4. Core ledger (both directions: what QEP owes customers, what QEP is owed by vendors). Customer return rules: 30-day window, electrical parts non-returnable, 25% restocking fee on all special-order returns and any return after the 30-day window, vendor-credit hold on special-order returns. Vendor RA flow that releases the hold once vendor credit is confirmed. Warranty parts: manufacturer evaluation before any credit; replacement paid in full up front (cash + in-house charge alike) if customer needs it before credit arrives, or ordered only after credit if they wait; service warranties require certified technician confirmation; Parts Department or assigned Warranty Advisor runs the claim.',
 'not_started', 'Engineer',
 NULL,
 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §1.9, §1.10, §1.11',
 '[2026-05-26] Created from Phase 3 Parts blueprint. Policy prints on customer receipts.',
 7009),

('G10.1', 'G', 'G10', 'Kit catalog + 500-hour first-service kits',
 'DP 4.5. Parts Manager curates the standard kit catalog. Manufacturer 500-hour first-service kits seeded per model (Tier 3 DP 4.2). One-off kits built for a specific job stay on that job unless the Parts Manager promotes them to the catalog.',
 'blocked', 'Norman + Engineer',
 'BLK-PARTS-KIT-CSV',
 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §1.4, §2 /v1/kits',
 '[2026-05-26] Blocked: current parts kit catalog CSV export from QEP (if one exists) needed to seed. Norman owns.',
 7010),

('G11.1', 'G', 'G11', 'Service WO parts seam + internal pricing',
 'DP 5.1 + 5.2 + 5.3 + ADR-020. Parts issued from inventory direct to work order; on-hand decrements, cost posts to job, nothing re-keyed as counter sale. Reservation/staging ahead of scheduled appointments. Internal job pricing (recon, rental-fleet maintenance, PDI) = standard sell price minus 10%, floor 25% margin. Customer-pay work orders use standard parts price.',
 'blocked', 'Engineer',
 'BLK-CONTROLLER-SIGNOFF',
 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §4 ADR-020',
 '[2026-05-26] DELIBERATE DEVIATION from recommended starting point (was at-cost). Sell-minus-10% guarantees the parts department earns margin on every internal job and removes the need for a separate handling fee. Blocked on Controller (Tina + Ryan) sign-off — changes how recon and rental-maintenance cost reports read.',
 7011),

('G12.1', 'G', 'G12', 'Cycle counts + dead stock (18-month window)',
 'DP 2.3 + 2.5 + ADR-019. Rolling weighted cycle counts; high-value and fast-moving parts counted more often. System generates count lists and records variances. Dead stock = no movement in 18 months (DELIBERATE DEVIATION from the 12-month recommended starting point). Suggested-action layer (return/discount/scrap) deferred to a later phase.',
 'not_started', 'Engineer',
 NULL,
 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §1.12, §4 ADR-019',
 '[2026-05-26] Created from Phase 3 Parts blueprint. Constant DEAD_STOCK_MONTHS = 18.',
 7012),

('G13.1', 'G', 'G13', 'Inventory + counter reporting',
 'DP 5.4 + 5.5. Inventory: value on hand by location, inventory turns, fill rate, margin by part and category vs 35% target, dead stock (18-month window). Counter: sales (volume + margin, by location and counterperson), counter fill rate (HEADLINE — customer''s actual experience), special-order ratio, quote-to-sale conversion, average time to serve. Per-counterperson framed as coaching, not ranking.',
 'not_started', 'Engineer + Data',
 NULL,
 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §2 /v1/reports/inventory + /v1/reports/counter',
 '[2026-05-26] Created from Phase 3 Parts blueprint. Turns + fill rate are the Parts Manager weekly watch numbers.',
 7013),

('G14.1', 'G', 'G14', 'IntelliDealer parts data import + parallel run',
 'ETL parts master, on-hand, open POs, open backorders, open cores, customer parts history, and warranty claims from IntelliDealer into Phase 3 tables. Nightly idempotent sync during parallel run. Per-workflow cutover flag flip when parity is confirmed. parts_module_live = false at launch.',
 'blocked', 'DevOps + Engineer',
 'BLK-INTELLIDEALER-API',
 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §9',
 '[2026-05-26] Blocked: VitalEdge/IntelliDealer rep intro needed for parts-side endpoints. Third-party integrations (FileBound, TARGIT) confirm an API exists.',
 7014)
ON CONFLICT (task_id) DO UPDATE SET
  stream = EXCLUDED.stream,
  wave = EXCLUDED.wave,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  ship_state = EXCLUDED.ship_state,
  owner = EXCLUDED.owner,
  blocking_decision = EXCLUDED.blocking_decision,
  evidence_link = EXCLUDED.evidence_link,
  notes = EXCLUDED.notes,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

COMMIT;

-- Refresh the type comment after Stream G is present.
COMMENT ON TYPE public.qep_roadmap_stream IS
  'A=Iron Quote · B=Sales-Advisor Field Platform · C=IntelliDealer Cutover · D=Parity Validation+Decision Resolution · E=Platform Foundation · F=Decision Velocity · G=Parts Department';

-- -----------------------------------------------------------------------------
-- STEP 1 — Extend the stream enum: add H, I, J, K in order after G.
-- ALTER TYPE ... ADD VALUE must commit BEFORE the new value can be used in the
-- same script (exactly as 'G' was added in the Phase 3 Parts sync). Each runs
-- first, as its own statement, OUTSIDE any transaction, before any INSERT below.
--   H = Service Department
--   I = Grapple-Truck Production
--   J = Workforce
--   K = Financials Re-architecture
-- -----------------------------------------------------------------------------

ALTER TYPE qep_roadmap_stream ADD VALUE IF NOT EXISTS 'H' AFTER 'G';
ALTER TYPE qep_roadmap_stream ADD VALUE IF NOT EXISTS 'I' AFTER 'H';
ALTER TYPE qep_roadmap_stream ADD VALUE IF NOT EXISTS 'J' AFTER 'I';
ALTER TYPE qep_roadmap_stream ADD VALUE IF NOT EXISTS 'K' AFTER 'J';

-- -----------------------------------------------------------------------------
-- STEP 2 — UNBLOCK + REWRITE the two existing Service capture tasks.
-- E5.7 (QEP-138, service-writer workflow capture) and E5.8 (QEP-139, technician
-- workflow capture) were blocked ONLY because the owner discovery was missing.
-- The owner's Service Discovery Answers v1.1 + Service Advisor SOP + Service
-- Advisor Checklist + Tech Process Expanded Framework are exactly those inputs.
-- Both move blocked -> not_started and their descriptions are rewritten to the
-- owner's actual hard gates. Notes/evidence are APPENDED (COALESCE), not
-- overwritten, exactly like the Phase 3 Parts sync.
-- -----------------------------------------------------------------------------

BEGIN;

-- E5.7 / QEP-138 — Service writer (Service Advisor) workflow capture.
UPDATE qep_roadmap_tasks
SET ship_state = 'not_started',
    blocking_decision = NULL,
    description =
      'Service Advisor work-order workflow, hardened to the owner''s non-negotiables. '
      'Intake builds a complete and accurate WO: machine identified by make / model / serial / YEAR '
      '(a machine QEP has not seen is created at intake); the hour-meter reading is MANDATORY on every WO '
      '(miles is a separate optional field, required when the unit is a grapple truck); the three C''s '
      '(Complaint, Cause, Correction) are enforced as three distinct header fields; the customer complaint '
      'is captured clear and specific; requested work is defined; prior service history is reviewed; and the '
      'intake channel is recorded (phone, walk-in / drop-off, field request, internal request all open the '
      'same WO). Every WO carries a priority set at intake (emergency / down, high, normal) with emergency / '
      'machine-down work going to the front of the schedule, and a promised date that the customer is notified '
      'of when set and proactively notified of if it moves. Seven WO types are supported: customer repair, '
      'scheduled maintenance / PM, warranty, field service, internal, comeback / rework, and hauling / '
      'transport. Road jobs add a road sub-type capturing machine location, site contact name and phone, and '
      'site conditions / access notes. The written-estimate authorization gate is enforced — No approval = No '
      'repair — work cannot start without a documented approved estimate, and a scope increase greater than '
      '10% over the approved estimate triggers a documented re-authorization before the extra work proceeds. '
      'Closeout: confirm the repair is complete and operational, communicate completed work and recommendations, '
      'ensure all labor and parts are billed, process payment, and close with complete notes.',
    notes = CASE
      WHEN COALESCE(notes, '') LIKE '%[2026-05-29] Unblocked - owner Service Discovery v1.1%'
        THEN notes
      ELSE COALESCE(notes, '') ||
        E'\n[2026-05-29] Unblocked - owner Service Discovery v1.1 + SOP/Checklist/Tech-Process docs '
        'supplied the missing inputs. Now the spec source for Stream H epics H2/H3.'
    END,
    evidence_link = CASE
      WHEN COALESCE(evidence_link, '') LIKE '%QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md%'
        THEN evidence_link
      ELSE COALESCE(evidence_link, '') || ' | QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md'
    END,
    updated_at = now()
WHERE task_id = 'E5.7';

-- E5.8 / QEP-139 — Technician workflow capture.
UPDATE qep_roadmap_tasks
SET ship_state = 'not_started',
    blocking_decision = NULL,
    description =
      'Technician execution workflow, hardened to the owner''s non-negotiables. Per-segment SIGN-OFF on the '
      'diagnostic and repair stages: the technician submits the diagnosis to the Service Advisor and must NOT '
      'proceed to repair until approval is confirmed, and begins repair only after that approval. A labor-story '
      'field is required and held to a quality standard — clear and detailed enough that another technician can '
      'understand the work performed and the customer can see the value delivered (complaint verification, '
      'diagnostic steps, root cause, parts and quantities, repair recommendation, then work performed and steps '
      'taken). A quoted-time budget is set against the approved estimate with an overrun alert comparing actual '
      'labor against quoted time. Before / during / after photo multimedia is captured (overall machine '
      'condition, hour-meter, problem area, fluid levels before crank, failed components, fault / diagnostic '
      'codes, and timestamped notes). Lock-out / tag-out and safety conditions are flagged and addressed or '
      'reported immediately. ALL WARRANTY PARTS MUST BE LABELED AND TURNED IN. The Service Advisor runs a '
      'documentation-review CLOSE gate (labor story complete, work matches approved scope, required photos '
      'uploaded) and returns the job to the technician if incomplete. Time spent in a hold state is EXCLUDED '
      'from technician efficiency.',
    notes = CASE
      WHEN COALESCE(notes, '') LIKE '%[2026-05-29] Unblocked - owner Service Discovery v1.1%'
        THEN notes
      ELSE COALESCE(notes, '') ||
        E'\n[2026-05-29] Unblocked - owner Service Discovery v1.1 + SOP/Checklist/Tech-Process docs '
        'supplied the missing inputs. Now the spec source for Stream H epic H5.'
    END,
    evidence_link = CASE
      WHEN COALESCE(evidence_link, '') LIKE '%QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md%'
        THEN evidence_link
      ELSE COALESCE(evidence_link, '') || ' | QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md'
    END,
    updated_at = now()
WHERE task_id = 'E5.8';

COMMIT;

-- -----------------------------------------------------------------------------
-- STEP 3 — Non-destructive cross-reference NOTES on adjacent existing tasks.
-- These rows stay exactly where they are: ship_state and blocking_decision are
-- NOT changed. Only a dated cross-reference note is appended (COALESCE) so the
-- existing G-stream / cutover work is linked to the new Service stream.
-- -----------------------------------------------------------------------------

BEGIN;

-- G9.1 / QEP-176 — Cores / customer returns / vendor returns / warranty parts.
UPDATE qep_roadmap_tasks
SET notes = COALESCE(notes, '') ||
            E'\n[2026-05-29] Folds into Stream H epic H8 (warranty-parts label/turn-in) per service alignment.',
    updated_at = now()
WHERE task_id = 'G9.1';

-- G11.1 / QEP-183 — Service WO parts seam + internal pricing.
UPDATE qep_roadmap_tasks
SET notes = COALESCE(notes, '') ||
            E'\n[2026-05-29] Aligned to Stream H parts-vs-service revenue split and Stream K financials '
            're-architecture (parts to Parts Dept; Service = labor+miles+sublet+hauling).',
    updated_at = now()
WHERE task_id = 'G11.1';

-- G10.1 / QEP-188 — Kit catalog + 500-hour first-service kits.
UPDATE qep_roadmap_tasks
SET notes = COALESCE(notes, '') ||
            E'\n[2026-05-29] Linked to Stream H epic H9 (service plans / PM / 500-hr kits).',
    updated_at = now()
WHERE task_id = 'G10.1';

-- C1.3 / QEP-68 — Service/PDI rows in cutover (run snapshot in production).
UPDATE qep_roadmap_tasks
SET notes = COALESCE(notes, '') ||
            E'\n[2026-05-29] Aligned to Stream H epic H8 (warranty claim lifecycle) + internal WO costing.',
    updated_at = now()
WHERE task_id = 'C1.3';

-- C3.1 / QEP-75 — Equipment sale reversal (warranty-adjacent).
UPDATE qep_roadmap_tasks
SET notes = COALESCE(notes, '') ||
            E'\n[2026-05-29] Aligned to Stream H epic H8 (warranty claim lifecycle) + internal WO costing.',
    updated_at = now()
WHERE task_id = 'C3.1';

COMMIT;

-- -----------------------------------------------------------------------------
-- STEP 4 — INSERT the new Service / Grapple / Workforce / Financials rows.
-- One row per epic, like the Phase 3 Parts sync.
--   Stream H — Service Department .................. H1.1 .. H14.1 + H15.1 (Reveal)
--             sort_order 8001-8015
--   Stream I — Grapple-Truck Production ............ I1.1 .. I8.1
--             sort_order 8101+
--   Stream J — Workforce .......................... J1.1, J2.1
--             sort_order 8201+
--   Stream K — Financials Re-architecture ......... K1.1 .. K4.1 (all pending_decision)
--             sort_order 8301+
-- Every row: evidence_link = alignment doc + relevant section; notes begin with
-- the dated creation stamp + a one-line acceptance criterion.
-- -----------------------------------------------------------------------------

BEGIN;

INSERT INTO qep_roadmap_tasks
  (task_id, stream, wave, title, description, ship_state, owner,
   blocking_decision, evidence_link, notes, sort_order)
VALUES

-- ===================== Stream H — Service Department ========================

('H1.1', 'H', 'H1', 'Service rate & margin engine',
 'Add equipment-class door rates ($185/hr large construction & forestry, $165/hr grapple & compact construction, $185/hr + $2.00/mile field, $135/hr lube, $195/hr specialty, internal -10% off the applicable door rate); enforce a 55% target margin / 35% floor guardrail in the quote engine. ENHANCE service_labor_pricing — today pricing keys on location/customer/status/labor_type/premium with no equipment-class dimension and no margin check.',
 'not_started', 'Architect to Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H1, Section 1.3',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: quote engine selects the door rate by equipment class and blocks/ warns when a line falls below the 35% margin floor.',
 8001),

('H2.1', 'H', 'H2', 'Work-order type & intake hardening',
 'Seven WO types incl. hauling + comeback (customer repair, scheduled maintenance / PM, warranty, field service, internal, comeback / rework, hauling / transport); mandatory hour-meter on every WO; miles (required on grapple trucks); machine make / model / serial / YEAR; intake channel (phone, walk-in / drop-off, field request, internal request); priority (emergency / down, high, normal); promised date; three C''s (Complaint, Cause, Correction) as enforced header fields; road-job sub-type (site location / contact / conditions). ENHANCE; this is the build target for the rewritten QEP-138 (E5.7).',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H2, Section 1.7',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: a WO cannot be saved without machine year, hour-meter, three C''s, channel, priority and promised date; grapple WOs also require miles.',
 8002),

('H3.1', 'H', 'H3', 'Estimate authorization gates',
 'Block work-start without a documented approved estimate — No approval = No repair. A scope increase greater than 10% over the approved estimate triggers a documented re-authorization before the extra work is done. E-sign path follows as the customer portal matures. ADD — approvals are recorded today but no gate blocks work-start and there is no >10% trigger.',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H3, Section 1.7',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: technician clock-on/repair-start is blocked until an approved estimate exists; a >10% scope increase re-opens the authorization step.',
 8003),

('H4.1', 'H', 'H4', 'Hold states & efficiency integrity',
 'Five named hold states — waiting on parts / sublet (combined; both are PO-driven receipts that must be received before close), waiting on approval, waiting on customer, waiting on warranty authorization, waiting on payment — and exclude time in a hold state from technician efficiency. ENHANCE the free-text blocker_type and the efficiency view, which never excludes hold time today.',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H4, Section 1 (DP 3.6)',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: the five hold states are enumerated and the efficiency calculation subtracts all hold time from elapsed time.',
 8004),

('H5.1', 'H', 'H5', 'Tech execution: segments & documentation',
 'Per-segment sign-off (diagnostic / repair); labor-story field + quality standard (clear enough that another technician understands the work and the customer sees value); quoted-time budget + overrun alert (actual labor vs quoted time); before / during / after photo multimedia; lock-out / tag-out flag; warranty-parts label / turn-in; Service Advisor documentation-review close gate. ENHANCE; this is the build target for the rewritten QEP-139 (E5.8).',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H5, Section 1 (DP 3.5)',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: each segment requires a sign-off and labor story; the close gate refuses an incomplete WO and warranty parts must be marked turned-in.',
 8005),

('H6.1', 'H', 'H6', 'Scheduling & dispatch',
 'A single live shop schedule that retires the whiteboard; field dispatch to mobile; technician assignment by skills / certifications / branch / availability with the manager making the final call; capacity-aware scheduling as a fast-follow. ADD / ENHANCE.',
 'not_started', 'Engineer + Design',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H6, Section 1 (DP 2.3)',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: all open WOs appear on one live schedule and assignment surfaces suitable technicians by skill/cert/branch/availability.',
 8006),

('H7.1', 'H', 'H7', 'Hauling/transport dispatch',
 'Hauling / transport is a Service Department activity — schedulable, trackable, and costable like field repair. Customer and internal rate sheets by truck class + mileage band; round-trip mileage costing (origin to jobsite and back, with a minimum that applies regardless of distance); a driver as a dispatchable actor and a service advisor who builds the haul schedule and tracks the driver. ENHANCE the haul-router, which today posts a hardcoded line with no truck-class / mileage-band rate sheets and no round-trip.',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H7, Section 1.4 (DP 2.2)',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: a haul produces a costed line from the truck-class + mileage-band sheet using round-trip mileage and the per-haul minimum.',
 8007),

('H8.1', 'H', 'H8', 'Comeback & warranty',
 'Comeback flagged and linked to the original WO, per-technician and per-type rate, QEP-fault comebacks not re-billed (QEP absorbs parts and labor), counts against the responsible technician''s efficiency. Warranty claim assembly from the job (three C''s, warranty-flagged parts, labor) tracked from submission through OEM payment; per-line payer for mixed jobs so the warranty claim draws warranty lines and the invoice draws customer-pay lines on one machine history; warranty registration / coverage dates on the machine, surfaced at intake. ADD; absorbs the warranty-parts label / turn-in from QEP-176 and the warranty-adjacent QEP-75.',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H8, Section 1 (DP 4.1-4.3, 5.5)',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: a comeback links to its origin WO with no customer re-bill on QEP-fault, and a warranty WO assembles a claim with per-line payer tracked to OEM payment.',
 8008),

('H9.1', 'H', 'H9', 'Service plans / PM / contracts',
 'A service plan attached to a machine auto-generates PM work orders at hour / calendar intervals, with a prompt-to-schedule and contract entitlement / prepaid draw-down. ENHANCE the inert PM scaffolding and link to QEP-188 (kit catalog / 500-hr first-service kits). Gated on the undefined service-plan catalog (Appendix A H9, Section 8.7).',
 'blocked', 'Engineer',
 'BLK-SERVICE-PLAN-CATALOG',
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H9, Section 8.7',
 '[2026-05-29] Created from Service Department roadmap alignment. Blocked: the service-plan catalog is undefined; PM auto-generation and contract billing stay inert until the owner supplies it. Acceptance: a plan on a machine emits PM WOs at its intervals and draws down the contract entitlement.',
 8009),

('H10.1', 'H', 'H10', 'Internal & rental-fleet service',
 'Internal work orders (reconditioning, rental-fleet maintenance, PDI / new-prep) flagged internal: labor and parts captured the same way, costed at 10% off the applicable door rate, with the cost posting to the used unit''s landed cost, the rental unit, or new-unit prep instead of a customer invoice; rental PM auto-generation; renter-fault work billable. ENHANCE.',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H10, Section 1 (DP 4.6)',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: an internal WO posts cost (at door rate -10%) to the unit''s landed cost / rental unit / new-prep rather than producing a customer invoice.',
 8010),

('H11.1', 'H', 'H11', 'Service metrics dashboard',
 'Margin by work-order type (the owner''s #1 dashboard add), then cycle time and comeback rate (the two he watches most), plus technician efficiency, warranty recovery, shop / field mix, open WOs by status / hold reason, labor recovery, and average hours-to-first-touch. ADD; reuse the existing TAT plumbing.',
 'not_started', 'Engineer + Design',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H11, Section 1.8',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: the dashboard headlines margin-by-WO-type and also reports cycle time and comeback rate.',
 8011),

('H12.1', 'H', 'H12', 'Offline field mode',
 'The field work order works offline — open the job, see machine history, record the three C''s, clock labor, and capture photos and the hour-meter reading with no signal — and syncs when connectivity returns. ADD; this is the surface that absorbs the deferred Service Mobile duplicates (QEP-84 / QEP-93 / QEP-129).',
 'not_started', 'Engineer + Design',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H12, Section 1 (DP 5.3)',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: a field WO opens, clocks labor, and captures photos/hour-meter fully offline and reconciles on reconnect.',
 8012),

('H13.1', 'H', 'H13', 'Service roles & RLS',
 'Add service_writer, technician, parts_counter, dispatch, and finance_admin to the user_role enum and enforce row-level security (a technician sees only their own assigned jobs). ADD — foundation prerequisite for every other Service epic; the documented role matrix is not yet in the enum.',
 'not_started', 'Architect to Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H13, Section 6.4',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: the five service roles exist in user_role and RLS limits a technician to their assigned jobs in both API and policy.',
 8013),

('H14.1', 'H', 'H14', 'Customer communication',
 'Status notifications at the moments that matter — work started, awaiting approval, on-hold (parts), ready for pickup — and a proactive promised-date-change notification, which also cuts the status-call load on the service writer. Portal self-service follows as a fast-follow. ADD.',
 'not_started', 'Engineer + Design',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H14, Section 1 (DP 5.7)',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: a status change or a promised-date move fires a customer notification automatically.',
 8014),

('H15.1', 'H', 'H15', 'Verizon Reveal GPS integration (service vehicles)',
 'Integrate Verizon Reveal GPS on the service vehicles: live vehicle location plus GPS mileage feeding the $2.00/mile field charge (DP 3.2) and haul round-trip mileage (DP 2.2), and driver / technician accountability. The reading is reconciled against the mandatory work-order hour-meter / mileage. A MANUAL-mileage fallback keeps the workflow usable when the integration is absent — zero-blocking architecture, never a hard dependency.',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.5, Section 5 ADD (Verizon Reveal)',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: field/haul mileage sources from Reveal when available and falls back to a manual mileage entry that never blocks the WO.',
 8015),

-- ================== Stream I — Grapple-Truck Production =====================
-- Explicitly OUTSIDE the service module: a separate production process and
-- dashboard, NOT a work-order type. The grapple 4-tier pay ladder lives in
-- Stream J (Workforce), not here.

('I1.1', 'I', 'I1', 'Grapple build pipeline + production dashboard',
 'Stand up Grapple-Truck Production as its own process and dashboard, separate from repairs and outside the service module. A build pipeline tracks each grapple truck through its production stages on a dedicated dashboard (not the service work-order lifecycle). This is a distinct production module, not a work-order type.',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.1, Section 5 ADD (Stream I)',
 '[2026-05-29] Created from Service Department roadmap alignment. Note: the grapple 4-tier pay ladder lives in Stream J (Workforce). Acceptance: a grapple build is tracked end-to-end on its own production dashboard with no service-WO dependency.',
 8101),

('I2.1', 'I', 'I2', 'GTB inspection form',
 'Grapple Truck Build (GTB) inspection form as a first-class production entity capturing the build inspection, distinct from any service inspection checklist.',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.1, Section 5 ADD (Stream I)',
 '[2026-05-29] Created from Service Department roadmap alignment. Note: the grapple 4-tier pay ladder lives in Stream J (Workforce). Acceptance: a GTB inspection form is completed and attached to the build record.',
 8102),

('I3.1', 'I', 'I3', 'Accessory installs (Tanks/Coolers/Extensions)',
 'Model the build accessory installs — Tanks, Coolers, and Extensions — as tracked steps within the grapple build, each with its own completion state.',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.1, Section 5 ADD (Stream I)',
 '[2026-05-29] Created from Service Department roadmap alignment. Note: the grapple 4-tier pay ladder lives in Stream J (Workforce). Acceptance: Tanks / Coolers / Extensions installs are each trackable to completion on the build.',
 8103),

('I4.1', 'I', 'I4', 'Build parts sheet',
 'A build parts sheet for each grapple truck listing the parts consumed by the build, so production parts are captured against the build (not as a service work order).',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.1, Section 5 ADD (Stream I)',
 '[2026-05-29] Created from Service Department roadmap alignment. Note: the grapple 4-tier pay ladder lives in Stream J (Workforce). Acceptance: every build carries a parts sheet of consumed parts tied to that build.',
 8104),

('I5.1', 'I', 'I5', 'Build-progress sheets to sales + service',
 'Build-progress sheets that surface the state of each grapple build to the sales and service departments, so both can see where a build is in the pipeline.',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.1, Section 5 ADD (Stream I)',
 '[2026-05-29] Created from Service Department roadmap alignment. Note: the grapple 4-tier pay ladder lives in Stream J (Workforce). Acceptance: sales and service can view current build-progress for any in-flight grapple build.',
 8105),

('I6.1', 'I', 'I6', 'Final QC checklist + Lead sign-off',
 'A final quality-control checklist for each grapple build that requires a Lead sign-off before the build is released.',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.1, Section 5 ADD (Stream I)',
 '[2026-05-29] Created from Service Department roadmap alignment. Note: the grapple 4-tier pay ladder lives in Stream J (Workforce). Acceptance: a build cannot be released until the final QC checklist is complete and Lead-signed.',
 8106),

('I7.1', 'I', 'I7', 'Build-timeline tracking',
 'Build-timeline tracking across the grapple production pipeline so each build''s duration and stage transitions are recorded and reportable.',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.1, Section 5 ADD (Stream I)',
 '[2026-05-29] Created from Service Department roadmap alignment. Note: the grapple 4-tier pay ladder lives in Stream J (Workforce). Acceptance: each build records its timeline and stage transitions for reporting.',
 8107),

('I8.1', 'I', 'I8', 'Cleanup - no grapple build modeled as a service WO',
 'Cleanup task: ensure NO grapple build is modeled as a service work order, and migrate any existing grapple builds currently running through service work orders into the dedicated production module.',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.1, Section 5 ADD (Stream I)',
 '[2026-05-29] Created from Service Department roadmap alignment. Note: the grapple 4-tier pay ladder lives in Stream J (Workforce). Acceptance: zero grapple builds remain modeled as service WOs; any found are migrated to the production module.',
 8108),

-- ======================== Stream J — Workforce =============================

('J1.1', 'J', 'J1', 'Performance appraisal system (SA + Tech scorecards)',
 'Performance appraisal system for Service Advisors and Technicians: scorecards rated 1-10 across 7 equal-weight categories, with banding Sub-Par (<4) / Normal (4 to <8) / Excellent (>=8), a Manager Summary plus signatures, review types 90-Day / Annual / Merit, and a raise computed as Cost of Living + Performance. ADD (adjacent to QEP-112 appraisal guardrails).',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 5 ADD (Workforce)',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: an SA/Tech scorecard scores 7 equal-weight categories 1-10, bands the result, captures Manager Summary + signatures, and computes raise = Cost of Living + Performance.',
 8201),

('J2.1', 'J', 'J2', 'Technician certification + pay-ladder progression',
 'Technician certification and pay-ladder progression: per-role ladders (Road / Shop / Grapple) gated on efficiency %, comeback count, tenure, OEM certifications (Cummins, ASV, Yanmar, Sennebogen, Develon, ASC) plus in-house certifications, vendor logins, and tool count. Capture the documented divergence between the Shop Master tier (95% efficiency) and the Road Master tier (90% efficiency). ADD; ENHANCE technician_profiles (today free-JSON certs + efficiency with no OEM/in-house split, tier, wage, tenure, vendor logins, or progression).',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 5 ADD (Workforce), Section 1.6',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: a technician advances through Road/Shop/Grapple tiers gated on efficiency %, comeback count, tenure and certs, with the Shop 95% vs Road 90% Master divergence preserved.',
 8202),

-- ================ Stream K — Financials Re-architecture ====================
-- 2026-07-03 reconciliation: the SoR direction is decided by
-- docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md.
-- K1.1 can proceed as implementation work; K4.1 is closed by the decision log.
-- K3.1 remains open only for concrete migration-path decisions. K2.1 still
-- carries the original finance working-session gate.

('K1.1', 'K', 'K1', 'QEP OS native AR/AP + reporting as system of record',
 'Implement QEP OS as the forward accounting system of record for native AR, AP, customer invoices, reporting, tax evidence, close/reopen audit, job costing, and financial source data. QuickBooks Desktop is downstream check-register/CPA-reporting output only. Remaining open finance values must stay parameterized or config-driven; do not hard-code working-session values.',
 'not_started', 'Engineer',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.2, Section 8.1 | docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md | supabase/migrations/662_finance_foundation_invoice_numbering.sql | supabase/migrations/663_finance_foundation_quarter_close_reopen.sql | supabase/migrations/664_finance_foundation_ar_dunning_cycle.sql | supabase/migrations/665_finance_foundation_ap_three_way_match.sql | supabase/migrations/666_finance_foundation_county_tax_rentals.sql | supabase/migrations/667_finance_foundation_equipment_reversal_approvals.sql | supabase/migrations/668_finance_foundation_fet_form8300.sql | supabase/migrations/669_finance_foundation_margin_segments.sql | supabase/migrations/670_finance_foundation_intellidealer_master_match_dry_run.sql',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: QEP OS owns AR/AP/reporting after cutover. [2026-07-03] SoR decision satisfied by the finance K-stream artifact; build-now foundation exists in migrations 662-670, while open finance values remain config/working-session items rather than blockers to the SoR direction.',
 8301),

('K2.1', 'K', 'K2', 'Structured parts-vs-service revenue split',
 'A structured parts-vs-service revenue split: all parts revenue (including parts sold on a service work order) posts to the Parts Department, and Service Department revenue is labor + miles + sublet + hauling. The split must drive both the customer-facing invoice line grouping and the internal P&L, replacing today''s string-matching of line descriptions at QBO post. GATED on the owner-requested engineering working session.',
 'pending_decision', 'Architect to Engineer',
 'BLK-FIN-WORKING-SESSION',
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1 (DP 5.6), Section 8.1',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: revenue is split structurally (parts to Parts Dept; service = labor+miles+sublet+hauling) on both the invoice and the P&L.',
 8302),

('K3.1', 'K', 'K3', 'QuickBooks reduced to vendor-pay + cash + migration path',
 'QuickBooks role is decided: downstream vendor-pay, cash/check-register, and CPA-reporting output only, not the ledger. This row remains open only for migration-path decisions: allocation basis, depreciation, lender floor-plan terms, IBS treatment, CPA adjustment posting target, open service-WO migration, invoice width, master-ID strategy, finance-charge basis, and missing finance exports/attachments.',
 'pending_decision', 'Finance + Engineer',
 'BLK-FIN-MIGRATION-PATH',
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.2, Section 8.1 | docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: a defined migration path that reduces QuickBooks to vendor-pay + cash with QEP OS owning AR/AP/reporting. [2026-07-03] QuickBooks-as-ledger question is closed; keep this row open only for the concrete migration-path decisions listed in the K-stream decision artifact.',
 8303),

('K4.1', 'K', 'K4', 'Revisit Build-Lock memo G5 vs accounting-SoR direction',
 'Reconcile Build-Lock memo G5 against the accounting-system-of-record direction. Decision logged: G5 remains valid only as a bridge/outbound-feed precedent; Stream K target architecture is QEP OS as SoR and QuickBooks is downstream output.',
 'shipped', 'Architect',
 NULL,
 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.2, Section 6.3, Section 8.2 | docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md',
 '[2026-05-29] Created from Service Department roadmap alignment. Acceptance: Build-Lock memo G5 is reconciled against the accounting-SoR direction and the decision is logged. [2026-07-03] Shipped by the K-stream decision artifact: native AR/AP remains the long-term target, QuickBooks API is a Phase 1-7 bridge/outbound feed, and any QuickBooks-as-ledger interpretation is superseded.',
 8304)
ON CONFLICT (task_id) DO UPDATE SET
  stream = EXCLUDED.stream,
  wave = EXCLUDED.wave,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  ship_state = EXCLUDED.ship_state,
  owner = EXCLUDED.owner,
  blocking_decision = EXCLUDED.blocking_decision,
  evidence_link = EXCLUDED.evidence_link,
  notes = EXCLUDED.notes,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

COMMIT;

-- Final stream map after Phase One source-of-truth repair.
COMMENT ON TYPE public.qep_roadmap_stream IS
  'A=Iron Quote · B=Sales-Advisor Field Platform · C=IntelliDealer Cutover · D=Parity Validation+Decision Resolution · E=Platform Foundation · F=Decision Velocity · G=Parts Department · H=Service Department · I=Grapple-Truck Production · J=Workforce · K=Financials Re-architecture';
