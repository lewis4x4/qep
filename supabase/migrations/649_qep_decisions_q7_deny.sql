-- ============================================================================
-- Migration 649: record the owner answer for decision Q7 (prospect quote path)
--
-- Source provenance:
--   work_order_id:    19567914-c37e-47e7-95c5-ac272a3b4a9b
--   source_answer_id: 95ed183c-5fb5-4fa6-a900-24d7b5f7f935
--   client_answer:    do_not_allow
--
-- Question (from migration 596):
--   "A rep wants to quote someone who is not yet a real customer in your
--    books — a prospect. Do you want to allow that? If yes, when do we
--    automatically convert them to a real customer record — when the quote
--    is sent, or when they actually buy?"
--
-- Mapping: the runner's `do_not_allow` answer corresponds to the seeded
-- option label `deny` ("Require full customer record before quote can be
-- created"). Quote Builder now requires a CRM contact_id or company_id
-- before a quote can be saved.
--
-- Updating qep_decisions.status -> 'answered' fires the resolved-promote
-- trigger from migration 595, which auto-promotes any qep_roadmap_tasks
-- whose blocking_decision = 'Q7' from pending_decision -> not_started.
-- ============================================================================

BEGIN;

UPDATE public.qep_decisions
SET status             = 'answered'::public.qep_decision_status,
    answered_option    = 'deny',
    answered_rationale = $qep$Client decision do_not_allow (work order 19567914-c37e-47e7-95c5-ac272a3b4a9b, source_answer_id 95ed183c-5fb5-4fa6-a900-24d7b5f7f935): quotes must be tied to a real CRM customer. Quote Builder will not accept a save without a contact_id or company_id, and is_prospect_quote can no longer be set true.$qep$,
    answered_by        = 'rylee',
    answered_at        = COALESCE(answered_at, now())
WHERE code = 'Q7'
  AND status <> 'answered';

COMMIT;
