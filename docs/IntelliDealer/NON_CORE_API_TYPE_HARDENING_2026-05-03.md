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

## Verification

Commands run:

```bash
bun test src/features/ops/lib/payment-validation-history.test.ts src/features/service/lib/service-labor-pricing-utils.test.ts
bun run --filter @qep/web typecheck
```

Results:

- Payment validation normalizer tests: `3 pass`, `0 fail`.
- Service labor pricing utility and normalizer tests: `6 pass`, `0 fail`.
- Combined targeted test run: `9 pass`, `0 fail`.
- Web typecheck: PASS.

## Remaining Slice 6 Work

- Continue auditing non-core QRM/admin/service pages with `supabase as unknown` or direct `as SomeRow[]` result casts.
- Prioritize pages where malformed rows can break operator flows: approval center, service agreements, vendor profiles, executive dashboards, and high-traffic floor widgets.
- For each target, move row-shape logic into small exported normalizers and add unit tests before replacing direct casts.
