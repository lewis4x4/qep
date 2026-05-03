# IntelliDealer Fresh Production Verification

Date: 2026-05-03

## Scope

This verification re-ran the signed-off IntelliDealer customer import gates against production after the later handoff documentation and audit-inventory cleanup slices.

Production baseline:

- Supabase project: `iciddijgonywtxoelous`
- Netlify production URL: `https://qualityequipmentparts.netlify.app`
- Current production app bundle: `/assets/index-BMAFIJPs.js`
- Production import run ID: `df74305e-d37a-4e4b-be5e-457633b2cd1d`
- Source workbook SHA-256: `ade4fbb59632c8dc3bc266b86d80a43c6ecc68476f1e453654cc65cd96ba69f5`
- Smoke account: `TIGERCAT LOGISTICS`
- Smoke company ID: `0024eed7-05bd-43d2-b4d3-d89f03ab58ea`
- Legacy customer number: `TIGER001`

## Verification Results

| Check | Command / Source | Result |
| --- | --- | --- |
| Source file custody | `bun run intellidealer:source:custody` | PASS |
| Rerun safety gate | `bun run intellidealer:customer:rerun-check` | PASS |
| Production import reconciliation | `bun run intellidealer:customer:verify -- df74305e-d37a-4e4b-be5e-457633b2cd1d` | PASS |
| Production browser smoke | `bun run intellidealer:production:smoke` | PASS |
| Import upload storage leftovers | `intellidealer-customer-imports` bucket listing | PASS: `[]` |
| Active import runs | recent import-run status query | PASS: `[]` |
| Current production bundle | production HTML | PASS: `/assets/index-BMAFIJPs.js` |

## Reconciliation Snapshot

| Metric | Value |
| --- | ---: |
| Run status | `committed` |
| Import errors | `0` |
| Customer master mapped | `5,136` |
| Contacts mapped | `4,657` |
| Contact memo rows staged | `1,179` |
| Nonblank contact memos reconciled | `57` |
| Unique staged memos missing canonical | `0` |
| A/R agency mapped | `19,466` |
| Profitability mapped | `9,894` |
| Canonical A/R agency rows | `19,466` |
| Canonical profitability facts | `9,894` |
| Raw A/R card rows | `0` |
| Redacted card rows | `347` |

## Browser Smoke Evidence

| Check | Route | Screenshot |
| --- | --- | --- |
| Desktop Account 360 IntelliDealer tab | `/qrm/accounts/0024eed7-05bd-43d2-b4d3-d89f03ab58ea/command` | `test-results/intellidealer-production-smoke/account-intellidealer-desktop.png` |
| Companies legacy-number search | `/qrm/companies` with `TIGER001` | `test-results/intellidealer-production-smoke/companies-legacy-search.png` |
| Company editor IntelliDealer profile | `/qrm/companies/0024eed7-05bd-43d2-b4d3-d89f03ab58ea` | `test-results/intellidealer-production-smoke/company-editor-intellidealer-profile.png` |
| Contact editor IntelliDealer profile | `/qrm/contacts/1289e18a-4114-4461-9f8a-c9591cb89ebd` | `test-results/intellidealer-production-smoke/contact-editor-intellidealer-profile.png` |
| Admin IntelliDealer imports dashboard | `/admin/intellidealer-imports` | `test-results/intellidealer-production-smoke/admin-intellidealer-imports.png` |
| Mobile Account 360 IntelliDealer tab | `/qrm/accounts/0024eed7-05bd-43d2-b4d3-d89f03ab58ea/command` | `test-results/intellidealer-production-smoke/account-intellidealer-mobile.png` |

Browser smoke result:

- Verdict: `PASS`
- Visible redacted card rows: `4` desktop, `4` mobile
- Safe A/R export download: `intellidealer-ar-agencies-safe-customer-master-df74305e.csv`, `19,467` CSV rows including header, no sensitive/internal columns, no stored card redaction tokens
- Console errors: `0`

## Residual Notes

- The raw source files remain untracked by policy; custody is proven through `SOURCE_FILE_CUSTODY_MANIFEST.md` and `bun run intellidealer:source:custody`.
- This verification proves the core customer import and customer-facing/admin customer import UI. It does not close Wave 5 external integrations.
