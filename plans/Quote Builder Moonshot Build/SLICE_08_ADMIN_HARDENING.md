# SLICE 08 — Admin Hardening & QA Infrastructure

**Status:** Planned. Needs owner Q&A before execution (see below).

**Depends on:** Slice 07 + 4 post-merge audit fixes — all on main.
- Slice 07 merge: `e2a2be8`
- Audit fixes: `7426ef3` (C1), `ea56ed8` (H1+M1), `3a0b103` (H2), `f8f3650` (polish bundle)

**Branch:** `claude/qep-qb-08-admin-hardening`
**Next migration:** 302 (only if CP5 adds one — see Data Model Summary)

**Source of truth:** This plan addresses the 5 remaining findings from the Slice 07 post-merge audit (`SLICE_07_PRICE_SHEET_ADMIN.md` audit scorecard). All filenames and paths verified against main at the audit-fix branch head.

---

## What This Slice Is NOT

This slice does not ship new operator-facing features. It is **pure resilience + regression defense work**. Owners who expect new user value in every slice should understand: this slice pays down the rough edges in the admin surface shipped by Slices 06–07 so we don't re-litigate them when building Slice 09+.

If that trade-off is not acceptable, fold CPs 1–4 into Slice 09 and defer CPs 5–8 to a dedicated QA-infra slice.

---

## Scope Questions — Need Owner Resolution

| # | Question | Context | Recommendation |
|---|---|---|---|
| Q1 | When `publish-price-sheet` or `extract-price-sheet` fails, where do those events land? | Today: `console.warn`/`console.error` only. Angela and ops have no alerting. Options: (A) `flare_reports` table — already wired, visible in the Flare admin UI, works for admin failures; (B) existing `event_tracker` infrastructure — better for aggregation/time-series but no UI today; (C) new `qb_admin_events` table with its own list page. | **A — flare_reports.** Zero new schema. Reuses the existing flare triage flow admins already use. Low blast radius. |
| Q2 | Integration test runtime — `bun:test` + `happy-dom`, or Playwright against the dev server? | `happy-dom` is fast (seconds), runs in the existing bun test suite, doesn't need a real browser. Playwright catches real browser quirks but adds CI minutes and a separate runner. | **happy-dom + bun:test.** Faster feedback loop, keeps tests colocated with unit tests. Playwright in a later slice if we hit genuine browser bugs. |
| Q3 | `<RequireAdmin>` behavior when profile hasn't loaded yet | Current admin pages render early-return `<Navigate>` on falsy profile, which triggers navigation during the loading millisecond. Options: (A) show a loading spinner while `auth.loading === true`; (B) keep current behavior but fix the hooks-order violation. | **A — loading spinner.** Better UX than a flash of redirect, aligns with how the app shell already handles loading. |
| Q4 | Should failed uploads get a "retry this sheet" admin surface, or is the drawer-level retry sufficient? | Today: drawer-level retry exists (H1 fix). But if the user closes the drawer mid-failure, the failed sheet row is orphaned in `qb_price_sheets` with no UI to resume it. | **Defer.** The drawer-level retry covers the common path. Orphaned-sheet recovery is future work — only matters if staff closes the drawer during a 90s extract, which is an edge case on an edge case. |

---

## Objective

Close the 5 open findings from the Slice 07 audit and raise the floor on admin-surface resilience. Specifically:

1. **Eliminate the Rules-of-Hooks latent bug** in all admin pages via a single `<RequireAdmin>` wrapper (H3).
2. **Surface extract/publish failures to operators** via the existing flare pipeline (M2).
3. **Establish a lightweight e2e integration test harness** and write the first two flow tests (M3).
4. **Tighten the `active_workspace_id` contract** so a workspace-less profile fails gracefully instead of crashing (M4).
5. **Manual dark-mode audit** of the admin surfaces with specific fixes for any contrast issues (L2).

---

## Why This Slice

The post-Slice-07 audit closed 8 of 13 findings as point-fixes. The remaining 5 share a common trait: they're **cross-cutting** or **need infrastructure**, not quick edits.

- **H3 is a pattern bug** — 4 admin pages (`PriceSheetsPage`, `DealEconomicsPage`, `AiRequestLogPage`, `BranchManagementPage`) all early-return `<Navigate>` after some hooks but before others. Fixing one page doesn't help the others. A wrapper component is the right primitive.
- **M2 needs a design call** — where does ops see these events? Answered in Q1.
- **M3 needs test infra** — happy-dom setup touches package deps and bun test config, too much for a drive-by.
- **M4** is small but easy to forget. Bundle it here or it'll rot.
- **L2** requires booting dark mode and clicking through — better as a focused audit checkpoint than ad-hoc.

One slice > five trickle PRs. Also: once H3's `<RequireAdmin>` ships, future admin pages get the right behavior by default.

---

## Key Design Decisions (locked pending owner Q&A)

### `<RequireAdmin>` wrapper (H3)

Location: `apps/web/src/components/RequireAdmin.tsx`. Signature:

```tsx
interface RequireAdminProps {
  roles?: UserRole[];      // default: ["admin", "manager", "owner"]
  fallback?: string;        // default: "/dashboard"
  children: React.ReactNode;
}
```

Behavior:
- `auth.loading === true` → render a centered loading spinner (Q3=A)
- `profile` null after loading → `<Navigate to={fallback} replace />`
- `profile.role` not in `roles` → `<Navigate to={fallback} replace />`
- Otherwise → `children`

Usage pattern at admin pages:

```tsx
// Before (buggy):
export function PriceSheetsPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState(...);
  if (!profile || !["admin","manager","owner"].includes(profile.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  // ...more hooks
}

// After:
export function PriceSheetsPage() {
  return <RequireAdmin><PriceSheetsPageInner/></RequireAdmin>;
}
function PriceSheetsPageInner() { /* all hooks unconditionally */ }
```

Hook order is now stable because the inner component only mounts once the gate passes. The wrapper has only 2-3 hooks of its own, always in the same order.

### Observability surface (M2, Q1=A)

Both edge functions already handle the `rejected` status update on failure. Add a single call to insert into `public.flare_reports` from the existing failure branches:

```ts
// In extract-price-sheet and publish-price-sheet failure paths:
await serviceClient.from("flare_reports").insert({
  category:     "price_sheet_admin",
  severity:     "error",
  summary:      `Extract failed: ${sheetId}`,
  details:      { priceSheetId, brand_id, phase: "extract", error_message },
  status:       "new",
});
```

No new schema. The flare admin page (`/admin/flare`) already exists and admins already use it for other categorized events. Admin hardening = re-using existing infra, not building parallel channels.

### Integration test harness (M3, Q2=happy-dom)

Add `happy-dom` as a dev dependency and configure `bun:test` to use it for integration tests:

```json
// bunfig.toml
[test]
preload = ["./apps/web/test-setup/happy-dom.ts"]
```

First two tests exercise real component rendering with mocked Supabase:
1. `PriceSheetsPage.integration.test.tsx` — mount page → mock list query → assert rendering → click Upload → assert drawer opens → fill form → mock invoke → assert success banner
2. `FreightZoneDrawer.integration.test.tsx` — mount drawer → mock `getFreightZones` → click Add → fill form → click Create → assert row appears

Test naming: `.integration.test.tsx` suffix so the existing `.test.ts` unit suite isn't affected.

### `active_workspace_id` contract (M4)

Two-part fix:

1. **Defensive render:** In `useAuth`, treat `active_workspace_id === null` as "profile-not-ready". Downstream admin pages then see `!profile` and `<RequireAdmin>` shows the loading spinner or redirects.
2. **Type tightening:** Update `Profile.active_workspace_id: string | null` to match DB reality. Callers that currently destructure without guards become TypeScript errors; fix each by threading the null-check through (3-4 callsites max).

### Dark mode audit (L2)

Manual checklist of admin surfaces in dark mode:
- `/admin/price-sheets` — freshness table, upload drawer open, freight zone drawer open
- `/admin/deal-economics` — all 4 tabs
- `/admin/ai-request-log` — table + expanded row

For each: verify text contrast, badge readability, drop-zone states, coverage-grid pill colors, phase banners. Fix any hardcoded `text-white` / `bg-white` / `text-black` etc. in favor of theme tokens.

---

## Checkpoint Plan

### CP1 — `<RequireAdmin>` wrapper (H3 foundation)

**Files:**
- `apps/web/src/components/RequireAdmin.tsx` (new)
- `apps/web/src/components/__tests__/RequireAdmin.test.tsx` (new — uses happy-dom from CP6 if landed first; if not, pure-function test of the decision logic)

**Deliverables:**
- Wrapper component with spinner / redirect / render states
- Unit tests: 4 scenarios (loading, no profile, wrong role, right role)

**Acceptance:** Standalone component, not yet wired to any page. Tests green.

---

### CP2 — Migrate admin pages to `<RequireAdmin>` (H3 application)

**Files:**
- `apps/web/src/features/admin/pages/PriceSheetsPage.tsx`
- `apps/web/src/features/admin/pages/DealEconomicsPage.tsx`
- `apps/web/src/features/admin/pages/AiRequestLogPage.tsx`
- `apps/web/src/features/admin/pages/BranchManagementPage.tsx`

**Per page:** extract inner component, wrap in `<RequireAdmin>`, remove the early-return guard, move all hooks into the inner component.

**Acceptance:**
- All 4 pages still redirect rep → `/dashboard`
- ESLint `react-hooks/rules-of-hooks` shows no violations in admin pages
- No regression in the 75 admin unit tests

---

### CP3 — `active_workspace_id` null guard (M4)

**Files:**
- `apps/web/src/hooks/useAuth.ts` — tighten type to `string | null`
- Callsites that currently assume non-null (grep first, likely 3–4):
  - `PriceSheetsPage.tsx` (workspaceId prop to drawers)
  - Any other admin page threading workspace_id
- `<RequireAdmin>` from CP1 already handles the null-profile case, so this is about narrowing within the inner components.

**Acceptance:**
- TSC green after tightening type
- Profile with `active_workspace_id: null` either gets a loading spinner or a "Contact your workspace admin" message — not a crash

---

### CP4 — Dark mode audit pass (L2)

**Files:** UI components touched based on findings. Expected candidates:
- `UrgencyBadge.tsx` (may use raw color classes)
- `UploadDrawer.tsx` PhaseBanner tones
- `FreightCoverageGrid.tsx` pill colors

**Deliverable:** `plans/Quote Builder Moonshot Build/SLICE_08_DARK_MODE_AUDIT.md` logging exactly what was checked and any fixes applied. If zero fixes needed, the doc says so.

**Acceptance:** Manual walkthrough documented. All admin surfaces pass a contrast spot check.

---

### CP5 — Observability on extract/publish failures (M2, Q1=A)

**Files (edge functions):**
- `supabase/functions/extract-price-sheet/index.ts`
- `supabase/functions/publish-price-sheet/index.ts`

**Per function:** at every error-return that also sets `qb_price_sheets.status='rejected'`, also insert a `flare_reports` row.

**Tests (optional — edge fn contract test if the harness exists; otherwise spot-test in smoke):**
- Verify a deliberately failed extract creates a flare_report with expected category + details

**Acceptance:**
- Both functions redeployed to staging
- Failed upload produces a visible entry in `/admin/flare`
- Existing client-facing error surface unchanged (user still sees the same drawer error)

---

### CP6 — happy-dom integration test infrastructure (M3 infra)

**Files:**
- `package.json` — add `happy-dom` as dev dep
- `apps/web/bunfig.toml` (or root bunfig.toml) — register the happy-dom preload
- `apps/web/test-setup/happy-dom.ts` (new) — standard happy-dom registration + React Testing Library `@testing-library/react` if needed
- Docs: README section or inline comment explaining how to write an integration test

**Acceptance:**
- A trivial smoke integration test mounts a simple component (e.g., `<UrgencyBadge lastUploadedAt={…}/>`) and asserts rendered output
- Existing 75 unit tests still pass
- CI time delta < 5 seconds

---

### CP7 — Integration test: upload flow (M3 test 1)

**File:** `apps/web/src/features/admin/pages/__tests__/PriceSheetsPage.integration.test.tsx` (new)

**Scenario:** Mount page → mock Supabase responses → assert brand table renders → click Upload for brand → assert drawer renders → mock `uploadAndExtractSheet` → assert success banner and refetch fires.

**Acceptance:** Test runs in < 2 seconds, passes. Validates the PriceSheetsPage → BrandFreshnessTable → UploadDrawer integration chain end to end.

---

### CP8 — Integration test: freight zone flow (M3 test 2)

**File:** `apps/web/src/features/admin/components/__tests__/FreightZoneDrawer.integration.test.tsx` (new)

**Scenario:** Mount drawer → mock `getFreightZones` with 2 zones → assert both rows render + coverage grid reflects coverage → click Add → fill form → click Create → mock `upsertFreightZone` success → assert new row appears and grid updates.

**Acceptance:** Test runs < 2 seconds, passes. Catches regressions in the FreightZoneDrawer → FreightCoverageGrid → FreightZoneForm → `upsertFreightZone` chain.

---

### CP9 — Final gates + closeout

Same as Slice 07 CP10:

1. `bun run migrations:check` — 302 in sequence if M2 needed a migration (Q1=A means no migration)
2. `bun run build` from repo root
3. `bun x tsc --noEmit` in `apps/web`
4. `bun test src/features/admin` — expect 80+ tests (75 existing + 5 new from CP1, CP7, CP8)
5. Flare UI shows test-injected failures during CP5 validation
6. Update `SLICE_08_ADMIN_HARDENING.md` status + execution log

**Acceptance:**
- All 4 builds pass with zero new TypeScript errors
- Migration check passes (unchanged if no M2 migration)
- All tests green, including the 2 new integration tests
- `/admin/flare` surfaces test-seeded failure

---

## Data Model Summary

**No migration required** if Q1=A (flare_reports is pre-existing).

If Q1=C (new `qb_admin_events` table), would need migration 302:

```sql
create table public.qb_admin_events (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  category     text not null,
  severity     text not null check (severity in ('info','warning','error')),
  summary      text not null,
  details      jsonb,
  status       text not null default 'new',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id)
);
-- RLS + indexes as standard.
```

**Recommended: Q1=A, no migration.** Less surface area, reuses operator workflow.

---

## File Map

### New

| Path | CP | Purpose |
|---|---|---|
| `apps/web/src/components/RequireAdmin.tsx` | CP1 | Shared admin gate wrapper |
| `apps/web/src/components/__tests__/RequireAdmin.test.tsx` | CP1 | Gate logic tests |
| `apps/web/test-setup/happy-dom.ts` | CP6 | Test runtime setup |
| `apps/web/src/features/admin/pages/__tests__/PriceSheetsPage.integration.test.tsx` | CP7 | Upload flow |
| `apps/web/src/features/admin/components/__tests__/FreightZoneDrawer.integration.test.tsx` | CP8 | Freight flow |
| `plans/Quote Builder Moonshot Build/SLICE_08_DARK_MODE_AUDIT.md` | CP4 | Dark mode findings log |

### Modified

| Path | CPs | Reason |
|---|---|---|
| `apps/web/src/features/admin/pages/PriceSheetsPage.tsx` | CP2, CP3 | Wrapper + null workspace guard |
| `apps/web/src/features/admin/pages/DealEconomicsPage.tsx` | CP2 | Wrapper |
| `apps/web/src/features/admin/pages/AiRequestLogPage.tsx` | CP2 | Wrapper |
| `apps/web/src/features/admin/pages/BranchManagementPage.tsx` | CP2 | Wrapper |
| `apps/web/src/hooks/useAuth.ts` | CP3 | Type tightening `active_workspace_id: string \| null` |
| `supabase/functions/extract-price-sheet/index.ts` | CP5 | Flare report emit on failure |
| `supabase/functions/publish-price-sheet/index.ts` | CP5 | Flare report emit on failure |
| `package.json` | CP6 | Add `happy-dom` dev dep |
| `bunfig.toml` | CP6 | Register preload |
| UI components (TBD from CP4 findings) | CP4 | Dark mode fixes |
| `plans/.../SLICE_08_ADMIN_HARDENING.md` | CP9 | Status closeout |

### Not touched

- Migration files (assuming Q1=A)
- Slice 07 surfaces not flagged by audit (e.g., `BrandFreshnessTable`, `StateCodeMultiSelect`) — already clean

---

## Scope Estimate

| CP | Effort |
|---|---|
| CP1 | 1 hour |
| CP2 | 1.5 hours (4 pages + verification per page) |
| CP3 | 1 hour |
| CP4 | 1-2 hours (manual + fixes) |
| CP5 | 2 hours (edge fn edits + staging deploys + `/admin/flare` verify) |
| CP6 | 2-3 hours (new test infra, first passing smoke) |
| CP7 | 2 hours |
| CP8 | 1.5 hours |
| CP9 | 30 minutes |

**Total: ~2 days of focused work.** About half is refactor + type discipline (CP1-3), half is net-new infra + tests (CP5-8).

---

## Risks

| Risk | Mitigation |
|---|---|
| happy-dom pulls transitive deps that bloat the dev install | Pin the version, verify `node_modules` delta is small. If >10 MB bloat, reconsider Q2. |
| `<RequireAdmin>` breaks nav on profile refresh mid-page | Loading spinner handles it. Test: sign out → sign back in → open admin page → verify no flash of wrong content. |
| Edge fn flare-report insert fails silently → we miss failures we wanted to catch | Make the flare insert non-blocking (fire-and-forget with `.catch` → console.error). Original error-return path unchanged. |
| Integration tests become flaky as the DOM state machine evolves | Use React Testing Library's `findBy*` queries with timeouts (not `getBy*`). Keep test scope tight — one user journey per file. |
| Dark mode audit uncovers many small issues → scope creep | Cap at 90 minutes. Anything not trivially fixable goes on an issue list, not into this slice. |

---

## Out of Scope

Explicitly deferred:

- **Playwright** — reconsidered if we see real browser bugs. Slice 08 does not add it.
- **Orphaned-sheet recovery UI** (Q4) — drawer retry covers the common path; admin-resume is future.
- **Admin audit log** — separate concern; operator activity tracking is a different surface.
- **Alerting integrations** (Slack, email, PagerDuty) — flare UI is the surface this slice exposes. External routing is Slice 09+.
- **Mobile-specific admin surface polish** — admin is desktop-first in today's codebase; revisit when mobile admin use cases land.
- **Migrating non-admin pages to `<RequireAdmin>` pattern** — if they have their own role gates, leave them alone this slice.

---

## Commit / Branch Convention

**Branch:** `claude/qep-qb-08-admin-hardening`

**Commit prefix:** `[QEP-QB-08]`

**Per-CP commits** with descriptive messages, same rhythm as Slice 07. Example:
- `[QEP-QB-08] CP1: RequireAdmin wrapper component + tests`
- `[QEP-QB-08] CP2: Migrate admin pages to RequireAdmin wrapper`
- `[QEP-QB-08] CP5: Emit flare_reports on extract/publish failure`

Same hard rules apply:
1. Explicit `git add <paths>` only
2. No `supabase db push --linked`
3. No new migration unless CP5 needs one (default: no)
4. Stop at each CP boundary for review

---

## Acceptance (post-slice)

- **Audit scorecard all green or explicitly deferred:** H3 · M2 · M3 · M4 · L2 → closed
- **Test suite:** 80+ tests (75 existing + ≥5 new), zero failures
- **Operator experience:** a deliberately broken price sheet upload appears in `/admin/flare` within 30 seconds of failure
- **Developer experience:** any new admin page added after this slice inherits correct role-gating by wrapping in `<RequireAdmin>` — no Rules-of-Hooks footgun

**Mission fit check:**
- Does this advance equipment sales+rental ops? *Indirectly.* It protects the operator-utility surfaces shipped in Slices 06–07 from regression. Doesn't add new capability for field reps or Angela, but reduces the probability of breaking what's already there.
- Is it transformational? *No.* This is maintenance work.
- Operator utility change? *Small.* M2 gives Angela visibility into silent failures. The rest is invisible unless something breaks.

This slice is explicitly investment, not feature. Ship it if you want Slice 09 to start from a clean floor.
