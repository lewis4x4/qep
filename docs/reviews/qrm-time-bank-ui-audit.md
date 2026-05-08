# QRM Time Bank — UI / Customer-Readiness / Moonshot Audit

- **Surface:** `/qrm/time-bank`
- **Primary file:** `apps/web/src/features/qrm/pages/TimeBankPage.tsx`
- **Scope of this report:** UI/UX, premium customer-readiness, moonshot/operator-value. **Out of scope** (owned by parallel agent): `time-bank.ts` domain logic, `time-bank.test.ts`, `230_time_bank.sql`, `ask-iron-api.ts`. This review treats the additive Time Bank contract from the planning brief (overrun_days, budget_source, pressure_tier, intervention model, normalized fetch) as a consumed dependency — recommendations are written so the page can land in lockstep with that work.
- **Companion plan:** `prompt-exports/oracle-plan-2026-05-07-160158-qrm-time-bank-audit-53a4.md`

---

## 1. Verdict

**🔴 BLOCKED for premium QEP customer delivery.**

The surface is genuinely wired to live data and routes correctly — but as it stands today, **the first thing a paying customer sees is an amber `DEMO` badge** rendered above a static stage-age report with one CTA per row. Visually, hierarchically, and AI-wise it does not clear the QRM premium bar set by `RevenueRescueCenterPage` and `OperationsCopilotPage`, and it does not carry the moonshot signal the mission lock requires.

The underlying mechanics are healthy. The blockers are concentrated in seven concrete UI gaps — all addressable inside `TimeBankPage.tsx`, `QrmPageHeader.tsx`, `DataSourceBadge.tsx`, and a thin handoff helper in `askIronHandoff.ts`. None require a shell refactor.

### Customer-ready requires (delivery checklist)

1. **Provenance correction** — Native `Time Ledger` badge alongside the CRM source badge so demo-mode CRM no longer makes the surface read as fake data. *(§5.2)*
2. **Workspace query gating** — Stop firing the RPC with the literal string `"default"` while the workspace query resolves. *(§5.1)*
3. **Iron Intervention Queue** — Top-of-page card list of the 5 highest-priority deals with priority score, rationale trace, and a multi-CTA rail (Room · Detail · Account · Ask Iron). This is the moonshot lever. *(§5.3)*
4. **Pressure-tier metrics** — Replace the current 4-cell metric strip with 5 cells that surface Critical, Unassigned, and Fallback-SLA in addition to Open / Over Budget. *(§5.4)*
5. **Mobile-first ledger** — Wrap the 9-column table in `overflow-x-auto` and degrade to a card list under `lg`, matching the rescue-queue pattern. *(§5.6)*
6. **Premium empty / error / no-workspace states with retry** — current page has no retry, no skeleton, and no "no workspace" state. *(§5.5)*
7. **Multi-CTA ledger rows** — Room (over/critical) · Detail (default) · Account (when present) · Ask Iron (seeded). One CTA per row is below the bar. *(§5.7)*

Items 1, 2, 5, 6, 7 are pure UI and can land independently of the data-layer agent. Items 3 and 4 consume the additive `pressure_tier` / `overrun_days` / intervention contract from the parallel work; both can be coded behind a runtime fallback so the page still degrades cleanly if the new fields aren't yet present.

---

## 2. Context & Scope

### 2.1 What's currently on screen

`TimeBankPage.tsx` (213 lines) renders, in order:

1. `QrmPageHeader` — title, subtitle, surface/lens crumb, 4-cell metric strip, Iron briefing ribbon with one CTA (`Pipeline →`), and a CRM `DataSourceBadge` defaulted to `Demo`.
2. `QrmSubNav` — shell-aware sub-navigation.
3. Two `AggregateBoard` cards side-by-side at `xl` (Account / Rep balance).
4. A single `DeckSurface` containing a 9-column `<Table>` of the top 12 hottest deals, one CTA per row (`Open` → `/qrm/deals/:id`).
5. Loading/error fall back to a single `DeckSurface` line.

### 2.2 Reference patterns in the same shell

Two sibling QRM pages set the premium bar:

- **`RevenueRescueCenterPage.tsx`** — same 4-surface shell, same `QrmPageHeader`, but renders a *Rescue Queue* of priority-scored cards with `StatusDot pulse`, `SignalChip` priority chips, multi-CTA rails (Account · Room · Detail), reasons strings, mobile-first card layout (`flex-col gap-2 lg:flex-row`). Time Bank is a competing intelligence page rendered to a meaningfully lower bar.
- **`OperationsCopilotPage.tsx`** — deterministic recommendation board with a 4-cell summary grid, traceable confidence, and connection to AI Deal Coach / Service Dashboard. Establishes the "deterministic copilot" pattern Time Bank should adopt.

### 2.3 Mission lock (CLAUDE.md)

Every section below is judged against the four required mission checks: Mission Fit, Transformation, Pressure Test, Operator Utility. Aggregated mission-alignment evidence is in §6.

---

## 3. Findings — Information Hierarchy

### 3.1 Aggregate boards are stacked above the actionable ledger
**Where:** `TimeBankPage.tsx:78–97`
**Issue:** When the page loads, the operator sees Account + Rep aggregate cards *above* the deal ledger. Aggregates are useful for managers but not for the rep who opened the page to fix the next problem. There is no priority queue at all.
**Premium bar:** RevenueRescueCenterPage opens with the queue itself (the actionable list), aggregates are absent.
**Effect:** Time-on-task to "what should I do right now?" is high. The page reads as a report, not a copilot.

### 3.2 Metric strip undersells operational risk
**Where:** `TimeBankPage.tsx:71–76` — `Open deals · Over budget · Accounts · Reps`.
**Issue:** Critical (`pct_used >= 0.85` and not yet over) is invisible. So is the `Unassigned` count and the `Fallback SLA` count. These are first-class operational risks (the planning brief surfaces them as additive summary fields).
**Effect:** The single most useful "is this on fire?" scan-line — the metric rail — leaves the operator under-informed.

### 3.3 Iron briefing is decorative, not actionable
**Where:** `TimeBankPage.tsx:39–66`
**Issue:** The cascading headline is well-written but routes the operator only to `/qrm/pipeline`. The IronBar primitive supports multiple actions; sibling pages ship 2.
**Premium bar:** RevenueRescueCenterPage Iron actions are `Blockers →` and `Ops Copilot →` — destinations that resolve the cause, not just adjacent surfaces.
**Effect:** The AI ribbon reads as flavor text rather than a triage button.

### 3.4 No "next 5 moves" queue
**Where:** Entire page — there is no card list of prioritized interventions, only the table.
**Issue:** The mission requires a *transformational* layer. A static SQL-sorted table is not it. The planning brief supplies `buildTimeBankInterventions(rows)` precisely to fill this gap.
**Effect:** Highest-leverage product gap on the page. See §5.3 for the proposed shape.

---

## 4. Findings — Provenance / Demo Badge

### 4.1 The `Demo` badge appears by default and undermines trust
**Where:** `QrmPageHeader.tsx:121` — `dataSourceQuery.data ?? { state: "Demo" ... }`
**Issue:** The data-source query resolves asynchronously. While it is in-flight, the snapshot is `Demo`, and the badge renders amber on the very first paint of the page. Even after it resolves, the fallback path at `QrmPageHeader.tsx:107–111` queries `workspace_hubspot_portal` keyed by the literal string `"default"` — for any tenant whose workspace id ≠ `"default"`, this returns no rows and the badge stays `Demo` even when CRM is fully connected. This is a known issue across QRM pages, but on `/qrm/time-bank` it is *especially* damaging: the surface itself is a native computed ledger that does not even depend on HubSpot demo mode for the *Time* dimension (it depends on `crm_deals` + `crm_deal_stages` tables that are seeded in every workspace).
**Effect:** Premium demo: the customer's CMO opens the deck and the first thing they read is `DEMO`. Conversion-killer.

### 4.2 No badge expresses what Time Bank actually is
**Where:** `DataSourceBadge.tsx:9` already defines a `Native` state with emerald styling — it is unused on this page.
**Issue:** There is no signal that says "this surface computes its own ledger from your live deals." The CRM badge is the only provenance signal, and it conflates two different things: where the *underlying CRM data* came from (HubSpot live/demo) vs. whether *this report* is authentic.
**Recommendation:** Render two badges: prefix the CRM one (`CRM Live` / `CRM Demo`) and add a `Native · Time Ledger` badge in the `rightRail`. Resolution in §5.2.

---

## 5. Findings & Recommendations — Per-Concern

This section is the actionable output. Each recommendation lists the file, the change, and a verifiable acceptance condition.

### 5.1 Workspace query gating

**Current (`TimeBankPage.tsx:23–24`):**
```tsx
const workspaceQuery = useMyWorkspaceId();
const workspaceId = workspaceQuery.data ?? "default";
```

**Problem:** While `useMyWorkspaceId` is loading, the query key is `["qrm", "time-bank", "default"]`. After it resolves (e.g. `ws_42`), the key changes and a second fetch fires. For authenticated users the SQL ignores `p_workspace_id` and uses `get_my_workspace()`, so the data is technically correct — but the loading state flickers and the React Query cache holds a stale `"default"` row that competes with the real key.

**Recommendation:**
```tsx
const workspaceQuery = useMyWorkspaceId();
const workspaceId = workspaceQuery.data;

const timeBankQuery = useQuery({
  queryKey: ["qrm", "time-bank", workspaceId ?? "__pending__"],
  enabled: !workspaceQuery.isLoading && Boolean(workspaceId),
  queryFn: () => fetchTimeBankRows({ workspaceId: workspaceId!, defaultBudgetDays: 14 }),
  staleTime: 60_000,
  refetchInterval: 120_000,
});
```

When `!workspaceQuery.isLoading && !workspaceId`, render the **No Workspace** premium state from §5.5. `fetchTimeBankRows` is the shared adapter being added by the parallel agent; if not yet landed, keep the inline RPC call but adopt the gating change unconditionally — it is a UI-layer fix.

**Acceptance:** No second redundant fetch on first load; React Query devtools show a single key.

---

### 5.2 Provenance: dual-badge pattern

**Goal:** Operator sees CRM source state *and* sees that Time Bank is a native computed ledger, even when CRM is in demo mode.

**Step 1 — `DataSourceBadge.tsx`:** add an optional display label and a tooltip.

```tsx
interface DataSourceBadgeProps {
  state: DataSourceState;
  label?: React.ReactNode;     // overrides default text rendering
  title?: string;              // native HTML tooltip
  className?: string;
}
// in JSX: ...title={title}>{label ?? state}
```

Backwards-compatible — every existing callsite works unchanged.

**Step 2 — `QrmPageHeader.tsx`:** add an optional prefix prop.

```tsx
interface QrmPageHeaderProps {
  // ...existing fields
  dataSourceBadgePrefix?: string;   // e.g. "CRM"
}
```

When set, render the badge with `label={`${prefix} ${dataSourceState}`}` (e.g. `CRM Demo`, `CRM Live`). Stale sparkline path is unchanged.

**Step 3 — `TimeBankPage.tsx`:** wire both signals on the header.

```tsx
<QrmPageHeader
  title="Time Bank"
  subtitle="..."
  crumb={...}
  metrics={...}
  ironBriefing={...}
  dataSourceBadgePrefix="CRM"
  rightRail={
    <DataSourceBadge
      state="Native"
      label="Time Ledger"
      title="Computed live from your open deals and stage SLAs."
    />
  }
/>
```

**Visual outcome:** Header right-rail reads `[Native · Time Ledger] [CRM Demo]` (or `CRM Live`). The customer immediately understands: *the report is real; the CRM data feeding deal names may be sample.* The amber badge stops being an identity badge for the page.

**Acceptance:**
- Native green pill renders on first paint without waiting for the CRM data-source query.
- CRM badge always carries a `CRM` prefix on this page.
- No regression on other QRM pages (prop is opt-in).

---

### 5.3 Iron Intervention Queue (the moonshot lever)

This is the only recommendation that depends on the parallel agent landing the additive contract from §3.7 of the planning brief — namely `buildTimeBankInterventions(rows)`, `pressure_tier`, and `overrun_days`. The UI shape is fully designable now.

**Position:** Directly below `QrmSubNav`, *above* the aggregate boards. This becomes the page's first answer to "what should I do?".

**Component:** `TimeBankInterventionQueue` — internal to `TimeBankPage.tsx` for now, hoisted to its own file if reused.

**Render contract:**
```tsx
<DeckSurface tone="live" className="p-3 sm:p-4">
  <header className="flex items-start justify-between gap-3">
    <div>
      <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
        Iron intervention queue
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Highest-leverage stage-time corrections, scored by overrun, ownership, and budget pressure.
      </p>
    </div>
    <SignalChip label="Top" value={interventions.length} tone="live" />
  </header>

  <ol className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
    {interventions.map((iv) => (
      <InterventionCard key={iv.id} intervention={iv} />
    ))}
  </ol>
</DeckSurface>
```

**`InterventionCard` shape (per row):**
- Left: `<StatusDot tone={tierTone(iv.tier)} pulse={iv.tier === "over"} />` + `<SignalChip label="Priority" value={iv.priorityScore} tone={tierTone(iv.tier)} />`.
- Title row: `iv.dealName` · monospaced `iv.companyName · iv.assignedRepName · iv.stageName`.
- Trace strip: `iv.trace.join(" · ")` rendered at `text-[11px] text-muted-foreground` — the *why*. Each line is a deterministic, traceable assertion (planning brief §3.3).
- CTA rail (right side, wrap on mobile):
  - **Room** → `/qrm/deals/{dealId}/room` — primary for `over` / `critical`.
  - **Detail** → `/qrm/deals/{dealId}` — secondary.
  - **Account** → `buildAccountCommandHref(companyId)` when `companyId !== null`.
  - **Ask Iron** → `<Link to="/qrm/operations-copilot" state={createAskIronSeedState(iv.askIronQuestion, "today", iv.dealId)}>` — see §5.8.
- Pressure chips inline: `iv.chips.map(c => <SignalChip ... />)` — e.g. `Overrun · 3d` (`hot`), `Budget · Fallback` (`warm`), `Owner · Unassigned` (`hot`).

**Mobile behavior:** `flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between` — same pattern as `RevenueRescueCenterPage:134–160`. CTAs wrap to a second line under `lg` rather than overflow.

**Empty state for the queue:** When `interventions.length === 0` *and* there are open deals, render a one-line `Pipeline humming — no stage breaches, no orphan deals.` This is *good news* and should look it (cool tone, not warning).

**Pressure tier → tone map (UI-side, deterministic):**
| Tier | Status dot tone | Pulse | Signal chip tone |
|---|---|---|---|
| `over` | `hot` | yes | `hot` |
| `critical` | `warm` | no | `warm` |
| `watch` | `active` | no | `active` |
| `healthy` (only when missing ownership/account) | `cool` | no | `cool` |

**Degrade behavior** (parallel agent contract not yet shipped): if `buildTimeBankInterventions` is not exported, derive an inline fallback queue in the page using only existing fields — sort by `is_over` desc, `pct_used` desc, take 5, render with synthetic trace lines (`{stage_name} has used {round(pct_used*100)}% of its {budget_days}d budget.`). This guarantees the queue ships even if the data PR slips.

**Acceptance:**
- Queue is the first content under the subnav.
- Each card has ≥3 CTAs and at least one rationale trace line.
- Over-budget rows render `pulse` and `hot` tone.
- "Ask Iron" deep-link round-trips through `/qrm/operations-copilot` and auto-sends the seeded question (validated by `isAskIronSeedState`).

---

### 5.4 Metric strip — pressure-tier surfaced

**Replace `TimeBankPage.tsx:71–76` with:**
```tsx
metrics={[
  { label: "Open deals", value: summary.totalDeals },
  { label: "Over budget", value: summary.overBudgetDeals,
    tone: summary.overBudgetDeals > 0 ? "hot" : undefined },
  { label: "Critical", value: summary.criticalDeals,
    tone: summary.criticalDeals > 0 ? "warm" : undefined },
  { label: "Unassigned", value: summary.unassignedDeals,
    tone: summary.unassignedDeals > 0 ? "warm" : undefined },
  { label: "Fallback SLA", value: summary.fallbackBudgetDeals,
    tone: summary.fallbackBudgetDeals > 0 ? "active" : undefined },
]}
```

`MetricStrip` already supports 5 cells (`grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5` — see `command-deck.tsx:228–231`). The 4th and 5th cells make ownership and SLA gaps first-class scan items.

**Falls back gracefully:** if the parallel agent hasn't extended `summarizeTimeBank`, the page can compute `criticalDeals = rows.filter(r => !r.is_over && r.pct_used >= 0.85).length` and `unassignedDeals = rows.filter(r => !r.assigned_rep_id).length` inline. `fallbackBudgetDeals = rows.filter(r => !r.has_explicit_budget).length`. All three fields exist in the current `TimeBankRow`.

**Acceptance:**
- Five cells render across `lg+`.
- Each cell shows a tone color when its value > 0.
- No layout overflow at `sm`.

---

### 5.5 Empty / error / loading / no-workspace states

Current code (`TimeBankPage.tsx:80–86`):
```tsx
{timeBankQuery.isLoading ? (
  <DeckSurface className="p-6 text-sm text-muted-foreground">Loading time balance…</DeckSurface>
) : timeBankQuery.isError ? (
  <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
    {timeBankQuery.error instanceof Error ? timeBankQuery.error.message : "Time Bank unavailable."}
  </DeckSurface>
) : ( ... )}
```

**Gaps:**
- No retry button on error.
- No diagnostic chip identifying which RPC failed.
- No state for `!workspaceQuery.data && !workspaceQuery.isLoading`.
- No premium "no open deals" surface — when `summary.totalDeals === 0` the page renders empty boards and an empty table.
- Loading state is a single text line — there is no skeleton shape to set expectations.

**Recommendation — replace with four-state branch:**

```tsx
if (workspaceQuery.isLoading || timeBankQuery.isLoading) {
  return <TimeBankSkeleton />;
}
if (!workspaceId) {
  return <TimeBankNoWorkspaceState />;
}
if (timeBankQuery.isError) {
  return (
    <TimeBankErrorState
      error={timeBankQuery.error}
      onRetry={() => timeBankQuery.refetch()}
    />
  );
}
if (timeBankQuery.data && timeBankQuery.data.length === 0) {
  return <TimeBankEmptyState />;
}
```

(Each of these returns the full page chrome — header + subnav — and replaces only the body content area, so navigation never disappears.)

**`TimeBankEmptyState`:**
```tsx
<DeckSurface className="p-6 text-center">
  <p className="text-sm font-medium text-foreground">No open deals on the Time Bank.</p>
  <p className="mt-1 text-xs text-muted-foreground">
    Capacity is unused — press the graph to start new motion.
  </p>
  <div className="mt-4 flex items-center justify-center gap-2">
    <Button asChild size="sm" variant="outline">
      <Link to="/qrm/deals">Open deals →</Link>
    </Button>
    <Button asChild size="sm" variant="ghost">
      <Link to="/qrm/activities">Activities →</Link>
    </Button>
  </div>
</DeckSurface>
```

**`TimeBankErrorState`:**
```tsx
<DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6">
  <div className="flex items-start gap-3">
    <AlertTriangle className="h-4 w-4 text-qep-hot" />
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-qep-hot">Time Bank ledger unavailable</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {error instanceof Error ? error.message : "Unknown error from the time-ledger feeder."}
      </p>
      <SignalChip label="RPC" value="qrm_time_bank" tone="hot" className="mt-2" />
    </div>
    <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
  </div>
</DeckSurface>
```

**`TimeBankNoWorkspaceState`:** copy: *"Sign in to a workspace to view its time ledger."* CTA to `/admin/workspaces`. This state is reachable for service-role admins who have not selected an active workspace.

**`TimeBankSkeleton`:** 5 metric cells as gray bars + two `DeckSurface` placeholders + an 8-row `<Skeleton>` list. No cute spinner — a structural skeleton sets expectation of layout density.

**Critical:** Do not write the word *"Demo"* anywhere in any of these states. The current empty briefing reads `"No open deals on the time ledger today. Capacity is unused…"` which is good; preserve that phrasing.

**Acceptance:** Manual states verified via React Query devtools forced states; retry button calls `refetch()` and recovers without a full-page reload.

---

### 5.6 Mobile-first ledger

**Current (`TimeBankPage.tsx:99–145`):** 9-column `<Table>`, no `overflow-x-auto`, no responsive collapse. On a phone the right-side columns (Used / Action) push off-screen. The table uses generic shadcn `Table` primitives.

**Recommendation:** mirror the `RevenueRescueCenterPage` pattern — the *same shell already renders this exact problem space* in card form.

```tsx
<DeckSurface className="p-3 sm:p-4">
  <header>...</header>

  {/* Mobile + tablet: card list */}
  <ol className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30 lg:hidden">
    {hottestDeals.map((row) => <TimeBankLedgerCard key={row.deal_id} row={row} />)}
  </ol>

  {/* Desktop: table inside an x-scrollable wrapper */}
  <div className="mt-3 hidden overflow-x-auto lg:block">
    <Table>...</Table>
  </div>
</DeckSurface>
```

`TimeBankLedgerCard` shape:
- Top row: `<StatusDot tone={tierTone(row.pressure_tier)} />` + deal name + pressure chip.
- Middle row: `{company_name ?? "No account"} · {assigned_rep_name ?? "Unassigned"} · {stage_name}`.
- Metrics row (mono): `Age {days_in_stage}d · Budget {budget_days}d{!has_explicit_budget && "*"} · {is_over ? `+${overrun_days}d over` : `${remaining_days}d left`} · {pct_used*100}%`.
- CTA wrap: same 4-action rail as the queue card.

**Table improvements (when shown):**
- Add a **Tier** column at the leftmost position with `<StatusDot pulse={row.is_over} />`.
- Replace `Remaining {row.remaining_days}d` with `is_over ? <span class="text-qep-hot">+{overrun_days}d</span> : `${remaining_days}d``. Today the table renders `0d` for over-budget rows because `remaining_days` is SQL-clamped at zero — that is a silent UX bug that hides overrun magnitude.
- Replace single `Used %` cell with a compact two-line indicator: numeric percent + tiny progress bar capped at 100% width with hot fill above 100%.
- Replace the single `Open` action with the multi-CTA rail (§5.7).

**Acceptance:**
- 360px viewport: page scrolls vertically only; no horizontal scroll on the body.
- 1280px viewport: full table with all 10 columns, no scroll.
- Over-budget rows show a positive overrun integer, never `0d`.

---

### 5.7 Action CTAs

**Current state (per ledger row):** Single `Open` → `/qrm/deals/{deal_id}`. That's it.

**Premium bar (rescue queue, `RevenueRescueCenterPage.tsx:140–158`):** Account · Room · Detail in a `flex flex-wrap gap-1 lg:shrink-0` rail.

**Recommendation:** Both the intervention card *and* the ledger row share the same `LedgerActionRail` component:

```tsx
function LedgerActionRail({ row }: { row: TimeBankRow }) {
  const isUrgent = row.is_over || row.pct_used >= 0.85;
  return (
    <div className="flex flex-wrap gap-1 lg:shrink-0">
      {isUrgent && (
        <Button asChild size="sm" variant="ghost"
          className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-qep-orange">
          <Link to={`/qrm/deals/${row.deal_id}/room`}>Room <ArrowUpRight className="ml-1 h-3 w-3" /></Link>
        </Button>
      )}
      <Button asChild size="sm" variant="ghost" className="h-7 px-2 ...">
        <Link to={`/qrm/deals/${row.deal_id}`}>Detail <ArrowUpRight ... /></Link>
      </Button>
      {row.company_id && (
        <Button asChild size="sm" variant="ghost" className="h-7 px-2 ...">
          <Link to={buildAccountCommandHref(row.company_id)}>Account <ArrowUpRight ... /></Link>
        </Button>
      )}
      <Button asChild size="sm" variant="ghost"
        className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-qep-live">
        <Link to="/qrm/operations-copilot"
          state={createAskIronSeedState(askQuestionForRow(row), "today", row.deal_id)}>
          Ask Iron <ArrowUpRight className="ml-1 h-3 w-3" />
        </Link>
      </Button>
    </div>
  );
}
```

Where `askQuestionForRow(row)` is a deterministic prompt-builder, e.g.:
- Over-budget: *"What's blocking deal {dealName} at {companyName}? It has been in {stageName} for {days_in_stage}d, {overrun_days}d over the {budget_days}d budget."*
- Watch/critical: *"How should I move deal {dealName} forward in {stageName}? It has used {pct_used*100}% of its {budget_days}d budget."*

Same helper is reused by intervention cards (§5.3).

**AggregateBoard upgrades** (`TimeBankPage.tsx:158–200`):
- Show `totalOverrunDays` and `fallbackBudgetCount` underneath the existing meta line when those summary fields land.
- For the rep board, add an **Open mirror** CTA → `/qrm/rep-reality?repId={entityId}` (the existing Rep Reality Reflection page consumes Time Bank for the same rep — this completes a navigational loop the planning brief calls out).
- When the row is the missing-account or unassigned sentinel (planning brief §3.3), suppress the action button entirely instead of producing a dead link.

**Header right-rail upgrades:** in addition to the Native badge from §5.2, add a `Refresh` button (`onClick={() => timeBankQuery.refetch()}`) and consider an `Export ledger` button (CSV) for managers — both inside `rightRail`.

**Iron briefing actions:** expand from one to two:
- `Pipeline →` (existing)
- `Activities →` (`/qrm/activities`) — gives the manager a path to the source-of-truth log.

**Acceptance:**
- Every ledger and intervention row has at least 3 CTAs (Detail + Account-or-Room + Ask Iron).
- Over-budget rows render the Room CTA prominently.
- Ask Iron handoff arrives on `/qrm/operations-copilot` with an auto-fired question.

---

### 5.8 Ask Iron seeded handoff

**State of the world:** `askIronHandoff.ts` defines `AskIronSeedState`, `ASK_IRON_PATH`, and `isAskIronSeedState` — but **no builder helper**. The plan brief §3.7 mentions `createAskIronSeedState`; it does not yet exist.

**Recommendation — additive only, in `askIronHandoff.ts`:**
```tsx
export function createAskIronSeedState(
  question: string,
  source: AskIronSeedState["askIronSeed"]["source"] = "today",
  sourceId?: string,
): AskIronSeedState {
  return { askIronSeed: { question, source, sourceId } };
}
```

This is a 5-line helper. It belongs in the file that already owns the type. Keeping it in `askIronHandoff.ts` (already imported by `AskIronSurface.tsx`) avoids importing UI helpers from disparate locations. Coordinate with the data-layer agent so we don't both touch this file — but if they don't claim it, this is mine.

**Acceptance:**
- All Time Bank Ask Iron CTAs build state via this helper, not inline object literals.
- `isAskIronSeedState(createAskIronSeedState("..."))` returns `true` (existing test covers this).

---

## 6. Mission Alignment Evidence

CLAUDE.md mandates four checks per delivery slice. Verdict for current Time Bank vs. post-recommendations Time Bank:

| Check | Current state | After recommendations |
|---|---|---|
| **Mission Fit** — advances equipment/parts/sales+rental ops | ✅ Pass — direct utility for reps tracking deal stage timing | ✅ Pass — same plus surfacing unassigned deals (corporate/manager value) |
| **Transformation** — capability beyond commodity QRM | ❌ **Fail** — static SQL stage-age report; no AI layer; sibling pages already ship priority queues | ✅ Pass — Iron Intervention Queue with traceable rationale, deterministic priority scoring, Ask Iron seeded handoffs, dual provenance |
| **Pressure Test** — realistic usage, edge cases, failure modes | ❌ **Fail** — no retry, no no-workspace state, no mobile treatment, demo badge contradicts surface identity, overrun magnitude hidden by SQL clamp | ✅ Pass — four-state body (skeleton/no-workspace/error+retry/empty), mobile card list, native provenance, true overrun integers |
| **Operator Utility** — speed/quality of decisions | ⚠ Partial — table reveals pressure but requires manual scan; one-CTA-per-row forces context switching | ✅ Pass — top-of-page intervention queue answers "what now?", multi-CTA rails compress click depth, Ask Iron unblocks ambiguous cases without leaving flow |

**Net:** Currently 1.5/4 passing. Post-recommendations: 4/4 passing.

---

## 7. Coordination With Parallel Data-Layer Work

The data-layer agent owns `time-bank.ts`, `time-bank.test.ts`, `230_/231_…sql`, `qrm-supabase.ts`, `time-bank-api.ts`, plus consumer-page edits in `DealCoachPage`, `RepRealityReflectionPage`, `RepSkuPage`, `RevenueRescueCenterPage`, and `deal-coach.ts` / `revenue-rescue.ts` / `rep-sku.ts`.

**My (UI) edits will only touch:**
- `apps/web/src/features/qrm/pages/TimeBankPage.tsx` (full rewrite of body composition, header props, action rails)
- `apps/web/src/components/DataSourceBadge.tsx` (additive `label` + `title` props)
- `apps/web/src/features/qrm/components/QrmPageHeader.tsx` (additive `dataSourceBadgePrefix` prop)
- `apps/web/src/features/qrm/components/askIronHandoff.ts` (add `createAskIronSeedState` builder — coordinate before claiming)

**Shared dependency surface (read-only from this lane):**
- `TimeBankRow` shape — additive fields (`pressure_tier`, `overrun_days`, `budget_source`) are consumed but the page renders without them via UI-side fallbacks (§5.4 fallback math).
- `summarizeTimeBank` — additive fields consumed; same fallback strategy.
- `buildTimeBankInterventions` — when not yet exported, page synthesizes a degraded queue (§5.3 degrade behavior).
- `fetchTimeBankRows` — when not yet exported, keep the inline RPC call from the current file but apply the workspace gating fix (§5.1).

**Hand-off invariants requested from the data-layer agent:**
1. Preserve `TimeBankRow` field names — UI binds to them by string key.
2. Make `pressure_tier` / `overrun_days` / `budget_source` non-undefined (use `"healthy"` / `0` / `"fallback"` defaults) so the UI can render without optional-chaining everywhere.
3. Aggregate rows for missing entities should render with a `label` ≠ `null` so the AggregateBoard's truncate styling works as-is.

---

## 8. Implementation Sequence (UI lane)

Order is intentional — each step lands as an independently shippable PR.

1. **PR 1 — Provenance primitives.**
   `DataSourceBadge` `label`/`title` props + `QrmPageHeader` `dataSourceBadgePrefix` prop. Snapshot test on the badge. (Smallest, blocks nothing else, fixes the most visible customer-readiness bug.)

2. **PR 2 — TimeBankPage state branches + workspace gating.**
   Skeleton / NoWorkspace / Error+Retry / Empty states. Workspace query gating (§5.1). 5-cell metric strip with UI-side fallback math (§5.4). No new content yet — this is the structural rewrite of the page body.

3. **PR 3 — Mobile ledger + multi-CTA rail.**
   `TimeBankLedgerCard` for mobile/tablet. `LedgerActionRail` shared component. Overrun-aware Remaining/Used columns. (§5.6, §5.7)

4. **PR 4 — Iron Intervention Queue.**
   The moonshot card list. Lands once the data-layer `buildTimeBankInterventions` is merged; uses degrade fallback if not. (§5.3)

5. **PR 5 — Ask Iron handoff helper + intervention card Ask Iron CTA.**
   `createAskIronSeedState` builder + wiring. (§5.8)

Each PR runs the standard release gates from CLAUDE.md (`bun run migrations:check`, `bun run build` from repo root, `bun run build` in `apps/web`, edge function/contract tests for touched surfaces, role/workspace security checks).

---

## 9. Quick-Reference Recommendation Index

| ID | Concern | File(s) | Severity | Customer-blocker |
|---|---|---|---|---|
| R1 | Workspace `"default"` query fallback | `TimeBankPage.tsx:23–24` | High | Yes |
| R2 | Demo badge identity confusion | `QrmPageHeader.tsx:121`, `DataSourceBadge.tsx`, `TimeBankPage.tsx:69–77` | **Critical** | Yes |
| R3 | No intervention queue | `TimeBankPage.tsx` (new section) | **Critical** | Yes (moonshot) |
| R4 | Metric strip undersells risk | `TimeBankPage.tsx:71–76` | High | Yes |
| R5 | Empty / error / no-workspace states | `TimeBankPage.tsx:80–86` | High | Yes |
| R6 | Mobile ledger unusable | `TimeBankPage.tsx:99–145` | High | Yes |
| R7 | One CTA per row | `TimeBankPage.tsx:135–141` | Medium | Yes |
| R8 | Ask Iron handoff missing | `askIronHandoff.ts`, intervention/ledger rails | Medium | No (enabler) |
| R9 | Iron briefing single-CTA | `TimeBankPage.tsx:51–63` | Low | No |
| R10 | AggregateBoard rep "Open mirror" CTA | `TimeBankPage.tsx:158–200` | Low | No |

**R1, R2, R5, R6, R7 alone close the customer-readiness gap. R3 + R4 close the moonshot gap.**

---

*Report path:* `docs/reviews/qrm-time-bank-ui-audit.md`
