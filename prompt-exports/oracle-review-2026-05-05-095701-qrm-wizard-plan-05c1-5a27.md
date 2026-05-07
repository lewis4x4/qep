# Oracle Review

## Summary

The combined QRM Quote Wizard diff adds the 11-step quote-builder shell, expanded quote contracts, pricing/promotions/financing/detail/review screens, FL county tax support, delivery-event logging, and additive schema foundations. Typecheck/tests passing is a good sign, but I found several integration blockers around promotion persistence, legacy line-item totals, tax error handling, and send/document gating that should be fixed before handoff.

## Findings

### P1

1. **`QuoteBuilderV2Page.tsx`, `quote-api.ts`, `542_qrm_quote_wizard_foundation.sql` — placeholder promotions can break quote save**
   - Manual promotions use IDs like `"seed-mfg-support"` as both `selectedPromotionIds` and `reasonCode`. The migration defines `quote_packages.selected_promotion_ids uuid[]` and constrains `quote_package_line_items.reason_code` to discount reason values only. Selecting a placeholder promo can therefore fail persistence with invalid UUID / check-constraint errors.
   - **Suggestion:** Do not persist placeholder promo IDs to the UUID array. Either make placeholder selections UI-only, use real UUID seed rows, or change the column to text until real promotion IDs exist. Also make `reason_code` conditional to `line_type='discount'` or add a separate `promotion_id/source_id` field for promo lines.

2. **`quote-workspace.ts` — legacy custom/financing attachment rows are dropped from totals**
   - `attachmentTotal` now sums only `attachment | option | accessory | warranty` from `draft.attachments`, while legacy code can hydrate or create `custom` / `financing` rows inside `attachments`. Those rows still save/render but no longer affect subtotal, tax, margin, or customer total.
   - **Suggestion:** During hydration, migrate legacy non-config attachment rows into `pricingLines`, or include legacy `custom` / `financing` attachment rows in totals until all saved drafts are normalized.

3. **`QuoteBuilderV2Page.tsx` / `useQuoteTaxPreview.ts` — failed FL tax preview silently sets tax to `$0`**
   - When FL tax preview errors, such as missing/unseeded delivery county, `taxPreviewQuery.data` is undefined and the effect writes `draft.taxTotal = 0`. The UI may show an error, but save payloads and totals now carry understated tax.
   - **Suggestion:** Only update `draft.taxTotal` on successful tax preview responses. On tax errors, preserve the previous tax value or mark tax as unresolved and block document/send until resolved or manually overridden with a reason.

4. **`QuoteBuilderV2Page.tsx` — customer-facing document/send does not require “Why This Machine” confirmation**
   - Step 8 asks the rep to confirm the narrative, and Review shows “Needs rep confirm,” but Step 10/11 readiness does not block document generation or send logging when `whyThisMachineConfirmed` is false.
   - **Suggestion:** Add `whyThisMachineConfirmed` to document/send readiness when `whyThisMachine` is populated or AI-suggested.

5. **`tax-calculator/index.ts` / `542_qrm_quote_wizard_foundation.sql` — tax jurisdiction lookup ignores workspace**
   - `tax_jurisdictions` is workspace-scoped, but the service-role query filters only by state/county/active. In multi-workspace data, the function can pick another workspace’s county rate.
   - **Suggestion:** Filter by the authenticated user/quote workspace, or make tax jurisdiction seed data explicitly global rather than workspace-scoped.

### P2

1. **`QuoteBuilderV2Page.tsx` — datetime-local values display in UTC**
   - `dateTimeInputValue()` uses `toISOString().slice(0, 16)`, which shifts local follow-up times by timezone when displayed in `<input type="datetime-local">`.
   - **Suggestion:** Format datetime-local values from local date parts instead of ISO UTC.

2. **`QuoteBuilderV2Page.tsx` — top primary action can route to Document before `canSend` is actually clean**
   - `handlePrimaryAction()` uses `approvalGranted && packetReadiness.send.ready`, but document/send gates use `activeApprovalCase.canSend`. This can jump users to Step 10 only to show an approval blocker.
   - **Suggestion:** Use `approvalCaseCanSend` for the primary “Review & Send”/Document transition, matching the actual gate.