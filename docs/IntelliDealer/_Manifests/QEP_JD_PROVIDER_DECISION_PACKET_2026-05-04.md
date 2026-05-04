# QEP JD Provider Decision Packet

Date: 2026-05-04
Roadmap slice: Slices 1–4 in `QEP_PARITY_REMAINING_IMPLEMENTATION_SLICES_2026-05-04.md`
Workbook source: `QEP_Parity_Worksheet.xlsx`

## Rows Governed

- Field Parity Matrix: Phase-1_CRM / Prospect Board / `JDQuote is selected in this`
- Action & Button Parity: Phase-1_CRM / Prospect Board / John Deere Quote Upload
- Action & Button Parity: Phase-2_Sales-Intelligence / Equipment Invoicing / Access JD POs
- Action & Button Parity: Phase-2_Sales-Intelligence / Equipment Invoicing / JD Proactive Jobs

## Current Workbook Position

These rows remain `GAP`. Generic quote packages, generic purchase orders, IntegrationHub entries, credential-vault launchers, or mock/provider descriptions are not completion evidence.

## Decision Required

Pick one closure path before implementation work proceeds:

### Path A — Live JD requirement

Required evidence before build:

- Dealer is in JD-affiliated operational scope for this QEP deployment.
- JD Quote II license/API/SSO/XML/PDF contract is available.
- Sandbox credentials or authorized fixture exports are available.
- Authorization model for JD Quote II quote and PO access is approved.
- JD Proactive Jobs expected behavior is defined as API integration, deep link, credential-vault launch, or separate no-config/configured/error/launched workflow.
- Named owner approves payload retention, retry, and audit requirements.

Build implications:

- Add JD Quote II upload run ledger with workspace/user/RLS boundaries.
- Add accepted JD Quote II PO intake records linked to prospect/deal/equipment invoice/stock number where applicable.
- Add JD Proactive Jobs action state and audit trail.
- Add fixture-backed parser/adapter tests.

Workbook target after verified implementation: `BUILT`.

### Path B — De-scope / non-requirement

Required evidence:

- Source-controlled business decision states JD Quote II, Access JD POs, and/or JD Proactive Jobs are not required for this QEP deployment.
- Decision identifies replacement workflow or explains why no replacement is needed.
- Runtime/provider readiness status marks the JD workflow non-required/replaced if a registry row exists.

Workbook target after evidence: `N_A` / replaced, not `BUILT`.

## Decision Accountability

Assigned To: Unassigned — JD business/product owner required before build
Target Date: TBD before any JD implementation work

The JD Proactive Jobs behavior decision must be owned explicitly before Path A starts. Acceptable outcomes are API integration, deep link, credential-vault launch, or a separate no-config/configured/error/launched workflow.

## Stop Conditions

Stop and ask if any of these are unresolved:

1. JD live requirement cannot be confirmed or denied.
2. No legal/sandbox payload contract is available.
3. JD Proactive Jobs expected behavior is undefined.
4. Credentials would need to be hardcoded or stored outside the approved credential path.
5. Workbook status promotion is requested without one of the closure paths above.

## Current Queue Status

Status: Queued
Assigned To: Unassigned — JD business/product owner required before build
Target Date: TBD before any JD implementation work

No workbook status should change from this packet alone.
