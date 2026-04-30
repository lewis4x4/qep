# IntelliDealer Customer Import Final Reconciliation

Date: 2026-04-30

## Result

The IntelliDealer customer import is committed in production, the Account 360 UI is deployed, and the production smoke test passed against a real imported customer account.

Production target:

- Supabase project: `iciddijgonywtxoelous`
- Netlify production URL: `https://qualityequipmentparts.netlify.app`
- Production deploy ID: `69f36c6b6c2b090061daf140`
- Import run ID: `df74305e-d37a-4e4b-be5e-457633b2cd1d`

## Production Reconciliation

Read-only production verification returned:

| Check | Result |
| --- | ---: |
| Import run status | `committed` |
| Import errors | `0` |
| Mapped customer master rows | `5,136` |
| Mapped contacts | `4,657` |
| Staged contact memo rows | `1,179` |
| Staged nonblank contact memos | `57` |
| Unique staged company/body memo pairs | `52` |
| Canonical company memos matching staged memos | `57` |
| Unique staged memos missing canonical | `0` |
| Mapped A/R agency rows | `19,466` |
| Mapped profitability rows | `9,894` |
| Canonical A/R agency rows | `19,466` |
| Canonical profitability facts | `9,894` |
| Raw A/R card rows | `0` |
| Redacted A/R card rows | `347` |

The latest local migration is applied remotely:

- `514_intellidealer_customer_import_storage.sql`
- `515_intellidealer_import_dashboard_metadata.sql`
- `516_intellidealer_import_staging_status.sql`
- `517_intellidealer_dashboard_mapped_count_indexes.sql`
- `518_intellidealer_dashboard_counts_rpc.sql`
- `519_intellidealer_commit_transition_guard.sql`

## UI Readiness

The deployed Account 360 surfaces now include an `IntelliDealer` tab on:

- `/qrm/accounts/:accountId/command`
- `/qrm/companies/:companyId`

The tab renders:

- IntelliDealer source identity and legacy customer number.
- A/R type, terms, pricing level, territory, branch, salesperson, and business class.
- Imported A/R agency assignments with card values shown only as `Card redacted`.
- Imported profitability totals and area breakdowns.
- Controlled drill-downs for memo history, full A/R agency assignment detail, and profitability period metrics.

The browser query intentionally does not select `card_number`.

The deployed Companies surface at `/qrm/companies` now supports imported IntelliDealer lookup:

- Search by legacy customer number, including `TIGER001`.
- Visible `IntelliDealer <legacy #>` source badge on imported company rows.
- Company CSV export includes `IntelliDealer #`.

The deployed company editor now supports safe post-cutover maintenance of imported profile fields:

- Read-only IntelliDealer legacy customer number for traceability.
- Editable status, product category, A/R type, payment terms, terms code, territory code, pricing level, do-not-contact, and sale-PI opt-out.
- Sensitive card, credit, and redaction-token values remain excluded from the editor.

The updated `qrm-router` edge function is deployed so those editor fields persist through the production router API.

The deployed contact editor now supports safe post-cutover maintenance of imported contact fields:

- Read-only IntelliDealer customer/contact source numbers for traceability.
- Editable cell phone, direct phone, birth date, and SMS opt-in.
- Raw imported row metadata and memo bodies remain excluded from the editor.

The admin import dashboard is deployed at:

- `/admin/intellidealer-imports`

The dashboard renders:

- Latest run status and source file name.
- Source SHA-256 fingerprint and run id.
- Source, staged, mapped, and delta counts.
- Operational readiness checks for commit status, stage counts, errors, memo reconciliation, and card redaction.
- Row-level CSV export controls for safe staged customer master, contacts, memos, A/R agency assignments, profitability, and import-error rows.
- Upload-preview controls for browser-auditing a new `.xlsx`, storing it in a private bucket, and recording an audit-only preview run.
- Protected staging controls that reuse the browser-audited workbook rows, start staging through the `intellidealer-customer-import` edge gate, insert stage rows in 100-row chunks with retry through Supabase RLS, and complete staging only after exact source/stage counts match.
- Commit from uploaded preview remains gated until a run reaches `staged`; staged runs require a passing commit preflight, a fresh server-side preflight token, and exact-run-id confirmation before canonical commit.
- The preflight token expires after 15 minutes. Only its SHA-256 hash is stored in run metadata; direct edge `commit` calls without the token are rejected.
- The database rejects any IntelliDealer run transition into `committing` unless the previous status was `staged`.
- Browser-staged runs can be discarded from the dashboard, which clears staging rows and marks the run cancelled without touching canonical customer data.
- Recent run history and recent import errors.

The dashboard count path uses `qrm_intellidealer_customer_import_run_counts`, a count-only elevated RPC, so the browser no longer depends on the RLS-heavy reconciliation view and does not receive sensitive A/R card row data.

The browser staging production exercise recorded test run `e3191613-9d2f-4ed4-a3db-26139f3e3af6`, loaded exact stage counts (`5,136` master, `4,657` contacts, `1,179` memos, `19,466` A/R agencies, `9,894` profitability), completed the run to `staged`, verified direct commit without a preflight token was rejected with HTTP `409`, ran the dashboard commit preflight, verified zero import errors, confirmed the duplicate committed source-hash warning for the same workbook, confirmed the UI displayed token expiration, exercised the dashboard discard control, verified the run changed to `cancelled`, verified `0` staged rows remained, and recorded zero browser console or 5xx response errors. The test run and uploaded workbook object were deleted. The committed production run remains the operational baseline.

## Production Browser Smoke

Command:

```bash
bun run intellidealer:production:smoke
```

Smoke account:

- Company: `TIGERCAT LOGISTICS`
- Company ID: `0024eed7-05bd-43d2-b4d3-d89f03ab58ea`
- Legacy customer number: `TIGER001`

Evidence:

| Check | Result |
| --- | --- |
| Desktop Account 360 IntelliDealer tab and drill-downs | PASS |
| Companies legacy-number search | PASS |
| Company editor IntelliDealer profile | PASS |
| Contact editor IntelliDealer profile | PASS |
| Admin IntelliDealer import dashboard | PASS |
| Mobile Account 360 IntelliDealer tab | PASS |
| Visible redacted card rows | `4` |
| Console errors | `0` |

Screenshots:

- `test-results/intellidealer-production-smoke/account-intellidealer-desktop.png`
- `test-results/intellidealer-production-smoke/companies-legacy-search.png`
- `test-results/intellidealer-production-smoke/company-editor-intellidealer-profile.png`
- `test-results/intellidealer-production-smoke/contact-editor-intellidealer-profile.png`
- `test-results/intellidealer-production-smoke/admin-intellidealer-imports.png`
- `test-results/intellidealer-production-smoke/account-intellidealer-mobile.png`

## Memo Reconciliation

`CUST CONTACTS.pdf` contained `1,179` staged memo rows. Production reconciliation shows:

- All `1,179` source rows are retained in staging.
- `57` staged rows contain nonblank memo text.
- `52` unique company/body memo pairs exist after collapsing repeated same-text rows for the same company.
- `57` canonical `qrm_company_memos` rows match staged memo text.
- `0` unique staged memo bodies are missing from canonical.

No memo promotion is required for data completeness. If the UI should suppress repeated same-text memo rows for the same company, that should be handled as a display/deduping enhancement or a separate controlled cleanup with source-row metadata retained.

## Validation Commands

Passing checks:

```bash
bun run build:web
bun run migrations:check
bun run audit:edges
bun scripts/verify/intellidealer-browser-stage-flow.mjs
bun run intellidealer:customer:rerun-check
bun run intellidealer:customer:commit-rehearsal
bun run intellidealer:customer:verify -- df74305e-d37a-4e4b-be5e-457633b2cd1d
bun run intellidealer:production:smoke
git diff --check
```

Additional production guard check passed: a temporary audited run could not transition directly to `committing`; PostgreSQL raised `INTELLIDEALER_COMMIT_REQUIRES_STAGED_RUN`, and the temporary run was deleted.

The canonical commit rehearsal command is intentionally a non-production gate. It refuses the production Supabase project by default, stages the workbook in 100-row batches, runs the canonical commit in the target clone, and verifies exact staged, mapped, canonical, memo, A/R redaction, and profitability counts.

## Rerun Safety Gate

Before staging or committing the same customer workbook again, run:

```bash
bun run intellidealer:customer:rerun-check
```

The gate compares the current local workbook to the committed production import. It fails if the workbook hash, source row counts, staged counts, mapped counts, import-error count, memo reconciliation, canonical fact counts, or A/R card redaction state no longer match the signed-off run.

## Remaining Follow-Up

The customer import, canonical data load, redaction, deployment, admin dashboard, protected browser staging, commit preflight token enforcement, database commit-transition guard, staged-run discard control, safe row-level export controls, Account 360 IntelliDealer drill-downs, rerun-safety gate, non-production canonical commit rehearsal gate, and UI smoke test are complete.

Recommended next slice:

- Migrate legacy Supabase call sites to the regenerated `Database` type slice-by-slice; the shared client remains broad until old JSON/nullability and stale select-shape debt is resolved.
