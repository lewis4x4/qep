# QEP VESign Provider Decision Packet

Date: 2026-05-04  
Roadmap slice: Slice 8 in `QEP_PARITY_REMAINING_IMPLEMENTATION_SLICES_2026-05-04.md`  
Workbook source: `QEP_Parity_Worksheet.xlsx`

## Rows Governed

- Field Parity Matrix: Phase-2_Sales-Intelligence / Equipment Invoicing / VESign
- Field Parity Matrix: Phase-2_Sales-Intelligence / Equipment Quoting / VESign
- Field Parity Matrix: Phase-6_Rental / Rental Counter / Stock Number / reverse-highlight VESign status

## Current Workbook Position

These rows remain `PARTIAL`. Native QEP signing, signature schema, quote signatures, signed terms URLs, and provider registry descriptions are not VESign provider evidence by themselves.

## Decision Required

Pick one closure path before implementation proceeds:

### Path A — Live VESign provider

Required evidence before build:

- VitalEdge/VESign contract and sandbox credentials.
- Sender identity/legal envelope policy.
- API and webhook contract.
- Webhook secret and replay samples.
- Status vocabulary, including sent, viewed, signed, declined, canceled, expired, partially signed, failed.
- Mapping requirements for equipment invoice, equipment quote, and rental contract envelopes.

Build implications:

- Add shared VESign adapter boundary.
- Add send/status/webhook functions or equivalent provider worker.
- Persist provider envelope IDs, status ledger, webhook idempotency keys, error payloads, and retry metadata.
- Wire Equipment Invoicing, Equipment Quoting, and Rental Counter status/action surfaces.
- Preserve native QEP signing fallback but label it as fallback, not VESign.

Workbook target after verified implementation: `BUILT`.

### Path B — Native QEP signing replaces VESign

Required evidence:

- Source-controlled business/legal decision states native QEP signing is the replacement for VESign in this deployment.
- Decision confirms signature enforceability requirements and explicitly retires the VESign provider dependency.
- Runtime/provider readiness status marks VESign non-required/replaced if a registry row exists.

Workbook target after evidence: `N_A` / replaced, not `BUILT`.

## Stop Conditions

Stop and ask if any of these are unresolved:

1. VESign legal/provider contract cannot be confirmed or de-scoped.
2. Webhook/status vocabulary is unavailable.
3. Sender identity and envelope retention policy are undefined.
4. Native signing is proposed as replacement without a source-controlled legal/business decision.
5. Workbook status promotion is requested from native-signing evidence alone.

## Current Queue Status

Queued. No workbook status should change from this packet alone.
