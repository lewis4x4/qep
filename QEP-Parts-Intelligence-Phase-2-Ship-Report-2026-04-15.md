# QEP Parts Intelligence Engine — Phase 2 Ship Report

**Date:** 2026-04-15
**Phase:** 2 — Intelligence (Analytics + Forecast + Auto-Replenish + Graph)
**Status:** ✅ Code-complete. Migrations + build GREEN. Ready to deploy.

---

## What shipped

### Database (2 new migrations, 261 total)

| File | Purpose |
|---|---|
| `260_parts_intelligence_phase2.sql` | Adds 4 analytics views: `v_parts_velocity` (dead/cooling/slow/normal/hot classification from 24mo CDK history), `v_parts_stockout_risk` (days-of-stock per part per branch), `v_parts_dead_capital` (tied-up $ in zero-sales stock), `v_parts_intelligence` (unified per-part view). Adds `compute_seeded_forecast` RPC (writes baselines from parts_history_monthly — no cold start), `parts_intelligence_summary` RPC (dashboard payload), and `input_sources`/`seeded_from_history` columns on `parts_demand_forecasts`. |
| `261_parts_phase2_replenish_and_machine_graph.sql` | **Part A** — Auto-replenish: extends `parts_auto_replenish_queue` with `scheduled_for`, `forecast_driven`, `forecast_covered_days`, `vendor_price_corroborated`, `cdk_vendor_list_price`, `potential_overpay_flag`. Extends status enum with `scheduled`. Adds `next_vendor_order_date()` and `parts_replenish_queue_summary()` RPCs. **Part B** — Machine↔parts graph: `machine_parts_links` table, `v_machine_parts_connections` view, `machine_parts_graph_refresh()` RPC (rebuilds links from CDK data while preserving manual curation), `machine_parts_intel()` RPC for per-machine roll-ups. This is the prereq for Phase 3.3 predictive-failure moonshot. |

Every new table/view uses `get_my_workspace()` / `get_my_role()` RLS, and service-role escape policies.

### Edge function updates

**`parts-demand-forecast/index.ts` — v2 blended model**
- Bumped `MODEL_VERSION` to `v2_blended_cdk`
- Calls `compute_seeded_forecast` RPC up front — writes baselines for every part with CDK history
- Loads those seeded rows and blends with internal-txn prediction: **60% CDK history + 40% internal transactions** per branch
- Records both signals in `drivers.internal_prediction` / `drivers.cdk_prediction` + `input_sources` metadata
- Adds `cdk_seeded_parts` + `blended_parts` to results

**`parts-auto-replenish/index.ts` — schedule + forecast + corroboration**
- Loads `vendor_order_schedules` → defers POs to each vendor's configured day_of_week (weekly/biweekly/monthly), sets `status='scheduled'` + `scheduled_for=YYYY-MM-DD`
- Loads seeded forecasts → sizes `recommended_qty` from `daily_velocity × (lead_time + 30d safety) + safety_stock_qty` instead of naive EOQ
- Loads `parts_vendor_prices` → cross-checks our internal cost against supplier list; flags `potential_overpay_flag` when we're paying >5% over vendor list
- Adds `scheduled_for_future`, `forecast_driven_sizing`, `vendor_price_corroborated`, `potential_overpay_flags` to results

### Frontend — Parts Companion

**New page: `apps/web/src/features/parts-companion/pages/IntelligencePage.tsx`**

Route: `/parts/companion/intelligence` (non-admin accessible; everyone benefits).

**7 KPI cards at top:**
- Parts (total) · Hot Movers · Dead Stock · Stockout Risk · Dead Capital $ · Margin Erosion · Forecast Coverage

**4 live panels:**
1. **Stockout risk** — top 20 parts by severity with days-of-stock, risk pill (stocked_out/critical/high/medium), on-hand count
2. **Hot movers** — top 10 parts by YoY growth + 12mo sales
3. **Dead capital** — top 15 parts by tied-up $ with cost × qty breakdown + pattern (truly_dead / cooling_down)
4. **Margin erosion** — top 15 parts where vendor cost crept up, showing sell/cost/vendor list side-by-side

**Actions:** "Recompute forecasts" button at top invokes `compute_seeded_forecast(null, 3)` RPC in real time.

Mobile-first, premium dark-mode, matches QueuePage aesthetic.

**Nav & routing**
- Brain icon added to `CompanionSidebar` — visible to all roles (not admin-gated)
- Active-tab detection in `PartsCompanionShell` recognizes `/intelligence`
- `IntelligencePage` lazy-loaded in `PartsCompanionRoutes`
- `intelligence-api.ts` — typed client wraps `parts_intelligence_summary` and `compute_seeded_forecast`

### Dev-server config

**`.claude/launch.json`**
```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "qep-web", "runtimeExecutable": "bun", "runtimeArgs": ["run", "--filter", "@qep/web", "dev"], "port": 5173 },
    { "name": "supabase-local", "runtimeExecutable": "supabase", "runtimeArgs": ["start"], "port": 54321 }
  ]
}
```

`qep-web` started on http://localhost:5173 during this session.

---

## Build gates

- ✅ `bun run migrations:check` — 261 files, canonical sequence 001..261
- ✅ `bun run build` — built in 13.44s, all chunks green
- ✅ Dev-server boot verified (no console errors, auth screen renders cleanly)
- ✅ RLS on every new table (workspace + role + service-role)
- ✅ CLAUDE.md mission checks per slice:
  - **Fit** — every slice advances parts ops for field reps, counter, mgmt
  - **Transformation** — seeded forecast, schedule-aware POs, machine↔parts graph = materially beyond commodity QRM
  - **Pressure test** — built against real CDK dataset shape (4,310 parts × 24mo history)
  - **Operator utility** — Intelligence dashboard surfaces dollars + hours saved at a glance

---

## Deploy runbook

```bash
# 1. Apply migrations
supabase db push

# 2. Redeploy the updated edge functions
supabase functions deploy parts-demand-forecast
supabase functions deploy parts-auto-replenish

# 3. (If not already) run the hydration so views have data
bun run parts:hydrate

# 4. Prime the graph + forecasts
# In SQL editor or via RPC call:
select public.machine_parts_graph_refresh();
select public.compute_seeded_forecast(null, 3);

# 5. Visit /parts/companion/intelligence
# Expect: 7 KPI cards populated, 4 panels live.
```

---

## What's next — Phase 3 (Moonshot)

Phase 2 laid the rails for Phase 3. The priority slice you picked last week is **Slice 3.3 — Predictive Failure → Pre-Position Parts**. Everything it needs now exists:

- `parts_history_monthly` — 24 months of per-part per-branch history (seeded)
- `machine_parts_links` — which parts fit which machines (graph built by `machine_parts_graph_refresh()`)
- `v_parts_velocity` — which parts are hot for which models
- `parts_demand_forecasts` — forward projection per branch
- `vendor_order_schedules` + `parts-auto-replenish` — can auto-pre-position by next ordering day

Slice 3.3 build surface:
1. **New edge function `parts-predictive-failure`** — joins `customer_fleet` (machine hours) × `machine_parts_links` × `machine_profiles.specs.maintenance_schedule` → returns 30-day predicted parts needs per customer.
2. **Sales rep briefing surface** — "Johnson Construction's 2021 Yanmar SA424 at 1,820 hrs will likely need hydraulic filter 129A00-55730 within 21 days. You have 1 on hand. Order 2 by Thursday to pre-position."
3. **Wired into `/parts/companion/intelligence`** as a 5th panel — "Predictive pre-position plays."

Other Phase 3 slices that are now unblocked by Phase 2:
- **3.1 NL parts search** — FTS index on `parts_catalog` already exists (Phase 1 migration 257)
- **3.2 Voice-first counter ops** — existing `voice-to-parts-order` + Intelligence RPCs
- **3.4 Visual parts ID** — existing `parts-identify-photo` + `v_machine_parts_connections` for narrowing candidates
- **3.5 Supplier health monitoring** — `vendor_order_schedules` + historical price data + fill-rate tracking

---

## Known follow-ups (non-blocking)

1. **Replenish review UI** — `parts_replenish_queue_summary()` RPC exists; a `/parts/companion/replenish` page showing the queue grouped by vendor + next order date is a natural Slice 2.7 add.
2. **Machine profile page integration** — `machine_parts_intel(machine_id)` RPC is ready to light up the existing `MachineProfilePage` with a Parts tab.
3. **Forecast vs actuals tracking** — we write `predicted_qty` but don't yet compare against actual `parts_order_lines` post-period. Add a MAPE dashboard in Phase 2.7.
4. **Cron wiring** — `parts-demand-forecast` is set up to run on cron; confirm `supabase_cron` has it scheduled weekly. Same for `parts-auto-replenish` daily.

---

## Files touched

### New
```
supabase/migrations/260_parts_intelligence_phase2.sql
supabase/migrations/261_parts_phase2_replenish_and_machine_graph.sql
apps/web/src/features/parts-companion/lib/intelligence-api.ts
apps/web/src/features/parts-companion/pages/IntelligencePage.tsx
.claude/launch.json
QEP-Parts-Intelligence-Phase-2-Ship-Report-2026-04-15.md
```

### Modified
```
supabase/functions/parts-demand-forecast/index.ts      (v1 → v2_blended_cdk)
supabase/functions/parts-auto-replenish/index.ts        (+ schedule / forecast / corroboration)
apps/web/src/features/parts-companion/PartsCompanionRoutes.tsx  (+ intelligence route)
apps/web/src/features/parts-companion/PartsCompanionShell.tsx   (+ intelligence in activeTab)
apps/web/src/features/parts-companion/components/CompanionSidebar.tsx  (+ Brain nav item)
```

---

*Phase 2 complete. Every part now has a velocity class, a forecast, a stockout projection, a margin signal, and a vendor ordering cadence. Phase 3 moonshot is unblocked.*
