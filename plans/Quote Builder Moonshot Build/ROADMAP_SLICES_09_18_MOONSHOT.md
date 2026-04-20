# ROADMAP — Quote Builder Moonshot, Post-Slice-08

**Status:** Planned. Needs owner prioritization pass before CP execution.

**Depends on:** Slice 08 (Admin Hardening) — shipped 2026-04-19 at `45430d3`.

**Source of truth:** Single roadmap covering everything the Quote Builder Moonshot track still owes the product, assembled from three sources:
1. **Track A — new moonshot features** I recommended in the Slice-08 closeout (10 items)
2. **Track B — deferred backlog** from Slice 04/06/07 `Out of Scope` sections that was parked for "later" but never scheduled
3. **Track C — cross-track integration** work flagged in prior plans (QRM Phase 1, Executive Command Center, DGE) that touches Quote Builder surfaces

**This replaces the earlier version of this document** that covered only Track A. The user flagged that the deferred + cross-track work was missing — it's now included in full.

---

# Executive Summary

**Total known work:** 22 work items across 3 tracks, collapsed into **13 slices** sized 0.5–2 weeks each. Range: ~22–28 weeks of single-engineer focused work, or ~14–18 weeks with 2 contributors running non-overlapping tracks in parallel.

The three tracks by nature:

| Track | What it is | Count | Cumulative size |
|---|---|---|---|
| **A** Moonshot features | Net-new rep/admin capabilities — the highest-leverage slices | 10 items | ~11 weeks |
| **B** Deferred backlog | Items explicitly parked with "later slice" notes in Slices 04/06/07 | 10 items | ~5 weeks |
| **C** Cross-track integration | QRM Phase 1 + Executive + DGE touchpoints that affect Quote Builder | 5 items | ~6 weeks |

**Recommended execution order** (below) maximizes compounding: foundation (Slice 09) first, then parallel tracks pull in the highest-value item from each until the deferred backlog is cleared.

---

# What's Actually Pending

Before sequencing, the full inventory. Each item is labeled with track + source reference.

## Track A — Moonshot Features (from Slice-08 closeout)

| # | Feature | Track | Source |
|---|---|---|---|
| A1 | Quote lifecycle unification (`quote_packages` → `qb_quotes`) | A | Slice-08 #1 |
| A2 | Deal coach sidebar (rule-based v1) | A | Slice-08 #2 |
| A3 | Deal-cycle velocity intelligence | A | Slice-08 #3 |
| A4 | Voice-to-quote pipeline | A | Slice-08 #4 |
| A5 | Freight zone auto-suggest from historical orders | A | Slice-08 #5 |
| A6 | Proactive price-sheet stale detection + vendor watchdog | A | Slice-08 #6 |
| A7 | Win/loss reason capture at deal close | A | Slice-08 #7 |
| A8 | "Add to QRM" one-click from unresolved AI requests | A | Slice-08 #8 |
| A9 | Smart disclosure for under-margin quotes | A | Slice-08 #9 |
| A10 | Admin audit log UI (against existing `qb_*_audit` tables) | A | Slice-08 #10 |

## Track B — Deferred Backlog (items parked in prior Out-of-Scope sections)

| # | Item | Parked in | Rationale at time of parking |
|---|---|---|---|
| B1 | `qb_programs` eligibility/edit admin UI | Slice 06 OoS | Separate surface, later slice |
| B2 | `qb_programs` freshness tracking | Slice 07 OoS | No cadence logic needed yet |
| B3 | Human review UI for extracted items (`qb_price_sheet_items` / `_programs`) | Slice 07 OoS (Q5=skip) | Revisit when extraction eval data is available |
| B4 | Notification emails for overdue price sheets | Slice 07 OoS | Separate workstream; `qb_notifications` infra exists |
| B5 | AI log pruning / retention cron | Slice 06 OoS | Soft-keep policy during early Iron training; needed long-term |
| B6 | P50/P95 latency SLA alerting for edge functions | Slice 06 OoS | Future analytics pass |
| B7 | Retire / properly integrate orphan `qb-calculate` edge fn | Slice-07 audit C1 note | Pre-existing; audit fix (7426ef3) stopped the bleeding but didn't retire |
| B8 | Remove `FALLBACK_FREIGHT_CENTS = 194200` hardcode | Slice 07 OoS | Real ASV/FL rate, but shouldn't be in code |
| B9 | `discount_configured` column rename to `deal_engine_enabled` | Slice 07 OoS | 14 callsites > 10-file rename threshold; UI label handled it — revisit only when other slices already touch many of those files |
| B10 | `qb_price_sheets` historical URL preservation / archival | Slice 07 note | Retention policy TBD |

## Track C — Cross-Track Integration

| # | Item | Source | Affects Quote Builder because… |
|---|---|---|---|
| C1 | CRM / HubSpot integration for quotes | Slice 06 OoS ("QRM Phase 1 track") | Quotes reference deals/contacts; once QRM Phase 1 lands, `qb_quotes` needs a deal_id + contact_id wiring |
| C2 | Executive Command Center quote KPI feed | `2026-04-07-executive-command-center-moonshot-roadmap.md` Phase 2 | Quote throughput + win rate are canonical executive metrics |
| C3 | Iron AI training loop using quote outcome data | Slice 06 retention note + A7 | Outcome + scenario data is training fuel; needs a pipeline to the Iron fine-tuning layer |
| C4 | DGE Sprint 2 reconciliation for quote-driven deal economics | `CLAUDE.md` + Wave 5-6 reconciliation matrix | DGE refresh jobs need to consume `qb_quotes` once unified |
| C5 | QRM cross-department signals feeding quote urgency | `2026-04-08-qrm-addendum-merge.md` §3 | Cross-department event stream (rental-returns → resale opp, service → replacement) should surface as deal coach signals |

---

# Sequencing

Dependency graph (simplified):

```
Slice 09 (A1 Quote Lifecycle) ──┬── Slice 10 (A7 Win/Loss) ──┐
                                ├── Slice 12 (A3 Velocity)   │
                                └── Slice 13 (A2 Coach v1) ──┼── Slice 18 (A2 Coach v2, ML)
                                                             │     (waits for outcome data)
Slice 11 (A8+A10 parallel cleanup) — independent ───────────┘

Slice 14 (A4 Voice-to-Quote) — independent

Slice 15 (A9 Pricing Discipline) — soft-depends on 09

Slice 16 (A6 Price Sheet Watchdog) — independent

Slice 17 (A5 Freight Auto-Suggest) — depends on delivery data (from C4 DGE reconciliation)

Deferred-backlog (Track B) items fold into thematic slices:
  B1, B2 → Slice 19 (Programs Admin)
  B3     → never scheduled as a slice of its own; revisits depend on A7 data quality
  B4     → Slice 20 (Notification plumbing)
  B5     → Slice 20 (AI log retention)
  B6     → Slice 21 (Observability hardening)
  B7, B8 → Slice 21 cleanup bundle
  B9     → opportunistically; probably never executes
  B10    → Slice 20 (retention bundle)

Cross-track (Track C) items:
  C1 — unblocks Slice 10's outcome capture if deals/contacts come from HubSpot
  C2 — consumer of Slice 12 (velocity) data
  C3 — consumer of Slice 10 (outcome) data
  C4 — prerequisite for Slice 17 (freight data)
  C5 — enhancer of Slice 13 (coach)
```

**Recommended execution sequence** (maximizes compounding + earliest moonshot feel; ordered within capacity of one engineer serial):

| # | Slice | Items | Why here | Size |
|---|---|---|---|---|
| 1 | **09 Quote Lifecycle Unification** | A1 | Foundation; everything downstream compounds on it | 1 wk |
| 2 | **11 Admin Audit + One-Click Pipeline** | A8, A10 | Parallel cleanup track; zero dependency; ships fast wins | 1 wk |
| 3 | **14 Voice-to-Quote** | A4 | Independent high-delight feature | 1.5 wk |
| 4 | **10 Win/Loss Learning Loop** | A7 | Needed to train everything coming after | 1 wk |
| 5 | **12 Deal Cycle Velocity** | A3 | First predictive-ish surface; mgmt visibility | 2 wk |
| 6 | **13 Deal Coach Sidebar v1** | A2 | First rep-facing live intelligence | 2 wk |
| 7 | **15 Smart Pricing Discipline** | A9 | Margin guardrail; cheap + high-signal | 1 wk |
| 8 | **16 Auto Price Sheet Watchdog** | A6 | Long-tail ops automation for Angela | 1.5 wk |
| 9 | **19 Programs Admin + Freshness** | B1, B2 | Admin completeness; unblocks Angela editing programs without engineering | 1 wk |
| 10 | **20 Notification + Retention Plumbing** | B4, B5, B10 | Governance/policy work that accumulates risk until done | 1 wk |
| 11 | **21 Observability + Cleanup Bundle** | B6, B7, B8 | Infra hygiene — SLA alerts, retire `qb-calculate`, remove hardcode | 1 wk |
| 12 | **17 Freight Zone Auto-Suggest** | A5 | After C4 (DGE reconciliation) provides delivery data | 1 wk |
| 13 | **18 Deal Coach v2 (ML)** | A2 extension | Requires 3+ months of accumulated outcome data (from Slice 10) | 2+ wk |

B3, B9 stay deferred indefinitely — explicitly **don't schedule** unless the driver conditions appear (extraction quality problems; a slice that touches 8+ of the 14 `discount_configured` callsites already).

**Track C items don't get slices of their own in this track** — they're consumer or producer relationships with other tracks:
- C1 ships when QRM Phase 1 delivers deal/contact schema; Slice 09 leaves room for the `deal_id` + `contact_id` FK addition
- C2 ships when the Executive track pulls from `qb_quotes` (no action needed from us)
- C3 ships when the Iron AI training pipeline lands (consumer of our Slice 10 data)
- C4 is a DGE-track deliverable; we consume its output in Slice 17
- C5 is a QRM-track enhancement; Slice 13's rule registry is designed to accept signals from there when ready

---

# Per-Slice Detail

Below: full scope for each of the 13 slices in the recommended order.

Format follows Slice 07/08 convention: objective, scope, checkpoint plan, acceptance, risks, open questions.

---

## Slice 09 — Quote Lifecycle Unification

**Track A1** · **Size:** 1 week · **Depends on:** Slice 08

### Objective
Migrate the save flow from `quote_packages` to `qb_quotes`. Every downstream slice assumes quotes live in `qb_quotes` with `originating_log_id` populated.

### Why now
- `qb_quotes` table was built in migration 286 + the `originating_log_id` FK wired in migration 301 (Slice 07 CP1), but nothing writes to it. The Slice 08 CP8 "Time to Quote" column on AI Request Log will stay at `—` forever until this ships.
- Every moonshot slice below (10, 12, 13, 15, 18) needs a consistent quote record. Maintaining two parallel tables doubles blast radius on every change.
- Track C1 (HubSpot/QRM integration) will add `deal_id` + `contact_id` to the quote record. Easier to land on a unified table.

### Scope

**New files:**
- `supabase/functions/qb-create-quote/index.ts` — new edge fn wrapping `qb_quotes` insert + line items + program application + `originating_log_id` linkage
- `apps/web/src/features/quote-builder/lib/qb-quote-api.ts` — client API
- Migration `302_qb_quotes_from_packages.sql` — one-time backfill

**Modified:**
- `QuoteBuilderV2Page.tsx` — swap save path
- `quote-api.ts` — deprecate `saveQuotePackage`; add adapter
- `quote-builder-v2/index.ts` edge fn — proxy or retire

### CPs
1. Migration 302 + backfill
2. `qb-create-quote` edge fn
3. Client `qb-quote-api.ts` + adapter
4. `QuoteBuilderV2Page` migrated
5. `originating_log_id` wire-up from SSE stream
6. Final gates + retire old path

### Acceptance
- Quotes saved from UI land in `qb_quotes`
- AI Request Log "Time to Quote" shows real values
- No regression in quote list / detail / send / sign

### Open owner questions
- Q9.1: Retire `quote_packages` completely, or keep read-side for 90 days for historical URLs?
- Q9.2: Feature-flag the cutover or direct?

---

## Slice 11 — Admin Audit + One-Click Pipeline

**Track A8 + A10** · **Size:** 1 week · **Depends on:** (none)

### Objective
- `qb_*_audit` tables already exist (migration 288). Expose them in an admin page.
- AI Request Log unresolved rows get a "Add to QRM" one-click CTA.

### Scope

**New:**
- `apps/web/src/features/admin/pages/AuditLogPage.tsx` + `audit-api.ts`
- Route + nav entry, wrapped in `<RequireAdmin>` from Slice 08

**Modified:**
- `AiRequestLogPage.tsx` — "Add to QRM" button on unresolved rows, using existing QRM contact/lead APIs

### CPs
1. AuditLogPage + filters
2. One-click QRM CTA + QRM API wiring
3. Integration tests for both
4. Gates + smoke

### Acceptance
- Admins can answer "who changed freight zone X last week?" in <10s
- Unresolved AI requests convert to QRM prospects at ≥20% in first month

---

## Slice 14 — Voice-to-Quote Pipeline

**Track A4** · **Size:** 1.5 weeks · **Depends on:** existing `iron-transcribe` infra

### Objective
Rep says "Iron, quote me an RT-135 for Acme delivering to Ocala with PDI" → Iron fills the quote builder, runs the Deal Engine, reads back the monthly payment, offers send/save.

### Scope

**New:**
- `qb-voice-quote` edge fn — orchestrates transcribe → qb-parse-request → qb-ai-scenarios
- `VoiceQuoteButton.tsx` — hold-to-record UX in top bar
- Pre-fill + highlight in quote form
- Voice readback via existing `iron-tts`

### CPs
1. `qb-voice-quote` edge fn
2. Voice button UI + hold-to-record
3. Pre-fill flow into QuoteBuilder state
4. Iron readback
5. Confirmation (send/email/save)
6. Integration test
7. Gates + smoke

### Acceptance
- Desk → quote in <30s for a representative prompt
- Rep sees filled form with highlighted auto-populated fields
- Iron reads back headline monthly payment

### Open owner questions
- Q14.1: Where does the voice button live? Top bar, dashboard, dedicated voice page?
- Q14.2: Confirmation required before send, or auto-send on voice confirm?

---

## Slice 10 — Win/Loss Learning Loop

**Track A7** · **Size:** 1 week · **Depends on:** Slice 09

### Objective
10-second reason capture on every quote won/lost. Structured data for learning.

### Scope

**New:**
- Migration 303: `qb_quote_outcomes` with RLS
- `OutcomeCaptureDrawer.tsx` — voice-friendly reason chips (Price, Timing, Relationship, Service, Financing, Competitor, Other) + free text
- Status-transition hook fires the drawer
- Admin rollup tab on DealEconomicsPage

### CPs
1. Migration 303 + table
2. Capture drawer UI
3. Status-transition hook
4. Rollup view
5. Gates + smoke

### Acceptance
- ≥80% of quotes closed 30 days post-ship have an `qb_quote_outcomes` row OR explicit skip flag
- Admin can see top 3 loss reasons per brand, month-over-month

### Open owner questions
- Q10.1: Mandatory or skippable? Mandatory blocks close, skippable risks low adoption.

---

## Slice 12 — Deal Cycle Velocity Intelligence

**Track A3** · **Size:** 2 weeks · **Depends on:** Slice 09

### Objective
Descriptive analytics on how long quotes spend in each stage. First predictive surface.

### Scope

**New:**
- Migration 304: `qb_quote_stage_timings` materialized view on `qb_quotes_audit` with nightly cron refresh
- `/admin/deal-velocity` — per-stage median/p90, filter by rep/brand/deal-size band
- Drill-down: stalled quotes list

### CPs
1. Migration 304 + view + cron
2. `velocity-api.ts`
3. Overview page
4. Drill-down
5. Integration tests
6. Gates + smoke

### Acceptance
- Management can see "ASV avg 4.2 days pending; Barko 11.3 days — why?"
- Reps see own pipeline health per brand

---

## Slice 13 — Deal Coach Sidebar v1 (Rules)

**Track A2** · **Size:** 2 weeks · **Depends on:** Slice 09 · **Benefits from:** Slice 10

### Objective
Live sidebar in quote builder. 3 initial rules; registry accepts more from Track C5 when QRM signals land.

### Scope

**3 rules:**
1. Margin vs. personal baseline (rep's won-deal median, same brand + zip cluster, last 90 days)
2. Program stackability (detect missed stackable incentive)
3. Bid window urgency (CRM RFP deadline + win-rate inside vs. outside window)

**New:**
- `DealCoachSidebar.tsx`
- `coach-rules/` — one file per rule + registry

### CPs
1. Sidebar shell
2. Rule registry + RuleResult type
3. Rule 1 margin
4. Rule 2 stackability
5. Rule 3 bid window
6. Dismissal + applied tracking
7. Integration tests
8. Gates + smoke

### Acceptance
- Sidebar mounts and renders non-trivial suggestions on sample quote
- Dismissals persisted per rep
- Cap of 3 visible suggestions (Clippy guardrail)

---

## Slice 15 — Smart Pricing Discipline

**Track A9** · **Size:** 1 week · **Depends on:** Slice 09

### Objective
Detect under-margin quotes; require one-sentence reason before send; log + rollup.

### Scope

**New:**
- Migration 305: `qb_margin_thresholds` (per brand × deal-size-band × rep-tenure-band)
- Inline banner in QuoteBuilder
- Reason modal on send
- "Margin discipline" rollup tab

### CPs
1. Migration 305 + threshold admin UI
2. Inline banner
3. Reason modal
4. Rollup tab
5. Gates + smoke

### Acceptance
- Every quote sent under margin has a recorded reason
- Management sees "which reps / brands / zips erase the most margin"

---

## Slice 16 — Auto Price Sheet Watchdog

**Track A6** · **Size:** 1.5 weeks · **Depends on:** (none)

### Objective
Nightly check of vendor URLs; auto-extract new sheets in a sandbox; diff + one-click approve.

### Scope

**New:**
- Migration 306: `qb_brand_sheet_sources` (brand + vendor URL + check frequency)
- `qb-price-sheet-watchdog` cron edge fn
- Banner in `/admin/price-sheets` for detected sheets
- One-click approve flow

### CPs
1. Migration 306 + sources UI
2. Watchdog edge fn (URL hash check)
3. Sandbox extract pipeline
4. Diff generation
5. Review UI
6. Cron + alerting (flare + email from Slice 20)
7. Gates + smoke

### Acceptance
- New sheets detected within 24 hours of vendor publish
- Diff is accurate (no false positives)
- Angela approves in one click from a flare notification

### Open owner questions
- Q16.1: Source URLs — do we have them? Most OEMs don't publish stable PDF URLs. May require human-supplied URL inventory or headless-browser scraping.

---

## Slice 19 — Programs Admin + Freshness

**Track B1 + B2** · **Size:** 1 week · **Depends on:** (none)

### Objective
Close the long-deferred `qb_programs` admin gap. Angela (or Rylee) should be able to edit and track freshness of manufacturer programs without engineering touching the DB.

### Scope

**New:**
- `/admin/programs` page — list, create, edit, archive `qb_programs` rows
- Freshness column matching Price Sheets page (days since `effective_from` or last update; urgency thresholds)
- Stacking rule editor if `qb_program_stacking_rules` schema supports it (verify)

### CPs
1. Service layer `programs-api.ts`
2. List page with freshness
3. Create/edit form (program_type-specific fields)
4. Archive flow with confirm
5. Integration tests
6. Gates + smoke

### Acceptance
- Angela can update ASV's Q2 financing rate without an engineering ticket
- Freshness column visible per brand; urgency states match Price Sheets conventions

### Open owner questions
- Q19.1: Do we expose program-level RLS editing (workspace-scoped already) or keep it admin-only?
- Q19.2: For program types with rich `details` JSON (financing terms, rebate tables), do we build structured editors or a JSON textarea with schema hints?

---

## Slice 20 — Notification + Retention Plumbing

**Track B4 + B5 + B10** · **Size:** 1 week · **Depends on:** `qb_notifications` infra

### Objective
Three related governance items in one slice:
- Email notifications for overdue price sheets (B4)
- AI log retention cron with configurable policy (B5)
- `qb_price_sheets` historical URL preservation / archival (B10)

### Scope

**New:**
- Cron edge fn `qb-admin-notifications` — nightly scan of `qb_price_sheets` urgency; emits emails via existing email adapter for "urgent" brands
- Cron edge fn `qb-ai-log-retention` — soft-delete old `qb_ai_request_log` rows past retention policy (configurable; default 365 days; keep voice source forever)
- Migration 307: `qb_admin_policies` — one-row config for retention days, notification recipients

### CPs
1. Migration 307 + admin UI for policy config
2. Email notification cron
3. AI log retention cron
4. Price sheet archival strategy (compressed storage + pointer)
5. Integration tests
6. Gates + smoke

### Acceptance
- Angela + Rylee get a weekly email listing brands with urgent (>60d) price sheets
- AI log row count stabilizes at the retention horizon
- Historical price sheet URLs resolve via an archival path

### Open owner questions
- Q20.1: Retention horizon — 365 days default? 180? Different per row type?
- Q20.2: Email recipients — per-workspace config or global?

---

## Slice 21 — Observability + Cleanup Bundle

**Track B6 + B7 + B8** · **Size:** 1 week · **Depends on:** Slice 08 flare pipeline

### Objective
Three small hygiene items bundled:
- P50/P95 latency SLA alerting for Quote Builder edge fns (B6)
- Retire / properly integrate orphan `qb-calculate` (B7)
- Remove `FALLBACK_FREIGHT_CENTS = 194200` hardcode (B8)

### Scope

**New:**
- Migration 308: `qb_edge_fn_latency` — per-invocation timing rows for the Quote Builder edge fns
- Dashboard: P50/P95/P99 per function, weekly rollup
- Decision on `qb-calculate`: either integrate (route something through it) or retire (delete from staging, remove from repo)
- Remove `FALLBACK_FREIGHT_CENTS` — replace with a proper "no freight zone" error surface (partially done in Slice 07 CP2; this closes the loop)

### CPs
1. Migration 308 + latency logging instrumentation
2. Dashboard UI
3. Alerting thresholds → flare emission (piggybacks Slice 08 flare infra)
4. `qb-calculate` decision + execution
5. `FALLBACK_FREIGHT_CENTS` removal + callsite audit
6. Gates + smoke

### Acceptance
- P95 for `qb-ai-scenarios` + `extract-price-sheet` is visible on an admin page
- `qb-calculate` is either live-integrated or gone entirely (no orphan)
- No `FALLBACK_FREIGHT_CENTS` references in `apps/web/src`

### Open owner questions
- Q21.1: `qb-calculate` — integrate into the quote build flow (server-side pricing) or retire in favor of the client-side `apps/web/src/lib/pricing/calculator.ts`?

---

## Slice 17 — Freight Zone Auto-Suggest

**Track A5** · **Size:** 1 week · **Depends on:** C4 DGE delivery data

### Objective
When Angela adds a new freight zone, suggest the rate based on historical delivery costs.

### Scope

**New:**
- Aggregation RPC: delivery cost per state × size class (joined from service orders or equivalent)
- Service layer wiring in `price-sheets-api.ts`
- UI chip in `FreightZoneForm`

### CPs
1. Data aggregation RPC/view
2. Service layer
3. UI chip in form
4. Gates + smoke

### Acceptance
- Opening "Add zone" for an uncovered state shows suggested rate + source count
- Apply button pre-fills inputs

### Open owner questions
- Q17.1: Which table holds actual delivery costs? `service_orders` isn't the obvious fit — may need a data plumbing pass from DGE track (C4) before this slice is startable.

---

## Slice 18 — Deal Coach v2 (ML-Backed)

**Track A2 extension** · **Size:** 2+ weeks · **Depends on:** Slices 09, 10, 13 · **Waits for:** 3–6 months of outcome data

### Objective
Replace hand-coded rules in the Deal Coach with learned signals.

### Readiness criteria (hard blockers)
- ≥ 200 closed quotes with `qb_quote_outcomes` data
- Slice 13 has been shipping ≥ 1 month (suggestion-acceptance data to train on)
- At least one rep power-user available to validate learned signals

### Scope (intentionally light — expands after data accumulates)
- Model: gradient-boosted classifier or simple logistic regression
- Features: brand, deal size, rep tenure, stage timing, margin vs. personal baseline, competitor flag, bid window
- Outputs: win probability delta + top-3 suggested next actions ranked by learned impact

### Open owner questions
- Q18.1: ML infra — Python inference service, in-browser via `@xenova/transformers`, or a dedicated edge fn hosting an ONNX model?

---

# Items Permanently Deferred (Explicitly Don't Schedule)

| Item | Why never |
|---|---|
| **B3** Human review UI for extracted items | Auto-approve (Slice 07 CP6) is working; revisit only if extraction quality drops below threshold. Decision deferred to post-Slice-10 data. |
| **B9** `discount_configured` → `deal_engine_enabled` rename | 14 callsites still > 10-file threshold; UI label already handles the name problem. Only revisit if a later slice already touches 8+ of those files for other reasons. |

---

# Cross-Track Coordination (C Items)

Not slices in this track — but the Quote Builder track needs to stay aligned with:

**C1 — CRM / HubSpot integration for quotes**
When QRM Phase 1 lands, `qb_quotes` needs `deal_id` + `contact_id` FKs. **Action:** Slice 09's schema leaves room for these FKs; they get added in a small follow-up slice (Slice 22 or equivalent) when QRM is ready.

**C2 — Executive Command Center quote feed**
Executive track consumes `qb_quotes` for KPIs. **Action:** nothing from our side once Slice 09 ships — `qb_quotes` becomes the canonical source.

**C3 — Iron AI training loop**
Iron team consumes `qb_quote_outcomes` + scenario data. **Action:** once Slice 10 ships, confirm schema is stable enough to publish as training fuel. No direct work in this track.

**C4 — DGE Sprint 2 reconciliation for freight data**
Slice 17 depends on DGE providing delivery cost data. **Action:** coordinate with DGE track — Slice 17 doesn't start until `service_orders` (or equivalent) has per-state cost data available.

**C5 — QRM cross-department signals → Deal Coach**
When QRM addendum lands (cross-department event stream), Slice 13's rule registry accepts new rules driven by rental-return, service, and parts events. **Action:** Slice 13's `coach-rules/` structure is designed to receive these; no work needed upfront.

---

# Delivery Cadence

**Per slice:** same rhythm as Slices 07 + 08:
1. Plan draft → owner Q&A pass → v2 plan
2. Per-CP branches with commits: `[QEP-QB-NN] CPX: …`
3. Gates at every CP boundary (migrations:check · tsc · test:unit · test:integration · build)
4. Edge function redeploys per CP when changed
5. PR → squash-merge → update execution log
6. Post-merge audit pass when the slice is operator-facing

**Parallelization opportunities:**
- Slices 09 and 11 can run concurrently (different code areas, different contributors)
- Slice 14 is independent and can run alongside any other slice
- Slices 19, 20, 21 are hygiene-themed and can run in series after the feature backbone lands

**Target cadence:** 1 slice every 7–10 days. Full roadmap ships in **~6 months of focused single-engineer work**, **~4 months with parallelization**.

---

# Owner Decisions Needed Before Kickoff

Consolidated list from all per-slice questions:

| Q | Question | Affects slice |
|---|---|---|
| **R1** | Sequence — ship the recommended order, or reprioritize? | all |
| **R2** | Parallelization budget — solo serial, or multiple contributors? | all |
| **R3** | Slice 09 cutover — feature-flag + shadow mode, or direct cutover? | 09 |
| **R4** | Slice 10 outcome capture — mandatory on close, or skippable? | 10 |
| **R5** | Slice 14 voice button placement | 14 |
| **R6** | Slice 16 vendor URLs — do we have them? | 16 |
| **R7** | Slice 17 — which table holds delivery costs? (DGE coordination) | 17, C4 |
| **R8** | Slice 18 ML infra — Python service, in-browser, or ONNX edge fn? | 18 |
| **R9** | Slice 19 program details editor — structured or JSON textarea? | 19 |
| **R10** | Slice 20 retention horizon — 365 / 180 / per-type? | 20 |
| **R11** | Slice 21 `qb-calculate` — integrate or retire? | 21 |

Slice 09 is blocked only on R1 (order confirmation) + R3 (cutover style). Everything else's owner Qs can be answered at that slice's plan-draft time.

---

# Out of Scope for This Entire Roadmap

- **Mobile-specific deep polish** on admin pages (admin is desktop-first by design)
- **Multi-tenant beyond current workspace RLS** (architecture decision deferred)
- **Playwright for browser-level regression tests** (happy-dom from Slice 08 covers 90% — revisit only if we hit real browser bugs)
- **Quote versioning / branching** beyond existing `parent_quote_id` FK
- **External integrations** (Salesforce, QuickBooks, Stripe beyond what's wired)
- **Customer portal enhancements** (separate track)
- **Non-email alerting** (Slack/PagerDuty) — flare_reports + email is the ceiling
- **B3 extract review UI** — permanent defer (see above)
- **B9 `discount_configured` rename** — permanent defer (see above)

---

# Acceptance for This Roadmap

This document is acceptable when:
- [ ] Owner has read the full slice list across all 3 tracks
- [ ] R1–R3 answered (order, parallelization, cutover style)
- [ ] Slice 09's plan document is drafted and Q&A'd
- [ ] First CP of Slice 09 lands on a branch

Until those are true, this is a planning artifact, not a commitment.
