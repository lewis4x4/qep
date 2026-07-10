# A7.6 rep price-impact browser QA

Date: 2026-07-09

## Browser evidence

The Sales Today and price-impact routes were exercised with an authenticated,
temporary rep fixture. The fixture user was removed after the run.

| Viewport | Today | Impact queue | Horizontal overflow |
| --- | --- | --- | --- |
| 375 px | pass | pass | none |
| 768 px | pass | covered by responsive route contract | none |
| 1024 px | pass | covered by responsive route contract | none |
| 1440 px | pass | pass | none |

The undeployed local build correctly rendered the isolated OEM-impact error
state while the rest of Today remained usable. The error chip exposed a unique
`Retry` button and the direct queue exposed an accessible retry state. This is
the expected pre-deploy failure mode and proves the optional OEM query does not
block the core Today feed.

The direct `/sales/price-impacts` route retained:

- an accessible `Review re-prices` page heading;
- explicit copy that customer updates are never auto-sent;
- a compact mobile layout and stable bottom navigation;
- direct error/retry behavior without blank or misleading exposure totals.

The Quote Builder warning was also covered by focused tests: unaffected quotes
render no alert, while `requires_requote` quotes render an alert linking to the
focused impact queue and explicitly state that no customer communication is
sent automatically.

Reduced-motion coverage is encoded on the new loading shells/chip with
`motion-reduce:animate-none`; component tests cover loading, error, and visible
chip labels. The production-backed happy-path chip/card drill-through passed
after `oem-price-feeds` was migrated and deployed; see
`test-results/agent-gates/a7-production-acceptance-2026-07-09.json`.
