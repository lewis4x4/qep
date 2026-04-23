-- ============================================================================
-- Migration 367: Seed closed-lost mulcher deals so Decision Room pattern
-- memory has something to surface in the demo workspace.
--
-- The cross-deal pattern banner (decision-room-pattern-lookup) only fires
-- when >=2 similar historical losses exist. The demo workspace had exactly
-- one closed-lost deal (Municipal Mulcher), so the feature never surfaced.
-- This migration adds three more — two with the *same* loss reason — so
-- the banner activates on the Municipal Mulcher deal with a real pattern
-- callout.
--
-- All three seeded deals:
--   - workspace 'default'
--   - stage_id = Closed Lost (91000000-0000-4000-8000-000000000006)
--   - amount in the mid band ($75K–$300K) to match Municipal Mulcher
--   - machine_interest containing "mulcher" to classify as same equipment
--   - loss_reason populated (the pattern filter)
--
-- Fixed UUIDs + ON CONFLICT DO NOTHING so this migration is idempotent.
-- ============================================================================

-- Three seed deals
insert into public.qrm_deals (
  id, workspace_id, name, stage_id, company_id, amount, loss_reason, closed_at
) values
  (
    'a1111111-0000-4000-8000-000000000001',
    'default',
    'Thompson fleet mulcher upgrade',
    '91000000-0000-4000-8000-000000000006',
    'c1000000-0000-0000-0000-000000000001',
    185000,
    'Budget committee delayed replacement to next fiscal cycle',
    '2026-02-14 17:30:00+00'
  ),
  (
    'a1111111-0000-4000-8000-000000000002',
    'default',
    'Brazos Valley mulcher replacement',
    '91000000-0000-4000-8000-000000000006',
    'c1000000-0000-0000-0000-000000000004',
    210000,
    'Competitor offered 90-day extended financing',
    '2026-03-03 15:10:00+00'
  ),
  (
    'a1111111-0000-4000-8000-000000000003',
    'default',
    'Red River mulcher fleet expansion',
    '91000000-0000-4000-8000-000000000006',
    'c1000000-0000-0000-0000-000000000005',
    145000,
    'Budget committee delayed replacement to next fiscal cycle',
    '2026-03-22 19:45:00+00'
  )
on conflict (id) do nothing;

-- One needs_assessment per seed deal so the pattern-lookup's equipment
-- classifier ("mulcher" keyword match) recognizes them as same class.
insert into public.needs_assessments (
  id, workspace_id, deal_id, machine_interest, fields_populated, fields_total
) values
  (
    'b1111111-0000-4000-8000-000000000001',
    'default',
    'a1111111-0000-4000-8000-000000000001',
    'Prinoth Panther T14 forestry mulcher',
    5,
    15
  ),
  (
    'b1111111-0000-4000-8000-000000000002',
    'default',
    'a1111111-0000-4000-8000-000000000002',
    'Diamond mulcher head for skid steer',
    5,
    15
  ),
  (
    'b1111111-0000-4000-8000-000000000003',
    'default',
    'a1111111-0000-4000-8000-000000000003',
    'Fecon Blackhawk mulcher',
    5,
    15
  )
on conflict (id) do nothing;
