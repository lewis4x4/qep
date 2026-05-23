# QEP Decisions Inbox — Phase 2 Live Smoke Test Selection — 2026-05-23

Recorded at: 2026-05-23T16:07:35-08:00 (PST)

## Operator Selection

| Field | Value |
|---|---|
| Source aggregation | `6 decisions waiting on QEP` (Command Center tile) |
| Selected option | `smoke_test_selected` |
| Operator note | Phase 2 live smoke test |
| Work order id | `165c1295-d29b-4b75-8bac-e61800830d4c` |
| Source answer id | `ae8ceddb-d022-4eea-b2e0-11976199bde5` |
| Risk class | auto |

The operator selected `smoke_test_selected` on the aggregated `6 decisions
waiting on QEP` tile rather than answering the underlying `qep_decisions`
rows individually. The selection pins resolution of those 6 decisions on
the outcome of a Phase 2 live smoke test executed against the staging
project (`iciddijgonywtxoelous`) using the procedure that already exists
at `plans/Quote Builder Moonshot Build/SLICE_07_SMOKE_TEST.md`.

## Decisions Covered

These are the six `qep_decisions.status = 'open'` rows that exist at the
time of selection (mirrors the table in
`docs/operations/QEP_ROADMAP_BLOCKER_HANDOFF_2026-05-21.md §"Open Decision
Blockers"`):

| Code | Owner | Lane | Required action |
|---|---|---|---|
| Q7 | Rylee | RATIFY | Prospect quote policy: allow/deny and conversion timing |
| Q10 | Rylee | RATIFY | Rebate stack precedence policy |
| Q12 | Rylee | AUTHORIZE | Microsoft 365 consent / mailbox access policy |
| Q14 | Rylee | RATIFY | Source-required alert routing |
| Q15 | Rylee | RATIFY | Sales home priority cut |
| CYBER-INS | Rylee | AUTHORIZE | Cyber insurance coverage for AI-powered internal tools |

No `qep_decisions` row is mutated by this record. The selection records an
operator intent to run the smoke test before the per-row answers are
written. Per-row answers must still be applied through the audited path
(`apply_qep_delegated_recommendation` for delegated rows, owner-authored
update for AUTHORIZE rows).

## Smoke Test Procedure

The Phase 2 live smoke test is the existing Quote Builder Moonshot Build
Slice 07 procedure:

- File: `plans/Quote Builder Moonshot Build/SLICE_07_SMOKE_TEST.md`
- Audience: admin / manager / owner role on staging
- Duration: ~15 minutes if prerequisites are met
- Coverage matrix (from §"What this smoke test verifies"):
  - CP9 — Deal Engine Status tab + readiness strip
  - CP4 — Price Sheets dashboard freshness
  - CP5 + CP6 — Upload → extract → publish drawer
  - CP6 (edge fn) — auto-approve pending → approved before apply
  - CP7 — freight zone CRUD + coverage grid (covered / overlap / uncovered)
  - CP9 — brand toggle with prereq validation
  - CP2 — qb-ai-scenarios error messages reference "deal engine" not "discount"
  - CP2 — freight error message references "Admin → Price Sheets"
  - CP8 — AI Request Log "Time to Quote" column renders cleanly
  - cross-cutting — role gate enforcement

## Pass / Fail Routing

After the smoke test is executed:

1. If the test passes (or passes with documented exceptions), apply each
   of the six open decisions via the audited update path. The recommended
   options in `supabase/migrations/596_qep_decisions_seed.sql` remain the
   default; deviations must record `answered_rationale`.
2. If the test fails, the decisions stay `open` and the failure mode is
   logged on the Linear ticket(s) tied to the affected decision codes
   before any answer is applied.

Re-run after any blocker resolution per the Resume Procedure in
`docs/operations/QEP_ROADMAP_BLOCKER_HANDOFF_2026-05-21.md §"Resume
Procedure"`.

## Mission Lock Check

Per `CLAUDE.md §"Mission Lock"`:

- **Mission Fit:** Verifying the live Phase 2 stack before answering
  multi-decision policy choices protects Iron Quote operations for reps,
  managers, and corporate ownership.
- **Transformation:** The aggregated `smoke_test_selected` path is the
  Decision Inbox behavior that keeps owners out of one-by-one ratification
  busywork and is a step toward operator-grade automated triage.
- **Pressure Test:** The Slice 07 procedure exercises every CP and is the
  pressure test for this selection.
- **Operator Utility:** Closes the `6 decisions waiting` tile without
  forcing the owner to context-switch into each row individually.
