# IntelliDealer Customer Import Final Reconciliation

Date: 2026-04-30

## Result

The IntelliDealer customer import is committed in production, the Account 360 UI is deployed, and the production smoke test passed against a real imported customer account.

Production target:

- Supabase project: `iciddijgonywtxoelous`
- Netlify production URL: `https://qualityequipmentparts.netlify.app`
- Production deploy ID: `69f3314f2be96fee7b220edc`
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

- `512_intellidealer_company_legacy_search.sql`
- `513_refresh_crm_contacts_contact_profile.sql`

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
- Recent run history and recent import errors.

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
bun run audit:rls-initplan
bun run intellidealer:customer:rerun-check
bun run intellidealer:customer:verify -- df74305e-d37a-4e4b-be5e-457633b2cd1d
bun run intellidealer:production:smoke
git diff --check
```

## Rerun Safety Gate

Before staging or committing the same customer workbook again, run:

```bash
bun run intellidealer:customer:rerun-check
```

The gate compares the current local workbook to the committed production import. It fails if the workbook hash, source row counts, staged counts, mapped counts, import-error count, memo reconciliation, canonical fact counts, or A/R card redaction state no longer match the signed-off run.

## Remaining Follow-Up

The customer import, canonical data load, redaction, deployment, admin dashboard, Account 360 IntelliDealer drill-downs, rerun-safety gate, and UI smoke test are complete.

Recommended next slice:

- Add admin upload, preview, commit, rollback, and row-level export controls so import operations no longer depend on scripts for future runs.
- Migrate legacy Supabase call sites to the regenerated `Database` type slice-by-slice; the shared client remains broad until old JSON/nullability and stale select-shape debt is resolved.
