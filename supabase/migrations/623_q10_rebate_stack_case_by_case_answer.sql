-- ============================================================================
-- Migration 623: Q10 rebate-stack precedence — apply owner answer case_by_case
--
-- Q10 (RATIFY) asked whether a quote with both a cash rebate AND a finance
-- rebate should stack both, force the customer to pick one, or vary per OEM.
-- The owner answer is "case_by_case": stacking is decided on a per-quote basis
-- by the rep using existing program selection controls. This migration:
--
--   1. Extends the Q10.options JSONB array to include the case_by_case option
--      so the inbox UI and downstream audit artifacts can render the chosen
--      label without falling back to raw answered_option text.
--   2. Transitions the Q10 decision from open → answered with the chosen
--      option, owner attribution, and a rationale that cites the source
--      answer captured in the decision inbox.
--
-- Side effect: the trigger from migration 595
-- (fn_qep_decision_resolved_promote_tasks) will auto-promote roadmap task
-- A4.3 from pending_decision → not_started and emit a sync-event audit row.
--
-- Source answer: 8c1456b0-a4f3-4488-9a5b-807e834d27cd
-- ============================================================================

BEGIN;

UPDATE public.qep_decisions
SET options = $qep$[
  {"label":"stack_both","description":"Both rebates apply by default; rep can de-select either to model exclusive","is_recommended":true},
  {"label":"exclusive","description":"Customer picks one or the other"},
  {"label":"per_oem","description":"Stacking rules vary per OEM (Bandit stacks, ASV exclusive, etc.)"},
  {"label":"case_by_case","description":"Stacking is decided on a per-quote basis by the rep using existing program-selection controls; no global precedence rule"}
]$qep$::jsonb
WHERE code = 'Q10';

UPDATE public.qep_decisions
SET status             = 'answered'::public.qep_decision_status,
    answered_by        = owner_role,
    answered_at        = NOW(),
    answered_option    = 'case_by_case',
    answered_rationale = $qep$Owner answer: stacking is decided per quote by the rep using existing program-selection controls — no global cash-vs-finance precedence rule. qb_programs.stack_kind (cash_alt | finance_addon | always_on) plus the rep's de-select capability already covers the case-by-case behavior; no schema change required. Source answer 8c1456b0-a4f3-4488-9a5b-807e834d27cd, work order 8ca20260-6c4e-46e2-8299-84be26de953b.$qep$
WHERE code = 'Q10'
  AND status = 'open';

COMMIT;
