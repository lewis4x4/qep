-- ──────────────────────────────────────────────────────────────────────────
-- 378_quote_packages_status_widen.sql
--
-- quote_packages.status was originally constrained (migration 087) to
-- ('draft','ready','sent','viewed','accepted','rejected','expired').
-- Downstream features added status values without widening the check:
--   - submit-approval writes 'pending_approval'
--   - the flow-approval sync trigger (migration 363) writes 'approved',
--     'approved_with_conditions', 'changes_requested'
--   - rep/archive flows reference 'converted_to_deal' and 'archived'
-- The result: Submit for Approval has been 500'ing for every user with
-- "new row for relation quote_packages violates check constraint
-- quote_packages_status_check". Widen the check to accept every
-- transitional + terminal status the app actually writes.
-- ──────────────────────────────────────────────────────────────────────────

alter table public.quote_packages
  drop constraint if exists quote_packages_status_check;

alter table public.quote_packages
  add constraint quote_packages_status_check
  check (status in (
    'draft',
    'pending_approval',
    'approved',
    'approved_with_conditions',
    'changes_requested',
    'ready',
    'sent',
    'viewed',
    'accepted',
    'rejected',
    'expired',
    'converted_to_deal',
    'archived'
  ));

comment on constraint quote_packages_status_check on public.quote_packages is
  'Covers the full status lifecycle: draft -> pending_approval -> approved/approved_with_conditions/changes_requested -> sent -> viewed -> accepted/rejected/expired, plus converted_to_deal and archived terminal states. Widened from the original 7-state list in migration 087.';
