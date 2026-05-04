# QEP Tethr Provider Decision Packet

Date: 2026-05-04  
Roadmap slice: Slice 9 in `QEP_PARITY_REMAINING_IMPLEMENTATION_SLICES_2026-05-04.md`  
Workbook source: `QEP_Parity_Worksheet.xlsx`

## Rows Governed

- Action & Button Parity: Phase-2_Sales-Intelligence / Equipment Invoicing / Tethr It Now
- Action & Button Parity: Phase-3_Parts / Parts Invoicing / Tethr It Now
- Action & Button Parity: Phase-9_Advanced-Intelligence / Customer Portal / Tethr It Now

Related repo-audit residual if still in scope:

- Rental Counter / Work Orders / Tethr provider action

## Current Workbook Position

These rows remain `PARTIAL`. Generic telematics ingestion, fleet map, Asset 360, telemetry storage, and provider-neutral signal handling are foundation only. Completion requires Tethr-specific provider action support or a formal non-requirement decision.

## Decision Required

Pick one closure path before implementation proceeds:

### Path A — Live Tethr provider

Required evidence before build:

- Tethr credentials and auth contract.
- Webhook/API payload samples for hours, GPS, faults, and device metadata.
- Device-to-equipment mapping source of truth.
- Unknown-device handling policy.
- Stale-data and failed-provider policy.
- UI ownership for each exact IntelliDealer action surface.

Build implications:

- Add shared Tethr adapter and webhook normalization.
- Persist provider event IDs, mapping decisions, stale/unknown-device states, and idempotency markers.
- Add/verify manual mapping workflow and audit trail.
- Wire row-specific `Tethr It Now` actions on Equipment Invoicing, Parts Invoicing, and Customer Portal surfaces.
- Use Asset 360/Fleet Map only as fallback/deeplink targets, not completion evidence.

Workbook target after verified implementation: `BUILT`.

### Path B — Generic telematics replaces Tethr

Required evidence:

- Source-controlled product decision states provider-neutral telematics replaces Tethr for this deployment.
- Decision identifies which current QEP surfaces replace each IntelliDealer `Tethr It Now` action.
- Runtime/provider readiness status marks Tethr non-required/replaced if a registry row exists.

Workbook target after evidence: `N_A` / replaced, not `BUILT`.

## Stop Conditions

Stop and ask if any of these are unresolved:

1. Tethr credentials/API/webhook contract cannot be confirmed or de-scoped.
2. Device-to-equipment mapping policy is undefined.
3. Unknown-device and stale-data behavior is undefined.
4. Exact UI surface ownership is unclear.
5. Workbook status promotion is requested from generic telematics evidence alone.

## Current Queue Status

Queued. No workbook status should change from this packet alone.
