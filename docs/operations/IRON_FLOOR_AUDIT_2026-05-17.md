# Fix F — `/floor` Sales-Advisor Home Audit (2026-05-17)

**Source:** `IRON_QUOTE_BUILD_VERIFICATION_HANDOFF_2026-05-16.md` §4 Fix F (the only remaining net-new code lane).
**Method:** Walk `apps/web/src/features/floor/` against the seven elements Rylee called out on the 2026-05-14 transcript. For each element, name the file/route that owns it. Flag anything that's a label-only promise vs. real code.
**Bottom line:** All seven elements are shipped on `/floor` for the `iron_advisor` role. Fix F closes as ✓. No net-new build required; the audit ends with quality residuals worth tracking.

---

## 1. Element-by-element map

| # | Transcript element | Status | Where it lives | Verify |
|---|---|---|---|---|
| 1 | AI briefing card | ✓ | `widgets/sales.ai-briefing` (wraps `AdvisorBriefWidget` from `features/dashboards/widgets/impls/iron-advisor-widgets`) plus `components/AdvisorBriefingBanner.tsx` driven by `hooks/useFloorNarrative.ts`. Rendered as widget order 1 in `lib/default-layouts.ts::iron_advisor.widgets`. | Open `/floor` as an iron_advisor → top-of-page narrative banner + "Today" briefing widget. |
| 2 | Open deals | ✓ | `sales.my-quotes-by-status` widget (order 0) → `widgets/RoleHomeWidgets.tsx::MyQuotesByStatusWidget`. Plus the "MY PIPELINE" secondary card in `components/AdvisorActionCards.tsx` showing live `pl.activeDealCount` + `formatCompactUsd(pl.totalValueCents)`. Plus `MY PIPELINE` quick action → `/qrm/deals?assigned_to=me`. | Three independent surfaces showing open-deal posture. |
| 3 | Today's follow-ups | ✓ | "Today's Follow-ups" secondary card in `AdvisorActionCards.tsx` with live count, urgency phrasing, and stalest-customer call-out (`fu.dueTodayCount`, `fu.overdueCount`, `fu.tiedUpValueCents`, `fu.stalest`). Backed by `lib/advisor-home-stats.ts::fetchAdvisorFollowUpStats`. Plus `qrm.follow-up-queue` widget (order 4) → `FollowUpQueueWidget`. | Open `/floor`. The orange "Today's follow-ups" card carries a live count + days-stale tag. |
| 4 | Voice-quote starter | ✓ | "Voice quote" button next to the Start-new-quote primary CTA on `AdvisorActionCards.tsx` → `/voice-quote`. Route is wired in `App.tsx:1152`. | Tap "Voice quote" → routes to `VoiceQuotePage`. |
| 5 | Voice-note starter | ✓ | "Voice note starter" QuickToolLink in `AdvisorActionCards.tsx` → `/voice`. Plus `voice_note` quick action in `iron_advisor.quickActions` → `/voice-qrm`. Route `/voice` is wired in `App.tsx:1084`. | Tap "Voice note starter" tile → `/voice` capture UI. |
| 6 | Prospecting/map with UCC CSV ingest | ✓ | "Prospecting map" QuickToolLink in `AdvisorActionCards.tsx` → `/qrm/opportunity-map`. CSV ingest is real: `lib/opportunity-map.ts::parseUccProspectCsv` (UCC schema-aware), `UccProspectRow` type, `uccProspects` state + Upload affordance in `pages/OpportunityMapPage.tsx`. Imports tag prospects with `source: "ucc_csv"` and convert to companies via `buildProspectCompanyCreateHref`. | Open `/qrm/opportunity-map`, click Upload, drop a UCC export CSV — rows appear as markers. |
| 7 | Log-action shortcuts (submit service request, add customer) | ✓ | Both live in `AdvisorActionCards.tsx` Advisor quick tools section: "Submit service request" → `/service/intake`; "Add customer" → `/qrm/companies?new=1`. | Tap each tile from `/floor`. |

---

## 2. Code-side proof of "real, not label-only"

The audit's biggest risk was element 6 (UCC CSV ingest) being a marketing label on a button that didn't actually parse a CSV. It's real:

- `apps/web/src/features/qrm/lib/opportunity-map.ts::parseUccProspectCsv` parses CSV cells, normalizes UCC-flavored headers (`debtor`, `secured party`, `filing date`, `collateral`), validates lat/lng, and emits `UccProspectRow[]` with stable IDs.
- `OpportunityMapPage.tsx` holds `uccProspects` state, surfaces an Upload affordance from `lucide-react::Upload`, displays errors via `uccImportError`, mixes prospects into the `boardQuery` via `uccProspectsQueryKey`, and routes "Convert to customer" through `buildProspectCompanyCreateHref` with `source: ucc_csv` provenance.
- Test coverage: `apps/web/src/features/qrm/lib/opportunity-map.test.ts` exercises the parser.

The "Prospecting map" tile on `/floor` is wired to the page that actually does the work.

---

## 3. Quality residuals worth tracking (not blocking)

These don't block Fix F closure but are worth a follow-up cleanup PR or product Q.

### 3.1 Three voice routes for voice-adjacent flows

The advisor home reaches three different voice surfaces:
- "Voice quote" button → `/voice-quote`
- "Voice note starter" QuickToolLink → `/voice`
- `voice_note` quick action → `/voice-qrm`

These three routes are probably intentional (Voice Quote = guided quote intake, Voice = field note capture, Voice QRM = QRM-side voice ops). But three voice routes accessible from one home screen is a UX question worth confirming with Rylee. **Product Q (new):** is `voice_note` (`/voice-qrm`) the same flow as "Voice note starter" (`/voice`)? If yes, drop one. If no, label them so reps don't tap the wrong one.

### 3.2 `iron_advisor` widget layout does not include the prospecting map as a widget

The prospecting map is reachable via the QuickToolLink in `AdvisorActionCards.tsx` (which renders for `isAdvisor === true` per `FloorPage.tsx:214`). But there is no `iron.prospecting-map` widget in `lib/default-layouts.ts::iron_advisor.widgets`. If product wants the map embedded directly on `/floor` (vs. a click-through), that's a small widget-wrapper PR — likely a Mapbox/MapLibre `ProspectingMapFloorWidget` that calls the same `buildOpportunityMapBoard` query. **Product Q15** decides whether this matters for v1.

### 3.3 AI briefing depth vs. transcript implication

Rylee's transcript framing — "what's their AI briefing for the day" — implies a daily summary that names specific deals, blockers, and next-move recommendations. The current `sales.ai-briefing` widget pulls from `useFloorNarrative` and `static-narrative.ts`. Confirm the narrative is rich enough to satisfy "AI briefing for the day" by opening `/floor` on a real prod data set and comparing against what Rylee imagined. If thin, the upgrade lives in `hooks/useFloorNarrative.ts` + `lib/static-narrative.ts` (plus possibly a new edge fn similar to `owner-morning-brief` but scoped to advisor). **Operational verify, not code-blocking.**

### 3.4 Action items widget naming collision

`widgets/ActionItemsWidget.tsx` is the order-2 widget in `iron_advisor.widgets` (`sales.action-items`). Today it handles tasks/follow-ups. The transcript's "log actions" element refers to *quick-action shortcuts* (submit service request, add customer), which live in `AdvisorActionCards.tsx`'s Advisor quick tools section. Two different concepts share the word "actions." Worth a naming clarification in code comments so future contributors don't merge them.

---

## 4. Handoff doc updates

Applied to `IRON_QUOTE_BUILD_VERIFICATION_HANDOFF_2026-05-16.md` (and tracked copies under `docs/operations/`): §0 code-complete banner, §3.1 row 17 → ✓, §4 Fix F → audited, §8 zero code lanes, Q16 added.

---

## 5. What remains for "verified to spec"

After this audit closes Fix F, the build verification doc has **no remaining code lanes**. What's left:

| Gate | Owner | Type |
|---|---|---|
| Set `PLAYWRIGHT_TEST_*` env vars on `e2e-staging` CI job | DevOps / Brian | Ops |
| §3.3 manual staging QA (FL 6% tax, surtax cap, exempt badge, all 4 approval outcomes, TILA surfaces) | Rylee + architect | Manual QA |
| §3.4 PDF parity sign-off vs IntelliDealer Q02699 | Architect | Manual QA |
| §3.2 #21 staging spot-check (inline override behavior in browser) | Rylee | Manual QA |
| §3.2 #25 staging spot-check (inbound freight hidden when in_stock) | Rylee | Manual QA |
| Product Qs Q6, Q7, Q11–Q15 (post-approval default, prospect path policy, IntelliDealer cutover scope, M365 tenant consent, mobile breakpoint, 8x8 vs Twilio, sales-advisor home priority cut) | Brian / Rylee / Ryan | Product |
| New product Q (§3.1 above): three voice routes — consolidate or label? | Rylee | Product |
| Voice-narrative depth check (§3.3 above) | Rylee | Manual QA |

When all eight rows close, the build is verified to spec.
