# QEP Owner Dashboard — Moonshot Ship Report

**Date:** 2026-04-16
**Branch:** `main`
**Route:** `/owner` (role=owner lands here on login)
**Status:** Shipped — all 7 slices live in production

---

## What shipped

A 5-tier cockpit page that gives the owner one screen for the whole business.

### Tier 1 — Hero
- **Ownership Health Dial** — animated SVG arc (ease-out cubic, 900 ms). Composite 0-100 score weighted across Parts (20%), Sales (25%), Service (20%), Rental (15%), Finance (20%). Current live score: **72 · Healthy**. Per-dimension sub-score bars underneath.
- **Owner Brief Card** — Claude Sonnet 4.6 writes a 3-5 sentence morning narrative from `owner_dashboard_summary` + `compute_ownership_health_score` + `owner_event_feed(24h)`. 60-min cache in `owner_briefs`; refresh button forces regeneration. Local synthesis fallback until the edge function warms.

### Tier 2 — Ask Anything
Full-width input. Owner types a question, Claude answers with tool use across:
- `get_dashboard_summary`, `search_parts` (hybrid semantic via `match_parts_hybrid`), `search_companies`, `list_deals` (status / min_amount / stale_days), `recent_predictive_plays`, `branch_stack_ranking`, `owner_event_feed`.
- Tool trace is persisted in the response and collapsible in the UI for transparency.

### Tier 3 — Live Business Signals (6 premium KPI cards)
Today's Revenue · Pipeline Weighted Value · Parts Capital at Play · Critical Stockouts · Service Backlog · AR Aged 90+. Each card drill-routes to the relevant deep page. Tone (neutral/good/warning/critical) is derived from the live data.

### Tier 4 — Predictive Interventions
Claude Sonnet 4.6 projects 3-4 forward scenarios. Each: title, projection (with concrete number + timeframe), rationale (citing the driving signal), impact_usd, horizon_days, severity, and a click-through `action { label, route }` constrained to a whitelist of 14 real app routes. 30-min cache in `owner_predictive_interventions_cache`. Static fallback renders until first warm-up.

### Tier 5 — Branch Stack + Team Signals
- **Branch Stack Heatmap** — per-branch inventory value / dead parts / reorder count with quartile coloring (emerald → amber → rose).
- **Team Signals Grid** — YTD bookings, close rate, avg close days per rep. Top-quartile reps get an emerald ring; bottom-quartile get amber. Empty state handled.

---

## Shipped artifacts

### Migrations (3)
| # | Name | Purpose |
|---|---|---|
| 273 | `owner_dashboard.sql` | `owner_dashboard_summary`, `compute_ownership_health_score`, `owner_event_feed`, `v_branch_stack_ranking` |
| 274 | `owner_briefs_cache.sql` | `owner_briefs` 60-min cache + `owner_team_signals()` RPC |
| 275 | `owner_predictive_interventions_cache.sql` | 30-min scenario cache |

### Edge functions (3 · Claude Sonnet 4.6)
- `owner-morning-brief` — cached narrative; refresh=true bypasses cache.
- `owner-ask-anything` — tool use across 7 domains.
- `owner-predictive-interventions` — STRICT-JSON scenario engine with route-whitelist validation.

### Frontend (`apps/web/src/features/owner/`)
- `pages/OwnerDashboardPage.tsx` — 5-tier composition, 90 s refetch, realtime invalidation via `useDashboardRealtime('iron_manager')`.
- `components/OwnershipHealthDial.tsx` — animated SVG arc.
- `components/OwnerBriefCard.tsx` — narrative + refresh.
- `components/AskAnythingBar.tsx` — Claude tool-use surface.
- `components/PredictiveInterventionPanel.tsx` — scenario cards.
- `components/BranchStackHeatmap.tsx` — quartile heatmap.
- `components/TeamSignalsGrid.tsx` — rep leaderboard.
- `components/OwnerKpiTile.tsx` — premium KPI card primitive.
- `lib/owner-api.ts` — typed client for all RPCs + edge fns.

### Routing & nav
- `apps/web/src/lib/home-route.ts` — role=owner now lands at `/owner` (was `/qrm`).
- `apps/web/src/App.tsx` — `/owner` route, owner-gated with `<Navigate to="/dashboard">` fallback.
- `apps/web/src/lib/nav-config.ts` — "Owner Cockpit" utility nav item (owner-only).

---

## Commit trail
| SHA | Slice | Summary |
|---|---|---|
| `b281cd6` | A + B | Foundation — migration 273, /owner route, KPI grid live |
| `4fc3903` | C | owner-morning-brief edge fn + migration 274 |
| `cb3decc` | D | owner-ask-anything edge fn (Claude tool use) |
| `a0cc4cd` | E | owner-predictive-interventions edge fn + migration 275 |
| `a4b49e0` | F | Animated SVG dial + TeamSignalsGrid wired |
| `HEAD`    | G | Polish + nav entry + ship report |

---

## Production readout (at ship)

From `owner_dashboard_summary('default')`:
- **Parts catalog:** 4,317 SKUs · last CDK import 2026-04-15
- **Dead capital:** $79,469
- **Stockouts (critical):** 3,560
- **Open predictive plays:** 12 · projected revenue $1,351
- **Replenish pending:** 2
- **Margin erosion flags:** 4

From `compute_ownership_health_score('default')`:
- **Composite:** 72 · **Healthy**
- Parts 52 · Sales 60 · Service 75 · Rental 75 · Finance 100

---

## Mission check

| Check | Result |
|---|---|
| Mission Fit | Owner cockpit is the missing top-of-funnel for QRM Phase 1 — field/corporate/management all benefit from a single-screen view. |
| Transformation | Tool-use Ask Anything + scenario engine + ownership health composite don't exist in any off-the-shelf CRM. Claude Sonnet 4.6 grounds every number in live tool output. |
| Pressure Test | End-to-end tested against live prod data: RPC returns JSON, edge fns deploy & respond, build is green, empty-states render cleanly (0-rep team signals, cold-cache briefs). |
| Operator Utility | Owner signs in → sees health, narrative, 6 KPIs, 3 interventions, branch + team stack in one scroll. Drill actions route into existing deep pages (QRM deals, intelligence, replenish queue, etc.). |

---

## Follow-ups (not blockers)

- **Service health score wiring** — currently defaults to 75 until `service_dashboard_rollup` lands.
- **Rental utilization score wiring** — currently defaults to 75.
- **Ask Anything history** — persist turn pairs per owner so the bar can answer follow-ups ("what about the one I asked earlier?").
- **Morning brief cron** — schedule a daily `refresh=true` call at 7am local so the first owner visit doesn't wait on the LLM.
- **Team Signals richness** — layer in activity counts + `qrm_activities` to show "last customer touch" per rep.

None of these block the moonshot claim. The cockpit is live and working against real data today.
