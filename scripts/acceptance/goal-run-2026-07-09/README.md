# Rental + service live acceptance

`rental-service-live-acceptance.mjs` is the production-shaped acceptance
harness for `RB-MULTI-RETURN-MONEY-CORRECTNESS`,
`RB-BILLING-RUNNER-SCALE`, and `SP-REPLAN-PO-IDEMPOTENCY`.

The default invocation is a zero-network dry run:

```bash
bun scripts/acceptance/goal-run-2026-07-09/rental-service-live-acceptance.mjs
```

Live execution requires the pinned project URL/key environment plus a second,
literal confirmation gate:

```bash
QEP_PRODUCTION_ACCEPTANCE_CONFIRM=iciddijgonywtxoelous \
  bun scripts/acceptance/goal-run-2026-07-09/rental-service-live-acceptance.mjs \
  --execute \
  --workspace=default \
  --evidence=test-results/agent-gates/live-rental-service-2026-07-09.json
```

The script loads `.env.local` and `.env` without executing either file. It
refuses any hosted Supabase URL/project ref other than
`iciddijgonywtxoelous`, never logs credentials, uniquely tags every fixture,
and cleans fixture-owned database/auth rows in `finally`.

Rental acceptance is intentionally split into three runs:

1. One exact-money final invoice proves multi-equipment aggregation,
   corrected-assessment supersession, pending-damage exclusion, the legacy
   `equipment_id IS NULL` fallback, source-return audit evidence, and replay.
2. A clean 501-contract cohort proves bounded concurrent batches, durable
   resumption, exact one-invoice-per-period behavior, invoice-number safety,
   and replay with zero new invoices.
3. A three-contract, batch-size-one run gives one returned contract an
   intentional end-before-start clock invariant violation. That item must
   dead-letter while the two lexically later contracts invoice; the terminal
   run must report `failed` honestly.

The runner mirrors invoices into AR and queues QuickBooks GL jobs by design.
The harness checks and deletes those fixture queue rows after every bounded
HTTP batch, fails if any reached `synced`, and removes fixture AR rows during
cleanup. Run this gate during a controlled acceptance window so an external GL
worker cannot race the quarantine step.

Service acceptance creates an ephemeral manager user/JWT because
`service-parts-planner` correctly rejects service-role invocation. Two
concurrent first plans must produce one active submitted commitment; replay
must reuse it; a concurrent quantity-and-vendor change must retire the old
action/line/header and leave exactly one linked replacement.

The live caller must use a current Supabase `sb_secret_` project key (or the
configured internal-service secret) for `rental-billing-runner`; the hardened
service gate intentionally rejects legacy JWT service-role credentials.

Mission alignment: the evidence directly pressure-tests the rental revenue and
service-parts purchasing invariants that keep an equipment sales/rental
operation financially trustworthy, while leaving durable machine-readable
checkpoints for future AI-operated fleet and parts workflows.
