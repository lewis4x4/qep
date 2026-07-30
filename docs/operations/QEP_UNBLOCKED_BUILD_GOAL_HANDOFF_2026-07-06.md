# QEP Unblocked Build Goal Handoff

Prepared: 2026-07-06
Owner: Engineering
Purpose: build every currently safe rental, service, parts, and sales improvement that does not require unresolved owner decisions, vendor inputs, credentials, legal review, or go-live sign-off.

## Goal

Move QEP forward by implementing concrete engineering work that is already supported by existing product decisions and source-controlled evidence.

Do not promote blocked roadmap rows, invent policy defaults, or build speculative integrations. The goal is to remove verified technical defects, harden existing shipped surfaces, and deepen already-created operating pages without creating new business commitments.

## Source Evidence To Read First

- `docs/operations/QEP_ENGINEER_ACTIONABLE_BLOCKER_REVALIDATION_2026-07-05.md`
- `docs/operations/QEP_OWNER_BLOCKER_QUESTION_PACKET_2026-07-03.md`
- `docs/operations/QEP_GOLD_HANDOFF_NEXT_OPEN_ITEMS_2026-07-03.md`
- `docs/operations/IRON_QUOTE_BUILD_VERIFICATION_HANDOFF_2026-05-16.md`
- `QEP-OS-Complete-Roadmap-2026-04-15.md`
- `docs/designs/qep-parts-workflow-document-2026-05-29-review-candidate.md`

## Current Blocker Boundary

The official Engineer-owned roadmap selector is blocked. Do not bypass these blockers:

- A7.3 / QEP-173: OEM price-sheet parser still needs ASV, Yanmar, Bandit, and CMI real sheets or confirmed formats.
- A7.4, A7.5, A7.7, A7.9: downstream price-diff/reprice work must not be marked shipped while A7.3 is blocked.
- B3.1 / QEP-54: Omi webhook/admin shell still needs vendor docs, HMAC rules, payload examples, idempotency behavior, staging endpoint, and secret path.
- B2.5 / QEP-53: do not ship active Omi source behavior before B3.1 is unblocked.

## Buildable Work Package

### 1. Fix Parts Voice Order Runtime Defect

Problem:

- `supabase/functions/voice-to-parts-order/index.ts` resolves `workspaceId` with `adminClient` before `adminClient` is declared.
- This is a technical defect, not a product decision.

Target files:

- `supabase/functions/voice-to-parts-order/index.ts`
- Add or extend focused Deno coverage near the function if a local test harness exists. If no harness exists, add a static regression test that catches declaration order / source-shape regression.

Acceptance:

- `adminClient` is initialized before any call that uses it.
- Workspace resolution still uses the service-role client.
- No behavior changes to extraction, fuzzy match, or auto-submit policy.
- Focused verification passes.

Suggested verification:

```bash
deno check supabase/functions/voice-to-parts-order/index.ts
rg -n "resolveProfileActiveWorkspaceId\\(adminClient|const adminClient" supabase/functions/voice-to-parts-order/index.ts
```

### 2. Align Parts Order Status UI With Backend Contract

Problem:

- Frontend helper allows draft orders to advance to `submitted` or `confirmed`.
- Backend `parts-order-manager` requires `submit_internal_order` for draft handoff and allows `advance_status` from draft only to `cancelled`.
- The UI should not offer transitions that the server rejects.

Target files:

- `apps/web/src/features/parts/lib/order-status-machine.ts`
- `apps/web/src/features/parts/lib/purchase-order-utils.test.ts` or a new focused `order-status-machine.test.ts`
- Any affected page smoke tests for `PartsOrderDetailPage` if existing coverage is easy to extend.

Acceptance:

- `validNextStatuses("draft")` returns only transitions that `advance_status` accepts directly, or the UI special-cases submit through `invokeSubmitInternalOrder`.
- Draft-to-fulfillment remains available through the existing "Submit to fulfillment" action.
- Tests prove the frontend status helper matches backend transition rules.

Suggested verification:

```bash
bun test apps/web/src/features/parts/lib
```

### 3. Harden Quote Builder Without Changing Open Policy Defaults

Allowed work:

- Lighthouse/performance hardening explicitly marked non-blocking in the Iron Quote handoff.
- Focused smoke or regression tests around already-built quote surfaces.
- UI resilience and copy clarity for existing defaults where the product decision is already represented in config or schema.
- Do not change post-approval default, prospect quote policy, rebate stacking, source-required notification channel, or voice-route consolidation.

Target areas:

- `apps/web/src/features/quote-builder/`
- `apps/web/tests/e2e/`
- Existing quote-builder test files under `apps/web/src/features/quote-builder/**/__tests__`

Acceptance:

- No policy behavior changes.
- Existing quote-builder tests remain green.
- Any new hardening has a focused test or a measurable before/after command.

Suggested verification:

```bash
bun test apps/web/src/features/quote-builder
bun run --cwd apps/web bundle:check
```

### 4. Deepen Existing Track 7A/7B Operating Surfaces

Allowed work:

- Audit and harden pages that already exist on disk.
- Add missing empty/error/loading states.
- Add confidence labels and trace/source disclosure where the page already presents AI-derived or inferred output.
- Add tests for existing pure builders and normalizers.
- Improve data-depth checks without adding new business rules.

Priority surfaces:

- Rental Command Center: `apps/web/src/features/qrm/pages/RentalCommandCenterPage.tsx`, `apps/web/src/features/qrm/lib/rental-command.ts`
- Rental Conversion: `apps/web/src/features/qrm/pages/RentalConversionEnginePage.tsx`, `apps/web/src/features/qrm/lib/rental-conversion.ts`
- Service-to-Sales: `apps/web/src/features/qrm/pages/ServiceToSalesPage.tsx`, `apps/web/src/features/qrm/lib/service-to-sales.ts`
- Parts Intelligence: `apps/web/src/features/qrm/pages/PartsIntelligencePage.tsx`, `apps/web/src/features/qrm/lib/parts-intelligence.ts`

Acceptance:

- Existing pages remain within their current data contracts.
- No new renter-fault billing, rental PM schedule generation, hauling-rate policy, rental tax/exemption policy, or rental-to-sale accounting behavior is introduced.
- Tests cover any changed pure logic.
- UI changes preserve existing design patterns and responsive behavior.

Suggested verification:

```bash
bun test apps/web/src/features/qrm/lib/rental-command.test.ts \
  apps/web/src/features/qrm/lib/rental-conversion.test.ts \
  apps/web/src/features/qrm/lib/service-to-sales.test.ts \
  apps/web/src/features/qrm/lib/parts-intelligence.test.ts
```

### 5. Optional: K1.1 Finance Foundation Status Surface

This is buildable if the branch has capacity, but it is not strictly rental/service/parts/sales UI work.

Allowed work:

- Add a read model or admin status surface exposing finance foundation state from migrations `662` through `670`.
- Show unresolved values as `config-required` / null / owner-reviewed, never as hidden constants.
- Preserve the decision that QEP OS is forward AR/AP/reporting SoR, IntelliDealer is transition operational SoR, and QuickBooks Desktop is downstream output only.

Do not work on:

- K2.1 structured parts-vs-service revenue split.
- K3.1 migration-path values.
- Any live accounting posting behavior requiring missing finance inputs.

## Explicit Non-Goals

Do not build or mark shipped:

- OEM parser support for ASV/Yanmar/Bandit/CMI without real sample sheets or confirmed formats.
- Omi webhook, active Omi source enum, or wearable-glasses behavior without vendor contract evidence.
- HubSpot migration work requiring API credentials.
- DNS, R2 quote PDF secrets/CORS, M365 admin-consent changes, or deployment-only tasks.
- Rental PM auto-WO generation, renter-fault billing rules, rental tax/exemption behavior, rental security deposit monthly reconciliation, rental-to-sale commission/accounting, or rental clawback logic.
- Standalone Parts Quote UI ownership decisions beyond existing backend hardening, unless Juan/Norman answer D3.6/D-4.
- Service plan catalog, service PM entitlement rules, technician pay progression, hauling policy, Verizon Reveal depth, or grapple repair/build boundaries.
- Iron Quote go-live closure, customer send to three real customers, PDF parity sign-off, or any manual staging sign-off.
- Track 7C Hidden Forces work.

## Execution Order

1. Fix `voice-to-parts-order` declaration-order defect and verify.
2. Align parts order status helper with backend transition contract and verify.
3. Run a focused parts/service gate subset if touched code crosses service/parts boundaries.
4. Harden one Track 7A/7B surface at a time, starting with Rental Command Center because it directly touches rental operations and has pure builder tests.
5. Run quote-builder hardening only after the parts/rental defect work is green, because quote-builder is broad and already highly tested.
6. If time remains, implement K1.1 finance status read model under the explicit config-required rules.

## Verification Gate

For every changed segment:

```bash
bun run migrations:check
bun run pressure:parts
bun run audit:edges
bun run build
```

For service/parts/rental logic changes, also run:

```bash
deno test supabase/functions/_shared/service-engine-smoke.test.ts --allow-read --allow-env
deno test supabase/functions/_shared/vendor-inbound-contract.test.ts --allow-read --allow-env
bun run segment:gates --segment "unblocked-build-goal-2026-07-06" --ui
```

If only frontend pure helpers changed, run the focused Bun tests first and document why the full gate was not necessary.

## Completion Report Requirements

Final report must include:

- Changed files.
- Which unblocked work packages were completed.
- Verification commands and results.
- Any skipped verification with reason.
- Remaining blockers that still require owner/vendor/legal/credential input.
- Confirmation that no blocked roadmap rows were marked shipped.

## Copy-Paste Start Prompt

```text
Build the unblocked QEP work package in /Users/brianlewis/Projects/qep-knowledge-assistant.

Read first:
- docs/operations/QEP_UNBLOCKED_BUILD_GOAL_HANDOFF_2026-07-06.md
- docs/operations/QEP_ENGINEER_ACTIONABLE_BLOCKER_REVALIDATION_2026-07-05.md
- docs/operations/QEP_OWNER_BLOCKER_QUESTION_PACKET_2026-07-03.md
- docs/operations/IRON_QUOTE_BUILD_VERIFICATION_HANDOFF_2026-05-16.md

Goal:
Implement all currently safe rental, service, parts, and sales improvements that do not require unresolved owner decisions or external inputs.

Required first cuts:
1. Fix the voice-to-parts-order adminClient declaration-order defect.
2. Align parts order status UI transitions with the backend parts-order-manager contract.
3. Harden existing Track 7A/7B rental/service/parts/sales surfaces without adding new policy behavior.
4. Optionally add K1.1 finance foundation status visibility only if unresolved values remain config-required.

Constraints:
- Preserve unrelated dirty worktree changes.
- Do not build speculative OEM, Omi, HubSpot, DNS, R2, M365, rental PM/billing/tax, or Iron Quote go-live work.
- Do not mark blocked roadmap rows shipped.
- Add focused tests for changed logic.
- Run focused tests plus the appropriate gates from the handoff.
```
