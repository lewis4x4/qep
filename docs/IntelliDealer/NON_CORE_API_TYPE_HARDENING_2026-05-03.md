# Non-Core API Type Hardening

Date: 2026-05-03

## Scope

This is Slice 6 hardening work outside the core IntelliDealer customer import path. The goal is to remove unchecked Supabase row casts from QRM/admin/ops UI surfaces that can break rendering when joined rows, numeric fields, or optional fields arrive in an unexpected shape.

## First Pass Completed

| Surface | Previous Risk | Hardening |
| --- | --- | --- |
| Ops payment validation history | Query result was cast directly to the UI row type. Malformed amounts, dates, booleans, or missing IDs could reach rendering. | Added `normalizeValidationHistoryRows` with required field checks, numeric-string coercion, invalid-date rejection, and malformed-row filtering. |
| Service labor pricing branch defaults | Query result was typed through an unknown Supabase client cast and returned directly. | Added `normalizeServiceLaborBranchConfigRows` with required ID/branch checks and safe numeric coercion. |
| Service labor pricing customer options | Query result was returned directly as company options. | Added `normalizeServiceLaborCompanyOptions` with required ID/name filtering. |
| Service labor pricing rules | Query result was returned directly as pricing rules with joined company data. | Added `normalizeServiceLaborPricingRuleRows` with enum validation, numeric coercion, active-boolean enforcement, and joined company array/object normalization. |
| QRM approval center | Query hook normalized joined relations inline and cast margin, deposit, trade, demo, and quote approval results into UI row types. | Added exported normalizers for all approval query row families with required field checks, numeric-string coercion, valid-date checks, joined relation normalization, route-mode validation, and malformed-row filtering. |
| Service agreements list/detail | List and detail pages defined local row shapes and returned agreement, company, equipment, and maintenance query results directly. | Added exported normalizers for agreement rows, detail rows, company/equipment options, and maintenance schedule rows with required field checks, status validation, numeric-string coercion, and joined relation normalization. |
| Vendor profiles and pricing approvals | Vendor page cast vendor, policy, portal-key, submission, and active-price query results directly into local UI row types. | Added exported normalizers for vendor rows, escalation policies, portal access keys, vendor submissions, and active vendor prices with required field checks, numeric-string coercion, status validation, supplier-type fallback, and joined vendor normalization. |
| Executive shared data hook and metric drill drawer | Metric definitions, latest KPI snapshots, metric drill snapshot history, and analytics alerts were returned directly from unknown Supabase/RPC payloads. | Added exported exec normalizers with required field checks, role/status/severity/refresh-state validation, numeric-string coercion, string-array cleanup, metadata/config object guards, and reduced snapshot-history validation. |

## Verification

Commands run:

```bash
bun test src/features/ops/lib/payment-validation-history.test.ts src/features/service/lib/service-labor-pricing-utils.test.ts
bun test src/features/ops/lib/payment-validation-history.test.ts src/features/service/lib/service-labor-pricing-utils.test.ts src/features/qrm/command-center/lib/approvalTypes.test.ts
bun test src/features/ops/lib/payment-validation-history.test.ts src/features/service/lib/service-labor-pricing-utils.test.ts src/features/qrm/command-center/lib/approvalTypes.test.ts src/features/service/lib/service-agreement-utils.test.ts
bun test src/features/ops/lib/payment-validation-history.test.ts src/features/service/lib/service-labor-pricing-utils.test.ts src/features/qrm/command-center/lib/approvalTypes.test.ts src/features/service/lib/service-agreement-utils.test.ts src/features/service/lib/vendor-profile-utils.test.ts
bun test src/features/ops/lib/payment-validation-history.test.ts src/features/service/lib/service-labor-pricing-utils.test.ts src/features/qrm/command-center/lib/approvalTypes.test.ts src/features/service/lib/service-agreement-utils.test.ts src/features/service/lib/vendor-profile-utils.test.ts src/features/exec/lib/exec-row-normalizers.test.ts
bun run --filter @qep/web typecheck
```

Results:

- Payment validation normalizer tests: `3 pass`, `0 fail`.
- Service labor pricing utility and normalizer tests: `6 pass`, `0 fail`.
- Approval center normalizer tests: `3 pass`, `0 fail`.
- Service agreement utility and normalizer tests: `8 pass`, `0 fail`.
- Vendor profile normalizer tests: `6 pass`, `0 fail`.
- Exec shared data and metric drill normalizer tests: `5 pass`, `0 fail`.
- Combined targeted test run: `31 pass`, `0 fail`.
- Web typecheck: PASS.

## Remaining Slice 6 Work

- Continue auditing non-core QRM/admin/service pages with `supabase as unknown` or direct `as SomeRow[]` result casts.
- Prioritize pages where malformed rows can break operator flows: remaining executive components and high-traffic floor widgets.
- For each target, move row-shape logic into small exported normalizers and add unit tests before replacing direct casts.
