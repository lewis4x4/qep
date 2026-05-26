-- ============================================================================
-- Migration 623: CYBER-INS — record client answer "yes_covered_need_time"
--
-- Source: work order c58ed852-444b-4e32-b900-24b9230aeade
-- Source answer: 1345941c-db62-4be6-bd56-d6c38d2e7317 (app 7ebd059c-a87e-4db3-9a90-12ce45d277ff)
-- Decision id at runtime: 70f42db8-6782-4642-8b1e-841ee506189d (code CYBER-INS)
--
-- Rylee confirmed verbally that the current cyber policy does cover AI-powered
-- internal tools (Iron Quote, the Decision Inbox, the QEP Knowledge Base) but
-- needs additional time to deliver the one-page written confirmation from the
-- carrier. We add a fourth option to qep_decisions.options that captures this
-- verbal-yes / written-pending state, then mark the decision answered so the
-- migration-595 trigger promotes D3.12 out of pending_decision.
--
-- AUTHORIZE-lane: answered_by records the human owner, answered_rationale
-- captures the carrier follow-up SLA, and a precedent row is written for
-- future similarity matching.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Extend CYBER-INS options with the verbal-yes / written-pending choice.
--    Idempotent: skips if an option with this label already exists.
-- ----------------------------------------------------------------------------
UPDATE public.qep_decisions
SET options = options || $qep$[{"label":"yes_covered_need_time","description":"Coverage confirmed verbally for Iron Quote, Decision Inbox, and the QEP Knowledge Base; carrier needs additional time to issue the one-page written confirmation."}]$qep$::jsonb
WHERE code = 'CYBER-INS'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(options) AS opt
    WHERE opt->>'label' = 'yes_covered_need_time'
  );

-- ----------------------------------------------------------------------------
-- 2. Apply the client answer.
--    AUTHORIZE lane requires a human author — answered_by names the owner,
--    answered_rationale captures the follow-up commitment.
-- ----------------------------------------------------------------------------
UPDATE public.qep_decisions
SET status              = 'answered'::public.qep_decision_status,
    answered_by         = 'rylee',
    answered_at         = NOW(),
    answered_option     = 'yes_covered_need_time',
    answered_rationale  = $qep$Rylee confirms the current cyber insurance policy covers AI-powered internal tools (Iron Quote, Decision Inbox, QEP Knowledge Base). The one-page written confirmation from the carrier is in progress — Rylee owns delivery and will forward it to Brian for the BlackRock AI compliance review. Provenance: source_answer 1345941c-db62-4be6-bd56-d6c38d2e7317, work_order c58ed852-444b-4e32-b900-24b9230aeade.$qep$
WHERE code = 'CYBER-INS'
  AND status = 'open';

COMMIT;
