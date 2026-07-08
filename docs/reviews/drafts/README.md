# Stream M/N seed drafts — apply checklist

**Status:** DRAFT, awaiting Brian red-line. These two `.sql` files live under `docs/` deliberately — placing them in `supabase/migrations/` before approval would trip `migrations:check` and `scripts/check-roadmap-source-truth.mjs`.

Source: [2026-07-08 full-codebase review](../2026-07-08-full-codebase-review.md) · [findings JSON (RF-001–RF-203)](../2026-07-08-findings.json) · [Stream M blueprint](../../finance/REVENUE-CONVERGENCE-BLUEPRINT.md)

## What's in the drafts

- `stream-m-seed.sql` — enum label `M` + 7 slices (M0.1–M6.1), Revenue Convergence. M0.1/M6.1 carry `blocking_decision = BLK-FIN-WORKING-SESSION`; everything else is unblocked engineering.
- `stream-n-seed.sql` — enum label `N` + 9 slices (N0.1–N8.1), Seam Completion, **plus** 5 Stream L additions (L9.1–L9.5, rental seam defects — no enum change needed, sort_order continues the L block).

## Apply checklist (in order, after red-line)

1. **Renumber + move**: rename each file to the then-current migration head (`NNN_qep_stream_m_revenue_convergence.sql`, `NNN+1_qep_stream_n_seam_completion.sql`) and move into `supabase/migrations/`. Note: `ALTER TYPE ... ADD VALUE` is irreversible — this is the point of no return for the enum labels.
2. **Update the sync + audit tooling in the same commit** (CI fails otherwise):
   - `roadmap-linear-sync/scripts/lib/status-map.mjs` → add `M: 'Stream M — Revenue Convergence'`, `N: 'Stream N — Seam Completion'` to `STREAM_PROJECT_NAMES`.
   - `roadmap-linear-sync/scripts/regen-unified-roadmap.mjs` → add M/N to `STREAM_LABELS`.
   - `scripts/check-roadmap-source-truth.mjs` → extend `expectedStreams`, `expectedProjectNames`, the two `stream: 'A' | … ` TS-union assertions (and the files they point at), and add seed-count checks for the new migrations (M: 7 rows, N: 9 N-rows + 5 L-rows).
3. **Apply** via the normal `bun run db:push` flow (project `iciddijgonywtxoelous` — verify project identity first, per the mis-pointed-MCP incident).
4. **Linear**: `npm run bootstrap` in `roadmap-linear-sync/` (creates the two new projects + labels), then `npm run import` (mirrors the new rows), then `npm run reconcile` (expect drift = 0) and `npm run regen:roadmap`.
5. **Attach to the finance session**: link the Stream M blueprint §10 decision register into the K3.1 decision-release packet (`docs/operations/QEP_K3.1_FINANCE_DECISION_RELEASE_2026-07-04.md`).
6. Mark `N0.1` shipped once the P0 PR merges **and** migrations 780–782 are applied **and** `equipment-vision` + `portal-api` are redeployed (deploy step is part of done — the L8.c lesson).

## Deliberate scoping choices (for red-line review)

- Rental-anchored seams live in **Stream L (L9.x)**, not N, so they stay with the owning stream and its blueprint.
- The rental **rate floor** is in **M4.1** (it's a margin-governance/finance parity item), while the rental **quote document** is **L9.5** — they pair.
- Commission engine, whole-goods procurement/floor-plan, payroll bridge, and barcode scanning are **not seeded** — they're real missing features (review Part 4) but need owner input first (commission → QA-R2; procurement/floor-plan → finance session; payroll → Stream J extension decision; barcode → Stream G wave). Add them where they land.
- Governance rows (runtime verification R1–R8, 7A depth audit) are one slice (N8.1) rather than 10 rows — split if you want per-gate tracking.
