-- ============================================================================
-- Migration 594: seed qep_roadmap_tasks from QEP_UNIFIED_ROADMAP_2026-05-19.md
-- Idempotent — ON CONFLICT (task_id) DO UPDATE preserves manual edits to
-- ship_state, owner, notes, but refreshes title/description/blocking_decision/
-- depends_on/evidence_link from the unified roadmap.
--
-- Stream A — Iron Quote
-- Stream B — Sales-Advisor Field Platform
-- Stream C — IntelliDealer Cutover
-- Stream D — Parity Validation + Decision Resolution
-- Stream E — Platform Foundation
--
-- Ship-state reflects ground-truth as of 2026-05-19 per:
--   - QEP_Codebase_Audit.md (2026-04-21)
--   - IRON_QUOTE_BUILD_VERIFICATION_HANDOFF_2026-05-16.md (verified 2026-05-17 @ 20b3805e)
--   - JAR decision packets (JAR-103 through JAR-109)
-- ============================================================================

BEGIN;

-- Helper: upsert wrapper. Uses ON CONFLICT (task_id) DO UPDATE but preserves
-- any manual ship_state advancement (so re-running the seed never demotes a
-- row that's been promoted in the UI).
WITH seed(task_id, stream, wave, title, description, ship_state, owner, blocking_decision, depends_on, evidence_link, sort_order) AS (
  VALUES
  -- =====================================================================
  -- STREAM A — IRON QUOTE
  -- =====================================================================
  -- A1 — Ship Iron Quote to customers
  ('A1.1','A','A1','Manual staging QA pass','FL 6% state tax, county surtax $5K cap, tax-exempt badge, all 4 manager approval outcomes, TILA disclaimer surfaces','in_progress','Rylee + architect',NULL,NULL::text[],'IRON_QUOTE_BUILD_VERIFICATION_HANDOFF_2026-05-16.md §3.3', 101),
  ('A1.2','A','A1','Q02699 PDF parity sign-off','Side-by-side review against IntelliDealer Q02699; parity checklist §10.15 items 1–30 with §11 amendments','in_progress','Architect + Ryan',NULL,NULL::text[],'QRM_QUOTE_WIZARD_SPEC_2026-05-05.md §10.15 + §11', 102),
  ('A1.3','A','A1','Playwright CI env vars wired','Set PLAYWRIGHT_TEST_EMAIL, PLAYWRIGHT_TEST_PASSWORD, PLAYWRIGHT_AGED_EQUIPMENT_ID on e2e-staging CI job → 3 skipped specs flip to pass','in_progress','DevOps',NULL,NULL::text[],'apps/web/tests/e2e/TODO_PLAYWRIGHT.md', 103),
  ('A1.4','A','A1','Three real customers receive Iron Quote','Captured in writing for the project file. Moonshot exit gate.','not_started','Brian',NULL,ARRAY['A1.1','A1.2'],'QRM_QUOTE_MOONSHOT_HANDOFF_2026-05-07.md EXIT BAR', 104),
  ('A1.5','A','A1','Brand voice pass on every Iron Quote string','Email Quote body, Text Quote SMS, Why This Machine pre-suggest — all through email-voice skill or human edit','in_progress','Engineer',NULL,NULL::text[],'skills/email-voice', 105),

  -- A2 — PDF refinements (Section 11)
  ('A2.1','A','A2','Typography bump','Body 11→12pt (Inter), table cells 9→10pt, headlines scale proportionally','shipped','Engineer',NULL,NULL::text[],'QRM_QUOTE_WIZARD_SPEC §11.1', 201),
  ('A2.2','A','A2','Drop redundant header text','Remove metadata line that repeats quote test name / number / expiry next to banner','shipped','Engineer',NULL,NULL::text[],'QRM_QUOTE_WIZARD_SPEC §11.2', 202),
  ('A2.3','A','A2','Rep card fills container','Canonical rep card layout per §11.3 — name in Bebas Neue, contact rows in Inter','shipped','Engineer',NULL,NULL::text[],'QRM_QUOTE_WIZARD_SPEC §11.3', 203),
  ('A2.4','A','A2','Strip trade comp range from customer copy','M4 is rep-facing only — comp range renders only in Deal IQ sidebar + internal trade detail view','shipped','Engineer',NULL,NULL::text[],'QRM_QUOTE_WIZARD_SPEC §11.4', 204),
  ('A2.5','A','A2','Empty Misc/Parts/Trade sections suppress','No header, no divider, no body when section is empty — content below pushes up','shipped','Engineer',NULL,NULL::text[],'QRM_QUOTE_WIZARD_SPEC §11.5', 205),
  ('A2.6','A','A2','Two-column totals + signature','Subtotal/totals left column, Authorization signature right column, vertically aligned','shipped','Engineer',NULL,NULL::text[],'QRM_QUOTE_WIZARD_SPEC §11.6', 206),
  ('A2.7','A','A2','Monthly payment is the hero','Largest/boldest typographic element in any financing block — Montserrat Bold at headline scale','shipped','Engineer',NULL,NULL::text[],'QRM_QUOTE_WIZARD_SPEC §11.7', 207),
  ('A2.8','A','A2','One-page priority','Single-unit/no-trade/no-parts/no-misc quote must render on exactly one page','shipped','Engineer',NULL,NULL::text[],'QRM_QUOTE_WIZARD_SPEC §11.8', 208),

  -- A3 — Moonshot moves
  ('A3.1','A','A3','M1 — Equipment hero photo gallery','3–5 photos per unit on cover page, pulled from equipment record photo set','not_started','Engineer',NULL,NULL::text[],'QRM_QUOTE_MOONSHOT_HANDOFF M1', 301),
  ('A3.2','A','A3','M2 — Live spec sheet from structured source','Model specs from manufacturer spec sheet ingestion, not free-text bullets. Filterable, searchable, consistent per model.','not_started','Engineer + Data',NULL,NULL::text[],'QRM_QUOTE_MOONSHOT_HANDOFF M2', 302),
  ('A3.3','A','A3','M3 — Cash/finance/lease comparison (payment hero)','Side-by-side comparison with toggle, APR source attribution per ADR-006. Payment column is largest/boldest per §11.7.','in_progress','Engineer',NULL,NULL::text[],'QRM_QUOTE_MOONSHOT_HANDOFF M3 + §11.7', 303),
  ('A3.4','A','A3','M4 — Trade-in market context (rep-facing only)','Deal IQ sidebar + internal trade detail view. Never on customer PDF (per §11.4).','in_progress','Engineer',NULL,NULL::text[],'QRM_QUOTE_MOONSHOT_HANDOFF M4 amended by §11.4', 304),
  ('A3.5','A','A3','M5 — Branded acceptance flow','Signed R2 URL → branded landing → e-sign via DocuSign-style → Stripe deposit. Sign event triggers timeline + stage update + rep notify.','not_started','Engineer + DevOps',NULL,NULL::text[],'QRM_QUOTE_MOONSHOT_HANDOFF M5', 305),
  ('A3.6','A','A3','M6 — Deal IQ sidebar (rep-facing only)','Margin %, margin $, commission projection, win-probability score, flagged risks (below floor, trade above max, discount above cap). Never on customer PDF.','in_progress','Engineer',NULL,NULL::text[],'QRM_QUOTE_MOONSHOT_HANDOFF M6', 306),
  ('A3.7','A','A3','M7 — Mobile-first PDF + acceptance','Mobile shells in place — full mobile validation against customer phone + iPad cab use','shipped','Engineer',NULL,NULL::text[],'apps/web/src/features/quote-builder/components/QuoteBuilderV2PageMobileShell.tsx', 307),
  ('A3.8','A','A3','M8 — Versioned immutable PDFs in R2','Every send creates a new version. Customer always opens latest. Rep sees version history with line-by-line diff.','not_started','Engineer',NULL,NULL::text[],'QRM_QUOTE_MOONSHOT_HANDOFF M8', 308),
  ('A3.9','A','A3','M9 — Brand-voice email + SMS templates','Every template through email-voice skill before shipping. Outbound delivery PDF wording (Q9) blocks final.','pending_decision','Engineer','Q9',NULL::text[],'QRM_QUOTE_MOONSHOT_HANDOFF M9', 309),
  ('A3.10','A','A3','M10 — QR landing page with NPS feedback','Branded landing showing quote status, accept button, contact rep, 3-question NPS feedback that pings rep on submit','not_started','Engineer',NULL,NULL::text[],'QRM_QUOTE_MOONSHOT_HANDOFF M10', 310),
  ('A3.11','A','A3','M11 — One-page priority','Default target single page; collapsing empty sections + tightening spacing','shipped','Engineer',NULL,NULL::text[],'QRM_QUOTE_WIZARD_SPEC §11.8', 311),

  -- A4 — Open product decisions blocking world-class
  ('A4.1','A','A4','Q6 — Post-approval routing default','return_to_rep vs auto_send_customer. Schema in place; default needs sign-off.','pending_decision','Brian/Rylee/Ryan','Q6',NULL::text[],'IRON_QUOTE_BUILD_VERIFICATION §6 Q6', 401),
  ('A4.2','A','A4','Q7 — Prospect-quote path policy','Allow or deny + conversion timing. Code exists.','pending_decision','Brian/Rylee/Ryan','Q7',NULL::text[],'IRON_QUOTE_BUILD_VERIFICATION §6 Q7', 402),
  ('A4.3','A','A4','Q10 — Rebate stack precedence','Cash + finance both, or one-or-other','pending_decision','Brian/Rylee/Ryan','Q10',NULL::text[],'IRON_QUOTE_BUILD_VERIFICATION §6 Q10', 403),
  ('A4.4','A','A4','Q11 — IntelliDealer snapshot scope + cutover date','Full history vs last N years. Cutover date.','pending_decision','Ryan','Q11',NULL::text[],'IRON_QUOTE_BUILD_VERIFICATION §6 Q11', 404),
  ('A4.5','A','A4','Q14 — 8x8 vs Twilio for availability escalation','Step-2 source_required notification channel','pending_decision','Brian/Rylee','Q14',NULL::text[],'IRON_QUOTE_BUILD_VERIFICATION §6 Q14', 405),
  ('A4.6','A','A4','Q15 — Sales-advisor home v1 cut priority','Of seven elements Rylee listed, which is v1','pending_decision','Brian/Rylee','Q15',NULL::text[],'IRON_QUOTE_BUILD_VERIFICATION §6 Q15', 406),
  ('A4.7','A','A4','Q16 — Three voice routes consolidate or relabel','/voice-quote, /voice, /voice-qrm from /floor','pending_decision','Rylee','Q16',NULL::text[],'IRON_FLOOR_AUDIT_2026-05-17.md §3.1', 407),
  ('A4.8','A','A4','Q9 — Outbound delivery PDF copy template','Exact wording for delivered-machine line','pending_decision','Brian/Rylee','Q9',NULL::text[],'IRON_QUOTE_DELTA_2026-05-14.md §3 Q9', 408),

  -- A5 — Omi-wave QB polish
  ('A5.1','A','A5','QB-3 — Fuzzy phone customer search','Share HF-1 RPC, add phone-digit helper, rank phone matches first. Migration 583.','in_progress','Engineer',NULL,ARRAY['B5.2'],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-3', 501),
  ('A5.2','A','A5','QB-6 — Cash down vs deposit semantics','Reconcile aliases, fix labels, persistence, proposal copy','in_progress','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-6', 502),
  ('A5.3','A','A5','QB-7 — SOP deposit recommendation','Preview-only tier calculation; blocked on owner-approved canonical tiers','blocked','Engineer','BLK-QB7',NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-7', 503),
  ('A5.4','A','A5','QB-8 — Special Terms voice field','Mostly already built; decide MobileVoiceTextarea vs Iron VoiceFillButton','shipped','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-8', 504),
  ('A5.5','A','A5','QB-9 — Expiration 30d / follow-up 3d defaults','Centralize constants, guard follow-up after expiration. Migration 588 if needed.','in_progress','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-9', 505),
  ('A5.6','A','A5','QB-10 — Review screen margin-gated send','Reconcile dirty changes; web/server margin math agreement; primary CTA cannot bypass note','in_progress','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-10', 506),
  ('A5.7','A','A5','QB-11 — Margin exception report (owner role)','Build enriched view from qb_margin_exceptions + quote_approval_cases','not_started','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-11', 507),
  ('A5.8','A','A5','QB-12 — Save Draft reason logging','draft_low_margin additive status; manual save vs autosave semantics','in_progress','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-12', 508),
  ('A5.9','A','A5','QB-13 — Auto-send rep notification copy','Distinguish approved+auto-sent vs approved+send-failed vs approved+return-to-rep','in_progress','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-13', 509),
  ('A5.10','A','A5','QB-14 — Realistic demo seed','Idempotent, deterministic IDs, natural-key guards, provenance metadata','not_started','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-14', 510),

  -- A6 — Open code gaps
  ('A6.1','A','A6','Bundle size + Lighthouse hardening','Beyond Fix D bundle:check guard','not_started','Engineer',NULL,NULL::text[],'IRON_WIZARD_DECOMPOSITION_PLAN §7', 601),
  ('A6.2','A','A6','Lease quoting (Step 7 Lease tab)','Gated on FEATURE_LEASE_QUOTING + lease rate sheets','blocked','Engineer','BLK-3',NULL::text[],'QRM_QUOTE_WIZARD_SPEC §4 BLK-3', 602),

  -- =====================================================================
  -- STREAM B — SALES-ADVISOR FIELD PLATFORM
  -- =====================================================================
  -- B1 — /floor audit residuals
  ('B1.1','B','B1','Voice route consolidation decision','Three routes accessible from /floor — consolidate or relabel','pending_decision','Rylee','Q16',NULL::text[],'IRON_FLOOR_AUDIT_2026-05-17.md §3.1', 1101),
  ('B1.2','B','B1','Prospecting-map-as-widget on /floor','Optional embed vs click-through','pending_decision','Brian','Q15',NULL::text[],'IRON_FLOOR_AUDIT_2026-05-17.md §3.2', 1102),
  ('B1.3','B','B1','AI briefing depth check','Confirm narrative is rich enough to satisfy "AI briefing for the day"','not_started','Rylee + Brian',NULL,NULL::text[],'IRON_FLOOR_AUDIT_2026-05-17.md §3.3', 1103),
  ('B1.4','B','B1','ActionItemsWidget vs AdvisorActionCards naming','Two different concepts share the word "actions" — code comment clarification','not_started','Engineer',NULL,NULL::text[],'IRON_FLOOR_AUDIT_2026-05-17.md §3.4', 1104),

  -- B2 — Voice capture pipeline
  ('B2.1','B','B2','VC-1 — Record from inside customer record','Teach VoiceQRM/voice capture to accept linked_company_id. Skip fuzzy company creation when launched from known customer.','in_progress','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md VC-1', 1201),
  ('B2.2','B','B2','VC-2 — Bullet summarization in voice-capture','Migration 584. Persist transcript even if summary fails; show 5-8 bullets above expandable transcript.','in_progress','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md VC-2', 1202),
  ('B2.3','B','B2','VC-3 — Live call capture w/ idempotent chunks','Migrations 585, 593. 10s chunks tolerate retries; finalization creates voice_captures + crm_activities.','in_progress','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md VC-3', 1203),
  ('B2.4','B','B2','VC-4 — Workspace-scoped speaker labeling','Migration 586. Privacy/audit fields. UI only suggests labels, no silent assignment.','in_progress','Engineer + Security',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md VC-4', 1204),
  ('B2.5','B','B2','VC-5 — Canonical source enum normalization','Migration 587. wearable_glasses reserved unless active bridge.','in_progress','Engineer',NULL,ARRAY['B3.1'],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md VC-5', 1205),

  -- B3 — Omi webhook bridge
  ('B3.1','B','B3','OM-1 — omi-webhook edge function + admin shell','HMAC validation, idempotency receipts, encrypted credential pattern. Blocked on Omi docs/secrets.','blocked','Engineer','OMI-DOCS',NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md OM-1', 1301),

  -- B4 — Daily briefings
  ('B4.1','B','B4','DH-1 — Morning AI brief','Unify morning_briefings vs daily_briefings storage; 6 AM ET semantics documented','in_progress','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md DH-1', 1401),
  ('B4.2','B','B4','OM-2 — Evening debrief','Migration 595 adds daily_briefings.kind, uniqueness (user_id, briefing_date, kind). Depends on OM-1 source tagging.','blocked','Engineer','OMI-DOCS',ARRAY['B3.1'],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md OM-2', 1402),

  -- B5 — Activity logging + dashboard polish
  ('B5.1','B','B5','DH-3 — One-tap activity logging','Shared sales activity logger; deal_id vs company_id precedence; RLS-safe insert','in_progress','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md DH-3', 1501),
  ('B5.2','B','B5','HF-1 — Customer attach dropdown search','Migration 583. matchesRepCustomerSearch + debounced workspace-wide fallback via search_companies_for_picker.','in_progress','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md HF-1', 1502),
  ('B5.3','B','B5','HF-2 — Voice-note dropdown contrast','Fix VoiceNoteCapture input/list option classes; design-token hover/focus','in_progress','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md HF-2', 1503),
  ('B5.4','B','B5','HF-3 — Bottom nav stability','SalesShell 100dvh + owned scrolling + safe-area; height contract on BottomTabBar','in_progress','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md HF-3', 1504),
  ('B5.5','B','B5','HF-4 — Save Draft / back collision','Replace mobile footer with MobileStickyActionBar; separate persistent Save from previous','in_progress','Engineer',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md HF-4', 1505),
  ('B5.6','B','B5','SC-1 — Remove fake view_as, real rep test session','Manager/owner-only "Open Rep Test Session" via real Supabase auth; correct role to rep','not_started','Engineer + Admin',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md SC-1', 1506),
  ('B5.7','B','B5','SC-2 — Role-scoped home route','resolveHomeRoute; reps land on /sales/today; guard non-sales paths','not_started','Engineer',NULL,ARRAY['B5.6'],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md SC-2', 1507),

  -- B6 — Prospecting + map
  ('B6.1','B','B6','UCC CSV ingest on /qrm/opportunity-map','Real, not label-only — parseUccProspectCsv shipped','shipped','Engineer',NULL,NULL::text[],'IRON_FLOOR_AUDIT_2026-05-17.md §1 row 6', 1601),
  ('B6.2','B','B6','ProspectingMapFloorWidget embed','Optional widget wrapper if Q15 prioritizes embed-on-floor','pending_decision','Engineer','Q15',NULL::text[],'IRON_FLOOR_AUDIT_2026-05-17.md §3.2', 1602),

  -- =====================================================================
  -- STREAM C — INTELLIDEALER CUTOVER
  -- =====================================================================
  -- C1 — Snapshot ETL
  ('C1.1','C','C1','Snapshot ETL scripts','Equipment, quotes, parts, service history — stage-and-commit ready with provenance source=intellidealer_snapshot_2026-05-14','shipped','DevOps',NULL,NULL::text[],'scripts/stage-intellidealer-{equipment,quotes,parts,service}-*.py', 2101),
  ('C1.2','C','C1','Pick scope + cutover date','Full history vs last N years. Cutover date.','pending_decision','Ryan','Q11',NULL::text[],'IRON_QUOTE_BUILD_VERIFICATION §6 Q11', 2102),
  ('C1.3','C','C1','Run snapshot in production','Commit cutover; flip Iron-only mode','not_started','Brian + DevOps',NULL,ARRAY['C1.2'],'scripts/commit-intellidealer-snapshot-import.mjs', 2103),

  -- C2 — OEM master schema + admin UI + parser (JAR-105)
  ('C2.1','C','C2','Slice 5.1 — OEM master schema + resolver','oems, oem_dealer_cost_tiers tables + qb_price_sheets extension + resolve_oem_cost() resolver','not_started','Architect → Engineer',NULL,NULL::text[],'JAR-105 packet', 2201),
  ('C2.2','C','C2','Slice 5.2 — /admin/oems admin UI','Test calculation: enter list + OEM → see cost via tier resolution','not_started','Engineer',NULL,ARRAY['C2.1'],'JAR-105 packet', 2202),
  ('C2.3','C','C2','Slice 5.3 — PDF price book parser','YCENA template ready; Bobcat/Vermeer templates after samples arrive','not_started','Engineer',NULL,NULL::text[],'JAR-105 packet', 2203),
  ('C2.4','C','C2','Slice 5.4 — ASV/Yanmar (YCENA) sample import','Books already provided in uploads','not_started','Engineer',NULL,ARRAY['C2.1','C2.2','C2.3'],'JAR-105 packet', 2204),
  ('C2.5','C','C2','Slice 5.5 — Bobcat sample import','Blocked on Norman pulling current Bobcat dealer file','blocked','Norman → Engineer','BLK-BOBCAT',NULL::text[],'JAR-105 packet', 2205),
  ('C2.6','C','C2','Slice 5.6 — Vermeer sample import','Blocked on Norman pulling current Vermeer dealer file','blocked','Norman → Engineer','BLK-VERMEER',NULL::text[],'JAR-105 packet', 2206),

  -- C3 — Equipment sale reversal (JAR-103)
  ('C3.1','C','C3','Equipment sale reversal — atomic mutation','Credit memo + GL reversal + equipment status + idempotency + authorization. Blocked on finance policy sign-off.','blocked','Engineer','JAR-103',NULL::text[],'JAR-103 packet', 2301),

  -- C4 — Native signing extension (JAR-106)
  ('C4.1','C','C4','Extend native e-signature to invoices + rental contracts','Quote builder e-signature pattern exists; extend','not_started','Engineer',NULL,NULL::text[],'JAR-106 packet', 2401),

  -- C5 — Generic telematics aggregator (JAR-107)
  ('C5.1','C','C5','Slice 9.1 — Telematics schema + adapter pattern','Foundation is social_telematics migration 090','not_started','Architect → Engineer',NULL,NULL::text[],'JAR-107 packet', 2501),
  ('C5.2','C','C5','Slice 9.2 — Yanmar Smart Assist adapter','Priority 1 — covers ASV + Yanmar','not_started','Engineer',NULL,ARRAY['C5.1'],'JAR-107 packet', 2502),

  -- C6 — HubSpot migration
  ('C6.1','C','C6','HubSpot migration: field map + dedup + parallel run','Blocked on API key from Rylee. Target: HubSpot cancelled post-cutover validation.','blocked','Engineer + Data','BLK-HUBSPOT-API',NULL::text[],'CLAUDE_CODE_HANDOFF_2026-04-23.md §8', 2601),

  -- C7 — Communication Hub
  ('C7.1','C','C7','M365 mailbox sync + token rotation','Migration 567 + 571 + m365-token-refresh cron','shipped','Engineer',NULL,NULL::text[],'IRON_QUOTE_BUILD_VERIFICATION §3.1 row 15', 2701),
  ('C7.2','C','C7','Entra Mail.Read + Mail.Send consent verification','Per-user vs tenant-admin consent (Q12)','pending_decision','Rylee + DevOps','Q12',NULL::text[],'IRON_QUOTE_BUILD_VERIFICATION §6 Q12', 2702),
  ('C7.3','C','C7','Twilio A2P 10DLC registration for QEP','BLK-7','blocked','DevOps','BLK-7',NULL::text[],'QRM_QUOTE_WIZARD_SPEC §4 BLK-7', 2703),
  ('C7.4','C','C7','8x8 Sandhills scoping memo (ADR-010)','QA-S1 session feeds the memo','blocked','Data & Integration','QA-S1',NULL::text[],'CLAUDE_CODE_HANDOFF_2026-04-23.md ADR-010', 2704),

  -- C8 — Deferred IntelliDealer items
  ('C8.1','C','C8','JAR-108 — Service Mobile Web UI','Deferred until QEP service ops modernize toward mobile-first','deferred','—','JAR-108',NULL::text[],'JAR-108 packet', 2801),
  ('C8.2','C','C8','JAR-109 — IronGuides live feed','Deferred until Ryan signs contract or operational gap surfaces','deferred','—','JAR-109',NULL::text[],'JAR-109 packet', 2802),

  -- =====================================================================
  -- STREAM D — PARITY VALIDATION + DECISION RESOLUTION
  -- =====================================================================
  ('D1.1','D','D1','Field UAT evidence on PARTIAL rows','Parity worksheet rows that need field UAT — work through systematically','in_progress','Brian + Rylee',NULL,NULL::text[],'QEP_Parity_Worksheet.xlsx', 3101),
  ('D1.2','D','D1','Source fixtures + vendor contracts','Where vendor data is required for promotion','in_progress','Data & Integration',NULL,NULL::text[],'QEP_PARITY_EXTERNAL_DECISION_QUEUE_2026-05-04.md', 3102),

  -- D2 — Open JAR decisions
  ('D2.1','D','D2','JAR-103 — Finance policy sign-off','Closed-period authorization rule — Tina/Ryan signature needed','blocked','Tina + Ryan','JAR-103',NULL::text[],'JAR-103 packet (pending signature)', 3201),
  ('D2.2','D','D2','JAR-104 — JD de-scope','Closed','shipped','—','JAR-104',NULL::text[],'JAR-104 packet', 3202),
  ('D2.3','D','D2','JAR-105 — OEM expansion','In-progress via Stream C2','in_progress','Architect','JAR-105',ARRAY['C2.1','C2.2','C2.3','C2.4'],'JAR-105 packet', 3203),
  ('D2.4','D','D2','JAR-106 — VESign replaced with native','Closed','shipped','—','JAR-106',NULL::text[],'JAR-106 packet', 3204),
  ('D2.5','D','D2','JAR-107 — Tethr replaced with generic telematics','Closed','shipped','—','JAR-107',NULL::text[],'JAR-107 packet', 3205),
  ('D2.6','D','D2','JAR-108 — Service Mobile deferred','See C8.1','deferred','—','JAR-108',NULL::text[],'JAR-108 packet', 3206),
  ('D2.7','D','D2','JAR-109 — IronGuides deferred','See C8.2','deferred','—','JAR-109',NULL::text[],'JAR-109 packet', 3207),

  -- D3 — Blocking gates
  ('D3.1','D','D3','NDA signed','Production-territory work gate','blocked','Ryan','NDA',NULL::text[],'CLAUDE_CODE_HANDOFF_2026-04-23.md §8', 3301),
  ('D3.2','D','D3','HubSpot API key delivered','Sprint 5 → C6 migration gate','blocked','Rylee','BLK-HUBSPOT-API',NULL::text[],'CLAUDE_CODE_HANDOFF §8', 3302),
  ('D3.3','D','D3','Customer list export (final)','Real-data validation','blocked','Rylee','BLK-CUST-EXPORT',NULL::text[],'CLAUDE_CODE_HANDOFF §8', 3303),
  ('D3.4','D','D3','Stock-numbers-with-costs export','OEM pricing validation','blocked','Rylee','BLK-STOCK-EXPORT',NULL::text[],'CLAUDE_CODE_HANDOFF §8', 3304),
  ('D3.5','D','D3','Florida TILA / lending rule docs','Financing calculator launch (ADR-006)','blocked','Angela','BLK-TILA',NULL::text[],'CLAUDE_CODE_HANDOFF §8 + ADR-006', 3305),
  ('D3.6','D','D3','Parts workflow document','Parts module refinement gate','blocked','Juan + Norman','BLK-PARTS-WF',NULL::text[],'CLAUDE_CODE_HANDOFF §8', 3306),
  ('D3.7','D','D3','Parts pricing ruleset documented','OEM schema validation gate','blocked','Norman','BLK-PARTS-PRICING',NULL::text[],'CLAUDE_CODE_HANDOFF §8', 3307),
  ('D3.8','D','D3','Agent service accounts in Supabase Auth','Automation workflows','not_started','DevOps',NULL,NULL::text[],'CLAUDE_CODE_HANDOFF §8', 3308),
  ('D3.9','D','D3','Paperclip env vars set','QEP_AGENT_EMAIL/PASSWORD + admin variants','not_started','DevOps',NULL,NULL::text[],'CLAUDE_CODE_HANDOFF §8', 3309),
  ('D3.10','D','D3','DNS for qep.blackrockai.co (QUA-108)','Staging access','in_progress','DevOps','QUA-108',NULL::text[],'CLAUDE_CODE_HANDOFF §8', 3310),
  ('D3.11','D','D3','Playwright PLAYWRIGHT_TEST_* env vars on CI','3 specs flip from skip to pass','in_progress','DevOps + Brian',NULL,NULL::text[],'apps/web/tests/e2e/TODO_PLAYWRIGHT.md', 3311),
  ('D3.12','D','D3','Cyber insurance covers AI tools','Confirmation only','pending_decision','Rylee','CYBER-INS',NULL::text[],'CLAUDE_CODE_HANDOFF §8', 3312),

  -- D4 — Three real customer signoffs
  ('D4.1','D','D4','Three real customers receive Iron Quote in writing','Moonshot exit gate','not_started','Brian',NULL,ARRAY['A1.1','A1.2','A1.5'],'QRM_QUOTE_MOONSHOT_HANDOFF EXIT BAR', 3401),

  -- =====================================================================
  -- STREAM E — PLATFORM FOUNDATION
  -- =====================================================================
  -- E1 — ADRs
  ('E1.1','E','E1','ADR-001 — Record concurrency','Optimistic + Supabase Realtime presence','shipped','Architect',NULL,NULL::text[],'docs/adr/ADR-001-*', 4101),
  ('E1.2','E','E1','ADR-002 — Multi-window workspace','Browser-native tabs, stable deep-link URLs','shipped','Architect',NULL,NULL::text[],'docs/adr/ADR-002-*', 4102),
  ('E1.3','E','E1','ADR-003 — Progressive customer capture (Parts)','Phone + first name minimum, enrichment queue','shipped','Architect',NULL,NULL::text[],'docs/adr/ADR-003-*', 4103),
  ('E1.4','E','E1','ADR-004 — Serial number as primary Parts entry','One large input on parts landing','shipped','Architect',NULL,NULL::text[],'docs/adr/ADR-004-*', 4104),
  ('E1.5','E','E1','ADR-005 — Trade-in photo-to-estimate guardrails','Comp range, no single number, inspection checklist gate. Rep-facing only per §11.4.','shipped','Architect',NULL,NULL::text[],'docs/adr/ADR-005-*', 4105),
  ('E1.6','E','E1','ADR-006 — Financing calculator compliance gate','FEATURE_FINANCING_CALCULATOR feature flag; depends on TILA docs','in_progress','Architect','BLK-TILA',ARRAY['D3.5'],'docs/adr/ADR-006-*', 4106),
  ('E1.7','E','E1','ADR-007 — Equipment ownership transfer','Same-serial-new-customer soft-transfer prompt','shipped','Architect',NULL,NULL::text[],'docs/adr/ADR-007-*', 4107),
  ('E1.8','E','E1','ADR-008 — Offline-first for field features','IndexedDB queue, service-worker background sync','shipped','Architect',NULL,NULL::text[],'docs/adr/ADR-008-*', 4108),
  ('E1.9','E','E1','ADR-009 — IntelliDealer data miner','Weekly ingestion replaces VitalEdge API as blocker','shipped','Architect',NULL,NULL::text[],'docs/adr/ADR-009-*', 4109),
  ('E1.10','E','E1','ADR-010 — Sandhills recording scoping','Open questions for QEP via QA-S1 session','blocked','Architect','QA-S1',NULL::text[],'docs/adr/ADR-010-*', 4110),
  ('E1.11','E','E1','ADR-011 — Quote wizard pattern','Step-by-step wizard, jump-back via progress bar','shipped','Architect',NULL,NULL::text[],'docs/adr/ADR-011-*', 4111),
  ('E1.12','E','E1','ADR-012 — Tax jurisdiction engine','FL 6% state + county surtax with $5K cap','shipped','Architect',NULL,NULL::text[],'docs/adr/ADR-012-*', 4112),
  ('E1.13','E','E1','ADR-013 — Lease quoting scope','Blocked on rate sheets','blocked','Architect','BLK-3',NULL::text[],'docs/adr/ADR-013-*', 4113),
  ('E1.14','E','E1','ADR-014 — Quote PDF layout & brand system','Per QRM_QUOTE_MOONSHOT + §11','shipped','Architect',NULL,NULL::text[],'docs/adr/ADR-014-*', 4114),
  ('E1.15','E','E1','ADR-015 — Multi-unit quote data model','Equipment + attachment + secondary as separate stock lines','shipped','Architect',NULL,NULL::text[],'docs/adr/ADR-015-*', 4115),
  ('E1.16','E','E1','ADR-016 — Acceptance flow & e-signature','Signed R2 URL → branded landing → e-sign → Stripe deposit','in_progress','Architect',NULL,NULL::text[],'docs/adr/ADR-016-*', 4116),

  -- E2 — Brand + voice compliance
  ('E2.1','E','E2','UI brand-guide compliance audit','Every surface validated against qep_brand_guide.pdf','in_progress','Engineer + Design',NULL,NULL::text[],'qep_brand_guide.pdf', 4201),
  ('E2.2','E','E2','LLM strings through email-voice skill or human edit','Every user-facing string','in_progress','Engineer',NULL,NULL::text[],'skills/email-voice', 4202),
  ('E2.3','E','E2','Anti-pattern enforcement','No Riley · no AI-sounding copy · no other-client demos','shipped','All agents',NULL,NULL::text[],'CLAUDE_CODE_HANDOFF §11', 4203),

  -- E3 — Mobile-first verification
  ('E3.1','E','E3','Iron Quote mobile shell validated','QuoteBuilderV2PageMobileShell.tsx','shipped','Engineer',NULL,NULL::text[],'apps/web/src/features/quote-builder/components/QuoteBuilderV2PageMobileShell.tsx', 4301),
  ('E3.2','E','E3','/floor advisor home iOS+Android+iPad verified','Real device verification pass','in_progress','Engineer + QA',NULL,NULL::text[],'IRON_FLOOR_AUDIT_2026-05-17.md', 4302),
  ('E3.3','E','E3','Service mobile UI','Deferred until service ops modernize','deferred','—','JAR-108',NULL::text[],'JAR-108 packet', 4303),

  -- E4 — Knowledge ingestion + RAG
  ('E4.1','E','E4','KL-1 — Meeting summarizer → knowledge doc','Skill update outside repo + ingestion endpoint inside','in_progress','Engineer',NULL,ARRAY['E4.2'],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md KL-1', 4401),
  ('E4.2','E','E4','KL-2 — Role-aware knowledge ingestion','Migration 594 for kb_audience_role_access; RLS-enforced; no existence leakage','in_progress','Engineer + Security',NULL,NULL::text[],'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md KL-2', 4402),

  -- E5 — Workshop sessions
  ('E5.1','E','E5','QA-R1 — Ryan branded UI walkthrough','Ryan sign-off on visual direction','not_started','Architect + Brian',NULL,NULL::text[],'CLAUDE_CODE_HANDOFF §9', 4501),
  ('E5.2','E','E5','QA-R2 — Rylee commission structure deep dive','Commission calc spec, widget wireframe','not_started','Brian + Architect',NULL,NULL::text[],'CLAUDE_CODE_HANDOFF §9', 4502),
  ('E5.3','E','E5','QA-R3 — Rylee+Ryan first five morning reports','Reports priority list for Stream A','not_started','Brian',NULL,NULL::text[],'CLAUDE_CODE_HANDOFF §9', 4503),
  ('E5.4','E','E5','QA-N1 — Norman parts pricing workshop','Parts pricing ruleset document','not_started','Brian + Architect',NULL,NULL::text[],'CLAUDE_CODE_HANDOFF §9', 4504),
  ('E5.5','E','E5','QA-WF1 — Sales rep workflow capture','David or Angela','not_started','Brian + Data',NULL,NULL::text[],'CLAUDE_CODE_HANDOFF §9', 4505),
  ('E5.6','E','E5','QA-WF2 — Parts counter workflow capture','Bobby','not_started','Brian + Data',NULL,NULL::text[],'CLAUDE_CODE_HANDOFF §9', 4506),
  ('E5.7','E','E5','QA-WF3 — Service writer workflow capture','TBD','not_started','Brian + Data',NULL,NULL::text[],'CLAUDE_CODE_HANDOFF §9', 4507),
  ('E5.8','E','E5','QA-WF4 — Technician workflow capture','TBD','not_started','Brian + Data',NULL,NULL::text[],'CLAUDE_CODE_HANDOFF §9', 4508),
  ('E5.9','E','E5','QA-WF5 — Finance workflow capture','Tina','not_started','Brian + Data',NULL,NULL::text[],'CLAUDE_CODE_HANDOFF §9', 4509),
  ('E5.10','E','E5','QA-S1 — Sandhills account scoping','Feeds ADR-010','not_started','Data & Integration',NULL,NULL::text[],'CLAUDE_CODE_HANDOFF §9', 4510),

  -- E6 — Cross-cutting reliability
  ('E6.1','E','E6','Pre-commit gates green','migrations:check · audit:edges · audit:secrets · typecheck · test · e2e · build','shipped','Engineer',NULL,NULL::text[],'CLAUDE.md release gate', 4601),
  ('E6.2','E','E6','Migration discipline','Append-only, sequential, no gaps. Current head 592.','shipped','Engineer',NULL,NULL::text[],'supabase/migrations/', 4602),
  ('E6.3','E','E6','Role taxonomy enforcement','rep | admin | manager | owner | client_stakeholder + iron roles','shipped','Engineer',NULL,NULL::text[],'profiles.role', 4603)
)
INSERT INTO public.qep_roadmap_tasks (task_id, stream, wave, title, description, ship_state, owner, blocking_decision, depends_on, evidence_link, sort_order)
SELECT
  task_id,
  stream::public.qep_roadmap_stream,
  wave,
  title,
  description,
  ship_state::public.qep_roadmap_ship_state,
  owner,
  blocking_decision,
  depends_on,
  evidence_link,
  sort_order
FROM seed
ON CONFLICT (task_id) DO UPDATE
SET title              = EXCLUDED.title,
    description        = EXCLUDED.description,
    stream             = EXCLUDED.stream,
    wave               = EXCLUDED.wave,
    blocking_decision  = EXCLUDED.blocking_decision,
    depends_on         = EXCLUDED.depends_on,
    evidence_link      = EXCLUDED.evidence_link,
    sort_order         = EXCLUDED.sort_order,
    -- Preserve manual progression of ship_state/owner/notes:
    ship_state         = CASE
                           WHEN public.qep_roadmap_tasks.ship_state IN ('shipped','in_progress','blocked','pending_decision','deferred')
                             AND EXCLUDED.ship_state = 'not_started'
                           THEN public.qep_roadmap_tasks.ship_state
                           ELSE EXCLUDED.ship_state
                         END,
    owner              = COALESCE(public.qep_roadmap_tasks.owner, EXCLUDED.owner);

COMMIT;
