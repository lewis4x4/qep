# Sales Rep Home — Session Handoff

**Date:** 2026-04-24
**Prev session shipped:** Owner Home Option A (four-BU Pulse strip + locked numbers, execution pass 2 — wider canvas, 1/3+2/3 split, real GM%).
**Next target:** `iron_advisor` (Sales Rep) home on `/floor`, applying the Owner-Home execution pattern.
**Mission check:** Advances field-rep selling motion → ✅ Mission Fit, ✅ Operator Utility. "My Quotes by status" is the MUST-HAVE rep widget per product brief.

---

## 1. What shipped immediately before (anchor context)

The last three commits finished the Owner home:

```
a4b6fa2 Owner Home execution pass 2 — wider canvas, 1/3+2/3 split, real GM%
58ac7b2 Ship Owner Home Option A — four-BU Pulse strip + locked numbers
5d3a395 Seed 60-day BU Pulse data for Owner /floor strip
```

The **execution pattern** that worked for Owner — and that Sales Rep must follow:

1. **Wider canvas** than the old 3-column grid. Floor body renders full-width, not boxed.
2. **Hero-left / supporting-right split** (the Owner shipped as 2/3 + 1/3 for the revenue-pace + large-deals row; Sales Rep will mirror 2/3 hero + 1/3 rail).
3. **Locked numbers.** Zero placeholders. If a metric has no real source, it does not render. The Owner pass explicitly removed fake GM% and replaced it with the live `margin_analytics_view` signal.
4. **Data first, chrome last.** Queries are written against seeded tables; if data is missing, add a seed migration before styling.
5. **One primary action band, three cards max, exactly as the spec says.**

Any deviation from that pattern is a regression.

---

## 2. The spec — Sales Rep (`iron_advisor`)

Source of truth: [role-home-redesign.md:121-192](docs/role-home-redesign.md) ("Role: Sales Rep (`iron_advisor`) — Cole / David").

### Top bar quick actions (already wired in `DEFAULT_FLOOR_LAYOUTS.iron_advisor`)
1. **NEW QUOTE** → `/quote-v2`
2. **VOICE NOTE** → `/voice-qrm`
3. **MY PIPELINE** → `/qrm/deals?assigned_to=me`
4. Cmd+K OmniCommand covers search (no third top-bar button beyond the three above).

### 01 Narrative
- Pull from `floor-narrative` edge fn with `role=iron_advisor`.
- Signals: quotes awaiting reply, follow-ups due today, recent viewed quotes (buying signal).
- Example copy: *"3 follow-ups due today, 1 quote viewed by Jensen Ranch at 4pm, 1 overdue from Monday."*

### 02 Actions (exactly 3 cards)
1. **Hero — TODAY'S FOLLOW-UPS** → `/sales/today` or `/qrm/my/reality`
   - Hero number: count of due-today follow-ups (`follow_up_touchpoints.due_at::date = today`, assigned to me)
   - Aggregate: tied-up deal $ value
   - Urgency: `{n} overdue · {n} due today`
2. **NEW QUOTE** → `/quote-v2`
   - Pure-action card, no hero number
   - Aggregate: "Start from voice or scenario"
   - Sub-route chip: "Dictate instead →" links `/voice-quote`
3. **MY PIPELINE** → `/qrm/deals?assigned_to=me`
   - Hero number: count of active deals assigned to me
   - Aggregate: total $ value
   - Urgency: `{n} at decision stage`

### 03 The Floor — body

**Hero widget (largest area, ~2/3 width — mirror Owner's left column):**
- **`sales.my-quotes-by-status`** — grouped rows: Draft | Sent | Viewed | Approved | Declined | Expired. Columns: customer, product summary, value, days since sent, action. **This is the MUST HAVE from the product brief.**
- Registry entry already exists: [floor-widget-registry.tsx:320-329](apps/web/src/features/floor/lib/floor-widget-registry.tsx). Component `MyQuotesByStatusWidget` is referenced — verify it's real and wired end-to-end before styling.

**Right rail (≤ 2 supporting widgets, ~1/3 width):**
1. **`sales.ai-briefing`** — morning brief + next best actions. Adapter over [AiBriefingCard.tsx](apps/web/src/features/sales/components/AiBriefingCard.tsx), wired via `SalesAiBriefingFloorWidget`.
2. **Recent Activity** — last 5 touches this rep logged (`qrm_activities` filtered to me). Surfaces "quote viewed" signals when a customer opens a sent quote. **This is a NEW widget — not in the registry yet.** Build it.

**Below the fold (≤ 1 full-width table):**
- **My Deal Pipeline** — either `iron.pipeline-by-rep` scoped to me OR `qrm.follow-up-queue` expanded. Columns: deal, stage, next step, days in stage, action. Sortable.

### What is NOT on the home screen
- Deal Detail / Deal Room / Deal Coach
- Account 360
- Decision Room (rare)
- Customer Strategist / Account Genome / Ecosystem map
- **Commission MTD** — explicitly removed; rules don't exist (Surprise S4).

---

## 3. What already exists in the codebase

### Current default layout for `iron_advisor`
[default-layouts.ts:34-46](apps/web/src/features/floor/lib/default-layouts.ts):

```ts
iron_advisor: {
  widgets: [
    { id: "sales.my-quotes-by-status", order: 0 },
    { id: "sales.ai-briefing",         order: 1 },
    { id: "sales.action-items",        order: 2 },
    { id: "qrm.follow-up-queue",       order: 3 },
    { id: "quote.deal-copilot-summary", order: 4 },
  ],
  quickActions: [
    { id: "new_quote",    label: "NEW QUOTE",    route: "/quote-v2",                    icon: "quote" },
    { id: "voice_note",   label: "VOICE NOTE",   route: "/voice-qrm",                   icon: "voice" },
    { id: "my_pipeline",  label: "MY PIPELINE",  route: "/qrm/deals?assigned_to=me",    icon: "activity" },
  ],
  showNarrative: true,
},
```

The widget IDs match the spec. What needs verification/work:

| Widget ID | Status | Action |
|---|---|---|
| `sales.my-quotes-by-status` | Registered [:320](apps/web/src/features/floor/lib/floor-widget-registry.tsx) pointing to `MyQuotesByStatusWidget` | Verify the component renders against real `quote_packages.status` rows for the signed-in rep. Confirm the six status buckets work. |
| `sales.ai-briefing` | Adapter wired | Smoke-test; no known issues |
| `sales.action-items` | Real data via [ActionItemsWidget.tsx](apps/web/src/features/floor/widgets/ActionItemsWidget.tsx) joining `follow_up_touchpoints → cadences → qrm_deals` sorted DESC by deal $. | Keep; this is the "Today's Follow-Ups" aggregate surface. |
| `qrm.follow-up-queue` | Real | Candidate to drop if `sales.action-items` covers it. Decision: **drop from default layout** once rep hero confirms parity. |
| `quote.deal-copilot-summary` | Real; 5 most recent copilot turns | Keep in right rail. |

### Reusable Sales-feature components (already built — do not re-build)
Located in [`apps/web/src/features/sales/components/`](apps/web/src/features/sales/components):
- `AiBriefingCard.tsx` — morning brief
- `DaySummaryCard.tsx` — today's visits/calls/quotes count
- `ActionItemCard.tsx`, `PipelineSnapshot.tsx`, `PrepCard.tsx`
- `VoiceNoteCapture.tsx` — shared voice component (promote to top bar per Phase 4 note)

Existing rep mobile surface (reference, not the home target): [TodayFeedPage.tsx](apps/web/src/features/sales/pages/TodayFeedPage.tsx) under `/sales/today`.

### Seeded data
BU Pulse seed from `5d3a395` covers 60 days. For Sales Rep widgets the relevant tables are:
- `quote_packages` (status + days_since_sent)
- `follow_up_touchpoints` + `cadences`
- `qrm_deals` (assigned_to, stage, stage_changed_at, amount)
- `qrm_activities` (touches by user)
- `qb_quote_copilot_turns` (for copilot summary)

Seed status on these is assumed live from prior sprints. **Before styling, run a data audit** — query each table for the Sales Team shared user (`iron_advisor`) and confirm non-empty results. If empty, add a rep-scoped seed migration *before* touching UI.

---

## 4. Execution plan (do this in order)

### Phase A — Data audit (30 min)
1. Identify the signed-in user ID used by the Sales Team shared account (`iron_role = 'iron_advisor'`). Confirm from `profiles`.
2. Run live queries against `quote_packages`, `follow_up_touchpoints`, `qrm_deals`, `qrm_activities` filtered to that user. Record counts.
3. If any hero widget's source is empty, write a seed migration (`NNN_seed_iron_advisor_floor.sql`) following the canonical sequence. Pattern: copy the shape of `migrations/*_seed_bu_pulse_*.sql`.

### Phase B — Verify `sales.my-quotes-by-status` (the MUST-HAVE)
1. Open [floor-widget-registry.tsx:320](apps/web/src/features/floor/lib/floor-widget-registry.tsx) and find the `MyQuotesByStatusWidget` import.
2. Read the component. Confirm it:
   - Queries `quote_packages` where `assigned_to = auth.uid()` (or equivalent).
   - Groups by status: Draft / Sent / Viewed / Approved / Declined / Expired.
   - Renders customer, product summary, value, days since sent, action column.
   - Has a working action per row (open quote detail at `/quote-v2/{id}` or `/quotes/{id}`).
3. If anything is missing, fix inline. No new files unless the widget doesn't exist.

### Phase C — Apply the Owner-Home execution pattern
1. In the Floor body for `iron_advisor`, render a 2/3 + 1/3 split on desktop:
   - **Left (2/3):** `sales.my-quotes-by-status` hero.
   - **Right (1/3):** `sales.ai-briefing` stacked above `sales.action-items`.
2. **Below the fold, full width:** `qrm.follow-up-queue` or pipeline-scoped-to-me table.
3. Drop the stale `quote.deal-copilot-summary` from the home default — it belongs on a deal detail surface, not the home. (The registry entry stays; just remove from default-layouts.)
4. Mobile: all widgets stack single-column, hero first.

### Phase D — Narrative + quick actions
1. Confirm the `floor-narrative` edge fn returns live copy for `iron_advisor`. If it's static, wire real signal counts (follow-ups due today, overdue, quote viewed events).
2. Quick actions are already correct in `default-layouts.ts` — leave them.

### Phase E — Build and release gates (mandatory per CLAUDE.md)
1. `bun run migrations:check`
2. `bun run build` at repo root
3. `bun run build` in `apps/web`
4. Edge-function / contract tests for any touched surfaces
5. Role/workspace RLS check: signed-in Sales Team user must only see their own quotes / follow-ups / deals. **This is the security gate — do not skip.**

### Phase F — Visual proof
1. `preview_start`, visit `/floor` as the Sales Team shared user.
2. Screenshot desktop + mobile layouts.
3. Verify: hero widget renders real quotes, right rail has live briefing + action items, below-fold pipeline is scoped to me, no placeholders.

---

## 5. Gotchas the prior session hit (avoid repeating)

1. **Commission MTD is a trap.** Every time it sneaks back in, pull it out. The widget [`sales.commission-to-date`](apps/web/src/features/floor/lib/floor-widget-registry.tsx:352) exists as a source-of-truth surface but the home screen does **not** render it.
2. **The old 3-col grid looks busy.** Owner shipped twice — first ship was right on content, wrong on canvas. Go straight to the 2/3 + 1/3 split.
3. **`verify_jwt` must match between config.toml and deploy.** Any edge fn touched by this slice — if `verify_jwt` changes in `config.toml`, it does **not** propagate to prod without a redeploy. See `feedback_deploy_verify_jwt_preserves.md` in memory.
4. **Edge fns must pass the JWT explicitly** to `auth.getUser(token)` — the arg-less variant silently 401s on Deno. See `feedback_supabase_jwt_auth.md`.
5. **No architecture reset.** Build on the existing registry + default-layouts contract. Don't create a parallel sales-home component.

---

## 6. Files to open first (in order)

1. [docs/role-home-redesign.md:121-192](docs/role-home-redesign.md) — spec
2. [apps/web/src/features/floor/lib/default-layouts.ts:34](apps/web/src/features/floor/lib/default-layouts.ts) — current iron_advisor layout
3. [apps/web/src/features/floor/lib/floor-widget-registry.tsx:299-358](apps/web/src/features/floor/lib/floor-widget-registry.tsx) — sales widget registrations
4. [apps/web/src/features/floor/widgets/ActionItemsWidget.tsx](apps/web/src/features/floor/widgets/ActionItemsWidget.tsx) — working rep widget
5. [apps/web/src/features/floor/widgets/BuPulseStrip.tsx](apps/web/src/features/floor/widgets/BuPulseStrip.tsx) — Owner pattern to mirror
6. [apps/web/src/features/floor/pages/FloorPage.tsx](apps/web/src/features/floor/pages/FloorPage.tsx) — how the page composes widgets + role copy
7. [apps/web/src/features/sales/components/AiBriefingCard.tsx](apps/web/src/features/sales/components/AiBriefingCard.tsx) — right-rail hero
8. [docs/ui-overhaul-handoff.md](docs/ui-overhaul-handoff.md) — shell + VIEW AS context

---

## 7. Success criteria (mission-locked)

A 12-year-old signing in as the Sales Team shared user lands on `/floor` and:
- Reads one sentence that tells them what's pressing today.
- Sees their quotes grouped by status, with the most-stale Sent/Viewed quotes at the top.
- Can fire a new quote, a voice note, or jump to their pipeline in one click from the top bar.
- Sees their real follow-ups due today, sorted by deal $, with a one-tap mark-done.
- Sees no number that isn't real.

When that works on desktop and mobile, commit, push, report, and continue to the next roadmap item per CLAUDE.md execution cadence.

---

## 8. Prompt for the new session

Paste this as the opening message of the fresh session:

> Continue QEP OS build. Read `docs/sales-rep-home-handoff.md` first — it has the full spec, current state, execution plan, and gotchas. Ship the Sales Rep (`iron_advisor`) home on `/floor` applying the same 2/3 + 1/3 canvas pattern we just shipped for Owner. Start with Phase A data audit, then verify `sales.my-quotes-by-status`, then compose the layout. Follow the build/release gates in `CLAUDE.md`. Do not render any placeholder numbers. No architecture reset.
