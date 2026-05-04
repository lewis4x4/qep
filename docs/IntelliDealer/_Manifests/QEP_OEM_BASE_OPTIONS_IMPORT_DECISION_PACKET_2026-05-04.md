# QEP OEM Base & Options Import Decision Packet

Date: 2026-05-04  
Roadmap slice: Slice 5 in `QEP_PARITY_REMAINING_IMPLEMENTATION_SLICES_2026-05-04.md`  
Workbook source: `QEP_Parity_Worksheet.xlsx`

## Rows Governed

- Action & Button Parity: Phase-2_Sales-Intelligence / Base & Options / Bobcat Base and Options Import
- Action & Button Parity: Phase-2_Sales-Intelligence / Base & Options / Vermeer Base and Options Import

## Current Workbook Position

These rows remain `PARTIAL`. Canonical tables and generic/admin catalog screens are foundation only. Completion requires OEM-specific import behavior or a formal non-requirement decision.

## Decision Required

Pick one closure path per OEM before implementation proceeds:

### Path A — File import

Required evidence before build:

- Authorized Bobcat and/or Vermeer sample files.
- File format definition including base codes, option codes, descriptions, pricing/cost fields, effective dates, supersession behavior, and delete/deactivate semantics.
- Upload ownership and storage retention policy.
- Error-reporting requirements for invalid rows.

Build implications:

- Parser tests with representative fixtures.
- Import run ledger writes inserted/updated/skipped/error counts.
- Admin UI exposes import action, status, and history.
- Imports write canonical `equipment_base_codes`, `equipment_options`, and `equipment_base_codes_import_runs`, or a documented bridge from quote-builder catalog to canonical tables.
- Re-runs are idempotent.

Workbook target after verified implementation: `BUILT`.

### Path B — Provider/API pull

Required evidence before build:

- OEM API contract and credentials.
- Pull cadence and retry/error policy.
- Mapping from provider payload to canonical IntelliDealer base/options tables.
- Ownership of stale/deactivated option handling.

Workbook target after verified implementation: `BUILT`.

### Path C — De-scope / non-requirement

Required evidence:

- Source-controlled decision states Bobcat and/or Vermeer import is not required for this QEP deployment.
- Decision names the replacement catalog maintenance workflow.

Workbook target after evidence: `N_A` / replaced, not `BUILT`.

## Stop Conditions

Stop and ask if any of these are unresolved:

1. No sample file or API contract exists.
2. It is unclear whether imports must write canonical IntelliDealer tables or quote-builder catalog tables.
3. Delete/deactivate semantics are undefined.
4. Pricing/cost field mapping is ambiguous.
5. Workbook status promotion is requested without fixture/API-backed evidence.

## Current Queue Status

Queued. No workbook status should change from this packet alone.
