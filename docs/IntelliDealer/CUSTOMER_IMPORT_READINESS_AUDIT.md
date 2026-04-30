# IntelliDealer Customer Import Readiness Audit

Date: 2026-04-29

## Scope

Source files:

- `CMASTR.pdf`
- `Customer Master.xlsx`
- `CUST PROFITABILITY.pdf`
- `CUST CONTACTS.pdf`
- `CUST AR AGENCY.pdf`

Repo surfaces audited:

- Customer/QRM schema, migrations, RLS, and compatibility views
- Existing customer/import edge functions and scripts
- QRM company/contact UI, Account 360, admin data-quality/error UI

## Source Data Verdict

The delivered workbook is internally consistent and importable with positional column mapping.

Audit command:

```bash
bun run intellidealer:customer:audit
```

Latest result:

- Workbook SHA-256: `ade4fbb59632c8dc3bc266b86d80a43c6ecc68476f1e453654cc65cd96ba69f5`
- `MAST`: 5,136 rows, 5,136 unique customer keys
- `CONTACTS`: 4,657 rows, all customer keys match `MAST`
- `Cust Contact Memos`: 1,179 rows, all customer/contact keys match
- `AR AGENCY`: 19,466 rows, all customer keys match `MAST`
- `PROFITABILITY`: 9,894 rows, all customer keys match `MAST`

Primary key model:

- Customer: `Company + Division + Customer Number`
- Contact: `Company + Division + Customer Number + Contact Number`
- Contact memo: `Company + Division + Customer Number + Contact Number + Sequence Number`
- A/R agency: `Company + Division + Customer Number + Agency Code + Card Number`
- Profitability: `Company + Division + Customer Number + Area`

Important source warnings:

- `MAST` has duplicate header text: `Mailing Code` appears twice.
- `CONTACTS` has duplicate header text: `Area` appears three times.
- Import code must use positional mapping, not simple header-name mapping.
- Customer numbers must remain text; they contain spaces and symbols.
- Company, division, branch, location, county, salesperson, and agency codes must remain text to preserve leading zeros.
- Date `0` means null. Customer/contact dates are `YYYYMMDD`; A/R agency expiry is `YYYYMM`.
- Blank customer status means active. `D` means deleted; `X` means prospect.
- A/R card values are mostly placeholders (`*` or `?`) and must not be credit-card validated.

## Implemented In This Audit

Migration added:

- `supabase/migrations/508_intellidealer_customer_import_staging.sql`
- `supabase/migrations/509_intellidealer_ar_type_true_balance_forward.sql`
- `supabase/migrations/510_intellidealer_ar_card_redaction.sql`

Database additions:

- `qrm_intellidealer_customer_import_runs`
- `qrm_intellidealer_customer_master_stage`
- `qrm_intellidealer_customer_contacts_stage`
- `qrm_intellidealer_customer_contact_memos_stage`
- `qrm_intellidealer_customer_ar_agency_stage`
- `qrm_intellidealer_customer_profitability_stage`
- `qrm_intellidealer_customer_import_errors`
- `qrm_customer_ar_agencies`
- `qrm_customer_profitability_import_facts`

Compatibility fix:

- `public.ar_type` now includes `true_balance_forward` for IntelliDealer A/R type `T`.
- `commit_intellidealer_customer_import(run_id)` commits staged rows into canonical QRM tables.

Audit tooling added:

- `scripts/audit-intellidealer-customer-master.py`
- `scripts/stage-intellidealer-customer-master.py`
- `scripts/purge-non-parts-seed-data.mjs`
- `scripts/commit-intellidealer-customer-import.mjs`
- `scripts/verify-intellidealer-customer-import.mjs`
- `scripts/verify-intellidealer-customer-rerun-safety.mjs`
- `scripts/verify/intellidealer-production-smoke.mjs`
- `package.json` script: `intellidealer:customer:audit`
- `package.json` script: `intellidealer:customer:stage`
- `package.json` script: `intellidealer:customer:commit`
- `package.json` script: `intellidealer:customer:verify`
- `package.json` script: `intellidealer:customer:rerun-check`
- `package.json` script: `intellidealer:production:smoke`
- `package.json` script: `intellidealer:seed:purge`

## Production Execution Update

Date: 2026-04-30

Production import is complete and verified. See `docs/IntelliDealer/CUSTOMER_IMPORT_FINAL_RECONCILIATION.md`.

Verified production results:

- Import run `df74305e-d37a-4e4b-be5e-457633b2cd1d` is `committed`.
- Customer master mapped: 5,136 / 5,136.
- Contacts mapped: 4,657 / 4,657.
- A/R agency rows mapped: 19,466 / 19,466.
- Profitability rows mapped: 9,894 / 9,894.
- Import errors: 0.
- Raw A/R card rows: 0.
- Account 360 IntelliDealer tab, Companies legacy search, and admin import dashboard deployed to Netlify production deploy `69f2b8e2be107d80333f8a82`.
- Authenticated desktop, mobile, companies-search, and admin-dashboard production smoke tests passed.
- Rerun safety gate added with `bun run intellidealer:customer:rerun-check`.

Memo reconciliation:

- `Cust Contact Memos` staged rows: 1,179.
- Nonblank staged memo rows: 57.
- Unique staged company/body memo pairs: 52.
- Canonical company memos matching staged memos: 57.
- Unique staged memo bodies missing canonical: 0.
- No memo promotion is required for data completeness.

## Seed Data Purge Policy

Approved operator policy:

- Delete known seed/demo data before live IntelliDealer import.
- Preserve all parts-related data.
- Do not use `service-parts-seed.mjs reset`; it deletes protected parts tables.

Safe purge command:

```bash
bun run intellidealer:seed:purge
```

Apply command, after the dry run is reviewed and a database backup exists:

```bash
bun run intellidealer:seed:purge -- --apply --confirm-non-parts-seed-purge
```

The purge script has a hard guard against `parts_*`, `_parts_`, `vendor_part_catalog`, and `customer_parts_intelligence` tables. It also defers non-parts rows that can still be referenced by protected parts rows, including demo CRM companies, portal customers, service jobs, vendor profiles, branch config, branch directory rows, and demo user profiles. Those deferred rows should be removed only after preserved parts rows are remapped to imported IntelliDealer customers/users or a specific nulling policy is approved.

## Current Readiness

Ready:

- Source workbook can be parsed locally without third-party spreadsheet libraries.
- All source child rows join to the customer master.
- Database now has a lossless staging home for every workbook row and raw source column.
- A dry-run-by-default staging importer now exists; it writes to Supabase only with `--commit`.
- A dry-run-by-default seed purge now exists for known non-parts seed data, with parts-table protections.
- A database-side canonical commit function now upserts companies, contacts, contact links, memos, agencies, customer-agency assignments, imported profitability facts, and external IDs.
- Database now has canonical one-to-many customer A/R agency assignments.
- Database now has canonical imported profitability facts separate from QEP-computed profitability.
- RLS policies are in place for the new import and fact tables.
- Companies list/search now supports IntelliDealer legacy customer number lookup and displays imported source badges.
- Account 360 now exposes source identity, contact coverage, A/R exposure, profitability posture, and next-best-action operating signals.

Still to harden:

- Supabase TypeScript types have been regenerated from production, but the shared browser client remains broadly typed until legacy JSON/nullability and stale select-shape debt is migrated slice-by-slice.
- Admin import UI is read-only; it does not yet support upload, preview, commit, rollback, or row-level export.
- QRM company/contact editor UI exposes only a subset of the imported fields.
- Deferred non-parts seed support rows that protected parts data still references remain intentionally preserved until a remap/nulling policy is approved.

## Required Next Work

1. Run the non-parts seed purge dry run against the target database.

   After service-role credentials are available, run `bun run intellidealer:seed:purge`. Review protected parts counts and deferred rows before any apply.

2. Apply the approved non-parts seed purge.

   After a target database backup exists, run `bun run intellidealer:seed:purge -- --apply --confirm-non-parts-seed-purge`.

3. Run the staging importer against the target database.

   After migration `508` is applied and service-role credentials are available, run `bun run intellidealer:customer:stage -- --commit`.

4. Review staged run counts and commit canonical rows.

   Use `--commit-canonical` on the staging script or call `commit_intellidealer_customer_import(run_id)` after reviewing the staging run.

5. Add import preview/admin UI.

   Minimum required views: run summary, row counts, warnings, duplicate/conflict list, sample rows, commit button, failed-row export, and rollback/cancel state.

6. Extend customer UI/API surfaces.

   Remaining display/edit coverage: company/contact edit forms, tax/terms maintenance, pricing group/level editability, memo history surfacing, and controlled A/R agency/profitability drill-down beyond Account 360.

7. Keep Supabase types current after migration application.

   Run `bun run supabase:types` against local DB or `bun run supabase:types:remote` against the target project after schema changes.

## End-to-End Slice Plan

1. Policy lock

   Finalize import behavior for deleted `D` customers, prospect `X` customers, generic `Primary Contact` rows, A/R card redaction/tokenization, and default profitability area.

2. Target backup and seed purge

   Snapshot the target database, dry-run `intellidealer:seed:purge`, apply only eligible non-parts deletes, and verify protected parts counts did not change. Defer support rows that protected parts data still references.

3. Database foundation

   Apply migrations `508` and `509`, regenerate types, and verify RLS/security checks.

4. Import control room UI

   Add admin upload/preview/run-detail screens before production import: counts, warnings, conflict samples, apply button, failure export, and run status.

5. Test stage

   Stage the workbook into target staging tables, verify exact row counts against the audit baseline, and block commit if any stage count or FK check differs.

6. Test canonical commit

   Run `commit_intellidealer_customer_import(run_id)` in a controlled target/staging environment and reconcile created/updated companies, contacts, memos, A/R agencies, profitability facts, and external ID maps.

7. Reconciliation UI and reports

   Show source-vs-stage-vs-canonical counts, field-level exception buckets, unresolved decisions, and protected parts count comparisons.

8. Customer operator UI

   Extend customer list/search, Account 360, company edit, contact edit, A/R agency display, profitability display, and memo history so imported data is visible and operational.

9. Parts remap and deferred seed cleanup

   Remap preserved parts rows away from demo CRM/portal/customer/user references where possible, then remove deferred seed support rows with a second guarded dry run.

10. UAT and production run

   Execute full dry run, business review, final backup, production seed purge, production stage, production commit, reconciliation sign-off, and post-cutover monitoring.

## Decisions Needed Before Live Import

- Whether deleted `D` customers should be imported as soft-deleted, imported as inactive, or excluded from canonical QRM while preserved in staging.
- Whether prospect `X` customers should become `qrm_prospects`, `qrm_companies.status = prospect`, or both.
- Whether generic `Primary Contact` rows should be preserved as contacts, converted to company-level default communication fields, or staged only.
- Whether non-placeholder A/R card values are safe to store in the database or must be tokenized/redacted before canonical commit.
- What `Area` code should drive default Account 360 profitability display: likely `T` total, with area drill-down.
