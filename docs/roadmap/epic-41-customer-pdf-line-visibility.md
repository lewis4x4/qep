# Epic #41 — Customer PDF / proposal line visibility (canonical rules)

**GitHub:** [lewis4x4/qep#41](https://github.com/lewis4x4/qep/issues/41)  
**Implementation:** `apps/web/src/features/quote-builder/lib/quote-proposal-data.ts` (`buildQuoteProposalData`, `buildLineItems`, `isCustomerVisibleLine`)  
**Shared visibility:** `apps/web/src/features/quote-builder/lib/quote-workspace.ts` (`quoteLineCostVisibility`)

These rules apply to **customer-facing** proposal PDF data, printable HTML derived from that data, and attachment/equipment **summary** rows in the same envelope—not rep-only UI.

## 1. Visibility resolution (`quoteLineCostVisibility`)

For any `QuoteLineItemDraft`:

1. If `costVisibility` is `internal` or `customer`, that value wins.
2. Else if `kind === "freight"` and metadata indicates **inbound** (`freight_direction: "inbound"` or `pricing_field_key: "inbound_freight"`) → **internal**.
3. Else if `kind` is `pdi` or `good_faith` → **internal**.
4. Else → **customer**.

## 2. Customer proposal line waterfall (`buildLineItems`)

Included as priced lines only when `quoteLineCostVisibility(line) === "customer"`:

- `draft.equipment`
- `draft.attachments`
- `draft.pricingLines` (when present)

Then, if applicable: rolled-up **commercial discount** line (remainder after explicit credit lines), then **trade-in allowance** when `draft.tradeAllowance > 0`.

**Excluded:** all lines resolved as **internal** by §1 (e.g. internal equipment rows, internal accessories, PDI, good-faith, inbound freight).

## 3. Equipment and attachment summaries (`buildQuoteProposalData`)

- `equipment` / `attachments` arrays in the proposal envelope use the **same** customer filter as §2 (not the raw draft lists).

## 4. Metadata on customer lines

Only whitelisted customer-safe fields are projected (see module comment in `quote-proposal-data.ts`: stock/serial/condition/warranty/spec bullets, approved media URLs, vendor logo, etc.). Raw metadata blobs, dealer cost, margin, internal IDs, and AI excerpts must **not** appear in customer output.

## 5. Regression tests

Behavior is locked in `apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts` (internal attachments/equipment, inbound freight suppression, media URL safety, trade line enrichment).

```bash
bun test apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts
```

## See also

- [Epic #42 — Post-approval routing](./epic-42-post-approval-routing.md) (customer send after approval vs return to rep).
- [Epic #43 — M365 + IntelliDealer observability](./epic-43-m365-intellidealer-observability.md) (cron health, staging SQL).
- [Epic #44 — Trade valuation audit](./epic-44-trade-valuation-audit.md) (comp-range on rep surfaces vs customer PDF).
