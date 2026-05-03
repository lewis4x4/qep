# IntelliDealer Handoff Closeout Control

Date: 2026-05-03

## Purpose

This is the control document for closing the IntelliDealer handoff without mixing three different scopes:

- Core customer import from `Customer Master.xlsx`, `CUST CONTACTS.pdf`, `CUST AR AGENCY.pdf`, and `CUST PROFITABILITY.pdf`.
- IntelliDealer-to-QEP gap-audit schema waves 0-4.
- Deferred dealer/OEM integrations that require external credentials or dealer-specific scope.

If another document conflicts with this one, treat this document as the current closeout map and fix the stale document.

## Current Verdict

| Area | Status | Evidence | Closeout Meaning |
| --- | --- | --- | --- |
| Core customer import | Complete, production-proven | `CUSTOMER_IMPORT_FINAL_RECONCILIATION.md` | The imported customer data is committed, reconciled, redacted, visible in UI, and smoke-tested against `TIGER001`. |
| Account 360 / Companies / editors / admin import UI | Complete for the customer handoff | `CUSTOMER_IMPORT_FINAL_RECONCILIATION.md`, production smoke screenshots | Operators can find, review, maintain safe imported fields, export safe staged rows, and audit import runs. |
| Gap-audit Waves 0-4 | Implemented and remote-push verified through `506_*` by the 2026-04-27 cutover gate | `docs/intellidealer-gap-audit/_migration_order.md` | Core schema, reporting views, sensitive-field hardening, and computed/reporting surfaces were shipped for the gap-audit waves. |
| Customer import migrations `508_*`-`519_*` | Applied remotely per the final reconciliation | `CUSTOMER_IMPORT_FINAL_RECONCILIATION.md` | Customer import staging, dashboard, storage, redaction, counts RPC, and commit transition guard are part of the production baseline. |
| Latest local migration range | Present locally through `521_floor_customer_legacy_search_layouts.sql` | `supabase/migrations/` | Migrations after `519_*` must be treated by their own feature gates; they are not required to prove the core customer import. |
| Wave 5 external integrations | Deferred, not complete | `_migration_order.md` Wave 5 status | AvaTax live wiring, VESign, UPS WorldShip, OEM imports, and Tethr are intentionally not marked complete. |
| Audit manifest / YAML inventory | Regenerated 2026-05-03 | `docs/intellidealer-gap-audit/manifest.yaml`, `_blockers.csv`, phase YAMLs | The inventory now reflects the current `Database` type under a conservative table/column-exists rule. Remaining blocker count is `91` must-fix rows. |
| Raw source file custody | Manifested 2026-05-03 | `SOURCE_FILE_CUSTODY_MANIFEST.md` | The raw files remain untracked, but filename, size, SHA-256, page counts, workbook row counts, and import run binding are now committed and script-verifiable. |
| Fresh production verification | Passed 2026-05-03 | `FRESH_PRODUCTION_VERIFICATION_2026-05-03.md` | Rerun safety, production reconciliation, production browser smoke, storage cleanup, and active-run checks passed against the current production bundle. |
| UI completion review | Passed 2026-05-03 | `UI_COMPLETION_REVIEW_2026-05-03.md` | Account 360, Companies search, company/contact editors, admin dashboard, safe export download, browser stage, preflight rejection, discard, and cleanup are verified. |
| Non-core API type hardening | In progress 2026-05-03 | `NON_CORE_API_TYPE_HARDENING_2026-05-03.md` | Hardened ops payment validation, service labor pricing, QRM approval-center, service agreement, vendor profile, exec shared-data/metric drill, Floor customer/serial/health widget, Floor operational widget, owner dashboard API, Floor role-home, parts companion pricing/replenish/supplier-health/post-sale/intelligence/core/import/voice API, and portal fleet/doc/history row/payload shapes with targeted tests and web typecheck. |

## Production Customer Import Baseline

Authoritative import run:

- Supabase project: `iciddijgonywtxoelous`
- Import run ID: `df74305e-d37a-4e4b-be5e-457633b2cd1d`
- Workbook SHA-256: `ade4fbb59632c8dc3bc266b86d80a43c6ecc68476f1e453654cc65cd96ba69f5`
- Smoke account: `TIGERCAT LOGISTICS`
- Smoke company ID: `0024eed7-05bd-43d2-b4d3-d89f03ab58ea`
- Legacy customer number: `TIGER001`

Baseline counts:

| Data Set | Count |
| --- | ---: |
| Customer master rows mapped | `5,136` |
| Contacts mapped | `4,657` |
| Contact memo rows staged | `1,179` |
| Nonblank contact memo rows | `57` |
| A/R agency rows mapped | `19,466` |
| Profitability rows mapped | `9,894` |
| Canonical A/R agency rows | `19,466` |
| Canonical profitability facts | `9,894` |
| Import errors | `0` |
| Raw A/R card rows | `0` |
| Redacted A/R card rows | `347` |

## What Is Complete

- Positional source parsing for the customer workbook/PDF-derived sheets.
- Lossless staging tables for customer master, contacts, contact memos, A/R agencies, profitability, and import errors.
- Canonical commit into QRM companies, contacts, company/contact links, memos, A/R agencies, customer A/R agency assignments, profitability facts, and external IDs.
- Non-parts seed purge tooling with parts-table guards.
- A/R card redaction guard and verification that no raw A/R card values remain in canonical rows.
- Browser upload preview, protected staging, commit preflight token, direct-commit rejection, discard/cancel path, safe CSV exports, and dashboard counts RPC.
- Database transition guard blocking `committing` unless the run is already `staged`.
- Rerun safety gate and non-production canonical commit rehearsal gate.
- Account 360 IntelliDealer tab and drill-downs.
- Companies legacy customer-number search and `IntelliDealer #` export.
- Company editor safe imported profile maintenance fields.
- Contact editor safe imported profile maintenance fields.
- Production smoke coverage for desktop Account 360, mobile Account 360, Companies legacy search, company editor, contact editor, and admin import dashboard.
- Gap-audit schema waves 0-4, including EIN, foundation tables, column extensions, FK/status hardening, sensitive-field guards, and reporting views.

## What Is Not Complete

These are not customer-import blockers, but they must not be represented as done:

- Raw IntelliDealer source files remain untracked by policy until a privacy/retention decision approves committing or moving them to controlled private storage.
- Wave 5 integrations are deferred until credentials and dealer-specific scope are available.
- Remaining non-core raw Supabase row casts still need slice-by-slice normalization if the goal is broader API hardening.
- The old `test-results/agent-gates/*` evidence referenced by `_migration_order.md` is not present in the current working tree; either recover those artifacts or replace them with fresh gate outputs.

## Remaining Roadmap

### Slice 2: Regenerate Audit Inventory

Status: complete 2026-05-03.

Goal: turn the gap-audit bundle back into a live dashboard.

Deliverables:

- Reconcile phase YAML entries against `apps/web/src/lib/database.types.ts`.
- Mark completed fields `BUILT` with current schema evidence where the declared table/view and column now exist.
- Regenerate `manifest.yaml`.
- Regenerate `_blockers.csv`.
- Produce remaining blocker counts by phase.

Gate:

- PASS. The remaining counts now reflect the current generated `Database` type under the conservative reconciliation rule.

Result:

- Total fields: `847`.
- Built fields: `678`.
- Partial fields: `18`.
- Missing fields: `151`.
- Remaining must-fix blockers: `91`.

Remaining must-fix blockers by phase:

| Phase | Must Missing |
| --- | ---: |
| Phase-1 CRM | `1` |
| Phase-2 Sales Intelligence | `0` |
| Phase-3 Parts | `3` |
| Phase-4 Service | `3` |
| Phase-5 Deal Genome | `39` |
| Phase-6 Rental | `35` |
| Phase-8 Financial Operations | `6` |
| Phase-9 Advanced Intelligence | `3` |
| Cross-Cutting | `1` |

### Slice 3: Source File Custody

Status: complete 2026-05-03.

Goal: make the customer import reproducible without exposing sensitive data unnecessarily.

Deliverables:

- Create a committed source manifest with filename, size, SHA-256, expected row counts, and import run ID.
- Add a repeatable custody verifier: `bun run intellidealer:source:custody`.
- Keep raw files untracked unless a separate privacy/retention decision approves a different storage path.
- Bind the manifest to import run `df74305e-d37a-4e4b-be5e-457633b2cd1d`.

Gate:

- PASS. A reviewer can prove which source files produced the production import, while the raw files remain outside Git.

### Slice 4: Fresh Production Verification

Status: complete 2026-05-03.

Goal: prove production still matches the signed-off customer handoff after later code/deploy work.

Deliverables:

- Run `bun run intellidealer:customer:rerun-check`.
- Run `bun run intellidealer:customer:verify -- df74305e-d37a-4e4b-be5e-457633b2cd1d`.
- Run `bun run intellidealer:production:smoke`.
- Confirm no active import runs or import storage leftovers remain.
- Record current production bundle evidence.

Gate:

- PASS. Production verification passed with zero import errors, expected counts, no raw A/R card rows, no active import runs, no import storage leftovers, and production bundle `/assets/index-BMAFIJPs.js`.

### Slice 5: UI Completion Review

Status: complete 2026-05-03.

Goal: verify the user-facing workflow, not just data presence.

Deliverables:

- Account 360 imported customer walkthrough.
- Companies legacy-number search walkthrough.
- Company editor safe-field persistence walkthrough.
- Contact editor safe-field persistence walkthrough.
- Admin import dashboard export/preview/stage/commit/discard control walkthrough.
- Mobile Account 360 walkthrough.

Gate:

- PASS. A rep/admin can operate the imported customer data without database access. The production smoke also downloads the safe A/R agencies CSV and proves sensitive/internal columns and stored card redaction tokens are excluded.

### Slice 6: Non-Core API Type Hardening

Status: in progress 2026-05-03. First hardening pass complete.

Goal: reduce runtime risk from stale Supabase row assumptions.

Deliverables:

- Normalize remaining high-risk QRM/admin API row shapes.
- Add unit tests for each normalizer.
- Leave metadata-only casts only where documented as low risk.

Gate:

- No core customer or Account 360 path depends on unchecked raw row shape assumptions.

Current result:

- Ops payment validation history rows now use `normalizeValidationHistoryRows`.
- Service labor pricing branch config, company options, and pricing rule rows now use exported normalizers.
- QRM approval center margin, deposit, trade, demo, and quote approval rows now use exported normalizers.
- Service agreement list/detail rows, company/equipment options, and maintenance schedule rows now use exported normalizers.
- Vendor profiles, escalation policies, portal keys, vendor submissions, and active vendor price rows now use exported normalizers.
- Exec metric definitions, KPI snapshots, metric drill snapshot history, and analytics alert rows now use exported normalizers.
- Floor customer search, serial-first lookup, and customer-health profile rows now use exported normalizers.
- Floor morning brief, customer parts intel, pending invoice, and supplier health rows now use exported normalizers.
- Owner dashboard summary, ownership health, event feed, branch ranking, predictive intervention, ask-anything, morning brief, and team signal payloads now use exported normalizers.
- Floor role-home quote, counter inquiry, margin, SLA, approval decision, service job, and joined-deal rows now use exported normalizers.
- Parts companion pricing summary, active rules, pending suggestions, preview, create-rule response, and mutation result counts now use exported normalizers.
- Parts companion replenish summary, enriched queue rows, and mutation result counts now use exported normalizers.
- Parts companion supplier health summary, risk vendor, price creep, fill-rate, and detail rows now use exported normalizers.
- Parts companion post-sale playbook summary, eligible deals, generation responses, detail payloads, windows, and parts now use exported normalizers.
- Parts companion intelligence summary, predictive plays, run results, AI prediction, embed backfill, action-play, and AI timeout recovery rows now use exported normalizers.
- Parts companion core queue, activity, machine profile, counter inquiry, and preference rows now use exported normalizers.
- Parts companion import preview, commit, dashboard, import run, conflict, and bulk-resolution payloads now use exported normalizers.
- Parts companion voice ops edge responses now use an exported normalizer.
- Portal fleet map/detail, document library, and reorder history rows now use exported normalizers.
- Targeted tests passed: `94 pass`, `0 fail`.
- Web typecheck passed.

### Slice 7: Wave 5 Deferred Integration Register

Goal: make deferred external dependencies explicit.

Deliverables:

- One register row each for AvaTax, VESign, UPS WorldShip, JD Quote II, OEM base/options imports, and Tethr.
- For each row: credentials needed, owner, target UI, schema status, API dependency, test plan, and cutover impact.

Gate:

- Deferred work is intentionally parked with owners and prerequisites, not lost.

### Slice 8: Final Signoff Pack

Goal: close the handoff with one evidence bundle.

Deliverables:

- This closeout control document updated with final statuses.
- Regenerated gap inventory.
- Source custody manifest.
- Fresh production verification output.
- UI smoke evidence.
- Deferred integration register.
- Rerun and rollback procedure.

Gate:

- The repo can answer what is live, what data is in production, what was verified, what is deferred, and what remains.
