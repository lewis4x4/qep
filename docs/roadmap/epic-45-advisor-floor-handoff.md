# Epic #45 — Advisor home (`iron_advisor` /floor) + prospect at quote-sent

**GitHub:** [lewis4x4/qep#45](https://github.com/lewis4x4/qep/issues/45)

## Product / UX spec (canonical)

- **[`docs/sales-rep-home-handoff.md`](../../sales-rep-home-handoff.md)** — layout pattern, MUST-HAVE `sales.my-quotes-by-status`, quick actions, what is **not** on the home screen.

## Repo anchors

| Area | Path |
|------|------|
| Default widget stack | `apps/web/src/features/floor/lib/default-layouts.ts` (`iron_advisor`) |
| Widget registry | `apps/web/src/features/floor/lib/floor-widget-registry.tsx` |
| My quotes by status + prospect badge | `apps/web/src/features/floor/widgets/RoleHomeWidgets.tsx` (`MyQuotesByStatusWidget`, `is_prospect_quote`) |
| Quote list row contract | `apps/web/src/features/floor/widgets/role-home-widget-normalizers.ts` |
| Floor shell + advisor 2/3 + 1/3 grid | `apps/web/src/features/floor/pages/FloorPage.tsx` (`AdvisorFloorGrid`) |
| Advisor action cards / AI briefing | `apps/web/src/features/floor/components/AdvisorActionCards.tsx`, `AdvisorBriefingBanner.tsx` (banner uses `sales.ai-briefing` / `AiBriefingCard` — not duplicated in the grid rail) |
| Recent activity (touches + quote viewed) | `apps/web/src/features/floor/widgets/RecentActivityWidget.tsx` |
| One-sentence narrative (edge + fallback) | `apps/web/src/features/floor/hooks/useFloorNarrative.ts`, `apps/web/src/features/floor/lib/static-narrative.ts`, `supabase/functions/floor-narrative/index.ts` (`buildSnapshot` for `iron_advisor`: active deals, follow-ups, active quotes) |

### Implemented layout (vs handoff doc snapshot)

`iron_advisor` default widgets (in order): `sales.my-quotes-by-status` → `sales.ai-briefing` → `sales.action-items` → `sales.recent-activity` → `qrm.follow-up-queue` → `crm.customer-search`. **`quote.deal-copilot-summary` is not on the home default** (registry may still exist for other surfaces).

`AdvisorFloorGrid`: **left 2/3** `sales.my-quotes-by-status`; **right 1/3** `sales.action-items` then `sales.recent-activity`; **below fold** `qrm.follow-up-queue` then `crm.customer-search`.

## Prospect at quote-sent

- `is_prospect_quote: true` on quote list rows surfaces when the package was a **walk-in prospect** path; UI shows a badge for **sent** / **viewed** (see `MyQuotesByStatusWidget` in `RoleHomeWidgets.tsx`).

## Phase A — data audit (staging SQL)

Run in Supabase SQL editor (replace `<ADVISOR_UUID>` once):

- **[`scripts/verify/advisor-floor-phase-a.sql`](../../scripts/verify/advisor-floor-phase-a.sql)**

## Verification (repo)

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
bun test apps/web/src/features/floor
```

Or: `bun run verify:track-a-epics` (includes floor tests plus quote-builder + Track B checks).

## See also

- [Epic #44 — Trade valuation audit](./epic-44-trade-valuation-audit.md)
