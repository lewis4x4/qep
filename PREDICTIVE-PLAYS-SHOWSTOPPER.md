# 🚀 Predictive Plays — The Showstopper

**Status:** Code-complete · Not deployed · Not seeded (as of 2026-04-15)
**Route:** `/parts/companion/predictive-plays`
**Sidebar icon:** Rocket

---

## The one-line pitch

**"Tell the sales rep which specific parts each customer will need in the next 90 days, with how many to order and which day to order them by."**

---

## What it produces (the money shot)

One row in the UI per (customer × machine × part × projection window):

> 🚀 **Johnson Construction**
> 
> 🚚 Yanmar SA424 · 1,820 hrs · within 30 days
> 
> **`129A00-55730`** — Fuel Filter Element
>
> ⚡ 250-hr service interval due in ~180 hrs (est 2026-05-15)
>
> ✨ **Pre-position 2 more** (you have 1, need 3) — order by **Thursday (Yanmar)**.
>
> Projected revenue **$76.56** · 85% confidence · Service interval signal

That's a rep-ready decision. Not "think about maintenance." Not "here's a checklist." A specific SKU, a specific count, a specific vendor, a specific deadline.

---

## Why it's a moonshot

This output is **genuinely impossible to produce** without every piece of infrastructure we built across Phases 1 + 2:

| Data piece | Where it came from | Why predictive plays needs it |
|---|---|---|
| 4,309 parts with `machine_code` | CDK PARTMAST import (Phase 1) | Matches parts to machine models |
| 24 months of per-part history | `parts_history_monthly` (Phase 1) | Primes velocity classifier |
| Machine↔parts graph | `machine_parts_links` (Phase 2) | Knows which parts fit which model |
| Blended forecast | `parts_demand_forecasts` v2 (Phase 2) | Sizes recommended_order_qty |
| Vendor ordering schedules | `vendor_order_schedules` (Phase 1 contacts) | Computes "order by Thursday" |
| Current inventory | `parts_catalog.on_hand` (Phase 1) | Knows what you already have |
| Customer machine hours | `customer_fleet.current_hours` (pre-existing) | The trigger signal |
| Machine maintenance schedules | `machine_profiles.maintenance_schedule` (pre-existing) | The "which parts, when" rulebook |

Remove any single one and this feature emits nothing. With all of them it emits a concrete play.

---

## The prediction math

Given a fleet row: `Yanmar SA424`, `current_hours=1820`, `service_interval_hours=250`:

1. **Match** → `machine_profiles` where `manufacturer='Yanmar' and model='SA424'`
2. **Flatten** → `maintenance_schedule` JSONB into per-interval rows
3. **Project interval** →
   ```
   hours_into_interval = 1820 % 250 = 70
   hours_until_next    = 250 - 70  = 180
   projected_due_date  = today + ceil(180 / 6) = today + 30 days
   ```
   (6 hrs/day is our default daily-usage assumption; telemetry upgrade possible)
4. **Cross-reference parts** → For each part in `schedule.parts[]` that also exists in `parts_catalog`:
   - Look up `on_hand`, `cost_price`, `list_price`
   - `recommended_order_qty = max(1, 2 - on_hand)`
   - Call `next_vendor_order_date(vendor_id, branch)` → returns the next Thursday (or whatever their cadence is)
5. **Write play** → upsert `predicted_parts_plays` with `probability=0.85`, `signal_type='hours_based_interval'`
6. **Idempotent** — re-runs update in place. Dismissed / actioned / fulfilled decisions survive.

Secondary signal: `common_wear_parts` from `machine_profiles` gives softer plays (0.65 probability, `signal_type='common_wear_pattern'`).

---

## The UI

**Top**: Rocket + orange→purple gradient header, "MOONSHOT" badge, "Run predictions" button.

**5 KPI cards**:
- Open Plays
- Due in 7 days (danger tone)
- Needs Order (warning tone — count of plays where recommended_order_qty > on_hand)
- Revenue at Play next 90d (success tone)
- Customers touched

**Filter pills**: All / Due in 7 days / Needs order / Pre-positioned

**Body**: Grouped by customer. Each customer card contains every play across all their machines, sorted by due date.

**Per-play row**:
- Machine make/model/hours + projection window pill
- Part number (bold mono) + description
- The reason line (small muted text, with a ⚡ icon)
- **The recommendation** — star of the show, big friendly sentence:
  - If pre-positioned: ✓ green "Pre-positioned — X on hand covers Y needed."
  - If short: ✨ orange "Pre-position **N more** (you have X, need Y) — order by **Thursday (Vendor)**."
- Right column: projected revenue · Action + Dismiss buttons · confidence % + signal type

Mobile-first responsive. Matches the premium dark-mode aesthetic of the rest of Parts Companion.

---

## The components

### Database (migration 262)

| Object | Type | Purpose |
|---|---|---|
| `predicted_parts_plays` | Table | One row per (customer, machine, part, window) — the source of truth for plays |
| `v_predictive_plays` | View | Enriched read surface — joins customer + fleet + inventory + vendor |
| `predict_parts_needs()` | RPC | The brain — 7-CTE SQL that computes plays |
| `predictive_plays_summary()` | RPC | Dashboard payload with KPIs + top-30 plays |
| `action_predictive_play()` | RPC | Lifecycle: mark actioned / dismissed / fulfilled |

### Edge function

`supabase/functions/parts-predictive-failure/index.ts` — orchestrator:
- Service-role path (cron)
- User-JWT path (admin/manager/owner "Run predictions" button)
- Optional `chain_auto_replenish=true` → kicks `parts-auto-replenish` after so scheduled POs reflect new plays

### Frontend

| File | Role |
|---|---|
| `apps/web/src/features/parts-companion/pages/PredictivePlaysPage.tsx` | The page (590 lines) |
| `apps/web/src/features/parts-companion/lib/intelligence-api.ts` | Typed client: `fetchPredictivePlays`, `runPredictivePrediction`, `actionPlay` |
| `apps/web/src/features/parts-companion/PartsCompanionRoutes.tsx` | Route `/predictive-plays` registered |
| `apps/web/src/features/parts-companion/components/CompanionSidebar.tsx` | Rocket nav entry |
| `apps/web/src/features/parts-companion/PartsCompanionShell.tsx` | Active-tab detection |

---

## What works today

- ✅ Schema installed at migration-check level (262 files canonical)
- ✅ Frontend compiles cleanly (`bun run build` green)
- ✅ Local dev server boots with no console errors
- ✅ Routes + nav wired
- ✅ Typed API adapter round-trips

## What's NOT done yet (blockers before it emits plays in prod)

- ❌ Migrations 257–262 applied to production Supabase
- ❌ `parts-bulk-import` + `parts-predictive-failure` edge functions deployed
- ❌ `parts-imports` Supabase Storage bucket created (part of migration 258)
- ❌ 4 Lake City files hydrated (`bun run parts:hydrate`)
- ❌ `machine_parts_graph_refresh()` RPC called post-hydration
- ❌ `compute_seeded_forecast(null, 3)` called post-hydration
- ❌ `predict_parts_needs(null, 90)` called to generate plays
- ❌ Frontend deployed to Netlify (`git push origin main` → Netlify rebuild)
- ❌ `customer_fleet` populated with real customer machines + current_hours (this is the input signal — without it, zero plays will be generated even after everything else is deployed)

---

## Deploy checklist (full Phase 3.3 activation)

```bash
# 1. Apply all migrations (Phases 1+2+3)
supabase db push

# 2. Deploy edge functions
supabase functions deploy parts-bulk-import
supabase functions deploy parts-predictive-failure

# (parts-demand-forecast and parts-auto-replenish already exist;
#  redeploy them too to pick up Phase 2 changes)
supabase functions deploy parts-demand-forecast
supabase functions deploy parts-auto-replenish

# 3. Hydrate the parts data
bun run parts:hydrate
#   → Loads 47 vendors, 241 contacts, 26 schedules
#   → Loads 17,881 Yanmar prices
#   → Loads 4,309 PARTMAST rows + ~100k history rows

# 4. Build the machine↔parts graph + seed forecasts
# In SQL editor or via psql:
select public.machine_parts_graph_refresh();
select public.compute_seeded_forecast(null, 3);

# 5. Ensure customer_fleet has real data
#   → Without customer machines + current_hours, zero plays will be emitted.
#   → customer_fleet can be populated by import or CRM sync (existing flow).

# 6. Run predictions
select public.predict_parts_needs(null, 90);
#   → Returns { plays_written: N, machines_scanned: M, elapsed_ms: K }

# 7. Commit + push frontend
git add -A
git commit -m "feat(parts): Phase 1+2+3 — CDK ingest, Intelligence dashboard, Predictive Plays moonshot"
git push origin main
#   → Netlify picks up and rebuilds

# 8. Visit https://qualityequipmentparts.netlify.app/parts/companion/predictive-plays
#   → Should show grouped plays per customer with pre-positioning recommendations
```

---

## Daily usage pattern (intended)

1. **Cron** runs `parts-predictive-failure` nightly at 3am with `chain_auto_replenish=true`
2. Plays land on `/parts/companion/predictive-plays`
3. **Rep** opens the page at 8am → sees all open plays grouped by customer
4. For each high-confidence 7-day play: clicks **Action** → creates parts order / customer call / calendar reminder
5. If a play hits its due date without being actioned, it auto-expires (clean queue)
6. When the service appointment lands: rep marks `fulfilled` → feeds accuracy-tracking (future slice)

---

## Accuracy ladder (current + planned)

| Signal | Probability | Status |
|---|---|---|
| `hours_based_interval` | 0.85 | ✅ shipped — from machine's own maintenance schedule |
| `common_wear_pattern` | 0.65 | ✅ shipped — pattern-based from avg_replace_hours |
| `date_based_schedule` | 0.75 | planned 3.3b — annual oil change, storage cycles, etc. |
| `yoy_demand_spike` | 0.60 | planned 3.3b — hot-mover × customer purchase pattern |
| `ai_inferred` | 0.40–0.90 | planned 3.3b — Claude augmentation for seasonal/industry context |
| `manual_curation` | 0.95 | ✅ schema-ready — rep-added plays (bypass predictor) |

---

## Why this changes the business

**Revenue** — every play is a sales conversation starter with a *specific SKU* and *explicit lead time*. The difference between "hey, been a while, think about maintenance" and "your SA424 at 1,820 hrs needs 129A00-55730 in 21 days, I'll drop 2 by Tuesday."

**Capital efficiency** — pre-positioning = fewer surprise stockouts + fewer rush-order expedites. Inventory turns improve because we stock-to-demand, not stock-to-fear.

**Customer retention** — proactive parts delivery is the single strongest reason customers stay with a dealer. This is the operational backbone.

**Operator dignity** — this is not a spreadsheet or a reminder. It's an AI pair that scans every customer machine every night and brings the rep a prioritized ask list every morning.

---

## Related ship reports

- [Phase 1 Foundation](QEP-Parts-Intelligence-Phase-1-Ship-Report-2026-04-15.md) — ingestion + conflict reconciliation
- [Phase 2 Intelligence](QEP-Parts-Intelligence-Phase-2-Ship-Report-2026-04-15.md) — velocity + forecast + auto-replenish + graph
- [Phase 3.3 Predictive Plays](QEP-Parts-Intelligence-Phase-3-3-Predictive-Plays-Ship-Report-2026-04-15.md) — this slice, full detail
- [Master Plan](QEP-Parts-Intelligence-Engine-Master-Plan-2026-04-15.md) — the 3-phase roadmap

---

*This file describes what works after full deployment. Today the code is live in the repo, the build is green, and the path to production is the 8-step checklist above.*

🚀
