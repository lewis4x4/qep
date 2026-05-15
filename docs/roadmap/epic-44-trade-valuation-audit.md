# Epic #44 — Trade valuation source audit + comp-range UI

**GitHub:** [lewis4x4/qep#44](https://github.com/lewis4x4/qep/issues/44)

## Source of truth (implementation)

| Layer | Path / artifact |
|-------|-----------------|
| Comp-range + credit basis copy | `apps/web/src/features/quote-builder/lib/trade-valuation-range.ts` (`inferTradeRangeSummary`, `describeTradeCreditBasis`, `describePointShootApplyCreditLine`) |
| Point-Shoot UI | `apps/web/src/features/quote-builder/components/PointShootTradeCard.tsx` |
| Trade-in step copy | `apps/web/src/features/quote-builder/components/TradeInSection.tsx` |
| Point-Shoot API client | `apps/web/src/features/quote-builder/lib/point-shoot-trade-api.ts` |
| Customer PDF / proposal | `quote-proposal-data.ts` — trade **allowance** line only; valuation comps / internal reasoning must **not** leak (see [Epic #41](./epic-41-customer-pdf-line-visibility.md)). |

## Rules

1. **Customer PDF:** Do not add pre-trade comp tables or internal midpoint language to the customer packet unless product explicitly approves (Epic #44 DoD).
2. **Rep UI:** Comp-range summaries and “credit basis” strings belong on **rep surfaces** (Point-Shoot card, trade step), driven by `trade-valuation-range.ts` + valuation payload from `trade-valuation` / saved valuation rows.

## Verification (repo)

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
bun test apps/web/src/features/quote-builder/lib/__tests__/trade-valuation-range.test.ts
bun test apps/web/src/features/quote-builder/lib/__tests__/point-shoot-trade-api.test.ts
```

Or: `bun run verify:track-a-epics`.

## See also

- [Epic #41 — Customer PDF / proposal line visibility](./epic-41-customer-pdf-line-visibility.md)
- [Epic #45 — Advisor floor + prospect](./epic-45-advisor-floor-handoff.md) (`/floor`, quote-sent prospect UX).
- [Epic #43 — M365 + IntelliDealer observability](./epic-43-m365-intellidealer-observability.md)
