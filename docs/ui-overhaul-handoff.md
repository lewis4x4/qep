# QEP UI Overhaul — Handoff Spec

**Source:** `docs/QEP UI Overhail Issues.docx`
**Audience:** Implementing builder (senior engineer)
**Status:** **DECISIONS LOCKED. Execute-ready.** (confirmed by Brian 2026-04-24)
**Success bar:** a 12-year-old can navigate QEP without instruction.

---

## 0. What the request says vs. what the real problem is

**Stated request (Brian's words, paraphrased):**
Fix UI inconsistencies across the app in one unified pass. Reference the menu on `/sales/quotes` as the gold standard. `/floor` is missing that menu. Role-based home routing needs to respect the logged-in user, with admins defaulting to the Owner view and able to preview other roles. `/sales/field-note` has small UI issues. `/voice-quote` is graphically beautiful but is a *UI shell* — it shows fabricated transcript and scenario content on first visit and must be wired end-to-end.

**Underlying problem:**
The app has two independent shells (`AppLayout` vs. `FloorTopBar`) that never converged. The gold-standard menu lives in `AppLayout`; `/floor` intentionally opted out during an earlier rollout. That fork is the root cause of Brian's "no top menu on /floor" complaint, and the role-preview toggle was never built because there was no shell to host it. Separately, `/voice-quote` is seeded with mock state that was never stripped out after the design demo — its data flow works, but the initial render lies.

This is **one architectural merge** plus **one state-seeding bug** plus **small polish** — not four unrelated UI issues.

---

## 1. Decisions (confirmed by Brian — builder may proceed)

| # | Question | Decision |
|---|---|---|
| A1 | What is "OFFICE VIEW" in the top-right? | **Label only.** Text badge confirming admin is viewing office-mode Floor. Not a button. |
| A2 | Where does the admin role-preview switcher live? | **Dedicated "VIEW AS" chip in the top bar**, positioned near BACK TO THE FLOOR. Visible only to admin/manager/owner roles. |
| A3 | Which roles can Brian / Ryan / Rylee preview? | **All six operator roles**: Sales Manager, Sales Rep, Parts Counter, Parts Manager, Deal Desk, Prep/Service. Preview is read-only. |
| A4 | Sales Team UUID `a5d1c0b5-…` — what iron_role? | **`iron_advisor`** (Sales Rep). |
| A5 | **Angela Land — Parts Counter or Parts Manager?** | **`iron_parts_manager`.** Angela IS the Parts Manager. |
| A5a | **Parts Team shared account + Norman + Bobby + Juan — which role?** | **`iron_parts_counter`.** Everyone except Angela who touches parts is Parts Counter. |
| A6 | `/sales/field-note` issues scope | **Visual polish only.** No walkthrough needed. Tighten alignment, normalize density, align status-badge colors with `/sales/quotes`. |
| A7 | `/voice-quote` first-visit behavior | **Start at step 1 (Record) with empty state.** Auto-restore only if the user has an explicit in-progress `voice_captures` row from their own `user_id` in the last 24h. |
| A8 | `BACK TO THE FLOOR` on `/floor` itself? | **No.** On `/floor` the QEP wordmark stands alone; the crumb shows on every other authenticated route. |
| A9 | Rule for the orange primary CTA in the top bar | **Page-declared.** Each route exports `{label, route|onClick, shortcut}`. Defaults to `QRM Hub / ⌘N` when not declared. |
| A10 | Top-bar search scope | **Global Cmd+K OmniCommand** — same search everywhere. No page-local search in the top bar. |

All decisions are final. No further product calls required before Phase 1 begins.

---

## 2. Problem statement

QEP has one shared shell (`AppLayout`) that delivers a gold-standard, mobile-responsive top menu on every route except `/floor`. `/floor` runs on its own stripped shell (`FloorTopBar`), which creates navigational dead-ends and blocks the admin role-preview feature. Separately, `/voice-quote` renders a fabricated transcript and scenarios on first visit because demo-seed state was never removed.

The fix is one shell for the whole app, one role-aware landing behavior for admins, and a rigorous state-clean pass on Voice Quote.

---

## 3. Target users and primary use cases

| User | Real person(s) | iron_role | Primary landing | Primary daily job |
|---|---|---|---|---|
| **Owner** | Brian Lewis, Ryan McKenzie, Rylee McKenzie | `iron_owner` | `/floor` → Owner home, VIEW AS visible | Glance at health + revenue pace, approve escalated deals |
| **Sales Rep** | Sales Team shared account | `iron_advisor` | `/floor` → Sales Rep home | New quote, follow-ups, log visits |
| **Parts Manager** | **Angela Land** | `iron_parts_manager` | `/floor` → Parts Manager home | Demand forecast, replenishment, supplier health |
| **Parts Counter** | **Parts Team shared account (Norman, Bobby, Juan, etc.)** | `iron_parts_counter` | `/floor` → Parts Counter home | Serial lookup, parts quote drafts, order status |
| **Sales Manager** | (future) | `iron_manager` | `/floor` → Sales Manager home | Approvals, pipeline by advisor |
| **Deal Desk** | (future) | `iron_woman` | `/floor` → Deal Desk home | Approval queue, credit apps, deposits |
| **Prep / Service** | (future) | `iron_man` | `/floor` → Prep/Service home | Prep queue, PDI, parts pickup |

**Primary use case for all roles:** land on `/floor`, read the narrative, act on the 3 quick-action cards or the hero widget, or jump to a sibling surface (QRM / Sales / Parts / Service / Rentals) via the top menu.

**12-year-old test:** a stranger logging in should (a) identify which section they are in from the top bar, (b) find a named action in ≤ 2 clicks from the home screen, and (c) return home from anywhere in one click on the "BACK TO THE FLOOR" breadcrumb or the QEP wordmark.

---

## 4. Scope

### 4.1 In scope (v1 — this overhaul)

1. **One shell across the app.** `/floor` renders inside `AppLayout`. `FloorTopBar` is removed (or demoted to an internal subcomponent). Every authenticated route shows the same gold-standard top menu with the same behaviors: Cmd+K search, mobile hamburger collapse, notifications, dark-mode toggle, avatar.
2. **Role-aware `/floor` landing.** On every page load `/floor` resolves the logged-in user's iron_role via `useIronRoleBlend` + `getEffectiveIronRole` (already working) and renders that role's layout. No logic change — the change is that it now renders *inside* `AppLayout`.
3. **VIEW AS switcher.** A new top-bar chip, admin-only, lets Brian / Ryan / Rylee preview any of the six operator role homes without signing in as a test user. Preview is non-destructive: it renders the chosen role's `floor_layouts` row and does not persist the user's `iron_role`.
4. **Named-user iron_role normalization.** Brian, Ryan, Rylee → `iron_owner`. Sales Team → `iron_advisor`. Angela Land → `iron_parts_manager`. Parts Team → `iron_parts_counter`. Done via a single migration that touches only the `iron_role` column.
5. **Voice Quote state reset.** First-visit render shows step 1 (Record), recording zone primed but idle, empty transcript, no extracted details, no scenarios, no highlighted recent-quotes row. All demo-seed data removed. End-to-end flow verified against `voice_captures` + `qb_packages` + `qb_ai_request_log`.
6. **Field Note visual polish.** Alignment / density tightening; status-badge color parity with `/sales/quotes`. No structural change; no walkthrough.
7. **Mobile parity.** Every page in v1 scope must pass the `/sales/quotes` mobile benchmark: menu collapses to hamburger, KPI cards stack 1–2 per row, tables become horizontally-scrollable or card-listed, CTAs remain within thumb reach.

### 4.2 Explicitly out of scope

- New widgets. Widget inventory stays the same.
- New role homes beyond the seven already seeded in `default-layouts.ts`.
- Changes to approval logic, quote math, or any backend RPCs.
- New migrations other than the iron_role normalization in §4.4.
- Rewriting the visual language. `docs/floor/visual-language.md` is the source of truth.

### 4.3 Phase 2+ (deferred)

- VIEW AS with write-mode (full impersonation that audits to a log). v1 is read-only preview.
- Multi-role blend editor UI (data model supports it via `profile_role_blend`; no admin UI yet).
- Page-scoped search replacing global OmniCommand on QRM / Parts / Service.
- Global keyboard-shortcut layer (`g a` approvals, `g q` quotes, etc.).

---

## 5. Design principles (the "gold standard" defined)

Derived from images 2 and 4 in the source doc. Non-negotiables.

1. **One top bar.** `← BACK TO THE FLOOR` left breadcrumb, `OFFICE VIEW` right-aligned context label, QEP logo, left nav (QRM / Sales / Parts / Service / Rentals with dropdown carets), global search `⌘K`, `SYSTEM` menu, primary orange CTA, dark-mode toggle, notification bell, avatar.
2. **Orange = action.** Exactly one orange element per view (the primary CTA). Highlights, hover states, and pills on the active nav item use orange at 60–80% opacity. Never use orange for destructive actions.
3. **Dark only on `/floor`.** `AppLayout` respects the user's theme preference everywhere else. `/floor` continues to force dark mode — that stays.
4. **Mobile collapses predictably.** See `/sales/quotes` mobile (image 5): top menu becomes hamburger, content stacks, filter tabs become a horizontally-scrollable strip, tables become card lists. This IS the mobile pattern for the entire app.
5. **Every page has a first line and a primary action.** The page header shows a subtitle ("POST-VISIT CAPTURE"), a title ("Field Note"), a status badge row ("Online · 0 notes queued"), then the primary CTA on the right.
6. **Empty states never lie.** Placeholder text is labeled as such ("Auto-match after recording"). Demo-seed state that simulates real user data must be removed before build ships. This is the Voice Quote rule codified.
7. **Back is always one click.** `BACK TO THE FLOOR` works from every authenticated route. On `/floor` the wordmark replaces the crumb.

---

## 6. Information architecture

### 6.1 Top menu (gold standard, unchanged)

Fixed order left-to-right: **QRM · Sales · Parts · Service · Rentals**. Each is a dropdown with contextual sub-routes. Active route gets an orange pill.

### 6.2 Role → home mapping

| iron_role | `/floor` lands on | Hero widget | Default quick actions |
|---|---|---|---|
| `iron_owner` | Owner home | Morning brief + revenue pace | Ask Iron · Open Pipeline · Monthly Report |
| `iron_manager` | Manager home | Pipeline by Advisor | Open Approvals · New Quote · Nudge Rep |
| `iron_advisor` | Sales Rep home | My Quotes by status | New Quote · Voice Note · My Pipeline |
| `iron_parts_counter` | Parts Counter home | Serial-first input (hero band) | New Parts Quote · Open Drafts |
| `iron_parts_manager` | Parts Manager home | Demand Forecast + Inventory Health | Review Replen · Inventory · Supplier Status |
| `iron_woman` | Deal Desk home | Approval Queue (SLA-sorted) | Approval Queue · Credit Apps · Margin Reviews |
| `iron_man` | Prep/Service home | Prep Queue (editable inline) | Next Job · PDI Checklist · Today's Demos |

Source: `docs/role-home-redesign.md`. No changes in this overhaul.

### 6.3 Admin → Owner → VIEW AS flow

```
Login as admin (Brian / Ryan / Rylee — iron_owner)
  → land on /floor (Owner home)
  → top bar shows "VIEW AS ▾" chip
  → click → dropdown lists six operator roles
  → select Sales Rep
  → /floor re-renders with Sales Rep layout
  → top bar chip now reads "VIEW AS · Sales Rep · Exit"
  → click Exit → back to Owner home
```

Preview URL is shareable via query param: `/floor?viewAs=iron_advisor`. The shell reads the param, confirms the current user has admin/owner role, and passes the iron_role to `useFloorLayout`. RLS is NOT bypassed — the previewed widgets render only data the admin themselves can see.

### 6.4 Profile UUID → iron_role mapping (LOCKED)

| UUID | Person | iron_role |
|---|---|---|
| `b8da7fa8-aa61-4743-abb4-5c5159c93bd3` | Brian Lewis | `iron_owner` |
| `3162f130-021a-45d4-a13c-be98f357a38b` | Ryan McKenzie | `iron_owner` |
| `16f60dc8-0efe-4cdc-9ab7-7b5b1d017e53` | Rylee McKenzie | `iron_owner` |
| `a5d1c0b5-0f7f-4260-9c93-ffafeb59fce3` | Sales Team | `iron_advisor` |
| `42f4c3fc-e469-41b1-9fad-ff225c9a9d6d` | **Angela Land** | **`iron_parts_manager`** |
| `ba288edb-d722-4e27-a6fd-afbdcd3d6e46` | **Parts Team (Norman / Bobby / Juan / etc.)** | **`iron_parts_counter`** |

**Normalization migration:** `387_seed_profile_iron_roles_for_named_users.sql`. Updates `iron_role` only; the existing `sync_iron_role` trigger cascades to `profile_role_blend`. Audit rows are written automatically. Migration uses `WHERE id IN (...) RETURNING id` and fails loudly if the returned row count ≠ 6.

---

## 7. Per-page specs

### 7.1 `/floor` (PRIMARY FIX)

**Current state:** renders `FloorPage` directly, bypassing `AppLayout`. Has its own `FloorTopBar` with JUMP TO menu and an admin Compose link but no unified search, notifications, theme toggle, or VIEW AS chip.

**Target state:** wrapped in `AppLayout`. `FloorTopBar` is deleted (or reduced to a slim internal component). Zone labels `01 NARRATIVE`, `02 ACTIONS`, `03 THE FLOOR` remain as internal content framing.

**Changes:**
1. In `apps/web/src/App.tsx` at the `/floor` route, wrap `<FloorPage>` in `<AppLayout>` (follow the `SalesOrAppLayout` pattern).
2. In `FloorPage.tsx`, delete the `<FloorTopBar>` render. The AppLayout header now provides it.
3. Preserve: dark-mode forcing, zone labels, attention pinning, serial-action-band carve-out, narrative freshness indicator.
4. AppLayout suppresses the `BACK TO THE FLOOR` breadcrumb when `location.pathname === "/floor"` (per A8).
5. The `/floor/compose` admin affordance moves into AppLayout's SYSTEM menu (or avatar menu) as "Edit Layout."
6. Typecheck + build + Playwright visual diff on `/floor` and `/sales/quotes` to confirm no regression.

**Acceptance:**
- `/floor` renders the exact gold-standard top menu from image 2.
- Every one of the 7 iron_roles still sees their role-specific layout below the menu.
- Mobile: hamburger collapse works identically to `/sales/quotes` mobile.

### 7.2 `/sales/quotes` (NO CHANGES — GOLD STANDARD)

This page is the reference. Do not touch it except to extract reusable components (e.g., the header-status-badge row, the KPI-card cluster) into `apps/web/src/components/` so other pages can adopt the same pattern.

### 7.3 `/sales/field-note` (VISUAL POLISH ONLY)

**Current state:** gold-standard menu ✓, 5-step stepper ✓, recording zone with mic ✓, placeholder-labeled extracted-details panels, recent-recordings table.

**Changes (visual only — no restructuring):**
- Align vertical rhythm of the three right-rail panels (QRM MATCH & DESTINATION, GET THE BEST RESULTS, OFFLINE & SYNC STATUS) with the left column height.
- Normalize status-badge colors with `/sales/quotes` palette (Needs match, Synced, Active, Ready).
- Tighten density: reduce whitespace in the EXTRACTED DETAILS (PREVIEW) rows so the panel doesn't dominate.
- Confirm empty-state copy reads as preview ("Auto-match after recording", "Models, categories, attachments") — adjust only if a user could read it as real data.

**Acceptance:** side-by-side diff with current — Brian signs off on screenshots before merging.

### 7.4 `/voice-quote` (CRITICAL FIX)

**Current state (per image 8):** page loads with a pre-populated live transcript ("Amanda at Red River Demolition needs a compact track loader…"), fully populated extracted details with High/Medium confidence badges, and three rendered scenarios (Options A/B/C at $49,750 / $56,250 / $64,850). The stepper is stuck on step 3 "Compare scenarios." This is demo-seed state left over from a design review.

**Target state:**
- Stepper on step 1: **Record**.
- Voice Capture card shows the orange mic button, 00:00 timer, "Tap to record or press Enter" prompt.
- Live Transcript panel reads "Transcript preview appears here after recording" or equivalent empty-state copy.
- Extracted Details panel shows placeholder rows labeled "— detected after transcript is ready".
- Scenarios panel shows "Scenarios appear after you review the extracted details".
- Recent Voice Quotes table loads the user's real past sessions from `voice_captures`.

**Work plan:**
1. `apps/web/src/features/voice-quote/pages/VoiceQuotePage.tsx` — remove any hardcoded `sampleTranscript`, `mockScenarios`, `demoExtractedDetails` constants. Initial useState values become `null` / `[]`.
2. Verify the page hooks call `voice-capture` and `qb-ai-scenarios` edge functions on user action, not on mount.
3. Trace flow end-to-end: record → MediaRecorder blob → `voice-qrm` edge fn → transcript stored → extract runs → scenarios generated → click "Open in Quote Builder" → `sessionStorage` handoff key → `/quote-v2` pre-fills draft. Document in `docs/voice-quote-flow.md`.
4. Write Playwright smoke: land on `/voice-quote`, assert stepper is on step 1, assert empty-state copy, assert no scenarios rendered. Committed to `apps/web/tests/voice-quote.spec.ts`.
5. If any edge function returns mock data (not just the UI), fix at the edge-function boundary.
6. Per A7: auto-restore ONLY when a `voice_captures` row exists for `user_id = current_user AND status IN ('pending', 'transcribing', 'extracting') AND created_at > now() - interval '24 hours'`. Otherwise: empty state.

**Acceptance:**
- Playwright smoke passes in CI.
- Fresh incognito session, log in, go to `/voice-quote`, see step 1 / empty state.
- Record a 10s test note → step advances → transcript appears → extracted details populate → two-to-four scenarios render → "Open in Quote Builder" navigates to `/quote-v2` with the scenario pre-filled.

### 7.5 Universal — shared `<PageHeader>` component

Extract a shared header used by Quotes, Field Note, Voice Quote, QRM pages, Service pages:

```
<PageHeader
  subtitle="POST-VISIT CAPTURE"
  title="Field Note"
  badges={[{label: "Online", tone: "ok"}, {label: "0 notes queued", tone: "muted"}]}
  primaryAction={{label: "Record", onClick: startRecording, shortcut: "R"}}
/>
```

Not applied to `/floor` — the Floor header is the narrative + zone labels.

---

## 8. Success criteria (measurable)

| # | Criterion | How to measure |
|---|---|---|
| S1 | Every authenticated route has the same top menu | Playwright visual-diff across 10 representative routes |
| S2 | `/floor` renders inside `AppLayout` | `FloorTopBar` import count in the codebase = 0; `AppLayout` wraps `/floor` in App.tsx |
| S3 | VIEW AS works for all 6 operator roles | Manual QA sign-off by Brian; Playwright test switches between 6 roles in one session |
| S4 | Brian / Ryan / Rylee land on Owner home; Angela lands on Parts Manager home; Parts Team lands on Parts Counter home | Log-in smoke for each UUID → assert hero widget matches expected role |
| S5 | Voice Quote first-visit shows empty state | Playwright smoke: incognito → `/voice-quote` → assert step 1, no scenarios |
| S6 | Mobile parity | Every v1 route passes the `/sales/quotes` mobile benchmark (menu collapses, content stacks, no horizontal overflow) |
| S7 | 12-year-old navigation test | Brian runs through as a stranger: reach any stated goal in ≤ 3 clicks from home; label on each button predicts what happens before clicking. Pass/fail. |
| S8 | Performance — first contentful paint on `/floor` ≤ 1.5s on production (Fast 3G simulated) | Lighthouse CI on Netlify deploy preview |
| S9 | No regressions on `/sales/quotes` | Visual diff + functional smoke before / after |
| S10 | Zero demo-seed strings in Voice Quote source | `grep VoiceQuotePage.tsx` for `"Amanda"`, `"Red River"`, `"Option A"`, `"$49"` → count = 0 |

---

## 9. Risks and assumptions

### Assumptions (labeled)

- **ASSUMPTION:** Wrapping `/floor` in `AppLayout` is a mechanical change with no data-flow impact. FloorTopBar's internal state (JUMP TO menu, admin Compose link) can be moved to AppLayout or deleted. *Mitigation:* typecheck + Playwright smoke on `/floor` before merge.
- **ASSUMPTION:** All six UUIDs in §6.4 exist in `profiles` today with non-null iron_role. *Mitigation:* migration 387 uses `WHERE id IN (...) RETURNING id`; builder verifies the returned count is exactly 6 before committing.
- **ASSUMPTION:** `/voice-quote` demo-seed state lives only in the React component, not in edge functions or DB. *Mitigation:* work-plan step 5 inspects edge functions and fixes at the boundary if needed.

### Risks (ranked)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Floor's dark-mode forcing conflicts with AppLayout's theme negotiation | Medium | Medium | Keep the dark-mode effect inside `FloorPage`, not AppLayout. AppLayout stays theme-respecting; Floor overrides the doc class while mounted. |
| A widget inside a role's layout throws when rendered inside AppLayout's max-width container (e.g. a map/chart that assumed full-bleed) | Medium | Low | QA pass per role after the merge; add container-query-safe wrappers where needed. |
| VIEW AS URL-tampering — `?viewAs=iron_advisor` enables role preview for non-admins | Low | Medium | Shell checks `canUseElevatedQrmScopes(userRole, ironRole)` before honoring the param. Silent ignore for non-admins. |
| Voice Quote edge functions return placeholder scenarios when no real transcript is sent | Low | High | Work-plan step 5 inspects `voice-qrm` and `qb-ai-scenarios` and fixes at the edge-function boundary. |
| Normalization migration overwrites a legitimate role blend | Low | Medium | Migration touches only the `iron_role` column. `profile_role_blend` is untouched. The `sync_iron_role` trigger handles cascade. |

---

## 10. Build order — phased, each phase independently shippable

### Phase 1 — Shell unification (biggest user-visible win, lowest risk)
**Scope:** §4.1 items 1 and 2 (one shell + role-aware Floor).
**Ships independently:** yes. `/floor` now looks and behaves like every other route.
**Tasks:**
1. Confirm only `FloorPage` uses `FloorTopBar`.
2. Route `/floor` through `AppLayout` in `App.tsx`.
3. Remove `FloorTopBar` import + render from `FloorPage.tsx`.
4. AppLayout: suppress `BACK TO THE FLOOR` breadcrumb when `location.pathname === "/floor"`.
5. Move `/floor/compose` admin link to AppLayout SYSTEM (or avatar) menu.
6. Typecheck + build + Playwright visual diff on `/floor` and `/sales/quotes`.
**Ship gate:** Netlify preview green, Brian signs off visually.

### Phase 2 — iron_role normalization + VIEW AS switcher
**Scope:** §4.1 items 3 and 4.
**Depends on:** Phase 1 (AppLayout hosts the switcher).
**Tasks:**
1. Write migration `387_seed_profile_iron_roles_for_named_users.sql`:
   - Brian / Ryan / Rylee → `iron_owner`
   - Sales Team → `iron_advisor`
   - Angela Land → `iron_parts_manager`
   - Parts Team → `iron_parts_counter`
   - Verify RETURNING row count = 6.
2. Build `<ViewAsChip>` component inside AppLayout top bar. Admin-only visibility.
3. Wire `?viewAs=iron_role` query param into `useFloorLayout` — bypass `getEffectiveIronRole` when set.
4. Add guard: ignore `viewAs` for non-admin users (silent).
5. Playwright: log in as Brian's UUID, switch to Sales Rep, confirm hero widget changes. Repeat for Angela (Parts Manager) and Parts Team (Parts Counter).
**Ship gate:** all 6 named users land on expected role home; VIEW AS works for all 6 operator roles.

### Phase 3 — Voice Quote state reset (critical correctness fix)
**Scope:** §4.1 item 5.
**Depends on:** nothing in this overhaul — can run in parallel with Phase 1.
**Tasks:**
1. Strip all hardcoded demo content from `VoiceQuotePage.tsx`.
2. Verify edge functions `voice-qrm`, `qb-ai-scenarios` do not return mock data.
3. Wire the auto-restore rule (A7): restore only if `voice_captures` row exists for current user in pending/transcribing/extracting status within last 24h.
4. Write Playwright smoke for first-visit empty state.
5. Write Playwright smoke for the happy path (record → scenarios → open in Quote Builder).
6. Document the end-to-end flow in `docs/voice-quote-flow.md`.
**Ship gate:** both Playwright specs pass in CI; manual incognito test by Brian.

### Phase 4 — Field Note visual polish
**Scope:** §4.1 item 6.
**Depends on:** Phase 1 (shared `PageHeader` lives in the unified shell).
**Tasks:**
1. Align right-rail panel heights with the left column.
2. Normalize status-badge colors with `/sales/quotes`.
3. Tighten density of EXTRACTED DETAILS (PREVIEW) rows.
4. Verify empty-state copy clearly reads as preview.
**Ship gate:** side-by-side screenshots, Brian signs off.

### Phase 5 — Mobile parity audit
**Scope:** §4.1 item 7.
**Depends on:** Phase 1.
**Tasks:**
1. Run `/sales/quotes` mobile benchmark against every v1 route.
2. Fix layout breakages one at a time.
3. Commit `docs/mobile-parity-audit.md` listing each route's pass/fail + fix notes.
**Ship gate:** all v1 routes pass.

### Phase order rationale
- **Phase 1 first** — largest perceptual win (Brian's primary complaint), unlocks 2 + 4 + 5.
- **Phase 3 parallel** — Voice Quote is architecturally independent.
- **Phase 2 after Phase 1** — needs AppLayout to host VIEW AS.
- **Phase 4 after Phase 1** — uses the shared `PageHeader`.
- **Phase 5 last** — mobile validation is a closing sweep.

---

## 11. What ships for Brian to review after each phase

- **After Phase 1:** a Netlify preview URL where `/floor` looks like image 2 up top and the role home below. One screenshot per role (6 roles × desktop + mobile = 12 screenshots).
- **After Phase 2:** Brian logs into production and confirms his UUID lands on Owner home; switches through all six roles via VIEW AS.
- **After Phase 3:** Playwright report + 30-second Loom of an incognito session going Voice Quote → record → scenarios → Quote Builder, proving no mock data.
- **After Phase 4:** before/after diff of Field Note.
- **After Phase 5:** `docs/mobile-parity-audit.md` with pass/fail per route.

---

## 12. Kickoff checklist (Phase 1 starts immediately)

All ambiguities are resolved. All decisions are locked. The builder should:

1. ✅ Read this doc end-to-end.
2. ✅ Confirm the six UUIDs in §6.4 map as stated (one-line SQL pull).
3. ✅ Start Phase 1.

No further product calls required.

---

## 13. One more thing

Everything in this spec exists in the codebase today except the `<ViewAsChip>` component and migration 387. No new backend tables. No new RPCs. No new widgets. The overhaul is **one merge of two shells** + **one state-bug fix** + **small polish** — exactly as the problem statement frames it.

If the builder finds themselves adding a table, a widget, or an edge function to complete any of the 5 phases, **stop and ask.** Scope drift is the most likely failure mode for this pass.
