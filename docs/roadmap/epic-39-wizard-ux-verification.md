# Epic #39 — Wizard UX (intake, steps, live margin, mobile)

**GitHub:** [lewis4x4/qep#39](https://github.com/lewis4x4/qep/issues/39)

## Repo anchors

| Area | Path |
|------|------|
| Wizard shell + steps | `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx` (`WIZARD_STEPS`) |
| Draft / step persistence | `apps/web/src/features/quote-builder/lib/local-draft.ts`, `saved-quote-draft.ts` |
| Page-level normalizers | `apps/web/src/features/quote-builder/lib/__tests__/quote-builder-page-normalizers.test.ts` |

## Automated verification (repo)

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
bun run floor:validate-layouts
bun test apps/web/src/features/quote-builder/lib/__tests__/quote-builder-page-normalizers.test.ts \
  apps/web/src/features/quote-builder/lib/__tests__/local-draft.test.ts
```

Or run the full Track A bundle: `bun run verify:track-a-epics` (includes the above indirectly via shared quote-builder + floor tests).

## Manual / product (close #39)

- Mobile: complete a draft through all wizard steps on a narrow viewport; confirm scroll-to-step and tap targets (no accidental double-tap zoom on primary actions).
- Live margin: confirm configure/pricing steps reflect margin signals per product spec on a real saved package (staging).

## See also

- [Track B 560–564 rollout](./track-b-560-564-rollout.md) (schema under wizard pricing lines).
- [Epic #41 — Customer PDF line visibility](./epic-41-customer-pdf-line-visibility.md).
