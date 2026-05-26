-- ============================================================================
-- Migration 623: Q7 ratified — disallow prospect quotes
--
-- Q7 (RATIFY lane) asked whether reps could quote non-customers (prospects)
-- and, if so, when to auto-convert. The recommended option was
-- `allow_convert_at_acceptance`. The owner answered `disallow_prospect_quotes`
-- — every quote must be anchored to a real customer record before draft
-- creation. The "Quote for prospect" walk-in shortcut is being removed from
-- the wizard in the same change set.
--
-- Resolving the decision row promotes any qep_roadmap_tasks gated on Q7 via
-- the trigger from migration 595.
-- ============================================================================

BEGIN;

UPDATE public.qep_decisions
SET status              = 'answered'::public.qep_decision_status,
    answered_by         = 'rylee',
    answered_at         = NOW(),
    answered_option     = 'disallow_prospect_quotes',
    answered_rationale  = $qep$Owner chose to require a real customer record before any quote can be created. The walk-in "Quote for prospect" shortcut in steps/CustomerStep.tsx + WizardShell.tsx is being removed. Reps must search/select an existing CRM customer or add a new customer via the picker's manual-entry flow before progressing past step 1. Reverses the seeded recommendation (allow_convert_at_acceptance) — reversal cost is 5 minutes per migration 596.$qep$
WHERE code = 'Q7'
  AND status = 'open';

COMMIT;
