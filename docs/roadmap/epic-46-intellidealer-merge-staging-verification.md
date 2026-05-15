# Epic #46 — Merge ordering, conflicts, 28-criteria staging verification

**GitHub:** [lewis4x4/qep#46](https://github.com/lewis4x4/qep/issues/46)

## Scope (from Track A index)

IntelliDealer **staging → review → commit** paths, **deterministic merge ordering**, **conflict / error surfacing** in operator UX, and **acceptance verification** before treating a snapshot lane as production-truth.

## Repo anchors

| Concern | Location |
|---------|----------|
| Admin import UI (preview, stage, preflight commit, discard, errors) | `apps/web/src/features/admin/pages/IntelliDealerImportDashboardPage.tsx` |
| Customer import edge (storage → run → errors → `commit_intellidealer_customer_import`) | `supabase/functions/intellidealer-customer-import/index.ts` |
| Snapshot lanes (equipment, parts, quotes history, service history staging tables) | [Epic #43](./epic-43-m365-intellidealer-observability.md) migration **568** tables; provenance `source` e.g. `intellidealer_snapshot_2026-05-14` |
| Snapshot commit script (canonical mapping, stable read order) | `scripts/commit-intellidealer-snapshot-import.mjs` — stage reads ordered by `source_file_name`, `source_row_number` |
| Service-history → PDI commit ordering | `scripts/intellidealer-pdi-actuals.mjs` — same ordering pattern on `qrm_intellidealer_service_history_stage` |
| Customer master stage + optional RPC commit | `scripts/stage-intellidealer-customer-master.py` (`--commit`, `--commit-canonical`); RPC `commit_intellidealer_customer_import` |
| Shared stage helper | `scripts/_shared/intellidealer_snapshot_stage.py` |

## Verification scripts (repo)

Run against a configured Supabase URL + service role unless noted.

| Script | Purpose |
|--------|---------|
| `bun ./scripts/verify-intellidealer-snapshot-stage.mjs` | Non-empty staging counts per lane (`--workspace`, `--source`) or `--jsonl-dir` dry output |
| `bun ./scripts/verify-intellidealer-customer-import.mjs` | Post-stage SQL checks on customer import staging vs canonical |
| `bun ./scripts/verify-intellidealer-customer-rerun-safety.mjs` | Rerun / hash safety after a committed customer import |
| `bun ./scripts/verify/intellidealer-browser-stage-flow.mjs` | Playwright: stage flow, guarded commit, discard (needs env + app URL) |
| `bun ./scripts/verify/intellidealer-canonical-commit-rehearsal.mjs` | Rehearsal pipeline (non-prod by default) |

## “28 criteria” checklist

**Assumption:** The **28-criteria** acceptance set is a **stakeholder / workbook artifact** (e.g. parity worksheet), not fully encoded in this repository. Track the authoritative list in **GitHub #46** (issue body or attachment) and map each criterion to a **script + SQL snapshot** or **UI path** as you close them.

## See also

- [Epic #43 — M365 + IntelliDealer observability](./epic-43-m365-intellidealer-observability.md) (staging table inventory, M365 cron).
- [Epic #45 — Advisor floor](./epic-45-advisor-floor-handoff.md) (downstream rep surfaces that assume clean master data).
