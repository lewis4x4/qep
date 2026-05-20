-- ============================================================================
-- Migration 596: seed 10 audited decisions into qep_decisions
-- Source: QEP_15_DECISIONS_AUDIT.md (2026-05-19)
--
-- Uses $qep$...$qep$ dollar-quoted string literals everywhere so any apostrophe
-- inside copy is parser-safe. Apply migration 595 FIRST.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Q6 (AUTO) — Post-approval routing default
-- ----------------------------------------------------------------------------
INSERT INTO public.qep_decisions
  (code, question_plain, lane, owner_role, options, recommended_option, recommended_rationale, citations, reversal_cost, silence_threshold_days)
VALUES (
  'Q6',
  $qep$After a manager approves a quote, should Iron Quote send it straight to the customer, or send it back to the rep so they can add a personal note before it goes out?$qep$,
  'auto'::public.qep_decision_lane,
  'rylee',
  $qep$[{"label":"return_to_rep","description":"Bounce back to the rep first so they can add a personal line before sending","implication":"Reps add a personal touch; one extra click per approved quote","is_recommended":true},{"label":"auto_send_customer","description":"Email goes to customer immediately on manager approval","implication":"Faster; loses the personal touch reps add today"}]$qep$::jsonb,
  'return_to_rep',
  $qep$Iron Quote already has post_approval_action defaulting to return_to_rep. Reps routinely add a personal line before sending. Auto-send strips that.$qep$,
  $qep$[{"source":"codebase","ref":"quote_packages.post_approval_action enum","excerpt":"default return_to_rep"},{"source":"transcript","ref":"IRON_QUOTE_DELTA_2026-05-14 §1 item 13","excerpt":"schema decision was made by Brian during the build based on read of rep behavior"}]$qep$::jsonb,
  $qep$30 seconds — single config row update$qep$,
  1
)
ON CONFLICT (code) DO UPDATE
SET question_plain         = EXCLUDED.question_plain,
    lane                   = EXCLUDED.lane,
    owner_role             = EXCLUDED.owner_role,
    options                = EXCLUDED.options,
    recommended_option     = EXCLUDED.recommended_option,
    recommended_rationale  = EXCLUDED.recommended_rationale,
    citations              = EXCLUDED.citations,
    reversal_cost          = EXCLUDED.reversal_cost,
    silence_threshold_days = EXCLUDED.silence_threshold_days;

-- ----------------------------------------------------------------------------
-- Q9 (AUTO) — Outbound delivery PDF copy
-- ----------------------------------------------------------------------------
INSERT INTO public.qep_decisions
  (code, question_plain, lane, owner_role, options, recommended_option, recommended_rationale, citations, reversal_cost, silence_threshold_days)
VALUES (
  'Q9',
  $qep$When a customer-facing quote shows a delivery line on the PDF, what exact wording do you want? Right now there is a placeholder.$qep$,
  'auto'::public.qep_decision_lane,
  'rylee',
  $qep$[{"label":"recommended","description":"Delivered to {shipping_address} per quote terms. Delivery window: {delivery_window}. Weather and access permitting.","is_recommended":true},{"label":"custom","description":"Provide your own one-line phrasing"}]$qep$::jsonb,
  'recommended',
  $qep$Q02699 parity (the IntelliDealer reference quote) prints delivery info as a dry line item, not free text. Customers are used to seeing it professional. Brand voice guide §7: no fluffy claims, no corporate jargon. Weather and access permitting is QEP-vernacular for forestry/logging deliveries.$qep$,
  $qep$[{"source":"spec","ref":"QRM_QUOTE_WIZARD_SPEC_2026-05-05 §10","excerpt":"Q02699 parity reference"},{"source":"spec","ref":"IRON_QUOTE_DELTA_2026-05-14 §3 Q9","excerpt":"states what the delivery terms were but did not dictate exact phrasing"}]$qep$::jsonb,
  $qep$30 seconds — one template string$qep$,
  1
)
ON CONFLICT (code) DO UPDATE
SET question_plain         = EXCLUDED.question_plain,
    lane                   = EXCLUDED.lane,
    owner_role             = EXCLUDED.owner_role,
    options                = EXCLUDED.options,
    recommended_option     = EXCLUDED.recommended_option,
    recommended_rationale  = EXCLUDED.recommended_rationale,
    citations              = EXCLUDED.citations,
    reversal_cost          = EXCLUDED.reversal_cost,
    silence_threshold_days = EXCLUDED.silence_threshold_days;

-- ----------------------------------------------------------------------------
-- Q16 (AUTO) — Three voice routes
-- ----------------------------------------------------------------------------
INSERT INTO public.qep_decisions
  (code, question_plain, lane, owner_role, options, recommended_option, recommended_rationale, citations, reversal_cost, silence_threshold_days)
VALUES (
  'Q16',
  $qep$Your floor screen has three voice buttons today — Voice Quote, Voice Note, Voice QRM. Reps have asked whether that is confusing. Should we collapse them into one button, or relabel so it is obvious which one does what?$qep$,
  'auto'::public.qep_decision_lane,
  'rylee',
  $qep$[{"label":"relabel","description":"Keep three buttons, relabel: Voice → Quote, Voice → Note, Voice → CRM","is_recommended":true},{"label":"collapse","description":"Merge into one button that switches mode based on context"},{"label":"custom","description":"Provide your preferred labels"}]$qep$::jsonb,
  'relabel',
  $qep$IRON_FLOOR_AUDIT confirmed three voice surfaces are intentional and serve distinct flows. Collapsing would lose functionality. Relabel solves the actual confusion problem without code refactor.$qep$,
  $qep$[{"source":"spec","ref":"IRON_FLOOR_AUDIT_2026-05-17 §3.1","excerpt":"three voice routes accessible from one home screen is a UX question worth confirming"}]$qep$::jsonb,
  $qep$30 seconds — three label strings$qep$,
  1
)
ON CONFLICT (code) DO UPDATE
SET question_plain         = EXCLUDED.question_plain,
    lane                   = EXCLUDED.lane,
    owner_role             = EXCLUDED.owner_role,
    options                = EXCLUDED.options,
    recommended_option     = EXCLUDED.recommended_option,
    recommended_rationale  = EXCLUDED.recommended_rationale,
    citations              = EXCLUDED.citations,
    reversal_cost          = EXCLUDED.reversal_cost,
    silence_threshold_days = EXCLUDED.silence_threshold_days;

-- ----------------------------------------------------------------------------
-- Q7 (RATIFY) — Prospect quote path
-- ----------------------------------------------------------------------------
INSERT INTO public.qep_decisions
  (code, question_plain, lane, owner_role, options, recommended_option, recommended_rationale, citations, reversal_cost, silence_threshold_days)
VALUES (
  'Q7',
  $qep$A rep wants to quote someone who is not yet a real customer in your books — a prospect. Do you want to allow that? If yes, when do we automatically convert them to a real customer record — when the quote is sent, or when they actually buy?$qep$,
  'ratify'::public.qep_decision_lane,
  'rylee',
  $qep$[{"label":"allow_convert_at_acceptance","description":"Allow prospect quotes; auto-convert to customer when they sign the quote","is_recommended":true},{"label":"allow_convert_at_send","description":"Allow prospect quotes; auto-convert at send","implication":"creates customer record on every quote"},{"label":"deny","description":"Require full customer record before quote can be created"}]$qep$::jsonb,
  'allow_convert_at_acceptance',
  $qep$Code already exists in steps/CustomerStep.tsx (wizard-quote-for-prospect helper). Reps lose deals when they have to stop and create a full customer record for someone who has not agreed yet. Converting at acceptance keeps the customer database clean of un-engaged prospects.$qep$,
  $qep$[{"source":"codebase","ref":"apps/web/src/features/quote-builder/steps/CustomerStep.tsx","excerpt":"wizard-quote-for-prospect helper + button live"},{"source":"transcript","ref":"IRON_QUOTE_DELTA_2026-05-14 §1 item 16","excerpt":"Rylee historically said always need a customer but acknowledged the friction"}]$qep$::jsonb,
  $qep$5 minutes — toggle flag + add validation$qep$,
  7
)
ON CONFLICT (code) DO UPDATE
SET question_plain         = EXCLUDED.question_plain,
    lane                   = EXCLUDED.lane,
    owner_role             = EXCLUDED.owner_role,
    options                = EXCLUDED.options,
    recommended_option     = EXCLUDED.recommended_option,
    recommended_rationale  = EXCLUDED.recommended_rationale,
    citations              = EXCLUDED.citations,
    reversal_cost          = EXCLUDED.reversal_cost,
    silence_threshold_days = EXCLUDED.silence_threshold_days;

-- ----------------------------------------------------------------------------
-- Q10 (RATIFY) — Rebate stack precedence
-- ----------------------------------------------------------------------------
INSERT INTO public.qep_decisions
  (code, question_plain, lane, owner_role, options, recommended_option, recommended_rationale, citations, reversal_cost, silence_threshold_days)
VALUES (
  'Q10',
  $qep$When a quote has both a cash rebate AND a finance rebate that could apply, can the customer stack both, or do they have to pick one?$qep$,
  'ratify'::public.qep_decision_lane,
  'rylee',
  $qep$[{"label":"stack_both","description":"Both rebates apply by default; rep can de-select either to model exclusive","is_recommended":true},{"label":"exclusive","description":"Customer picks one or the other"},{"label":"per_oem","description":"Stacking rules vary per OEM (Bandit stacks, ASV exclusive, etc.)"}]$qep$::jsonb,
  'stack_both',
  $qep$Kurt Spencer $20K miss happened because a $20K finance rebate did not surface alongside a cash rebate. Customer-favorable default prevents the missing-rebate failure mode. Schema (qb_programs.stack_kind) already supports both stacking and exclusive flags.$qep$,
  $qep$[{"source":"transcript","ref":"IRON_QUOTE_DELTA_2026-05-14 §1 item 9","excerpt":"Kurt Spencer 20K miss"},{"source":"codebase","ref":"qb_programs.stack_kind","excerpt":"cash_alt | finance_addon | always_on enum"}]$qep$::jsonb,
  $qep$30 minutes — change stacking rule + recompute open quotes$qep$,
  7
)
ON CONFLICT (code) DO UPDATE
SET question_plain         = EXCLUDED.question_plain,
    lane                   = EXCLUDED.lane,
    owner_role             = EXCLUDED.owner_role,
    options                = EXCLUDED.options,
    recommended_option     = EXCLUDED.recommended_option,
    recommended_rationale  = EXCLUDED.recommended_rationale,
    citations              = EXCLUDED.citations,
    reversal_cost          = EXCLUDED.reversal_cost,
    silence_threshold_days = EXCLUDED.silence_threshold_days;

-- ----------------------------------------------------------------------------
-- Q14 (RATIFY) — 8x8 vs Twilio for availability escalation
-- ----------------------------------------------------------------------------
INSERT INTO public.qep_decisions
  (code, question_plain, lane, owner_role, options, recommended_option, recommended_rationale, citations, reversal_cost, silence_threshold_days)
VALUES (
  'Q14',
  $qep$When a rep hits source-required on equipment (not in stock, needs to come from somewhere), Iron Quote needs to alert the sales manager. Do you want that alert sent through 8x8 (your existing phone system) or Twilio (the new SMS provider we are wiring for quote sends)?$qep$,
  'ratify'::public.qep_decision_lane,
  'rylee',
  $qep$[{"label":"twilio","description":"Send via Twilio SMS (already integrating for quote sends)","is_recommended":true},{"label":"8x8","description":"Send via 8x8 (requires ADR-010 Sandhills scoping)"},{"label":"both","description":"Dual channel — SMS via Twilio and a call via 8x8"}]$qep$::jsonb,
  'twilio',
  $qep$Twilio A2P 10DLC registration is already in progress for quote-send SMS. ADR-010 (Sandhills/8x8 recording scoping) is unresolved and gates 8x8 commitment. Reusing one channel beats wiring two.$qep$,
  $qep$[{"source":"spec","ref":"QRM_QUOTE_WIZARD_SPEC_2026-05-05 §4 BLK-7","excerpt":"Twilio number provisioning + A2P 10DLC registration for QEP"},{"source":"adr","ref":"ADR-010","excerpt":"Sandhills recording scoping pending"}]$qep$::jsonb,
  $qep$10 minutes — switch notification adapter$qep$,
  7
)
ON CONFLICT (code) DO UPDATE
SET question_plain         = EXCLUDED.question_plain,
    lane                   = EXCLUDED.lane,
    owner_role             = EXCLUDED.owner_role,
    options                = EXCLUDED.options,
    recommended_option     = EXCLUDED.recommended_option,
    recommended_rationale  = EXCLUDED.recommended_rationale,
    citations              = EXCLUDED.citations,
    reversal_cost          = EXCLUDED.reversal_cost,
    silence_threshold_days = EXCLUDED.silence_threshold_days;

-- ----------------------------------------------------------------------------
-- Q15 (RATIFY) — Sales-advisor home v1 cut priority
-- ----------------------------------------------------------------------------
INSERT INTO public.qep_decisions
  (code, question_plain, lane, owner_role, options, recommended_option, recommended_rationale, citations, reversal_cost, silence_threshold_days)
VALUES (
  'Q15',
  $qep$Of the 7 things you wanted on the salesman home screen — AI briefing, open deals, follow-ups, voice quote, voice note, prospecting map, log-action shortcuts — which 3 do you want most prominent at the top?$qep$,
  'ratify'::public.qep_decision_lane,
  'rylee',
  $qep$[{"label":"briefing_deals_followups","description":"Top 3: AI briefing · open deals · follow-ups due today. Map and voice routes as quick-action tiles below.","is_recommended":true},{"label":"map_embedded","description":"Embed the prospecting map as a hero widget"},{"label":"custom","description":"Provide your own top 3 in order"}]$qep$::jsonb,
  'briefing_deals_followups',
  $qep$All 7 elements are already shipped (IRON_FLOOR_AUDIT). This is ranking, not cut. AI briefing is the moonshot differentiator — putting it last hides the value. Open deals + follow-ups are the daily action surface.$qep$,
  $qep$[{"source":"spec","ref":"IRON_FLOOR_AUDIT_2026-05-17","excerpt":"all 7 transcript elements shipped for iron_advisor"}]$qep$::jsonb,
  $qep$1 minute — reorder widget array$qep$,
  7
)
ON CONFLICT (code) DO UPDATE
SET question_plain         = EXCLUDED.question_plain,
    lane                   = EXCLUDED.lane,
    owner_role             = EXCLUDED.owner_role,
    options                = EXCLUDED.options,
    recommended_option     = EXCLUDED.recommended_option,
    recommended_rationale  = EXCLUDED.recommended_rationale,
    citations              = EXCLUDED.citations,
    reversal_cost          = EXCLUDED.reversal_cost,
    silence_threshold_days = EXCLUDED.silence_threshold_days;

-- ----------------------------------------------------------------------------
-- Q11 (AUTHORIZE) — IntelliDealer cutover scope + date
-- ----------------------------------------------------------------------------
INSERT INTO public.qep_decisions
  (code, question_plain, lane, owner_role, options, recommended_option, recommended_rationale, citations, reversal_cost, silence_threshold_days)
VALUES (
  'Q11',
  $qep$When we pull your IntelliDealer data into Iron Quote, how much history do we grab? And what date do we cut over so reps stop using IntelliDealer for new quotes?$qep$,
  'authorize'::public.qep_decision_lane,
  'ryan',
  $qep$[{"label":"recommended","description":"3 years of closed quotes + all open quotes + active inventory + active customers. Cutover Monday 2026-06-15.","is_recommended":true},{"label":"full_history","description":"All available history. Larger import, longer dry-run reconciliation."},{"label":"shorter_window","description":"Last 1 year only — faster cutover, less reporting history"},{"label":"custom","description":"Provide your preferred scope and cutover date"}]$qep$::jsonb,
  'recommended',
  $qep$3 years covers all warranty-relevant history without bloating the import (industry standard). A Monday cutover gives the rep team the weekend to absorb pre-cutover communications. Four weeks out is the shortest defensible window for Rylee QA + rep training.$qep$,
  $qep$[{"source":"codebase","ref":"scripts/stage-intellidealer-*.py","excerpt":"snapshot scripts ready"},{"source":"roadmap","ref":"C1.1","excerpt":"Snapshot ETL scripts shipped"}]$qep$::jsonb,
  $qep$HIGH — cutover is a one-way operational door$qep$,
  NULL
)
ON CONFLICT (code) DO UPDATE
SET question_plain         = EXCLUDED.question_plain,
    lane                   = EXCLUDED.lane,
    owner_role             = EXCLUDED.owner_role,
    options                = EXCLUDED.options,
    recommended_option     = EXCLUDED.recommended_option,
    recommended_rationale  = EXCLUDED.recommended_rationale,
    citations              = EXCLUDED.citations,
    reversal_cost          = EXCLUDED.reversal_cost,
    silence_threshold_days = EXCLUDED.silence_threshold_days;

-- ----------------------------------------------------------------------------
-- Q12 (AUTHORIZE) — Entra M365 consent
-- ----------------------------------------------------------------------------
INSERT INTO public.qep_decisions
  (code, question_plain, lane, owner_role, options, recommended_option, recommended_rationale, citations, reversal_cost, silence_threshold_days)
VALUES (
  'Q12',
  $qep$Iron Quote needs to read and send email through your Microsoft 365 (so it can send quotes from your reps mailboxes and read replies). Do you want to grant that permission once for the whole qepusa.com tenant, or per-user?$qep$,
  'authorize'::public.qep_decision_lane,
  'rylee',
  $qep$[{"label":"tenant_admin","description":"One-time admin consent covers all current and future reps. Cleaner audit.","is_recommended":true},{"label":"per_user","description":"Each rep clicks an approve button. More friction but more granular."}]$qep$::jsonb,
  'tenant_admin',
  $qep$One approval covers Rylee, Ryan, Angela, David, and any rep added later. No per-rep friction. Audit is cleaner — one consent record per scope. The M365 token-rotation cron is already shipped (migration 567); designed for tenant-wide use.$qep$,
  $qep$[{"source":"codebase","ref":"migration 567","excerpt":"M365 token-rotation cron"},{"source":"roadmap","ref":"C7.1","excerpt":"M365 mailbox sync + token rotation shipped"}]$qep$::jsonb,
  $qep$15 minutes — revoke tenant admin consent + re-grant per user$qep$,
  NULL
)
ON CONFLICT (code) DO UPDATE
SET question_plain         = EXCLUDED.question_plain,
    lane                   = EXCLUDED.lane,
    owner_role             = EXCLUDED.owner_role,
    options                = EXCLUDED.options,
    recommended_option     = EXCLUDED.recommended_option,
    recommended_rationale  = EXCLUDED.recommended_rationale,
    citations              = EXCLUDED.citations,
    reversal_cost          = EXCLUDED.reversal_cost,
    silence_threshold_days = EXCLUDED.silence_threshold_days;

-- ----------------------------------------------------------------------------
-- CYBER-INS (AUTHORIZE) — Cyber insurance coverage for AI tools
-- ----------------------------------------------------------------------------
INSERT INTO public.qep_decisions
  (code, question_plain, lane, owner_role, options, recommended_option, recommended_rationale, citations, reversal_cost, silence_threshold_days)
VALUES (
  'CYBER-INS',
  $qep$Does your current cyber insurance policy cover AI-powered internal tools like Iron Quote, the Decision Inbox, and the QEP Knowledge Base? We need a one-page confirmation in writing.$qep$,
  'authorize'::public.qep_decision_lane,
  'rylee',
  $qep$[{"label":"confirmed","description":"Forward your current cyber policy to Brian for a 30-minute review by BlackRock AI compliance. Confirm yes/no in writing within 3 business days.","is_recommended":true},{"label":"need_rider","description":"Confirmed your current policy does not cover; need a rider amendment"},{"label":"no_coverage","description":"No coverage available; legal review needed before live customer data exposure"}]$qep$::jsonb,
  'confirmed',
  $qep$Most modern policies (issued post-2024) cover SaaS + AI as a matter of course, but the specific carrier and rider matter. Decision Inbox will hold owner signatures with legal weight (JAR-103, future TILA). Cyber coverage needs confirmation before that goes live.$qep$,
  $qep$[{"source":"spec","ref":"CLAUDE_CODE_HANDOFF_2026-04-23 §7","excerpt":"Rylee confirms cyber insurance covers AI-powered internal tools"}]$qep$::jsonb,
  $qep$N/A — confirmation, not a system change$qep$,
  NULL
)
ON CONFLICT (code) DO UPDATE
SET question_plain         = EXCLUDED.question_plain,
    lane                   = EXCLUDED.lane,
    owner_role             = EXCLUDED.owner_role,
    options                = EXCLUDED.options,
    recommended_option     = EXCLUDED.recommended_option,
    recommended_rationale  = EXCLUDED.recommended_rationale,
    citations              = EXCLUDED.citations,
    reversal_cost          = EXCLUDED.reversal_cost,
    silence_threshold_days = EXCLUDED.silence_threshold_days;

-- ----------------------------------------------------------------------------
-- Materialize qep_decision_blocks from qep_roadmap_tasks.blocking_decision
-- ----------------------------------------------------------------------------
INSERT INTO public.qep_decision_blocks (decision_id, task_id)
SELECT d.id, t.task_id
FROM public.qep_decisions d
JOIN public.qep_roadmap_tasks t ON t.blocking_decision = d.code
WHERE t.ship_state = 'pending_decision'
ON CONFLICT DO NOTHING;

COMMIT;
