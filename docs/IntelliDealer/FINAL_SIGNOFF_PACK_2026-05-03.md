# IntelliDealer Final Signoff Pack

Date: 2026-05-03

## Verdict

The core IntelliDealer customer import handoff is complete and production-proven.

This means the imported customer data is in the production database, reconciled to the source files, protected from raw A/R card exposure, visible through the intended UI paths, and covered by rerun/production/browser verification evidence.

This does not mean every IntelliDealer-adjacent external dependency is complete. Wave 5 external integrations remain deferred, but the regenerated broader gap-audit inventory now has `0` remaining must-fix blockers.

## Production Baseline

| Item | Value |
| --- | --- |
| Supabase project | `iciddijgonywtxoelous` |
| Production import run | `df74305e-d37a-4e4b-be5e-457633b2cd1d` |
| Import run status | `committed` |
| Import errors | `0` |
| Source workbook SHA-256 | `ade4fbb59632c8dc3bc266b86d80a43c6ecc68476f1e453654cc65cd96ba69f5` |
| Production bundle verified | `/assets/index-BMAFIJPs.js` |
| Smoke account | `TIGERCAT LOGISTICS` |
| Smoke company ID | `0024eed7-05bd-43d2-b4d3-d89f03ab58ea` |
| Legacy customer number | `TIGER001` |

## Data Reconciliation

| Data Set | Count |
| --- | ---: |
| Customer master rows | `5,136` |
| Contacts | `4,657` |
| Contact memo rows | `1,179` |
| A/R agency source rows | `19,466` |
| Profitability source rows | `9,894` |
| Canonical A/R agency rows | `19,466` |
| Canonical profitability facts | `9,894` |
| Raw A/R card rows | `0` |
| Redacted A/R card rows | `347` |

## UI Signoff

The customer handoff UI is complete for the imported customer workflow:

- Account 360 IntelliDealer tab passed on desktop and mobile.
- Companies legacy-number search passed for `TIGER001`.
- Company editor imported profile fields passed.
- Contact editor imported profile fields passed.
- Admin import dashboard passed.
- Safe A/R agencies CSV export passed with `19,467` CSV rows including the header.
- Browser staging flow passed upload preview, stage counts, commit-token guard, direct-commit rejection, discard cleanup, and storage cleanup.

Evidence:

- `docs/IntelliDealer/CUSTOMER_IMPORT_FINAL_RECONCILIATION.md`
- `docs/IntelliDealer/FRESH_PRODUCTION_VERIFICATION_2026-05-03.md`
- `docs/IntelliDealer/UI_COMPLETION_REVIEW_2026-05-03.md`

## Source Custody

Raw IntelliDealer files remain local-only and untracked by policy. They are not committed and should not be treated as centrally retained until a privacy/retention decision approves a controlled storage path. As of 2026-05-04, `.gitignore` explicitly blocks the five raw source files and `COL/` from accidental staging.

Committed custody evidence is sufficient to prove the production import lineage:

- `docs/IntelliDealer/SOURCE_FILE_CUSTODY_MANIFEST.md`
- `bun run intellidealer:source:custody`

The custody verifier binds the local source files to the production import by filename, size, SHA-256, page counts, workbook row counts, and import run ID.

## Verification Commands

Use these commands to reproduce the closeout evidence from the current repo and environment.

| Command | Purpose | Notes |
| --- | --- | --- |
| `bun run intellidealer:source:custody` | Proves local raw files match the custody manifest. | Requires raw files under `docs/IntelliDealer/`. |
| `bun run intellidealer:customer:audit` | Parses workbook/source baseline locally. | Local source validation only; not production database proof. |
| `bun run intellidealer:seed:purge` | Dry-runs non-parts seed purge with parts guards. | Requires Supabase URL and service-role key. |
| `bun run intellidealer:customer:stage -- --commit` | Stages workbook rows into import staging tables. | Mutating. Production canonical commit is intentionally guarded through the admin workflow. |
| `bun scripts/verify/intellidealer-browser-stage-flow.mjs` | Verifies browser upload/stage/preflight/discard flow. | Creates and cleans up a temporary run/upload. |
| `bun run intellidealer:customer:rerun-check` | Verifies the local source still matches the committed production import. | Fails intentionally on source/import drift. |
| `bun run intellidealer:customer:verify -- df74305e-d37a-4e4b-be5e-457633b2cd1d` | Reconciles the production import run. | Read-only production verification. |
| `bun run intellidealer:production:smoke` | Verifies production UI and safe export behavior. | Produces screenshots/download artifacts. |
| `bun run intellidealer:customer:commit-rehearsal` | Runs a non-production canonical commit rehearsal. | Refuses production by default. |
| `bun run db:push` | Checks migration drift. | Dry-run wrapper. |
| `bun run db:push:apply` | Applies pending migrations. | Mutates remote database; use only after review. |
| `node scripts/check-migrations-applied.mjs` | Compares repo migrations with the remote project. | Skips if required Supabase env is missing. |

## Rollback And Recovery

Before canonical commit, rollback is the admin cancel/discard path. The browser stage flow proves discard cleanup leaves no active run and no import storage leftovers.

After a production canonical commit, there is no one-command automated rollback for the customer import. Recovery must be handled through a database backup restore or controlled remediation SQL reviewed against the committed production run ID. This is intentional because deleting canonical customers, contacts, memos, A/R agencies, profitability facts, and external IDs after production use can damage linked records.

Non-parts seed purge apply also requires a database backup first:

```bash
bun run intellidealer:seed:purge -- --apply --confirm-non-parts-seed-purge
```

## Gap-Audit Status

Gap-audit Waves 0-4 are implemented and remote-push verified through `506_*` per `docs/intellidealer-gap-audit/_migration_order.md`. The follow-on must-blocker burndown applied migrations `522` through `525` and regenerated the inventory to `0` remaining must-fix blockers. The non-must cleanup applied migrations `526` through `533`, and follow-on UI/audit wiring reduced the remaining non-must inventory to `1` missing and `2` partial rows. Migration `535_wave5_deferred_provider_registry_seed.sql` was later applied to seed credential-free Wave 5 `pending_credentials` provider-readiness rows only; it does not mark external integrations connected.

Current regenerated inventory:

| Metric | Count |
| --- | ---: |
| Total fields | `847` |
| Built | `844` |
| Partial | `2` |
| Missing | `1` |
| Must | `496` |
| Should | `300` |
| Could | `51` |
| Remaining must-fix blockers | `0` |

Remaining must-fix blockers by phase:

| Phase | Must Missing |
| --- | ---: |
| Phase 1 | `0` |
| Phase 2 | `0` |
| Phase 3 | `0` |
| Phase 4 | `0` |
| Phase 5 | `0` |
| Phase 6 | `0` |
| Phase 8 | `0` |
| Phase 9 | `0` |
| Cross-Cutting | `0` |

Evidence: `docs/IntelliDealer/GAP_AUDIT_MUST_BLOCKER_BURNDOWN_2026-05-03.md`, `docs/IntelliDealer/NON_MUST_GAP_CLEANUP_BURNDOWN_2026-05-03.md`, `docs/intellidealer-gap-audit/manifest.yaml`, and `docs/intellidealer-gap-audit/_blockers.csv`.

## Slice 6 Status

Non-core active API type hardening is complete for the assigned Slice 6 active-code scan.

Evidence:

- `docs/IntelliDealer/NON_CORE_API_TYPE_HARDENING_2026-05-03.md`
- Combined targeted tests: `615 pass`, `0 fail` across `73` files.
- Latest QRM router/rental/decision-room focused tests: `21 pass`, `0 fail`.
- Latest SOP/QRM UI/local plus brief/nervous-system/portal/equipment tests: `34 pass`, `0 fail`.
- Latest QRM shared-lib/FleetRadar/editor tests: `16 pass`, `0 fail`.
- Web typecheck passed.

The final active-code scan is clear except for the intentional central `qrm-supabase` typed-client adapter. Remaining matches are tests or `Customer-strategist.tsx.backup`, which is excluded unless restored into active code.

## Slice 7 Status

Wave 5 external integrations are registered as deferred and are not implemented:

- AvaTax
- VESign / VitalEdge eSign
- UPS WorldShip
- JD Quote II
- OEM base/options imports
- Tethr telematics

Evidence:

- `docs/IntelliDealer/WAVE_5_DEFERRED_INTEGRATION_REGISTER_2026-05-03.md`
- `supabase/migrations/535_wave5_deferred_provider_registry_seed.sql`

These integrations require external credentials, dealer-specific scope, provider contracts, owner decisions, and dedicated test/cutover plans before implementation. The provider-readiness registry rows are intentionally `pending_credentials`; they are not blockers for the core customer import.

## Known Residuals

- Raw IntelliDealer source files remain intentionally untracked until privacy/retention is decided.
- Wave 5 integrations are deferred and must not be represented as shipped; only credential-free readiness rows are seeded.
- The broader gap-audit inventory has `0` remaining must-fix blockers, with `1` non-must missing row and `2` non-must partial rows left for external integration/workflow roadmap prioritization.
- Old `test-results/agent-gates/*` artifacts referenced by the gap-audit docs are missing from the current working tree and need recovery or replacement with fresh evidence if an auditor requires those original artifacts.

## Closeout Gate

PASS for Slice 8.

The repo now answers:

- What IntelliDealer customer data is live in production.
- Which source files produced it.
- How to verify it again.
- Which UI paths are ready for operators.
- Which integrations are intentionally deferred.
- Which broader gap-audit blockers remain outside the core customer import.
