## Final Prompt
<taskname="Advisor Quote Home"/>
<task>Make Advisor Home world-class for quoting by strengthening quote launch prominence on /floor, validating quote route readiness (/quote-v2 and /voice-quote), and diagnosing/fixing why evening briefing may render only as “Good evening, Brian.” Deliver a decomposable implementation plan suitable for sub-agent dispatch, with risks, tests/gates, and done criteria.</task>

<architecture>
- Floor shell and role rendering:
  - `FloorPage` is the advisor home container and mounts `AdvisorBriefingBanner` + `AdvisorActionCards` for `iron_advisor`.
  - `useFloorLayout` + `default-layouts` + `layout-types` govern role quick actions/widgets.
  - `floor-widget-registry` and `DirectWrapWidgets` show legacy/parallel briefing widget path (`sales.ai-briefing`) and the newer top banner path.
- Quoting entry surfaces:
  - Advisor action card links directly to `/quote-v2`; secondary path references `/voice-quote`.
  - App route table enforces role-based access to `/sales/quotes`, `/quote-v2`, `/voice-quote`.
  - Top bar global quick-action mapping also points sales quote actions to `/quote-v2`.
  - `QuoteBuilderV2Page` consumes `package_id`, `deal_id|crm_deal_id`, `contact_id|crm_contact_id` from URL.
  - `VoiceQuotePage` hands off to `/quote-v2?voice_session_id=...` via sessionStorage handoff key.
- Briefing data path:
  - `AdvisorBriefingBanner` -> `useTodayFeed` -> `fetchTodayBriefing` (`daily_briefings`) + `fetchRepPipeline` (`v_rep_pipeline`) -> `AiBriefingCard`.
  - `AiBriefingCard` intentionally renders greeting-only when no summary parts are available (pipelineValue/closingSoon/priority all zero).
  - Backend generators:
    - `generate-daily-briefing` writes structured JSON to `daily_briefings`.
    - `morning-briefing` writes markdown-ish content to `morning_briefings` (different table, not used by advisor banner).
  - Schema/RLS for `daily_briefings` and `v_rep_pipeline` are defined in migration 243.
</architecture>

<selected_context>
apps/web/src/features/floor/pages/FloorPage.tsx: Advisor home composition and role-conditional rendering for briefing/action cards and floor widgets.
apps/web/src/features/floor/components/AdvisorActionCards.tsx: Current 3-card advisor actions; New Quote already links to `/quote-v2` with modest emphasis.
apps/web/src/features/floor/components/AdvisorBriefingBanner.tsx: Collapsible banner using `useTodayFeed`; shows loading/error or `AiBriefingCard`.
apps/web/src/features/floor/lib/default-layouts.ts: Role quick-action defaults include advisor `new_quote` -> `/quote-v2`.
apps/web/src/features/floor/lib/layout-types.ts: Floor quick-action caps/types constraints.
apps/web/src/features/floor/hooks/useFloorLayout.ts: Layout source/fallback behavior from `floor_layouts`.
apps/web/src/features/floor/lib/floor-widget-registry.tsx: Registry still includes `sales.ai-briefing` widget path and floor role widget definitions.
apps/web/src/features/floor/widgets/DirectWrapWidgets.tsx: `SalesAiBriefingFloorWidget` uses same `useTodayFeed` + `AiBriefingCard` pipeline as banner.
apps/web/src/features/sales/hooks/useTodayFeed.ts: Merges briefing + pipeline; computes live stats and priority actions.
apps/web/src/features/sales/lib/sales-api.ts: `fetchTodayBriefing` reads `daily_briefings` for today; `fetchRepPipeline` reads `v_rep_pipeline`.
apps/web/src/features/sales/components/AiBriefingCard.tsx: Greeting + summary composition logic; empty summary when no positive signal inputs.
apps/web/src/features/sales/lib/types.ts: Briefing and pipeline contracts.
apps/web/src/App.tsx (slices): Shared chrome + `/quote-v2` and `/voice-quote` route guards and quoteBuilderAccess plumbing.
apps/web/src/components/TopBar.tsx: Quick-action map and command button behavior mapping quote actions to `/quote-v2`.
apps/web/src/lib/nav-config.ts: Primary nav includes `Voice Quote` and sales/quote header resolution.
apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx (slice): URL param ingestion and saved quote hydration entry.
apps/web/src/features/voice-quote/pages/VoiceQuotePage.tsx (slice): Voice-to-quote handoff path to `/quote-v2?voice_session_id=...`.
supabase/migrations/243_sales_companion_foundation.sql: `daily_briefings` schema/RLS + `v_rep_pipeline` view.
supabase/functions/generate-daily-briefing/index.ts: Writer for `daily_briefings` (table used by advisor banner).
supabase/functions/morning-briefing/index.ts: Writes to `morning_briefings` (not consumed by advisor banner).
supabase/migrations/205_morning_briefing_cron_modern.sql: Cron wiring for `morning-briefing` function.
</selected_context>

<relationships>
- `/floor` (advisor role) -> `AdvisorBriefingBanner` + `AdvisorActionCards`.
- `AdvisorBriefingBanner` -> `useTodayFeed` -> (`daily_briefings` + `v_rep_pipeline`) -> `AiBriefingCard`.
- `AiBriefingCard` summary only appears when one or more: `pipelineValue > 0`, `closingSoonCount > 0`, `priorityCount > 0`.
- `AdvisorActionCards` New Quote -> `/quote-v2`; Voice helper text points to `/voice-quote`.
- `VoiceQuotePage` scenario open -> stores handoff in sessionStorage -> navigates to `/quote-v2?voice_session_id=...`.
- `QuoteBuilderV2Page` reads `package_id`, `deal_id|crm_deal_id`, `contact_id|crm_contact_id` for hydration.
- `TopBar` quick action and nav-config sales grouping reinforce `/quote-v2` globally.
- `generate-daily-briefing` populates `daily_briefings`; `morning-briefing` populates a different table (`morning_briefings`).
</relationships>

<ambiguities>
- Possible expected-empty case: If `v_rep_pipeline` returns no active deals and live priority actions are empty, `AiBriefingCard` will render greeting-only by design.
- Possible data-path mismatch confusion: cron/function activity around `morning-briefing` does not directly affect advisor banner, which reads `daily_briefings`.
- Unknown runtime state (not in repo-only context): whether `generate-daily-briefing` is scheduled/executed in deployed env and whether `daily_briefings` has rows for the affected user/date.
</ambiguities>

<execution_plan>
1) Advisor quote-launch UX (home)
- Audit current advisor 02 Actions visual hierarchy against complaint.
- Promote unmistakable primary quote CTA (position, scale, color contrast, copy, and explicit next-step affordance).
- Preserve secondary voice path without diluting primary CTA.
- Ensure consistency with top bar quick-action behavior.

2) Quote route/readiness/integration
- Verify `/quote-v2` and `/voice-quote` role guards and shared-chrome routing behavior.
- Confirm advisor launch links carry enough context (deal/contact/package/voice) for smooth hydration.
- Identify any missing handoff continuity between advisor home actions and quote builder entry expectations.

3) Evening briefing diagnosis + fix
- Validate whether advisor banner should consume `daily_briefings` only (current behavior).
- Distinguish true empty-data state from broken pipeline (missing writes/reads, RLS, wrong table/job assumptions).
- Implement robust empty-state messaging in banner/card if greeting-only is common and confusing.
- If broken path is confirmed, fix source wiring (frontend query assumptions or backend generation path alignment).

4) QA and AGENTS gates
- Add/update targeted tests for advisor action CTA prominence/links and briefing empty/error states.
- Validate route accessibility expectations by role for `/quote-v2` and `/voice-quote`.
- Run required verification gates (lint, typecheck, tests/static analysis per repo norms) and report evidence.
</execution_plan>

<risks>
- Over-indexing on visual changes without preserving current navigation contracts.
- Confusing two briefing systems (`daily_briefings` vs `morning_briefings`) and patching the wrong producer.
- Regressing advisor/manager role-specific home behavior while adjusting shared floor components.
</risks>

<done_criteria>
- Advisor home makes quote start unmistakable and measurably more prominent than peer actions.
- `/floor` advisor quote actions correctly launch `/quote-v2` and/or `/voice-quote` with expected readiness/handoff behavior.
- Briefing behavior is explained and validated: either meaningful empty-state copy for no-data, or a concrete bug fix restoring briefing content.
- Tests/gates pass with verification evidence.
</done_criteria>

## Selection
- Files: 38 total (19 full, 3 slice, 16 codemap)
- Total tokens: 94686 (Auto view)
- Token breakdown: full 64145, slice 10169, codemap 20372

### Files
### Selected Files
/Users/brianlewis/Projects/qep-knowledge-assistant/
├── apps/
│   └── web/
│       └── src/
│           ├── components/
│           │   └── TopBar.tsx — 12,631 tokens (full)
│           ├── features/
│           │   ├── floor/
│           │   │   ├── components/
│           │   │   │   ├── AdvisorActionCards.tsx — 3,155 tokens (full)
│           │   │   │   └── AdvisorBriefingBanner.tsx — 1,093 tokens (full)
│           │   │   ├── hooks/
│           │   │   │   └── useFloorLayout.ts — 907 tokens (full)
│           │   │   ├── lib/
│           │   │   │   ├── default-layouts.ts — 1,267 tokens (full)
│           │   │   │   ├── floor-widget-registry.tsx — 6,133 tokens (full)
│           │   │   │   └── layout-types.ts — 1,013 tokens (full)
│           │   │   ├── pages/
│           │   │   │   └── FloorPage.tsx — 5,675 tokens (full)
│           │   │   └── widgets/
│           │   │       └── DirectWrapWidgets.tsx — 2,707 tokens (full)
│           │   ├── quote-builder/
│           │   │   └── pages/
│           │   │       ├── QuoteBuilderV2Page.tsx — 3,042 tokens (lines 420-680 (QuoteBuilderV2Page entrypoint: URL param ingestion (package_id/deal_id/contact_id), initial draft hydration, and saved quote loading path used by home launch links.))
│           │   │       └── QuoteListPage.tsx — 8,763 tokens (full)
│           │   ├── sales/
│           │   │   ├── components/
│           │   │   │   └── AiBriefingCard.tsx — 625 tokens (full)
│           │   │   ├── hooks/
│           │   │   │   └── useTodayFeed.ts — 532 tokens (full)
│           │   │   └── lib/
│           │   │       ├── sales-api.ts — 1,499 tokens (full)
│           │   │       └── types.ts — 749 tokens (full)
│           │   └── voice-quote/
│           │       └── pages/
│           │           └── VoiceQuotePage.tsx — 3,736 tokens (lines 320-700 (VoiceQuotePage flow from recording through scenario handoff; includes sessionStorage handoff key and navigation to /quote-v2?voice_session_id.))
│           ├── lib/
│           │   └── nav-config.ts — 4,561 tokens (full)
│           └── App.tsx — 3,391 tokens (lines 700-870 (SalesOrAppLayout and App-level quoteBuilderAccess state initialization/reset behavior that influences whether quote routes are gated in shared chrome.), 950-1145 (Main authenticated route table including /floor, /sales/quotes, /quote-v2, /voice-quote, and surrounding role guards/redirects.))
└── supabase/
    ├── functions/
    │   ├── generate-daily-briefing/
    │   │   └── index.ts — 4,998 tokens (full)
    │   └── morning-briefing/
    │       └── index.ts — 3,835 tokens (full)
    └── migrations/
        ├── 205_morning_briefing_cron_modern.sql — 1,372 tokens (full)
        └── 243_sales_companion_foundation.sql — 2,630 tokens (full)

### Codemaps
/Users/brianlewis/Projects/qep-knowledge-assistant/
├── apps/
│   └── web/
│       └── src/
│           ├── components/
│           │   ├── AppLayout.tsx — 212 tokens (auto)
│           │   ├── DashboardPage.tsx — 301 tokens (auto)
│           │   └── NavRail.tsx — 162 tokens (auto)
│           ├── features/
│           │   ├── floor/
│           │   │   └── lib/
│           │   │       └── attention.ts — 320 tokens (auto)
│           │   ├── qrm/
│           │   │   └── lib/
│           │   │       └── decision-room-archetype.ts — 952 tokens (auto)
│           │   ├── quote-builder/
│           │   │   ├── components/
│           │   │   │   ├── CustomerPicker.tsx — 351 tokens (auto)
│           │   │   │   └── OutcomeCaptureDrawer.tsx — 177 tokens (auto)
│           │   │   └── lib/
│           │   │       ├── local-draft.ts — 796 tokens (auto)
│           │   │       └── quote-api.ts — 4,265 tokens (auto)
│           │   ├── service/
│           │   │   └── lib/
│           │   │       └── types.ts — 2,031 tokens (auto)
│           │   └── voice-qrm/
│           │       └── lib/
│           │           └── voice-qrm-api.ts — 896 tokens (auto)
│           └── lib/
│               └── programs/
│                   └── types.ts — 669 tokens (auto)
├── shared/
│   └── qep-moonshot-contracts.ts — 6,171 tokens (auto)
└── supabase/
    └── functions/
        └── _shared/
            ├── qrm-command-center/
            │   └── types.ts — 2,110 tokens (auto)
            ├── dge-auth.ts — 710 tokens (auto)
            └── morning-briefing-fallback.ts — 249 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `advisor-quote-home-AD0589` | **Mode**: plan

### Response
## 1. **Summary**

Implement this as a targeted advisor-home upgrade, not a broad Floor or Sales Companion refactor. The core changes are: make quote launch the dominant `iron_advisor` action on `/floor`, fix quote route inconsistencies so all visible quote links are actually reachable, harden the `/voice-quote` → `/quote-v2` handoff, and prevent the AI briefing card from rendering as greeting-only by using QRM-backed advisor signals plus explicit empty-state copy. Backend work should be limited to validating/scheduling the `generate-daily-briefing` producer because the current visible banner reads `daily_briefings`, not `morning_briefings`.

---

## 2. **Current-state analysis**

### Advisor Home composition

`FloorPage` owns role resolution and role-specific rendering:

- `getEffectiveIronRole(...)` resolves the active Iron role.
- Admin/manager/owner can preview via `?view_as=iron_advisor`.
- For `activeRole === "iron_advisor"`:
  - Renders `AdvisorBriefingBanner` above the page title.
  - Renders `AdvisorActionCards` instead of `layout.quickActions`.
  - Renders `AdvisorFloorGrid`.

This means `default-layouts.ts` advisor quick actions are not the live advisor CTA UI today; `AdvisorActionCards.tsx` is the real launch surface.

### Current advisor quote action problem

`AdvisorActionCards` renders three equal cards:

1. Today’s follow-ups — visually dominant orange card.
2. New quote — subdued gray card linking to `/quote-v2`.
3. My pipeline — subdued gray card.

The quote action is technically present but visually secondary. The voice path is only helper text inside the New Quote card and is not a real link to `/voice-quote`.

### Quote route readiness

Current route table in `App.tsx`:

- `/quote-v2`: allowed for `["rep", "manager", "owner"]`.
- `/sales/quotes`: allowed for `["rep", "manager", "owner"]`.
- `/voice-quote`: allowed for `["rep", "admin", "manager", "owner"]`.

But `nav-config.ts` exposes quote navigation to admins:

- `Quotes` roles include `["rep", "admin", "manager", "owner"]`.
- `Voice Quote` roles include `["rep", "admin", "manager", "owner"]`.

So admins can see quote navigation but are redirected away from `/quote-v2` and `/sales/quotes`. This also breaks admin role-preview flows from `/floor?view_as=iron_advisor`.

### Voice quote handoff

`VoiceQuotePage.openScenario`:

- Stores handoff JSON under `VOICE_QUOTE_HANDOFF_KEY`.
- Navigates to `/quote-v2?voice_session_id=...`.

Potential issue:

```ts
sessionStorage voiceSessionId: originatingLogId ?? `voice-session-${Date.now()}`
URL voice_session_id: originatingLogId ?? "voice-session"
```

When `originatingLogId` is null, stored ID and URL ID do not match. The selected `QuoteBuilderV2Page` entrypoint only shows parsing for:

- `package_id`
- `deal_id` / `crm_deal_id`
- `contact_id` / `crm_contact_id`

The implementation must validate whether `voice_session_id` is consumed later. If not, add explicit consumption.

### Briefing data path

`AdvisorBriefingBanner`:

```tsx
useTodayFeed() -> AiBriefingCard
```

`useTodayFeed` loads:

- `fetchTodayBriefing()` from `daily_briefings`.
- `fetchRepPipeline()` from `v_rep_pipeline`.

`AiBriefingCard` ignores the structured `briefing` body and only renders summary text if one of these live scalar inputs is positive:

- `pipelineValue > 0`
- `closingSoonCount > 0`
- `priorityCount > 0`

If all are zero, it intentionally renders only:

```txt
Good evening, Brian
```

There is also a data-source mismatch risk:

- Advisor action cards use QRM tables:
  - `follow_up_touchpoints`
  - `follow_up_cadences`
  - `qrm_deals`
  - `qrm_deal_stages`
- `useTodayFeed` uses Sales Companion CRM view:
  - `v_rep_pipeline`
  - backed by `crm_deals`

So the home can show QRM pipeline/follow-up data while the briefing pipeline appears empty.

### Backend briefing producers

Two different systems exist:

- `generate-daily-briefing`
  - Writes structured JSON to `daily_briefings`.
  - This is the table read by `AdvisorBriefingBanner`.
- `morning-briefing`
  - Writes markdown-ish content to `morning_briefings`.
  - Not read by advisor banner.

Migration `205_morning_briefing_cron_modern.sql` schedules `morning-briefing`, not `generate-daily-briefing`. Fixing only `morning-briefing` will not fix the advisor banner.

---

## 3. **Design**

### A. Advisor quote-launch UX

#### Decision

Replace the equal three-card advisor action strip with a quote-first layout:

- Primary quote launch card is first, largest, orange/gradient, and unmistakable.
- It contains two real links:
  - Primary: `/quote-v2`
  - Secondary: `/voice-quote`
- Follow-ups and pipeline remain visible but secondary.

Do not introduce a generic CTA framework; this is advisor-specific and already isolated in `AdvisorActionCards`.

#### Target layout

Desktop:

```txt
[ Start a Quote / Quote Builder / Voice Quote ] [ Today’s Follow-ups ]
[ Start a Quote card spans wide             ] [ My Pipeline       ]
```

Mobile:

```txt
Start a Quote
Today’s Follow-ups
My Pipeline
```

#### Behavioral contracts

- `/quote-v2` remains the primary launch route.
- `/voice-quote` becomes an actual secondary link, not helper copy.
- Existing follow-up and pipeline destinations remain:
  - `/qrm/my/reality`
  - `/qrm/deals?assigned_to=me`

#### Shared advisor stats extraction

Move the data-fetching helpers currently embedded in `AdvisorActionCards.tsx` into a small shared module:

```ts
// apps/web/src/features/floor/lib/advisor-home-stats.ts

export interface AdvisorFollowUpStats {
  dueTodayCount: number;
  overdueCount: number;
  tiedUpValueCents: number;
  stalest: { customer: string; daysStale: number } | null;
}

export interface AdvisorPipelineStats {
  activeDealCount: number;
  totalValueCents: number;
  decisionCount: number;
}

export async function fetchAdvisorFollowUpStats(userId: string): Promise<AdvisorFollowUpStats>;

export async function fetchAdvisorPipelineStats(userId: string): Promise<AdvisorPipelineStats>;

export function formatCompactUsd(cents: number): string;
```

Why: `AdvisorBriefingBanner` should use the same QRM-backed pipeline truth as `AdvisorActionCards`, avoiding duplicate Supabase logic and avoiding the `crm_deals`/`qrm_deals` mismatch.

---

### B. Briefing fix: never render greeting-only

#### Decision

Keep `AiBriefingCard` reusable, but add explicit summary override support and empty-state copy.

Before:

```ts
interface AiBriefingCardProps {
  firstName: string;
  timeOfDay: "morning" | "afternoon" | "evening";
  pipelineValue: number;
  closingSoonCount: number;
  priorityCount: number;
}
```

After:

```ts
interface AiBriefingCardProps {
  firstName: string;
  timeOfDay: "morning" | "afternoon" | "evening";
  pipelineValue: number;
  closingSoonCount: number;
  priorityCount: number;

  /**
   * Optional explicit summary parts. When provided, the card uses these
   * instead of deriving summary only from scalar inputs.
   */
  summaryParts?: string[];

  /**
   * Rendered when derived/provided summary parts are empty.
   * Prevents greeting-only cards.
   */
  emptySummary?: string;
}
```

#### Advisor banner summary algorithm

In `AdvisorBriefingBanner`, combine:

1. QRM advisor pipeline stats from `fetchAdvisorPipelineStats`.
2. Existing `useTodayFeed` briefing/priority output.
3. Explicit empty copy.

Pseudocode:

```ts
summaryParts = []

if advisorPipeline.totalValueCents > 0:
  summaryParts.push("$X open quote/pipeline value")

if advisorPipeline.activeDealCount > 0:
  summaryParts.push("N active deal(s)")

if advisorPipeline.decisionCount > 0:
  summaryParts.push("N at decision stage")

if livePriorityActions.length > 0:
  summaryParts.push("N priority action(s) today")

if summaryParts empty:
  emptySummary =
    "No active quote pressure found yet. Start a quote or record a voice quote to seed today’s selling motion."
```

This fixes both cases:

- True empty data no longer looks broken.
- QRM data present but `v_rep_pipeline` empty still produces meaningful summary.

#### Error handling

Current banner treats `useTodayFeed.error` as a full-card failure. Adjust behavior:

- If `useTodayFeed` fails but QRM advisor stats succeed, still render `AiBriefingCard` with QRM summary.
- Show small degraded text only for the failed part:
  - “Daily briefing unavailable; showing live advisor signals.”
- Only show full error if both daily feed and QRM stats fail.

#### `useTodayFeed` interface adjustment

Add non-breaking fields:

```ts
return {
  briefing,
  liveStats,
  livePriorityActions,
  pipeline,
  timeOfDay,
  isLoading,
  error,

  briefingError: briefingQuery.error,
  pipelineError: pipelineQuery.error,
  hasBriefing: Boolean(briefing),
}
```

Existing callers can continue using `error`.

---

### C. Quote route readiness

#### App route guards

Update `/sales/quotes` and `/quote-v2` role guards to include admin, matching `nav-config.ts` and `/voice-quote`.

Before:

```tsx
["rep", "manager", "owner"].includes(profile.role)
```

After:

```tsx
["rep", "admin", "manager", "owner"].includes(profile.role)
```

Apply to:

- `/sales/quotes`
- `/quote-v2`

Rationale: visible navigation already advertises these routes to admins; route guards should not contradict chrome.

#### TopBar route metadata

Add route mappings:

- `BREADCRUMB_LABELS["/voice-quote"] = "Voice Quote"`
- `QUICK_ACTION_MAP["/voice-quote"] = { label: "New Quote", route: "/quote-v2" }`

This prevents `/voice-quote` from falling back to the generic “QRM Hub” quick action.

#### nav-config active header

Update `resolveActivePrimaryHeader` so `/voice-quote` resolves to `"sales"`.

Add:

```ts
pathname === "/voice-quote"
```

to the sales condition.

---

### D. Voice quote handoff hardening

#### Shared handoff contract

Create a small shared module:

```ts
// apps/web/src/features/voice-quote/lib/voice-quote-handoff.ts

export const VOICE_QUOTE_HANDOFF_KEY = "...";

export interface VoiceQuoteHandoff {
  voiceSessionId: string;
  at: string;
  scenario: QuoteScenario;
  resolvedModelId: string | null;
  resolvedBrandId: string | null;
  deliveryState: string;
  customerType: string;
  prompt: string;
  originatingLogId: string | null;
}

export function readVoiceQuoteHandoff(expectedSessionId: string): VoiceQuoteHandoff | null;
```

`VoiceQuotePage` and `QuoteBuilderV2Page` should import this constant from the same place.

#### Fix ID mismatch in `VoiceQuotePage`

Compute one session ID and use it for both storage and navigation:

```ts
const voiceSessionId = originatingLogId ?? `voice-session-${Date.now()}`;
```

Then:

- Store `voiceSessionId`.
- Navigate to `/quote-v2?voice_session_id=${voiceSessionId}`.

#### QuoteBuilder ingestion

In `QuoteBuilderV2Page`:

- Parse `voice_session_id`.
- Read handoff from sessionStorage.
- Validate ID match.
- Hydrate draft only once per handoff ID, similar to `existingQuoteHydrationKeyRef`.

Required state behavior:

```ts
const voiceSessionId = searchParams.get("voice_session_id") || "";
const voiceHandoffHydrationKeyRef = useRef<string | null>(null);
```

Hydration rules:

1. If `package_id` or `deal_id` is present, saved quote/deal hydration wins.
2. Else if `voice_session_id` exists and a matching handoff exists:
   - Set `entryMode: "voice"`.
   - Preserve transcript/prompt in `voiceSummary` or equivalent existing field.
   - Put selected scenario into the existing recommendation/scenario field used by Quote Builder.
   - Open the builder in guided mode at the first step that lets the user confirm customer/equipment.
3. If handoff is missing or invalid:
   - Do not crash.
   - Leave manual draft.
   - Show a non-destructive warning/toast: “Voice handoff expired; start manually or record again.”

---

### E. Backend briefing scheduling validation

#### Decision

Add/verify a modern cron for `generate-daily-briefing`, because advisor banner reads `daily_briefings`.

Add a new idempotent migration using the same modern pattern as migration 205:

```sql
-- supabase/migrations/<next>_generate_daily_briefing_cron_modern.sql
```

Target function:

```txt
/functions/v1/generate-daily-briefing
```

Job name:

```txt
generate-daily-briefing-daily
```

Schedule:

```txt
0 10 * * * -- 05:00 CT / early daily generation
```

Body:

```json
{}
```

Headers:

```txt
x-internal-service-secret
Content-Type: application/json
```

Do not modify `morning-briefing`; it is a separate markdown briefing path.

If an existing deployed cron already exists under another name, this new job is still safe because `generate-daily-briefing` skips rows that already exist unless `regenerate` is true.

---

## 4. **File-by-file impact**

### `apps/web/src/features/floor/lib/advisor-home-stats.ts` — new

- Move QRM-backed follow-up and pipeline fetch logic from `AdvisorActionCards`.
- Export stats interfaces and `formatCompactUsd`.
- Owns no React state.
- Used by `AdvisorActionCards` and `AdvisorBriefingBanner`.

Depends on: none.

---

### `apps/web/src/features/floor/components/AdvisorActionCards.tsx`

Modify:

- Remove local fetch/normalization helpers after moving them.
- Use shared `fetchAdvisorFollowUpStats` and `fetchAdvisorPipelineStats`.
- Redesign layout to make quote launch primary.
- Add actual `/voice-quote` secondary link.
- Keep follow-up and pipeline stats behavior.

Depends on: `advisor-home-stats.ts`.

---

### `apps/web/src/features/floor/components/AdvisorBriefingBanner.tsx`

Modify:

- Load advisor QRM pipeline stats using shared fetcher.
- Build `summaryParts` for `AiBriefingCard`.
- Pass `emptySummary`.
- Render degraded state if daily briefing fails but QRM stats are available.
- Avoid full error state unless all sources fail.

Depends on: `advisor-home-stats.ts`, updated `AiBriefingCard`.

---

### `apps/web/src/features/sales/components/AiBriefingCard.tsx`

Modify:

- Add optional `summaryParts`.
- Add optional `emptySummary`.
- Ensure a paragraph renders even when all scalar counts are zero.
- Preserve existing scalar-derived summary behavior for current callers.

Depends on: none.

---

### `apps/web/src/features/sales/hooks/useTodayFeed.ts`

Modify:

- Add `briefingError`, `pipelineError`, `hasBriefing`.
- Keep existing return fields for compatibility.
- No persistence changes.

Depends on: none.

---

### `apps/web/src/features/floor/widgets/DirectWrapWidgets.tsx`

Modify:

- Optionally pass `emptySummary` to `AiBriefingCard` in `SalesAiBriefingFloorWidget`.
- No layout change.

Depends on: updated `AiBriefingCard`.

---

### `apps/web/src/App.tsx`

Modify route guards:

- `/sales/quotes`: include `admin`.
- `/quote-v2`: include `admin`.

Depends on: none.

---

### `apps/web/src/components/TopBar.tsx`

Modify:

- Add `/voice-quote` breadcrumb label.
- Add `/voice-quote` quick action mapping.
- Confirm `/quote-v2` quick action remains unchanged.

Depends on: none.

---

### `apps/web/src/lib/nav-config.ts`

Modify:

- Add `/voice-quote` to Sales active-header resolution.

Depends on: none.

---

### `apps/web/src/features/voice-quote/lib/voice-quote-handoff.ts` — new

Add shared handoff key, type, parser, and validator.

Depends on existing `QuoteScenario` type location.

---

### `apps/web/src/features/voice-quote/pages/VoiceQuotePage.tsx`

Modify:

- Import shared handoff key/type.
- Compute one `voiceSessionId`.
- Use same ID in sessionStorage and URL.

Depends on: new handoff module.

---

### `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx`

Modify:

- Parse `voice_session_id`.
- Read/validate voice handoff.
- Hydrate draft once when no package/deal hydration is taking precedence.
- Show non-blocking warning if handoff is missing/expired.

Depends on: new handoff module.

---

### `supabase/migrations/<next>_generate_daily_briefing_cron_modern.sql` — new

Add idempotent pg_cron scheduling for `generate-daily-briefing`.

Depends on: existing internal-secret extraction pattern from migration 205.

---

## 5. **Risks and migration**

### Risks

- **Visual regression:** Advisor home could over-prioritize quotes and hide urgent follow-ups. Mitigation: keep follow-ups visible in the secondary rail with urgency count.
- **Admin access mismatch:** Adding admin route access may expose quote pages to admins. This matches nav visibility, but API/RLS behavior must be verified.
- **Voice handoff shape drift:** `QuoteScenario` may not map directly to `QuoteWorkspaceDraft`. Mitigation: use existing scenario/recommendation fields and preserve manual fallback.
- **Briefing source confusion:** `morning_briefings` is not used by the banner. Do not patch only `morning-briefing`.

### Migration behavior

- New cron migration is additive.
- `generate-daily-briefing` already checks for existing rows, so duplicate daily calls should usually no-op.
- No schema changes to `daily_briefings`.
- Rollback concern: unschedule `generate-daily-briefing-daily` if needed.

---

## 6. **Sub-agent dispatch plan**

### Agent 1 — Advisor Home UX

Files:

- `AdvisorActionCards.tsx`
- `advisor-home-stats.ts`
- related tests

Deliverables:

- Quote-first layout.
- Shared advisor stats module.
- Link tests for `/quote-v2` and `/voice-quote`.

---

### Agent 2 — Briefing Diagnosis/Fix

Files:

- `AdvisorBriefingBanner.tsx`
- `AiBriefingCard.tsx`
- `useTodayFeed.ts`
- `DirectWrapWidgets.tsx`
- related tests

Deliverables:

- No greeting-only state.
- QRM-backed advisor summary.
- Degraded daily-briefing handling.

---

### Agent 3 — Quote Route + Voice Handoff

Files:

- `App.tsx`
- `TopBar.tsx`
- `nav-config.ts`
- `VoiceQuotePage.tsx`
- `QuoteBuilderV2Page.tsx`
- new handoff module
- related tests

Deliverables:

- Admin route consistency.
- `/voice-quote` header/quick-action readiness.
- Fixed voice session ID continuity.
- Quote Builder handoff hydration.

---

### Agent 4 — Backend Cron Validation

Files:

- new Supabase migration

Deliverables:

- Idempotent `generate-daily-briefing` cron migration.
- Notes proving advisor banner uses `daily_briefings`, not `morning_briefings`.

---

## 7. **Tests and gates**

### Unit/component tests

Add or update tests for:

- `AiBriefingCard`
  - renders explicit `summaryParts`.
  - renders `emptySummary` when scalar inputs are zero.
  - never renders greeting-only.
- `AdvisorActionCards`
  - primary quote CTA links to `/quote-v2`.
  - voice CTA links to `/voice-quote`.
  - follow-up and pipeline links remain unchanged.
- Voice handoff helper
  - accepts matching `voiceSessionId`.
  - rejects mismatched/malformed payload.
- `VoiceQuotePage`
  - stored handoff ID equals URL param.
- `QuoteBuilderV2Page`
  - missing handoff does not crash.
  - valid handoff hydrates once.

### Manual QA

- Rep user:
  - `/floor` shows quote launch as dominant CTA.
  - Click primary CTA → `/quote-v2`.
  - Click voice CTA → `/voice-quote`.
- Admin preview:
  - `/floor?view_as=iron_advisor`.
  - Quote CTA reaches `/quote-v2`, no redirect loop.
- Empty data:
  - Banner shows meaningful no-signal copy, not just “Good evening, Brian.”
- Voice flow:
  - Record/generate scenario.
  - Open scenario.
  - Quote Builder receives handoff.

### Required gates

Run:

```txt
lint
typecheck
targeted frontend tests
relevant route/component tests
Supabase SQL lint/check if available
```

Done only when all gates pass or failures are documented as unrelated with evidence.

---

## 8. **Done criteria**

- Advisor Home quote launch is visually primary and above-the-fold.
- `/quote-v2` and `/voice-quote` links are reachable for every role that can see them.
- `/voice-quote` handoff uses one stable session ID and Quote Builder handles it.
- AI briefing never renders greeting-only.
- If no advisor data exists, the banner explains the empty state clearly.
- `generate-daily-briefing` scheduling is validated or added.
- Tests and verification gates pass with evidence.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "advisor-quote-home-AD0589", new_chat: false)