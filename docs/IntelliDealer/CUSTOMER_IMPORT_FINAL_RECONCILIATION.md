# IntelliDealer Customer Import Final Reconciliation

Date: 2026-04-30

## Result

The IntelliDealer customer import is committed in production, the Account 360 UI is deployed, and the production smoke test passed against a real imported customer account.

Production target:

- Supabase project: `iciddijgonywtxoelous`
- Netlify production URL: `https://qualityequipmentparts.netlify.app`
- Production deploy ID: `69f2aa525743004518b5f738`
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

- `510_intellidealer_ar_card_redaction.sql`

## UI Readiness

The deployed Account 360 surfaces now include an `IntelliDealer` tab on:

- `/qrm/accounts/:accountId/command`
- `/qrm/companies/:companyId`

The tab renders:

- IntelliDealer source identity and legacy customer number.
- A/R type, terms, pricing level, territory, branch, salesperson, and business class.
- Imported A/R agency assignments with card values shown only as `Card redacted`.
- Imported profitability totals and area breakdowns.

The browser query intentionally does not select `card_number`.

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
| Desktop Account 360 IntelliDealer tab | PASS |
| Mobile Account 360 IntelliDealer tab | PASS |
| Visible redacted card rows | `4` |
| Console errors | `0` |

Screenshots:

- `test-results/intellidealer-production-smoke/account-intellidealer-desktop.png`
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
bun run intellidealer:customer:verify -- df74305e-d37a-4e4b-be5e-457633b2cd1d
bun run intellidealer:production:smoke
git diff --check
```

## Remaining Follow-Up

The customer import, canonical data load, redaction, deployment, and UI smoke test are complete.

Recommended next slice:

- Add an admin import dashboard for run history, row counts, warnings, and reconciliation exports.
- Regenerate Supabase TypeScript types after the final IntelliDealer schema stabilizes.
