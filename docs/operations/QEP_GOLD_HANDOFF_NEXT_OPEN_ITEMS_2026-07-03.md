# QEP Gold Handoff - Next Open Items

Prepared: 2026-07-03

Scope source:
- `docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md`
- `docs/architecture/parts-pricing-ruleset.md`
- `docs/designs/qep-parts-workflow-document-2026-05-29-review-candidate.md`
- `supabase/migrations/765_d37_d36_stream_k_roadmap_reconciliation.sql`

Do not include D3.12 / CYBER-INS in this queue. It is already answered by migration 648 and is intentionally skipped.

## Closed / Unblocked By This Cleanup

- D3.7 / QEP-101 is closed. Evidence: `docs/architecture/parts-pricing-ruleset.md` plus migration `676_g81_parts_pricing_engine_counter_discount_cap.sql`. Deferred pricing extensions remain open and must not be inferred.
- K1.1 / QEP-221 is unblocked from the SoR decision and can move as implementation work. QEP OS is the forward accounting SoR; QuickBooks Desktop is downstream check-register/CPA-reporting output.
- K4.1 / QEP-224 is closed. Build-Lock G5 is reconciled as a bridge/outbound-feed precedent, not a QuickBooks-as-ledger decision.

## Best Next Engineering Item

### K1.1 / QEP-221 - Finance SoR implementation slice

Build from the existing foundation migrations:
- `662_finance_foundation_invoice_numbering.sql`
- `663_finance_foundation_quarter_close_reopen.sql`
- `664_finance_foundation_ar_dunning_cycle.sql`
- `665_finance_foundation_ap_three_way_match.sql`
- `666_finance_foundation_county_tax_rentals.sql`
- `667_finance_foundation_equipment_reversal_approvals.sql`
- `668_finance_foundation_fet_form8300.sql`
- `669_finance_foundation_margin_segments.sql`
- `670_finance_foundation_intellidealer_master_match_dry_run.sql`

Execution rules:
- Treat QEP OS as the target AR/AP/reporting SoR.
- Treat IntelliDealer as the transition operational SoR until cutover.
- Treat QuickBooks Desktop as downstream output only.
- Do not hard-code open finance values such as invoice width, finance-charge basis, floor-plan terms, allocation basis, depreciation rules, internal WO rates, or bank-account lists.
- Use config tables, settings, or owner-reviewed seed rows for values that are still unresolved.

Suggested first implementation cut:
1. Add a read model or admin-facing status surface that exposes the finance foundation state already created by migrations 662-670.
2. Make unresolved business values explicit as null/config-required states instead of defaults hidden in code.
3. Add tests proving QuickBooks is not treated as the ledger and that unresolved values are rejected or shown as config-required.
4. Run `bun run migrations:check`, the focused Bun tests for touched migrations/scripts, and any affected edge/web tests.

Definition of done:
- K1.1 remains implementation work, not a decision row.
- No open finance values are embedded as permanent constants.
- Evidence links point back to the K-stream decision artifact and the touched migrations.

## Manual Gates Not Ready For Engineering Closure

### D3.6 / QEP-100 - Parts workflow document

Current state: owner-review gated.

Manual action required:
- Juan + Norman red-line `docs/designs/qep-parts-workflow-document-2026-05-29-review-candidate.md`.
- They must confirm/correct the workflow stages and resolve or explicitly defer the §20 decision points.
- Record a signed v1 path before marking D3.6 shipped.

### K3.1 / QEP-223 - QuickBooks migration path

Current state: narrowed pending decision.

Manual/working-session decisions still required:
- corporate-to-branch allocation basis
- per-unit depreciation rules
- lender floor-plan terms, including IBS treatment
- CPA adjustment posting target
- open service-WO migration at cutover
- invoice width
- master-ID strategy
- finance-charge basis
- missing finance exports/attachments

Do not reopen whether QuickBooks is the ledger. It is not.

### K2.1 - Structured parts-vs-service revenue split

Current state: still gated on the original finance working session. This cleanup did not answer K2.1.

## Copy-Paste Start Prompt

```text
Implement the next K1.1 finance SoR slice in /Users/brianlewis/Projects/qep-knowledge-assistant.

Read first:
- docs/operations/QEP_GOLD_HANDOFF_NEXT_OPEN_ITEMS_2026-07-03.md
- docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md
- supabase/migrations/662_finance_foundation_invoice_numbering.sql through 670_finance_foundation_intellidealer_master_match_dry_run.sql

Goal:
Move K1.1 forward as implementation work without hard-coding unresolved finance values. Treat QEP OS as the forward AR/AP/reporting SoR, IntelliDealer as transition SoR, and QuickBooks Desktop as downstream output only.

Constraints:
- Preserve unrelated dirty worktree changes.
- Keep unresolved finance values config-required/null/owner-reviewed, not constants.
- Add focused tests for any changed migration, edge function, script, or UI surface.
- Run bun run migrations:check plus targeted tests.
- Do not mark K3.1 shipped or reopen the QuickBooks-as-ledger question.
```
