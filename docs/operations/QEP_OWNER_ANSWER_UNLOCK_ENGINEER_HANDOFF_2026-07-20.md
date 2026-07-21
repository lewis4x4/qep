# QEP Owner-Answer Unlock Engineer Handoff

Prepared: 2026-07-20

Segment: `owner-answer-unlocks-2026-07-20`

Branch: `codex/owner-answer-unlocks-2026-07-20`

## Outcome

The Finance, Service, Rental, Sales, and Iron answers in the owner packet are placed in the existing QEP source-of-truth model and implemented through migrations 825-833, shared Edge logic, and the affected sales/quote interfaces. The implementation preserves prior issued identifiers and audit evidence, fails closed on unanswered values, and does not claim externally blocked work as shipped.

The detailed answer-to-system map and remaining owner inputs are in `docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md`.

## Delivered scope

- `825`: owner decisions, system-of-record corrections, roadmap reopening, and Linear-delta source truth.
- `826`: Finance configuration plus structural department/segment line classification and QuickBooks routing.
- `827`: branch/department five-digit numbering and immutable Ryan/Tina quarter-reopen approval slots.
- `828`: monthly AR charge controls, bounded/fair/resumable dunning claims, and append-only sale/rental deposit liabilities.
- `829`: reviewed service-plan catalog, hour/calendar PM scheduling, bounded scanner, and entitlement ledger.
- `830`: inert rental conversion commission/refund-clawback ledger with exact replay semantics.
- `831`: evidence-backed quote/prospect lifecycle, immutable finance principal binding, OEM/effective-date stacking, availability alerts, and sales UI/voice decisions.
- `832`: exact service hold reasons, driver and mileage accountability, and Grapple release evidence.
- `833`: fix-forward replacement of temporary AR dunning copy while preserving the installed function's ownership, grants, security settings, and evidence rows.
- Edge/shared callers classify finance lines and commit sale-deposit, quote, service, rental-billing, and QuickBooks state through the new canonical contracts.
- Sales/Quote/Iron UI reflects owner priority, prospect quoting, one combined confirm-before-act voice flow, accessible focus order, and 44px mobile targets.

## Activation boundaries

- Migrations 825-833 are applied to production Supabase; the remote ledger contains 886 applied versions and reports zero pending local migrations. Remote database types were regenerated after the schema-bearing migrations. Migration 833 changes copy only and does not change generated types.
- The eleven changed active callers are deployed and active: `quote-builder-v2`, `qb-recommend-programs`, `portal-stripe`, `quickbooks-gl-sync`, `rental-billing-runner`, `equipment-invoice-runner`, `parts-order-manager`, `service-invoice-generator`, `service-job-router`, `service-haul-router`, and `service-quote-engine`.
- All 27 roadmap rows in the scoped owner-answer delta are synchronized to Linear with identifiers and URLs; no row is pending or failed.
- Do not deploy `rental-ops` or flow-engine rental importers in this segment. L12.1 remains `in_progress` until canonical commission event producers and UAT exist.
- The BlackRock service-plan catalog remains inactive draft data. H9.1 remains `in_progress` until review/activation/enrollment UI is delivered.
- OEM stacking fails closed without real manufacturer worksheets. Availability alerts persist provider-neutral SMS/8x8 delivery work but do not claim provider dispatch is live.
- Tina's named approval slot remains unbound and fail closed until her production profile exists. Ryan is seeded by stable profile UUID, never mutable display name.

## Verification evidence

- Repository tests: 3,133 unit tests passed; all 26 integration files passed.
- Owner migration contracts: 69 static tests passed; scratch-PostgreSQL behavior covers AR, PM, rental, sales, and service concurrency/replay paths.
- Migration 833 focused verification: 6 tests passed with 43 assertions. Apply-twice testing preserved function identity/security metadata and removed every temporary-copy sentinel.
- Production build: 4,577 modules; bundle budget passed.
- Post-833 authoritative segment orchestrator: 15/15 checks passed at `test-results/agent-gates/20260721T021756Z-owner-answer-unlocks-2026-07-20.json`.
- Security/RLS delta report passed at `test-results/agent-gates/20260721T021459Z-owner-answer-unlocks-2026-07-20-security-833.json`; Migration Integrity delta report passed at `test-results/agent-gates/20260721T021719Z-owner-answer-unlocks-2026-07-20-migration-833-integrity.json`.
- Live post-commit verification confirms the dunning function has the required copy, remains `SECURITY DEFINER` with `search_path=""` and owner `postgres`, and has zero temporary-copy rows in dunning events, invoices, or invoice lines.
- Required specialist reports are stored in `test-results/agent-gates/` for QA, Chief Design Officer, Testing/Simulation, Security/RLS, Migration Integrity, and Performance. The final post-833 Release Gate is `GO` with 12/12 release checks passed, 70 upstream checks passed, one optional skip, zero failures, zero required non-pass checks, and no blockers or waivers at `test-results/agent-gates/20260721T022217Z-owner-answer-unlocks-2026-07-20-final-release-gate.json`.

## Remaining external blockers

Lender schedules/IBS treatment, branch headcounts, QuickBooks/CPA samples, service roster, corrected retail haul rates, Grapple scorecard metrics, rental exemption certificates, post-July-24 sales reviews/pilots, OEM worksheets, and Florida TILA wording remain external inputs. None is inferred or auto-ratified by this segment.

## Recovery posture

Each migration includes non-destructive rollback or fix-forward guidance. Stop writers and scheduled callers first; retain financial, identity, approval, and operational evidence; correct money and audit state with explicit reversing or superseding entries rather than deletion.

## Mission alignment

**Pass.** The segment converts owner intent into governed, workspace-safe operating controls for equipment, parts, sales, rental, service, employees, and management. It strengthens the durable evidence and human approval boundaries required for transformational AI workflows without presenting provisional or externally blocked work as complete.
