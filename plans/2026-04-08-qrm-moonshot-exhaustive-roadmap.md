# QRM Moonshot Command Center — Exhaustive Dependency-Ordered Roadmap

**Scope**: The complete buildout of the QRM Moonshot Command Center and the dealership operating system that grows out of it. 103 tracked ideas (84 from the original inventory, 16 new from Leg 2 of the relay, 3 resurrected C-tier ideas reframed to S-tier).

**This document replaces** the thematic 4-phase roadmap in [QRM_Comprehensive_Idea_Inventory_Roadmap.md](../QRM_Comprehensive_Idea_Inventory_Roadmap.md) §3. That roadmap grouped ideas by what they were *about*; this one sequences them by what they *depend on*. Those are different artifacts. Only the second one ships.

**This is the working document.** Every slice in Phase 2 onwards will be planned against this roadmap. As each slice ships, its row in the idea index is marked shipped and the next slice is opened.

---

## 1. Why this roadmap exists

The prior 4-phase roadmap had four load-bearing problems that Slice 1 exposed in practice:

1. **No Phase 0.** The roadmap assumed substrate (tables, event bus, role model, honesty contract, prediction ledger) existed or would arrive "for free" during Phase 1. Slice 1's exploration found that `crm_alerts` doesn't exist in this codebase (the actual table is `anomaly_alerts`), that `deal_timing_alerts` joins to `customer_profiles_extended` instead of deals, and that the Flow Engine is currently modeled as a *feature* instead of an event bus. Every Phase 1 surface that shipped without Phase 0 is now doing point-to-point integrations the Flow Engine will eventually have to rip out.
2. **Two ideas sequenced in the wrong phase.** *Honesty Calibration* was buried in Phase 1 as one item among 33 — but it is the **contract** that every other AI-driven surface depends on. It has to exist *before* the AI Chief of Staff starts ranking deals, or the system will train users to perform stage hygiene instead of selling. And *Trust Thermostat* was scheduled for Phase 4, meaning every deal in the system would have been lied about for 12-18 months before the product could sense belief decay. Both need to move.
3. **Role purity.** The prior roadmap assumed exclusive Iron roles (advisor XOR manager XOR woman XOR man). Real dealerships have hybrid coverage every week — the covering-for-sick-rep manager, the Saturday-Iron-Man owner. Slice 1 inherited this mistake. The role data model has to support *weighted role blends* before Phase 3 ships full role-variant surfaces.
4. **None of the new ideas had a home.** The 16 NEW ideas and 3 resurrected ideas from the Leg 2 relay did not appear anywhere in the phasing. This roadmap gives every one of them a phase assignment and a rationale.

---

## 2. Current state of play (2026-04-08)

### What has shipped
- **Phase 1 (Slice 1 — Spine)** is built, gated, and verified locally but **not yet committed to git**. It lives on the working tree at [apps/web/src/features/qrm/command-center/](../apps/web/src/features/qrm/command-center/) plus [supabase/functions/qrm-command-center/](../supabase/functions/qrm-command-center/) plus [supabase/functions/_shared/qrm-command-center/](../supabase/functions/_shared/qrm-command-center/), mounted at the parallel route `/qrm/command`. Legacy [QrmHubPage](../apps/web/src/features/qrm/pages/QrmHubPage.tsx) at `/qrm` is untouched and has a temporary "Try the new Command Center" button.
- **Slice 1 delivers**: Global Command Strip, AI Chief of Staff (rules-based), Action Lanes (Revenue Ready / At Risk / Blockers), Pipeline Pressure Map, Scope Switcher, Role-variant ordering, per-section freshness chips, terminology-locked rationale, localStorage snooze.
- **Slice 1 gates**: `deno check` clean, 14/14 Deno tests passing, `bun run build` clean at repo root and `apps/web`, `bun run migrations:check` clean (206 files, no new migrations).
- **What Slice 1 does NOT ship**: Revenue Reality Board, Dealer Reality Grid, Relationship Engine, Field Intelligence Feed, Executive Layer, route cutover, legacy page deletion, LLM enrichment, any DB migration, any event bus, any prediction ledger, any honesty contract.

### Substrate problems discovered during Slice 1
| Problem | Concrete evidence | Phase where it gets fixed |
|---|---|---|
| `crm_alerts` does not exist; the table is `anomaly_alerts` | Slice 1 had to rewrite its signal query against `anomaly_alerts` (migration 057) | Phase 0 — Signal Taxonomy |
| `deal_timing_alerts` cannot join to a deal; it joins to `customer_profiles_extended` | Migration 146 only has `customer_profile_id` as an FK; Slice 1 could not use it | Phase 0 — Deal-Signal Bridge migration |
| Role model is exclusive, not blended | `profiles.iron_role` is a single string; Slice 1's `getIronRole()` picks one | Phase 0 — Role Blend data model |
| No event bus; surfaces integrate point-to-point | Slice 1's edge function manually parallel-fetches 5 signal sources | Phase 0 — Flow Engine |
| No prediction ledger | Slice 1's ranker emits scores but nothing records them at issue time | Phase 0 — Prediction Ledger |
| No honesty contract | Slice 1 labels everything "rules-based" but there's no system-wide measure of whether the reported state matches reality | Phase 0 — Honesty Calibration Index |

These are not theoretical. Each one is a concrete blocker that will cause Slice 2 or Slice 3 to either stall or ship broken code. Phase 0 exists to retire them before the next surface lands.

---

## 3. The corrected phase model (0–5)

### Phase 0 — Substrate (NEW)
Ships the data and event infrastructure every subsequent phase depends on. No user-visible features. Ends when Phase 2 can be built against a clean contract instead of inferred schema.

### Phase 1 — Command Center Spine (SHIPPED, NOT COMMITTED)
The four-section spine behind the parallel `/qrm/command` route. Already built.

### Phase 2 — Reality + Cutover
Revenue Reality Board, Dealer Reality Grid (all tiles, degraded-where-unavailable), Quote Velocity Center, Approval Center, Blocker Board, Relationship Engine, Field Intelligence Feed, Knowledge Gaps, Executive layer v1, Absence Engine (resurrected C-tier). Ends with the `/qrm` route flipped to the new page and [QrmHubPage.tsx](../apps/web/src/features/qrm/pages/QrmHubPage.tsx) deleted in the same PR.

### Phase 3 — Seam Layer + Operating Surfaces
The seam between roles becomes a first-class object. Branch Command Center, Account Command Center, Machine Lifecycle, Inventory Pressure Board, Rental Command Center, Service-to-Sales, Parts Intelligence, Customer Health, Mobile Field Command, Visit Intelligence, Trade Walkaround, Deal Room, Exception Handling, Deal Autopsy, Customer 360 Timeline, Opportunity Map, Post-Sale Experience, Revenue Rescue, Competitive Displacement, Operator Intelligence, SOP Compliance, Workflow Audit, Territory Command Center, Iron in Motion Register, Handoff Trust Ledger (full), Time Bank (visible), Rep Reality Reflection, Folk Workflow Library.

### Phase 4 — The Outward Turn
Everything that requires the dealership to look at the world outside its own walls: Customer Genome, Customer Operating Profile, Fleet Intelligence, Relationship Map, White-Space Map, Rental Conversion Engine, AI Deal Coach, AI Branch Chief, AI Customer Strategist, AI Operations Copilot, AI Owner Briefing, Forecast Confidence, Replacement Prediction, Competitive Threat Map, Seasonal Opportunity Map, Learning Layer, Cross-Dealer Mirror, Cashflow Weather Map, Decision Room Simulator, Decision Cycle Synchronizer, Ecosystem Layer, Reputation Surface, Rep as SKU, Death and Exit Register, Unmapped Territory Surface.

### Phase 5 — Hidden Forces
Trust Thermostat (post-hoc receipt), Machine Fate Engine, Silence Map, Customer Gravity Field, Rep Mythology Layer, Pre-Regret Simulator, Internal Market for Attention, Ruin Prevention Mode, Shadow Org Chart, Ghost Buyer (shape-only), Institutional Grief Archive, Body of the Operator, Tempo Conductor. Each one requires years of accrued data plus Phase 0's honesty contract. Shipped last because shipping them earlier would be dishonest.

---

## 4. Phase 0 — Substrate

**Theme**: Make every subsequent surface cheap and honest to build.
**Entry condition**: Slice 1 committed.
**Exit condition**: Every item below shipped, tested, and adopted by the existing Slice 1 spine via a refactor PR.
**Deliverable count**: 8 substrate tracks (P0.1 – P0.8).

### P0.1 — Commit and stabilize Slice 1
Slice 1 is on the working tree, not in git. Before any Phase 0 work:
- Stage only the Slice 1 files plus the `App.tsx` and `QrmHubPage.tsx` edits.
- Do NOT stage the 20+ unrelated modified files already in the working tree (those belong to other workstreams).
- Verify the gates one more time after stage: `deno check`, `deno test ranking.test.ts`, `bun run build`, `bun run migrations:check`.
- Commit with a message that names this as Slice 1 of the QRM Moonshot Command Center.
- Do not push until the user asks.

### P0.2 — Signal taxonomy + deal-signal bridge
**Problem**: Signals (anomalies, timing alerts, voice captures, deposits, competitive mentions) live in tables with incompatible join keys. Slice 1 worked around it by doing five parallel lookups; every future surface will have to do the same.

**Join path inventory (from Day 2 verification §2)**:
| Source | Migration | Join path to `crm_deals` | Direct FK? |
|---|---|---|---|
| `anomaly_alerts` | 057 | `entity_id` + polymorphic filter `entity_type='deal'` | No — polymorphic |
| `voice_captures` | 003 + 056 | `linked_deal_id` (NOT `deal_id` — Slice 1 bug fixed in Day 2.5) | Yes, direct FK |
| `deposits` | 070 | `deal_id` | Yes, direct FK |
| `deal_timing_alerts` | 146 | `customer_profile_id` → `customer_profiles_extended` → `crm_deals` | **No — two-hop bridge** |
| `competitive_mentions` | 056 | `voice_capture_id` → `voice_captures.linked_deal_id` → `crm_deals` | **No — two-hop bridge** |

**Deliverable**: New migration `207_deal_signal_bridge.sql` that:
- Creates a unified `deal_signals` view as a `UNION ALL` of five per-source subqueries, each resolving to `(deal_id, signal_type, source_id, severity, created_at, payload jsonb)`. The two-hop bridges (`deal_timing_alerts` via `customer_profiles_extended`, `competitive_mentions` via `voice_captures`) use explicit LEFT JOINs with null-safety on the intermediate hops so a broken bridge row is dropped cleanly, not silently corrupted.
- Adds RLS per [CLAUDE.md](../CLAUDE.md) backend conventions. Inherits the source tables' RLS via the view's `security_invoker = true` option.
- Ships with a Deno test that asserts the view returns the same signal set the Slice 1 edge function currently assembles by hand (after the Day 2.5 hot-fix).
- Refactor the Slice 1 edge function to read from the view instead of doing five parallel Promise.all queries.
- **One outstanding verification** for Day 3: confirm `customer_profiles_extended` has a usable FK path to `crm_deals` for the `deal_timing_alerts` bridge. Day 2 verification did not confirm this specifically — it's the one remaining unknown.
**Idea IDs closed**: foundational for IDEA-011, IDEA-012, IDEA-033, IDEA-055, IDEA-077.

### P0.3 — Prediction Ledger
**Problem**: The ranker emits scores, lane assignments, and rationales, but nothing records them at issue time. Without this, the Trust Thermostat (Phase 5) and Forecast Confidence (Phase 4) can never be back-tested. The thing that lets you *grade* predictions has to exist *before* you make them.
**Deliverable**: New migration `208_prediction_ledger.sql`:
- Table `qrm_predictions` — append-only: `id, workspace_id, predicted_at, subject_type, subject_id, prediction_kind, score, rationale_hash, rationale jsonb, inputs_hash, signals_hash jsonb, model_source (rules|rules+llm), outcome text null, outcome_at timestamptz null, outcome_logged_by uuid null`.
- Table `qrm_prediction_outcomes` — matches each prediction to a factual outcome when one becomes available (deal won, deal lost, blocker cleared, etc.).
- RLS: workspace-scoped, insert-only for the edge function; read for managers and owners.
- Index by `(subject_type, subject_id, predicted_at desc)`.
- Refactor Slice 1's `qrm-command-center` edge function to write every recommendation card to `qrm_predictions` at issue time.
- Ship with a nightly Deno function `qrm-prediction-scorer` that closes out predictions against observed deal outcomes.
**Idea IDs closed**: substrate for IDEA-053, IDEA-058, IDEA-075.

### P0.4 — Flow Bus (event bus, alongside existing Flow Engine)
**Problem**: IDEA-057 wanted a cross-surface event bus with typed payloads, idempotency, and an audit trail. Day 2 verification discovered the repo already has a **Flow Engine** — migrations 194/195/196, five edge functions (`flow-runner`, `flow-synthesize`, `iron-execute-flow-step`, `iron-orchestrator`, `iron-undo-flow-run`), 10 pre-built workflow definitions in `_shared/flow-workflows/`, and shared modules in `_shared/flow-engine/`. This existing engine is a **workflow execution engine** (definition → runs → steps state machine), NOT a pub/sub bus. P0.4 therefore ships the new bus **alongside** the existing engine in a distinct namespace, not as a replacement.

**Naming split (load-bearing)**:
- `_shared/flow-engine/` — the existing workflow execution engine. Untouched by P0.4.
- `_shared/flow-bus/` — the new pub/sub event bus. All P0.4 work lives here.

**Deliverable**:
- Migration `209_flow_bus.sql`: new tables `flow_events` (append-only), `flow_event_types` (registry), `flow_subscriptions` (per-surface listeners). The `flow_events` table absorbs all 17 ADD-033 canonical event-object fields from merge §4 as first-class columns (`event_id, event_type, source_module, source_record_id, customer_id, company_id, equipment_id, deal_id, severity, commercial_relevance, suggested_owner, required_action, recommended_deadline, draft_message, escalation_rule, status, created_at`).
- [supabase/functions/_shared/flow-bus/publish.ts](../supabase/functions/_shared/flow-bus/publish.ts) — `publishFlowEvent(type, payload, { idempotencyKey, correlationId })`.
- [supabase/functions/_shared/flow-bus/subscribe.ts](../supabase/functions/_shared/flow-bus/subscribe.ts) — declarative subscription DSL.
- Shared idempotency infrastructure reused from the existing engine's `flow_action_idempotency` table, with a distinct key namespace (`bus:{event_type}:{idempotencyKey}`) so workflow actions and bus events cannot collide.
- Refactor the existing `follow-up-engine`, `nudge-scheduler`, `deal-timing-scan`, and `anomaly-scan` to **also** publish to the bus (dual-write alongside their current direct inserts into `crm_in_app_notifications` and per-signal tables). Cutover retires the direct-insert paths at end of Phase 2 Slice 2.2.
- Do NOT touch `analytics_events` — that's the workflow engine's surface.
- Ship with Deno tests that verify event ordering, idempotency, subscription pattern matching, and RLS boundary enforcement.
**Idea IDs closed**: IDEA-057 (in substrate form, as a pub/sub bus coexisting with the workflow engine); unlocks IDEA-049, IDEA-051, IDEA-059, NEW-005.
**Non-collision principle**: the existing Flow Engine and the new Flow Bus share idempotency infrastructure but have independent data models. Workflows CAN subscribe to bus events later (Phase 2+), but bus events never execute workflows directly. That separation keeps each system's semantics clean.

### P0.5 — Role-blend data model
**Problem**: Real dealerships run role hybrids every week. A single `iron_role` column forces a dishonest choice.
**Deliverable**: Migration `210_role_blend.sql`:
- Table `profile_role_blend` — `profile_id, iron_role, weight (0..1), effective_from, effective_to`.
- Migrate existing `profiles.iron_role` values into `profile_role_blend` at weight 1.0, open-ended.
- Add view `v_profile_active_role_blend` that returns the caller's current weighted blend.
- Refactor [iron-roles.ts](../apps/web/src/features/qrm/lib/iron-roles.ts) `getIronRole()` to return an array of `{role, weight}` pairs.
- Refactor Slice 1's [RoleVariantShell.tsx](../apps/web/src/features/qrm/command-center/components/RoleVariantShell.tsx) to compose section order from a *blend*, not a single role.
- Ranker: refactor [getRoleWeights()](../supabase/functions/_shared/qrm-command-center/ranking.ts) to accept a weighted blend and produce a weighted ensemble.
**Idea IDs closed**: substrate for IDEA-014, IDEA-015, IDEA-016, IDEA-017, IDEA-018.

### P0.6 — Honesty Calibration Index
**Problem**: The moment AI Chief of Staff gets more confident in Phase 2/3, the temptation to perform-on-the-scoreboard becomes structural. The only antidote is a system-wide score that goes up when reported state matches observed state and down when it diverges. Ships invisibly in Phase 0 — the index computes but is not yet displayed to reps. Ownership view arrives in Phase 3.
**Deliverable**: Migration `211_honesty_calibration.sql`:
- Table `qrm_honesty_observations` — `id, workspace_id, observed_at, observation_type, expected_state, actual_state, discrepancy_score, attributed_user_id, attributed_role`.
- Table `qrm_honesty_probes` — probe registry with `id, probe_name, probe_type, is_enabled, depends_on text`. Lets probes 7 and 8 ship registered-but-disabled until their prerequisite surfaces land.
- Nightly edge function `qrm-honesty-scan` that runs **8 honesty probes** (6 implementable today, 2 stubbed awaiting Phase 2/3 surfaces — per Day 2 verification §6):
  1. **Stage probability ≥ 0.7 but no activity in 14 days** — implementable today via `crm_deals.last_activity_at` + JOIN `crm_deal_stages.probability`.
  2. **Close date inside 7 days but last activity > 14 days old** — implementable today via `expected_close_on` + `last_activity_at`.
  3. **Loss reason blank on closed-lost deals** — implementable today via `loss_reason` + `crm_deal_stages.is_closed_lost`. Must use admin client (loss_reason is `service_role`-only per migration 025).
  4. **Deposit marked verified but no `deposits` row with status `verified`** — implementable today via `crm_deals.deposit_status` + LEFT JOIN `deposits`.
  5. **Margin passed with `margin_pct` null** — implementable today via `crm_deals.margin_check_status` + `margin_pct IS NULL`.
  6. **Retroactive activity audit** (from merge §6.3) — implementable today via `crm_activities.occurred_at > crm_activities.created_at + interval '48 hours'`.
  7. **Decay-threshold-proximity audit** (from merge §6.3) — **STUB** on Day 10. Registered in `qrm_honesty_probes` with `depends_on = 'phase-2-slice-2.x-meaningful-contact'`. Probe function exists but returns `[]` until Phase 2 Slice 2.X ships the meaningful-contact calculation engine.
  8. **Protected-account gaming audits** (disproportionate-ratio, protective-timing, chronic-protection — from merge §6.4) — **STUB** on Day 10. Registered in `qrm_honesty_probes` with `depends_on = 'phase-3-slice-3.3-account-override'`. Probe function exists but returns `[]` until Phase 3 Slice 3.3 ships the protected-account override table.
- Each implementable probe (1–6) is a pure function with a Deno test. The probes are the contract.
- Stub probes (7, 8) still get skeleton functions + placeholder tests that assert "when `depends_on` surface does not exist, probe returns `[]` without throwing."
- Index output: `qrm_honesty_daily` — rollup per workspace per day.
**Idea IDs closed**: NEW-009 substrate.
**Critical**: This ships BEFORE Phase 2 surfaces use more AI. Inverted from the prior roadmap's placement.

### P0.7 — Time primitive
**Problem**: NEW-001 (Time Bank) needs time modeled as a balance, not a backdrop. Phase 3 will ship the visible Time Bank; Phase 0 ships the primitive.
**Deliverable**:
- Migration `212_time_primitive.sql`:
  - Function `qrm_stage_age(deal_id uuid)` — returns days in current stage, using a new `qrm_stage_transitions` table backfilled from existing `crm_activities`.
  - Table `qrm_stage_transitions` — `id, deal_id, from_stage_id, to_stage_id, at timestamptz`.
  - Backfill script that walks `crm_activities` and `deal_composite` to reconstruct historical transitions.
- Shared TS primitive `supabase/functions/_shared/time-primitive.ts` — `timeBalance(subject, budget)` pure function.
- Deno tests.
**Idea IDs closed**: NEW-001 substrate.

### P0.8 — Telemetry + trace substrate
**Problem**: IDEA-058 (AI Feedback/Trace) was bumped into Phase 0 because every AI output needs a visible accountability layer *from day one*, not after year two. Slice 1 already ships rationale bullets per recommendation; P0.8 ensures every one is stored, replayable, and reviewable.
**Deliverable**:
- Extend `qrm_predictions` (P0.3) with `trace_id` + `trace_steps jsonb` columns (atomic — same migration as P0.3 if possible, else a follow-up).
- New Supabase function `qrm-prediction-trace` that returns the full trace for a given prediction id.
- Frontend route `/qrm/command/trace/:predictionId` — read-only, manager-gated, renders the trace step by step.
- Slice 1's Accept/Dismiss/Snooze buttons persist feedback via `event-tracker.ts` *and* link it to the prediction's trace id.
**Idea IDs closed**: IDEA-058 substrate, IDEA-060 foundation.

### Phase 0 exit gate
- All 8 tracks shipped.
- Slice 1 edge function refactored to use P0.2 view, P0.3 ledger, P0.4 flow engine publish, P0.5 role blend, P0.8 trace.
- Deno tests all green.
- `bun run migrations:check` at 212 (or whatever the ending number is).
- Phase 2 planning can cite contracts instead of inferring them.

---

## 5. Phase 1 — Command Center Spine (SHIPPED)

**Status**: Built, gated, working tree only. Needs P0.1 commit.

**What it delivered** (mapped to idea IDs):

| Idea | Surface | File |
|---|---|---|
| IDEA-001, IDEA-021 | Command-center framing + war-room behavior | [QrmCommandCenterPage.tsx](../apps/web/src/features/qrm/command-center/components/QrmCommandCenterPage.tsx) |
| IDEA-002 | Decision Layer above the fold | [RoleVariantShell.tsx](../apps/web/src/features/qrm/command-center/components/RoleVariantShell.tsx) |
| IDEA-003 | Global Command Strip + narrative | [CommandStrip.tsx](../apps/web/src/features/qrm/command-center/components/CommandStrip.tsx) |
| IDEA-004 | AI Chief of Staff (rules-based, rationale-locked) | [AiChiefOfStaff.tsx](../apps/web/src/features/qrm/command-center/components/AiChiefOfStaff.tsx), [ranking.ts](../supabase/functions/_shared/qrm-command-center/ranking.ts) |
| IDEA-005 | Live Action Lanes (Ready / At Risk / Blockers) | [ActionLanes.tsx](../apps/web/src/features/qrm/command-center/components/ActionLanes.tsx) |
| IDEA-007 | Pipeline Pressure Map (5 meta-stages) | [PipelinePressureMap.tsx](../apps/web/src/features/qrm/command-center/components/PipelinePressureMap.tsx) |
| IDEA-008 | Role Actions launcher (primary/secondary CTAs on every card) | [RecommendationCard.tsx](../apps/web/src/features/qrm/command-center/components/RecommendationCard.tsx) |
| IDEA-014 – IDEA-018 | Role-native homepage ordering (exclusive role) | [roleVariant.ts](../apps/web/src/features/qrm/command-center/lib/roleVariant.ts) |
| IDEA-019 | Control-board visual language (severity zones, not calm cards) | All section components |
| IDEA-020 | What-should-I-do-next core | Chief of Staff hero cards |

**What it did NOT deliver**: IDEA-006, IDEA-009, IDEA-010, IDEA-011, IDEA-012, IDEA-013 (all deferred to Phase 2).

**Known fragility to repair before Phase 2**:
- Action Lanes forces single-lane assignment. A deal that is both blocked AND closeable appears only in Blockers. Phase 2 must teach the ranker to emit *weighted lane memberships* and the lane component to render ghosted cards in secondary lanes.
- Role variants are exclusive. Coverage events (a manager covering for a sick rep) get the wrong page. Phase 0 P0.5 unblocks this, Phase 2 takes the dependency.

---

## 6. Phase 2 — Reality + Cutover

**Theme**: Every dealership-specific operating surface the spine is missing, plus the cutover.
**Entry condition**: Phase 0 P0.1–P0.6 shipped (P0.7 and P0.8 can ship in parallel with Phase 2 Slice 1).
**Exit condition**: `/qrm` renders the new page. [QrmHubPage.tsx](../apps/web/src/features/qrm/pages/QrmHubPage.tsx) deleted in the cutover PR with a capability-diff in the PR description.

### Slice 2.1 — Revenue Reality Board
**Idea IDs**: IDEA-006, IDEA-009 (DGE centerpiece hook).
**Backend**:
- Extend [supabase/functions/qrm-command-center/index.ts](../supabase/functions/qrm-command-center/index.ts) response with `revenueReality: { openPipeline, weightedRevenue, closable7d, closable30d, atRisk, marginAtRisk, stalledQuotes, blockedByType[] }`.
- New shared helper `_shared/qrm-command-center/revenue-reality.ts`.
- Pull `dge-optimizer` scenario output to populate `closeProbability` adjustments per deal.
**Frontend**:
- New [RevenueRealityBoard.tsx](../apps/web/src/features/qrm/command-center/components/RevenueRealityBoard.tsx).
- Register in [roleVariant.ts](../apps/web/src/features/qrm/command-center/lib/roleVariant.ts) — place just under CommandStrip for managers, below Action Lanes for advisors.
**Gates**: all P0 gates + `bun run build` + new Deno tests for revenue aggregations.

### Slice 2.2 — Dealer Reality Grid
**Idea IDs**: IDEA-010, IDEA-031 (Quote Velocity Center tile), IDEA-032 (Approval Center tile), IDEA-033 (Blocker Board tile).
**Backend**:
- Extend response with `dealerRealityGrid: { quotes, trades, demos, traffic, rentals, serviceEscalations }` — each tile `{ activeCount, urgentCount, summary, cta, recentMovement, status: 'live'|'degraded'|'unavailable', reason? }`.
- Quotes: pull from `quotes` table (existing). Aging uses `P0.7` time primitive.
- Trades: pull from `crm_equipment` where `role='trade_in'` + needs_assessment.has_trade_in.
- Demos: pull from `demo_requests` via deal-composite.
- Traffic/Deliveries: `status='unavailable', reason='Logistics integration not yet connected'`.
- Rentals: `status='unavailable'` (until Phase 3).
- Service escalations: pull from existing service tables if present; else `status='degraded'`.
**Frontend**:
- [DealerRealityGrid.tsx](../apps/web/src/features/qrm/command-center/components/DealerRealityGrid.tsx) — 6 tiles, always rendered, muted for unavailable, "Request integration" CTA on unavailable tiles.
- Each tile has a CTA that opens a focused workflow (e.g. `/qrm/quotes?status=aging`).
**Critical**: Always-render pattern from the Slice 1 plan. Never hide a tile.

### Slice 2.3 — Quote Velocity Center
**Idea IDs**: IDEA-031 (full, not just tile).
**Deliverable**: Dedicated page at `/qrm/command/quotes` with creation time, aging, presentation lag, conversion pressure. Uses P0.7 time primitive. Reuses existing [qrm-quotes-api.ts](../apps/web/src/features/qrm/lib/qrm-quotes-api.ts).

### Slice 2.4 — Approval Center
**Idea IDs**: IDEA-032 (full).
**Deliverable**: Dedicated page at `/qrm/command/approvals` listing margin flags, deposit exceptions, trade approvals, demo approvals, goodwill exceptions. Uses P0.4 Flow Engine events to populate. One-click approve/deny with audit trail.

### Slice 2.5 — Blocker Board
**Idea IDs**: IDEA-033 (full).
**Deliverable**: Dedicated page at `/qrm/command/blockers` that only shows what is preventing revenue from moving. Same ranker blocker classification as the Action Lanes, but a board-style layout grouped by blocker type. CTA per blocker wires to the specific resolver.

### Slice 2.6 — Relationship & Opportunity Engine
**Idea IDs**: IDEA-011, IDEA-012 (Field Intelligence Feed lives inside it for Phase 2).
**Backend**: Extend response with `relationshipEngine: { heatingUp, coolingOff, competitorMentionsRising, fleetReplacementOpps, silentKeyAccounts, fieldFeed }`. Uses `voice_captures`, `customer_profiles_extended.health_score` deltas, `deal_timing_alerts` (via P0.2 bridge).
**Frontend**: [RelationshipEngine.tsx](../apps/web/src/features/qrm/command-center/components/RelationshipEngine.tsx) + [FieldIntelligenceFeed.tsx](../apps/web/src/features/qrm/command-center/components/FieldIntelligenceFeed.tsx).

### Slice 2.7 — Knowledge Gaps page + Absence Engine
**Idea IDs**: IDEA-061, NEW-RES-064 (Absence Engine as the resurrected hygiene → behavior read).
**Deliverable**:
- Knowledge Gaps: extend `knowledge_gaps` existing table to flag Iron-role attribution.
- Absence Engine: new nightly Deno function `qrm-absence-engine` that scores *which fields each rep systematically blanks* and surfaces the pattern to the manager view only. Never shown to the rep directly — this is a private managerial read, matching the "don't measure the thing you're trying to change" fragility note.

### Slice 2.8 — Executive Intelligence Layer v1
**Idea IDs**: IDEA-013.
**Deliverable**: Role-gated section (only rendered for `isIronElevated()`) showing forecast confidence (preview; full version in Phase 4), rep performance summary, margin pressure, branch health. Read-only in Phase 2.

### Slice 2.9 — Cutover + QrmHubPage deletion
**Deliverable**: Flip `/qrm` route to `QrmCommandCenterPage`. Delete [QrmHubPage.tsx](../apps/web/src/features/qrm/pages/QrmHubPage.tsx). Remove the "Try the new Command Center" link. PR description carries an explicit capability-diff (anomaly banner → Chief of Staff, deal scoreboard → Action Lanes, competitive mentions → Relationship Engine, knowledge gaps → Knowledge Gaps page).

### Phase 2 exit gate
- `/qrm` renders the new page.
- `QrmHubPage.tsx` is deleted.
- Every Phase 2 idea (11 total) is shipped.
- Dealer Reality Grid renders all 6 tiles, with unavailable ones clearly marked and a path to integration.
- Absence Engine has been running nightly for at least 7 days and has produced data managers can review.

---

## 7. Phase 3 — Seam Layer + Operating Surfaces

**Theme**: The seam between roles becomes a first-class object. The dealership's operating surfaces grow out of the command center into full modules.
**Entry condition**: Phase 2 exit gate passed. Phase 0 P0.7 (time primitive) shipped.
**Exit condition**: Every Phase 3 idea shipped. The Handoff Trust Ledger is live, visible to managers, and has at least 30 days of data.

### Slices

Each slice below is a self-contained delivery. They can run in parallel where marked.

**Slice 3.1 — Handoff Trust Ledger (full)** · NEW-005
A cross-role scoring surface that attributes quality-of-handoff to the seam between two roles, not to either role individually. Migration `21X_handoff_trust_ledger.sql`. Feeds from P0.4 Flow Engine events. Renders as a manager-gated surface inside the Executive Layer.

**Slice 3.2 — Time Bank (visible)** · NEW-001
Visible per-deal, per-account, per-rep time balance. Reuses P0.7 primitive. Renders as a column on the Pipeline Pressure Map and a chip on every recommendation card.

**Slice 3.3 — Account Command Center** · IDEA-025
Per-account operating room at `/qrm/accounts/:id/command`. Tabs: current deals, fleet intelligence, service history, parts revenue, health delta, AR status. This is the parent surface that Phase 4 surfaces (Customer Genome, Relationship Map) will attach to.

**Slice 3.4 — Branch Command Center** · IDEA-023
Per-branch rollup at `/qrm/branches/:id/command`. Revenue, readiness, logistics, rental, service-linked sales. Depends on 3.1 Handoff Trust Ledger and P0.5 Role Blend.

**Slice 3.5 — Territory Command Center** · IDEA-024
Per-territory routing and visit priority at `/qrm/territories/:id/command`. Depends on 3.6 Mobile Field Command for the field experience.

**Slice 3.6 — Mobile Field Command** · IDEA-043
Mobile-first field OS at `/m/qrm` with route intelligence, nearby opportunities, due visits, trade capture, voice-first actions.

**Slice 3.7 — Visit Intelligence page** · IDEA-044
Pre-visit briefing at `/qrm/visits/:contactId`. Talking points, service issues, rental activity, competitor mentions, likely objections.

**Slice 3.8 — Trade Walkaround Workflow** · IDEA-045
Guided capture flow for trades: required photos, condition prompts, AI scoring, instant valuation bands. Ships as a modal flow launched from any deal.

**Slice 3.9 — Machine Lifecycle system** · IDEA-034
First-class machine lifecycle state model paralleling the deal lifecycle. Migration creates `machine_lifecycle_states`. Existing `crm_equipment` rows are backfilled.

**Slice 3.10 — Machine Command Page** · IDEA-035
Per-machine operating page at `/qrm/equipment/:id/command`. Status, readiness, valuation, linked demand, location, attachments, margin exposure.

**Slice 3.11 — Inventory Pressure Board** · IDEA-036
Aged, hot, under-marketed, price-misaligned units in one board at `/qrm/inventory/pressure`.

**Slice 3.12 — Intake-to-Sale Board** · IDEA-037
Every unit from purchase to sale-ready. Builds on 3.9 Machine Lifecycle.

**Slice 3.13 — Iron in Motion Register** · NEW-007
Every machine not in the yard and not yet delivered appears here with carrying cost, decay rate, risk exposure, revenue lag. Parallel to 3.11.

**Slice 3.14 — Rental Command Center** · IDEA-038
Dedicated rental operations at `/qrm/rental/command`. Parallel to sales command center.

**Slice 3.15 — Service-to-Sales Opportunity page** · IDEA-040
Converts recurring breakdowns and downtime risk into replacement/upgrade motion.

**Slice 3.16 — Parts Intelligence page** · IDEA-041
Parts purchasing patterns as demand signals for machines, attachments, and churn risk.

**Slice 3.17 — Customer Health Score** · IDEA-042
Per-account health rolled up from sales, service, parts, delivery, payment, competitor pressure. Two-track design per the fragility audit: rep-visible score is portfolio-adjusted, manager-visible score is absolute.

**Slice 3.18 — Deal Room** · IDEA-070
Per-major-opportunity operating room at `/qrm/deals/:id/room`. Notes, scenarios, approvals, tasks, machine options, close plans.

**Slice 3.19 — Deal Autopsy page** · IDEA-052
Every closed-lost deal gets a structured post-mortem. Fed by P0.4 Flow Engine's `deal.lost` event.

**Slice 3.20 — Exception-handling surfaces** · IDEA-051
First-class product surfaces for revivals, failed deliveries, damaged demos, rental disputes, payment exceptions.

**Slice 3.21 — Customer 360 Timeline** · IDEA-071
Every meaningful event in a relationship rendered as a cinematic operating history.

**Slice 3.22 — Opportunity Map** · IDEA-072
Geographic overlay of open revenue, visit targets, rentals, trades, route pressure.

**Slice 3.23 — Revenue Rescue Center** · IDEA-067
Revenue that can still be saved this week. Triage view.

**Slice 3.24 — Competitive Displacement Center** · IDEA-068
Where competitors are weak and how to take share now.

**Slice 3.25 — Operator Intelligence page** · IDEA-069
What machine operators actually say, need, complain about, and prefer. Reframed from the C-tier bucket — this is not background noise, it is the voice of the user of the iron.

**Slice 3.26 — Post-Sale Experience Center** · IDEA-073
Onboarding quality, first-90-day friction, attachment adoption, repeat-purchase likelihood.

**Slice 3.27 — Workflow Audit page** · IDEA-059
Where processes break, stall, reroute, silently fail. Renders Flow Engine events grouped by broken seam.

**Slice 3.28 — SOP Compliance page** · IDEA-063
Where the dealership drifts from its own rules. Paired with Slice 3.29 to avoid the "authoritarian" fragility — compliance and folk workflow are the same surface from two sides.

**Slice 3.29 — Folk Workflow Library** · NEW-RES-065
Finds and names the off-script workflows. Adopts the wise ones, retires the harmful ones.

**Slice 3.30 — Rep Reality Reflection** · NEW-RES-062
Private, rep-owned mirror. Never visible to managers. The rep decides whether the reflection becomes a conversation.

### Phase 3 exit gate
- All 30 slices shipped.
- Handoff Trust Ledger has produced at least 30 days of data.
- Time Bank primitive is feeding every visible surface.
- Account Command Center has been adopted as the default drill-down target from every account link in the system.

---

## 8. Phase 4 — The Outward Turn

**Theme**: The dealership looks outside its own walls. Non-customer ecosystem, parallel systems, customer rhythms, AI agents.
**Entry condition**: Phase 3 complete. P0.3 Prediction Ledger has at least 90 days of accrued data (so AI surfaces can be back-tested honestly).
**Exit condition**: The dealership can answer three new questions it could not answer before Phase 4: *what is the customer's experience inside Deere's CRM right now? When does this customer have money? Who is in the actual decision room?*

### Slices

**4.1 — Customer Genome** · IDEA-026
Upgrade the customer model from contact+company to a full multi-dimensional profile.

**4.2 — Customer Operating Profile** · IDEA-027
Work type, terrain, brand preference, budget behavior, urgency pattern, buying style. Lives inside the Customer Genome.

**4.3 — Fleet Intelligence page** · IDEA-028
Owned machines, age, hours, attachment gaps, replacement windows, probable next buys. Already has a page stub ([FleetRadarPage.tsx](../apps/web/src/features/qrm/pages/FleetRadarPage.tsx)) — this slice replaces it with the full version.

**4.4 — Relationship Map** · IDEA-029
Who signs, influences, operates, blocks, decides. Stops at the named contacts; Ghost Buyer (Phase 5) adds the unnamed.

**4.5 — White-Space Map** · IDEA-030
Revenue the dealership should already be capturing but isn't. Per account.

**4.6 — Rental Conversion Engine** · IDEA-039 (Contrarian Bet #1)
Repeat renters and usage patterns → structured purchase motion. Depends on 3.14 Rental Command Center.

**4.7 — AI Deal Coach** · IDEA-046
Per-opportunity coaching: what is weak, what is missing, what move raises close probability next.

**4.8 — AI Branch Chief** · IDEA-047
Per-branch diagnostic agent: slippage, hidden risk, equipment pressure, intervention priorities.

**4.9 — AI Customer Strategist** · IDEA-048
30/60/90 account plans, white-space plays, competitive defense moves.

**4.10 — AI Operations Copilot** · IDEA-049
Incomplete deals, misrouted billing, delayed deposits, readiness failures.

**4.11 — AI Owner Briefing** · IDEA-050
Morning command note for ownership. Ships with the confidence-typed structure from the fragility audit: "Certain. Probable. Suspected. Don't act on this yet."

**4.12 — Forecast Confidence page** · IDEA-053
Not just forecast value but confidence bands, bias, and assumption quality. Depends on P0.3 Prediction Ledger having enough history.

**4.13 — Replacement Prediction page** · IDEA-054
Customers and fleet units entering replacement windows in 30/60/90/180 days.

**4.14 — Competitive Threat Map** · IDEA-055
Where Deere, CAT, others are gaining/losing by account, rep, branch, machine class.

**4.15 — Seasonal Opportunity Map** · IDEA-056
Time-of-year demand shifts as routeable opportunity pressure.

**4.16 — Learning Layer** · IDEA-074
Wins, losses, workflows, service patterns → dealership memory and behavior change. Depends on P0.3 Prediction Ledger + P0.4 Flow Engine + P0.6 Honesty Calibration.

**4.17 — Cross-Dealer Mirror** · NEW-002
Projected customer experience inside the competitor's CRM. Partial model beats zero model.

**4.18 — Cashflow Weather Map** · NEW-003
Customer float, payment cadence, seasonal cash swelling. Read from public filings + payment history + observed seasonal behavior.

**4.19 — Decision Room Simulator** · NEW-004
The literal humans in the actual decision room, the chairs they sit in, the order they speak, the objections each raises.

**4.20 — Decision Cycle Synchronizer** · NEW-010
Per-customer purchasing rhythm. Routes follow-ups into decision windows and avoids non-decision windows.

**4.21 — Ecosystem Layer** · NEW-011
Lenders, insurers, transport, factory reps, auctioneers, parts suppliers, territory managers. Same intelligence treatment customers get.

**4.22 — Reputation Surface** · NEW-012
Reviews, forums, auctioneer commentary, mechanic gossip, what foremen tell each other.

**4.23 — Rep as SKU** · NEW-013
Every rep modeled as a packaged offering. Detects rep-customer mismatches, proposes rep-swaps.

**4.24 — Death and Exit Register** · NEW-014
First-class event class for the end of relationships. Retirement, death, bankruptcy, acquisition, exclusive competitor, fleet sale.

**4.25 — Unmapped Territory Surface** · NEW-015
Map of provable absence. Who in this county have we never met?

### Phase 4 exit gate
- All 25 slices shipped.
- Every AI-driven surface reads from P0.3 Prediction Ledger and writes new predictions to it.
- Every surface tagged as AI has a visible confidence-typed label and a working trace at `/qrm/command/trace/:predictionId`.

---

## 9. Phase 5 — Hidden Forces

**Theme**: Instrument the emotional, political, temporal, and systemic forces normal CRM products refuse to model.
**Entry condition**: Phase 4 shipped. Honesty Calibration has been running for a full fiscal year so any AI surface can be back-tested against a complete sales cycle.
**Exit condition**: At least two slices in controlled pilots with explicit ethical limits, operator controls, and measurable operating value.

### Slices

**5.1 — Trust Thermostat (post-hoc receipt, not real-time gauge)** · IDEA-075 (Contrarian Bet #3)
Per fragility audit: ships as a *post-hoc receipt* shown to reps after a deal closes or dies, mapping their belief decay timeline against actual customer signals. Trains the instinct, does not replace it. Never shown while the deal is live.

**5.2 — Machine Fate Engine** · IDEA-076
Retail / rental / transfer / auction / cannibalization / demo-bait / strategic-hold recommendation per unit.

**5.3 — Silence Map** · IDEA-077
The absence of expected noise as a first-class operating signal.

**5.4 — Customer Gravity Field** · IDEA-078 (Contrarian Bet #4)
Paired with an explicit owner-authorized "Permission Slip" surface for formal deprioritization with a stated review date.

**5.5 — Rep Mythology Layer** · IDEA-079
The private stories reps use to avoid reality. Research-only in Phase 5; productization depends on the ethics review in the Research Agenda.

**5.6 — Pre-Regret Simulator** · IDEA-080
Shows the exact form of shame 30 days later if a major decision proceeds unchanged.

**5.7 — Internal Market for Attention** · IDEA-081
Unresolved issues compete for scarce organizational focus like capital.

**5.8 — Ruin Prevention Mode** · IDEA-082
Throttles optimism when too much revenue/logistics/trust depends on fragile concentrations of risk.

**5.9 — Shadow Org Chart** · IDEA-083
Who actually moves work, who blocks it, who silently runs the place.

**5.10 — Ghost Buyer (shape-only)** · IDEA-084 (Contrarian Bet #5)
Per fragility audit: never exposes the *identity* of the ghost — only its *shape* (a financial shadow, a service shadow, a retirement shadow). Reps prepare for it without naming it.

**5.11 — Institutional Grief Archive** · NEW-006
Deals that hurt to lose, customers who left and never came back, trust the dealership broke and didn't repair. With explicit "lesson promised / lesson kept" tracking.

**5.12 — Body of the Operator** · NEW-008
Aging signals mapped to replacement-machine demand cycles, ergonomic upgrade sales motion, cab-redesign relevance. Extremely sensitive — research-gated.

**5.13 — Tempo Conductor** · NEW-016
The single meta-surface that tells the dealership whether it is in tempo with its customers, inventory, weather, competitors, lenders, operators, and itself. The relay's conclusion: hierarchy + gravity + **rhythm**. This is the surface that serves the third system.

### Phase 5 exit gate
- At least 2 of the 13 slices in controlled pilots with documented ethical limits.
- The Research Agenda (§12) has been reviewed with ownership for each unreasonable idea before build.
- Honesty Calibration Index (P0.6) is still trending up after Phase 5 ships. If shipping Phase 5 collapses honesty, pause and redesign.

---

## 10. Dependency graph (text form)

Read top-down. Every node below depends on every node above that has an arrow to it.

```
Slice 1 (SHIPPED) ─────────────────────────────────────────────┐
                                                               │
P0.1 Commit ───> P0.2 Signal Bridge ───> P0.3 Prediction Ledger
                        │                     │
                        │                     ▼
                        │               P0.8 Trace substrate
                        │
                        ▼
                  P0.4 Flow Engine ───────> Phase 2 Slices
                        │                     │
                        ▼                     ▼
                  P0.5 Role Blend ───> Phase 2 Slice 2.6 (Relationship Engine)
                        │
                        ▼
                  P0.6 Honesty Index ───> Phase 2 Slice 2.8 (Exec v1)
                                              │
                                              ▼
                                        Phase 2 Cutover (2.9)
                                              │
                                              ▼
                        P0.7 Time Primitive ──┬──> Phase 3 Slices
                                              │       │
                                              │       ▼
                                              │  Handoff Trust Ledger (3.1)
                                              │       │
                                              │       ▼
                                              │  Branch Command Center (3.4)
                                              │       │
                                              │       ▼
                                              │  Territory (3.5) + Mobile (3.6)
                                              │
                                              ▼
                                    Phase 3 complete
                                              │
                                              ▼
                                    90 days of Prediction Ledger data
                                              │
                                              ▼
                                    Phase 4 AI surfaces
                                              │
                                              ▼
                                    Full fiscal year of Honesty Calibration
                                              │
                                              ▼
                                    Phase 5 Hidden Forces
```

Critical dependencies to protect:
1. **No AI Chief of Staff upgrade until P0.3 exists.** Slice 1 can ship rules-based without a ledger. Any upgrade to LLM rationale, ranking, or enrichment MUST write to the ledger at the moment the upgrade lands.
2. **No Trust Thermostat until Phase 4 ships and Phase 5 starts.** The thermostat depends on complete sales-cycle outcome data that only accrues after Phase 4.
3. **No role variant enforcement until P0.5 ships.** Slice 1's exclusive role selection is temporary. Any surface that assumes exclusive roles will break the moment someone takes a sick day.
4. **No Phase 3 Branch/Territory/Account surfaces until Flow Engine (P0.4) ships.** These surfaces depend on cross-module events that Flow Engine is the only publisher for.

---

## 11. Kill criteria

The roadmap's job is not to ship every idea. It is to ship the ones that survive contact with the data. Every idea in the inventory is subject to these kill criteria. Any idea that triggers one moves to the Deferred tier and is revisited at the next phase boundary.

1. **No users in 30 days**: If an opt-in surface has zero active users 30 days after launch, it is deferred. Second-chance: one redesign cycle before permanent deprecation.
2. **Negative Honesty Calibration impact**: If a surface causes the Honesty Index to drop measurably, it is paused immediately. No exceptions, including for AI Chief of Staff.
3. **Failure to pass the Fragility Audit**: Every slice must carry its own fragility review (what is the failure mode? what is the single most likely way this breaks adoption?). If a slice ships without one, it ships broken.
4. **Cannot be traced**: If a surface emits an AI recommendation that is not written to the Prediction Ledger, it is non-compliant and rolled back.
5. **Permissions leak**: Any surface that leaks cross-branch, cross-rep, or finance-adjacent data to the wrong role is rolled back immediately. No staged mitigation.
6. **Slow death test**: At the end of each phase, every surface is surveyed against the question "Would removing this cause a measurable loss of operational value?" Any surface where the answer is "probably not" is deferred.

---

## 12. Measurement plan per phase

Each phase has ONE question that determines whether it landed. Not a scorecard — a single falsifiable question. If the answer is no, the phase did not land, regardless of what shipped.

| Phase | The question |
|---|---|
| 0 | Can Phase 2 planning cite contracts instead of inferring schema? |
| 1 | Do testers open `/qrm/command` instead of `/qrm` when given the choice? |
| 2 | Have reps stopped using their personal spreadsheets for pipeline triage? |
| 3 | Can a manager covering for a sick rep land on the right homepage without manual intervention? |
| 4 | Can a rep walk into a customer meeting with a better theory of the deal than the customer's own operations team has? |
| 5 | Is the Honesty Calibration Index still trending up after the unreasonable layer shipped? |

These are the questions that matter. Everything else is instrumentation.

---

## 13. Complete idea index (103 ideas)

Every idea from the original 84, the 16 NEW, and the 3 resurrected, with its phase assignment and one-line rationale for placement.

### Originals (84)
| ID | Idea | Phase | Shipped? | Rationale |
|---|---|---|---|---|
| IDEA-001 | Command-center homepage | 1 | ✓ | Shipped in Slice 1 |
| IDEA-002 | Decision Layer above the fold | 1 | ✓ | Shipped in RoleVariantShell |
| IDEA-003 | Global Command Strip | 1 | ✓ | Shipped with narrative |
| IDEA-004 | AI Chief of Staff | 1 | ✓ | Shipped as rules-based |
| IDEA-005 | Live Action Lanes | 1 | ✓ | Shipped (single-lane; weighted in Phase 2) |
| IDEA-006 | Revenue Reality Board | 2 | | Needs margin + deposit joins |
| IDEA-007 | Pipeline Pressure Map | 1 | ✓ | Shipped with 5 meta-stages |
| IDEA-008 | Role/AI Action Launcher | 1 | ✓ | Shipped as card CTAs |
| IDEA-009 | DGE centerpiece | 2 | | Phase 2 Slice 2.1 hooks DGE |
| IDEA-010 | Dealer Reality Grid | 2 | | Phase 2 Slice 2.2 |
| IDEA-011 | Relationship & Opportunity Engine | 2 | | Phase 2 Slice 2.6 |
| IDEA-012 | Field Intelligence Feed | 2 | | Phase 2 Slice 2.6 (inside Relationship Engine) |
| IDEA-013 | Executive Intelligence Layer | 2 | | Phase 2 Slice 2.8 |
| IDEA-014 | Role-native homepages mandate | 1 | ✓ | Shipped; full blend in P0.5 |
| IDEA-015 | Iron Advisor homepage | 1 | ✓ | Shipped via roleVariant.ts |
| IDEA-016 | Iron Manager homepage | 1 | ✓ | Shipped via roleVariant.ts |
| IDEA-017 | Iron Woman homepage | 1 | ✓ | Shipped via roleVariant.ts |
| IDEA-018 | Iron Man homepage | 1 | ✓ | Shipped via roleVariant.ts |
| IDEA-019 | Control-board visual language | 1 | ✓ | Severity zones shipped |
| IDEA-020 | What-should-I-do-next core | 1 | ✓ | Chief of Staff hero cards |
| IDEA-021 | War-room behavior | 1 | ✓ | Shipped |
| IDEA-022 | Executive Command Center (full) | 3 | | Phase 3, depends on P0.5 |
| IDEA-023 | Branch Command Center | 3 | | Phase 3 Slice 3.4 |
| IDEA-024 | Territory Command Center | 3 | | Phase 3 Slice 3.5 |
| IDEA-025 | Account Command Center | 3 | | Phase 3 Slice 3.3 (anchor for Phase 4) |
| IDEA-026 | Customer Genome | 4 | | Phase 4 Slice 4.1 |
| IDEA-027 | Customer Operating Profile | 4 | | Phase 4 Slice 4.2 |
| IDEA-028 | Fleet Intelligence page | 4 | | Phase 4 Slice 4.3 |
| IDEA-029 | Relationship Map | 4 | | Phase 4 Slice 4.4 |
| IDEA-030 | White-Space Map | 4 | | Phase 4 Slice 4.5 |
| IDEA-031 | Quote Velocity Center | 2 | | Phase 2 Slices 2.2 (tile) + 2.3 (page) |
| IDEA-032 | Approval Center | 2 | | Phase 2 Slices 2.2 (tile) + 2.4 (page) |
| IDEA-033 | Blocker Board | 2 | | Phase 2 Slices 2.2 (tile) + 2.5 (page) |
| IDEA-034 | Machine Lifecycle system | 3 | | Phase 3 Slice 3.9 |
| IDEA-035 | Machine Command Page | 3 | | Phase 3 Slice 3.10 |
| IDEA-036 | Inventory Pressure Board | 3 | | Phase 3 Slice 3.11 |
| IDEA-037 | Intake-to-Sale Board | 3 | | Phase 3 Slice 3.12 |
| IDEA-038 | Rental Command Center | 3 | | Phase 3 Slice 3.14 |
| IDEA-039 | Rental Conversion Engine | 4 | | Phase 4 Slice 4.6 — Contrarian Bet #1 |
| IDEA-040 | Service-to-Sales Opportunity page | 3 | | Phase 3 Slice 3.15 |
| IDEA-041 | Parts Intelligence page | 3 | | Phase 3 Slice 3.16 |
| IDEA-042 | Customer Health Score | 3 | | Phase 3 Slice 3.17 |
| IDEA-043 | Mobile Field Command | 3 | | Phase 3 Slice 3.6 |
| IDEA-044 | Visit Intelligence page | 3 | | Phase 3 Slice 3.7 |
| IDEA-045 | Trade Walkaround Workflow | 3 | | Phase 3 Slice 3.8 |
| IDEA-046 | AI Deal Coach | 4 | | Phase 4 Slice 4.7 — needs P0.3 history |
| IDEA-047 | AI Branch Chief | 4 | | Phase 4 Slice 4.8 |
| IDEA-048 | AI Customer Strategist | 4 | | Phase 4 Slice 4.9 |
| IDEA-049 | AI Operations Copilot | 4 | | Phase 4 Slice 4.10 |
| IDEA-050 | AI Owner Briefing | 4 | | Phase 4 Slice 4.11 — confidence-typed |
| IDEA-051 | Exception-handling surfaces | 3 | | Phase 3 Slice 3.20 |
| IDEA-052 | Deal Autopsy page | 3 | | Phase 3 Slice 3.19 |
| IDEA-053 | Forecast Confidence page | 4 | | Phase 4 Slice 4.12 — needs Prediction Ledger |
| IDEA-054 | Replacement Prediction page | 4 | | Phase 4 Slice 4.13 |
| IDEA-055 | Competitive Threat Map | 4 | | Phase 4 Slice 4.14 |
| IDEA-056 | Seasonal Opportunity Map | 4 | | Phase 4 Slice 4.15 |
| IDEA-057 | QRM Flow Engine | 0 | | **P0.4 — moved up from Phase 3** |
| IDEA-058 | AI Feedback/Trace page | 0 | | **P0.8 — moved up from Phase 1** |
| IDEA-059 | Workflow Audit page | 3 | | Phase 3 Slice 3.27 |
| IDEA-060 | Data Quality Score | 0 | | **P0.8 foundation** |
| IDEA-061 | Knowledge Gaps page | 2 | | Phase 2 Slice 2.7 |
| IDEA-062 | Rep Adoption page → **NEW-RES-062** | 3 | | Resurrected as Rep Reality Reflection |
| IDEA-063 | SOP Compliance page | 3 | | Phase 3 Slice 3.28 — paired with Folk Workflow |
| IDEA-064 | Missing-Data Heatmap → **NEW-RES-064** | 2 | | Resurrected as Absence Engine |
| IDEA-065 | Process Drift page → **NEW-RES-065** | 3 | | Resurrected as Folk Workflow Library |
| IDEA-066 | Data Quality Command Center | 0 | | **P0.2 + P0.6 substrate** |
| IDEA-067 | Revenue Rescue Center | 3 | | Phase 3 Slice 3.23 |
| IDEA-068 | Competitive Displacement Center | 3 | | Phase 3 Slice 3.24 |
| IDEA-069 | Operator Intelligence page | 3 | | Phase 3 Slice 3.25 |
| IDEA-070 | Deal Room | 3 | | Phase 3 Slice 3.18 |
| IDEA-071 | Customer 360 Timeline | 3 | | Phase 3 Slice 3.21 |
| IDEA-072 | Opportunity Map | 3 | | Phase 3 Slice 3.22 |
| IDEA-073 | Post-Sale Experience Center | 3 | | Phase 3 Slice 3.26 |
| IDEA-074 | Learning Layer | 4 | | Phase 4 Slice 4.16 |
| IDEA-075 | Trust Thermostat | 5 | | Phase 5 Slice 5.1 — as receipt, not gauge |
| IDEA-076 | Machine Fate Engine | 5 | | Phase 5 Slice 5.2 |
| IDEA-077 | Silence Map | 5 | | Phase 5 Slice 5.3 |
| IDEA-078 | Customer Gravity Field | 5 | | Phase 5 Slice 5.4 — with Permission Slip |
| IDEA-079 | Rep Mythology Layer | 5 | | Phase 5 Slice 5.5 — research-gated |
| IDEA-080 | Pre-Regret Simulator | 5 | | Phase 5 Slice 5.6 |
| IDEA-081 | Internal Market for Attention | 5 | | Phase 5 Slice 5.7 |
| IDEA-082 | Ruin Prevention Mode | 5 | | Phase 5 Slice 5.8 |
| IDEA-083 | Shadow Org Chart | 5 | | Phase 5 Slice 5.9 |
| IDEA-084 | Ghost Buyer | 5 | | Phase 5 Slice 5.10 — shape-only |

### NEW ideas from Leg 2 (16)
| ID | Idea | Phase | Rationale |
|---|---|---|---|
| NEW-001 | Time Bank | 0 + 3 | Primitive in P0.7, visible in Phase 3 Slice 3.2 |
| NEW-002 | Cross-Dealer Mirror | 4 | Phase 4 Slice 4.17 |
| NEW-003 | Cashflow Weather Map | 4 | Phase 4 Slice 4.18 |
| NEW-004 | Decision Room Simulator | 4 | Phase 4 Slice 4.19 |
| NEW-005 | Handoff Trust Ledger | 0 + 3 | Schema in P0.4, full in Phase 3 Slice 3.1 |
| NEW-006 | Institutional Grief Archive | 5 | Phase 5 Slice 5.11 |
| NEW-007 | Iron in Motion Register | 3 | Phase 3 Slice 3.13 |
| NEW-008 | Body of the Operator | 5 | Phase 5 Slice 5.12 — research-gated |
| NEW-009 | Honesty Calibration Index | 0 | **P0.6 — the contract everything depends on** |
| NEW-010 | Decision Cycle Synchronizer | 4 | Phase 4 Slice 4.20 |
| NEW-011 | Ecosystem Layer | 4 | Phase 4 Slice 4.21 |
| NEW-012 | Reputation Surface | 4 | Phase 4 Slice 4.22 |
| NEW-013 | Rep as SKU | 4 | Phase 4 Slice 4.23 |
| NEW-014 | Death and Exit Register | 4 | Phase 4 Slice 4.24 |
| NEW-015 | Unmapped Territory Surface | 4 | Phase 4 Slice 4.25 |
| NEW-016 | Tempo Conductor | 5 | Phase 5 Slice 5.13 — serves the third system |

### Resurrected (3)
| ID | Original | New framing | Phase |
|---|---|---|---|
| NEW-RES-062 | Rep Adoption page | Rep Reality Reflection — private, rep-owned mirror | 3 (3.30) |
| NEW-RES-064 | Missing-Data Heatmap | Absence Engine — absence as behavioral grammar | 2 (2.7) |
| NEW-RES-065 | Process Drift page | Folk Workflow Library — drift as unrecognized innovation | 3 (3.29) |

**Total tracked**: 103 ideas (84 + 16 + 3). Every one has a phase, a slice, and a rationale.

---

## 14. Next 2 weeks — concrete day-by-day execution

**This is the part you're going to work through step by step.** Each day has a deliverable. Each day's deliverable has an exit gate. If a day's gate is not met, the next day does not start.

### Week 1

**Day 1 — Commit Slice 1** (P0.1) ✅ SHIPPED + PUSHED 2026-04-08
- Commit `0ba1498` on `main` — 19 files, 2,917 net insertions.
- Post-build audit fix commit `79e767b` on `main` — 3 files, 92 insertions, 18 deletions. P0-1 (`functions.invoke` contract: frontend wrapper now POSTs with body `{ scope }`; edge function reads scope from POST body with URL query fallback) + P1-1 (localStorage snooze prune: one-shot module-guarded sweep on first RecommendationCard mount per page load).
- Both commits pushed to `origin/main` per user override of the original Day-12 hold trigger. See §15 Q1 for the override rationale and what it means for Days 3–11.
- All four gates verified locally before each commit: `deno check`, `deno test` (14/14), `bun run build` (apps/web), `bun run migrations:check` (206 files, no new migrations).
- **Transitive dep note**: Slice 1 depends on `supabase/functions/_shared/workspace.ts` which was untracked at commit time (belongs to the workspace-identity workstream). After push, any external puller of `main` may see a build break until that workstream lands its own commit. Flag this if anyone reports a build failure during Phase 0.

**Day 2 — Phase 0 prep + dependency graph** ✅ SHIPPED 2026-04-08
- Verification artifact at [/Users/brianlewis/.claude/plans/phase-0-dependency-verification.md](/Users/brianlewis/.claude/plans/phase-0-dependency-verification.md). Three parallel Explore agents verified P0.2/P0.3/P0.7, P0.4 Flow Engine, and P0.5/P0.6/P0.8 respectively.
- **Verdict**: GO on Day 3 with 7 roadmap edits (applied in this same commit) + 1 Day 2.5 hot-fix commit (applied immediately after).
- **Five surprises found**:
  1. **P0 Production bug in Slice 1** — `voice_captures.deal_id` doesn't exist; real column is `linked_deal_id`. Voice heat has been permanently 0 since Slice 1 landed on main. Silent failure (`voiceRes.data ?? []` fallback with no error check). Fixed in Day 2.5 hot-fix.
  2. **P0.4 Flow Engine already exists** as a workflow execution engine (migrations 194–196, 5 edge functions, 10 pre-built workflows). New event bus builds alongside it in `_shared/flow-bus/`, not as a promotion of the existing `_shared/flow-engine/`. P0.4 description rewritten.
  3. **P0.7 historical backfill is impossible as originally planned** — `crm_activities.activity_type` has no stage-change enum values. Cold-start backfill is the only honest path. Day 11 language corrected.
  4. **P0.6 probes 7 and 8 must ship as stubs** — decay-threshold and protected-account probes depend on Phase 2 Slice 2.X and Phase 3 Slice 3.3 respectively. Day 10 exit gate updated to assert 8 probes registered, 2 stubbed.
  5. **P0.2 indirect joins** — `deal_timing_alerts` and `competitive_mentions` require two-hop bridges through `customer_profiles_extended` and `voice_captures`. P0.2 description updated.
- **Exit gate**: Dependency graph written. Surprises surfaced and corrected in roadmap edits (this commit) + hot-fix (next commit). Day 3 proceeds on schedule.

**Day 2.5 — Slice 1 voice_captures hot-fix** ✅ SHIPPED 2026-04-08
- **Context**: Day 2 verification found that Slice 1's `qrm-command-center` edge function queries `voice_captures.deal_id` (a column that doesn't exist; the real column is `linked_deal_id` from migration 056), AND reads `extracted_data.competitor_mentions` as nested jsonb when it's actually stored as top-level `text[]`. Both failures are absorbed silently by `voiceRes.data ?? []` with no error check. Result: voice heat has been permanently 0 and competitor-mention detection has been permanently false since Slice 1 landed on main.
- **Fix**: one file ([supabase/functions/qrm-command-center/index.ts](../supabase/functions/qrm-command-center/index.ts)), three changes:
  1. Rename `deal_id` → `linked_deal_id` in the `voice_captures` query (lines 387–393) and corresponding `VoiceRow` type + iteration (lines 452–475).
  2. Change competitor-mention reading from `row.extracted_data.competitor_mentions` (nested jsonb) to top-level `row.competitor_mentions` (text[]).
  3. Add explicit `.error` checks on every Promise.all result. Log errors to sentry via `captureEdgeException` before falling back to empty arrays. Silent absorption was the root cause of the bug going undetected; the hot-fix closes that hole.
- **No migration, no frontend changes, no breaking response-shape changes.** P0.2 was about to inherit the broken pattern one day later — fixing it now means P0.2's bridge view ships against correct column names.
- **Gates**: `deno check` clean, `deno test` 14/14, `bun run build` clean, `bun run migrations:check` still 206.
- **Commit**: separate fix commit on main immediately after this docs commit. Pushed together.

**Day 3 — P0.2 Signal taxonomy + deal-signal bridge** ✅ SHIPPED 2026-04-08
- Commit `a763591` on `origin/main`. 4 files, 776 insertions, 101 deletions.
- Migration `207_deal_signal_bridge.sql` shipped + applied to remote project `iciddijgonywtxoelous`.
- TS adapter at [supabase/functions/_shared/qrm-command-center/signal-bridge.ts](../supabase/functions/_shared/qrm-command-center/signal-bridge.ts) (190 lines) + 13 Deno tests in [signal-bridge.test.ts](../supabase/functions/_shared/qrm-command-center/signal-bridge.test.ts).
- Edge function refactored to read from the view + adapter instead of 5 parallel signal queries. Response shape byte-identical (frontend untouched).
- **SCOPE CHANGE FROM ORIGINAL PLAN**: shipped as a **four-source** bridge, not five. Day 3 verification of `customer_profiles_extended` (migration 013) confirmed it has NO direct FK to `crm_deals`, no `crm_company_id` column, and only fragile text-match join surfaces (`hubspot_contact_id`, `customer_name`, `intellidealer_customer_id`). The honest path from `deal_timing_alerts` to `crm_deals` is a three-hop text match through `hubspot_contact_id`. Slice 1's edge function does NOT query `deal_timing_alerts` today, so deferring it from the bridge regresses no current functionality. Migration 207 header documents the deferral with three concrete unblock conditions (direct deal_id column, customer_profiles_extended FK, or a separate mapping table).
- The four sources that DO ship: `anomaly_alerts` (polymorphic via entity_type='deal'), `voice_captures` (direct FK on `linked_deal_id`), `deposits` (direct FK on `deal_id`), `competitive_mentions` (clean two-hop FK via `voice_captures.linked_deal_id`).
- View ships with `security_invoker = true` so it inherits per-source RLS — no new policies, no new attack surface.
- **Exit gate met**: migration applied to remote, all 13 adapter tests green, response shape unchanged, deno check + bun build clean.

**Day 4 — P0.3 Prediction Ledger (migration + schema + integration + P0.8 atomic)** ✅ SHIPPED 2026-04-08
- Commit `89a1c23` on `origin/main`. 5 files, 1,399 insertions, 1 deletion.
- **Day 5 work was bundled into this commit** — see Day 5 entry below for the absorption rationale.
- Migration `208_prediction_ledger.sql` shipped + applied to remote project `iciddijgonywtxoelous`. Two new tables (`qrm_predictions`, `qrm_prediction_outcomes`) with full RLS via `get_my_workspace()` + `get_my_role()`. 5 indexes including a partial index for the prune candidate set (`WHERE outcome IS NULL`).
- **P0.8 trace columns landed atomically** in migration 208 — `trace_id uuid` and `trace_steps jsonb`. The roadmap originally scheduled these for Day 11 as a follow-up migration; bundling them here saves a follow-up. Day 11's P0.8 work becomes purely the trace UI route + the `qrm-prediction-trace` function — the schema is already in place.
- TS adapter at [supabase/functions/_shared/qrm-command-center/prediction-ledger.ts](../supabase/functions/_shared/qrm-command-center/prediction-ledger.ts) (336 lines): canonical-JSON serialization, SHA-256 hash helpers (`hashRationale`, `hashInputs`, `hashSignals`), trace step extraction, single-row builder, full-batch builder with dedupe by `(subject_id, prediction_kind)`. 18 Deno tests in [prediction-ledger.test.ts](../supabase/functions/_shared/qrm-command-center/prediction-ledger.test.ts) covering canonical determinism, hash determinism, role/version differentiation, dedupe semantics, and orphan-card defense.
- Edge function refactored to write recommendation cards to `qrm_predictions` at issue time. Synchronous insert via the admin client. Errors caught + logged + sent to sentry but never fail the request — observability loss only. Final log line includes `signalsLatency` and `ledgerLatency` for visibility.
- New nightly grader edge function at [supabase/functions/qrm-prediction-scorer/index.ts](../supabase/functions/qrm-prediction-scorer/index.ts) (325 lines). Service-role auth only. Pure `gradePrediction()` function that closes out predictions against deal stage flags (`is_closed_won` / `is_closed_lost`) or marks them `expired` after a 30-day window. Persists to `qrm_prediction_outcomes` AND updates the canonical `qrm_predictions.outcome` pointer.
- **DEPLOYED to live runtime**: both `qrm-command-center` v1 and `qrm-prediction-scorer` v1 deployed to `iciddijgonywtxoelous` 2026-04-08 20:23 UTC. `supabase functions list` confirms both ACTIVE.
- **DEFERRED-DECISION RESOLVED — retention policy**: graded predictions kept forever; ungraded pruned at 180 days. **Implementation differs from the original plan**: the policy lives in migration 208's header comment (NOT a per-row `retention_policy` column — would have been wasteful, would not enforce anything). The actual `qrm-prediction-retention` pruner skeleton is **deferred to Phase 4 alongside the actual enforcement**. Only the grader (`qrm-prediction-scorer`) shipped on Day 4; the pruner is a separate Phase 4 deliverable.
- **Types regenerated** in commit `f911068` — `apps/web/src/lib/database.types.ts` synced with remote schema (catches up multi-workstream drift in addition to migrations 207+208).
- **Exit gate met**: migration applied to remote, RLS verified, nightly skeleton type-checks, retention policy documented in the migration comment, all 45 Deno tests green, both functions deployed live.

**Day 5 — P0.3 Prediction Ledger (integration)** ✅ ABSORBED INTO DAY 4 2026-04-08
- All Day 5 deliverables shipped inside commit `89a1c23` (the Day 4 commit) instead of as a separate commit on a separate day.
- **Why bundled**: it was cleaner to ship the migration, the TS adapter, the edge function refactor, AND the unit tests as one atomic commit so the ledger writes are unit-testable against the migration that creates the table. Splitting them into two commits would have left the working tree in a half-state where the edge function had ledger calls but the migration hadn't been written yet (or vice versa). The atomic ship matches how the code actually depends on itself.
- **Day 5 deliverables that landed in `89a1c23`**:
  - Edge function refactored to write every recommendation card to `qrm_predictions` at issue time via the admin client.
  - Includes `rationale_hash`, `inputs_hash`, `signals_hash`, `model_source='rules'`, plus the P0.8 atomic `trace_id` and `trace_steps`.
  - Unit tests that assert the adapter produces the right number of rows for a simulated lane + Chief-of-Staff input set (5 rows for 2 deals across 3 lanes + 3 Chief-of-Staff slots, deduped by `(subject_id, prediction_kind)` — see `prediction-ledger.test.ts` "buildLedgerBatch produces one row per (subject, kind) pair").
- **What's NOT covered by unit tests** (and is left to manual verification): an end-to-end "fire `/qrm/command` against a live deployed runtime, confirm rows land in the live `qrm_predictions` table" test. The Deno tests exercise the TS adapter against fixture data; they do NOT round-trip through the actual `qrm-command-center` edge function or the live database. End-to-end verification is the manual smoke test in §15-or-equivalent.
- **Exit gate met**: recommendations land in the ledger when the edge function is invoked (verified at the unit-test level — adapter produces correct rows; verified at the deployment level — both functions ACTIVE on live runtime). Slice 1's `/qrm/command` still works (build clean, deno check clean, no response shape change).

### Week 2

**Day 6 — P0.4 Flow Bus (bus + publish helper)**
- **CRITICAL NAMESPACE NOTE (from Day 2 verification §4)**: the existing `_shared/flow-engine/` directory belongs to the pre-existing workflow execution engine (migrations 194–196). Do NOT put P0.4 files there. The new event bus goes in **`_shared/flow-bus/`** — a distinct namespace — so workflow-engine code and bus code never collide conceptually or structurally.
- **PRE-MIGRATION CHECKLIST — ADD-033 schema absorption (from merge §4)**: before writing `209_flow_bus.sql`, confirm the new `flow_events` table (the bus's append-only surface, NOT the existing workflow engine's `analytics_events` with flow columns) includes ALL of the following from the addendum's canonical event object: `event_id, event_type, source_module, source_record_id, customer_id, company_id, equipment_id, deal_id, severity, commercial_relevance, suggested_owner, required_action, recommended_deadline, draft_message, escalation_rule, status, created_at`. Add these to the initial schema, not a follow-up migration. The merge explicitly calls this out as "the only place the merge requires a change to a Phase 0 file — and it's a proactive addition, not a rework."
- Write migration `209_flow_bus.sql`: `flow_events` append-only (with ADD-033 fields above), `flow_event_types` registry, `flow_subscriptions`. RLS per `get_my_workspace()`. Indexes on `(event_type, published_at)` and `(idempotency_key)`.
- Write [supabase/functions/_shared/flow-bus/publish.ts](../supabase/functions/_shared/flow-bus/publish.ts) with `publishFlowEvent(type, payload, { idempotencyKey, correlationId })`. Reuse the existing engine's `flow_action_idempotency` table with a distinct key namespace (`bus:{event_type}:{idempotencyKey}`).
- Write [supabase/functions/_shared/flow-bus/subscribe.ts](../supabase/functions/_shared/flow-bus/subscribe.ts) with the declarative subscription DSL.
- Write Deno tests for ordering, idempotency, subscription pattern matching, RLS, AND the ADD-033 field coverage (assert every field is persistable and readable).
- **Exit gate**: Publish helper works. Subscribe helper works. No consumers yet. Merge §4 ADD-033 requirement closed. Existing Flow Engine at `_shared/flow-engine/` untouched.

**Day 7 — P0.4 Flow Engine (migrate existing publishers)**
- Refactor `follow-up-engine`, `nudge-scheduler`, `deal-timing-scan`, `anomaly-scan` to publish to the bus in addition to their current side-effects. Do NOT remove the side-effects yet — dual-write.
- **DEFERRED-DECISION CLOSED — Flow Engine dual-write cutover date**: dual-write continues until **the end of Phase 2 Slice 2.2 (Dealer Reality Grid)**. At that point, the side-effect paths are retired and the bus becomes the sole publisher. Any later cutover pollutes Phase 3 with stale integration code.
- **Exit gate**: Existing functions still work. Bus is receiving events. Cutover date stamped in a comment at the top of each refactored publisher.

**Day 8 — P0.5 Role Blend data model**
- Write migration `210_role_blend.sql` + backfill from `profiles.iron_role`.
- Write view `v_profile_active_role_blend`.
- Refactor [iron-roles.ts](../apps/web/src/features/qrm/lib/iron-roles.ts) `getIronRole()` → `getIronRoleBlend()` returning `{role, weight}[]`.
- Keep the exclusive `getIronRole()` as a deprecation shim.
- **Exit gate**: Both shapes work. Slice 1 still renders correctly with exclusive shim.

**Day 9 — P0.5 Role Blend (frontend adoption)**
- Refactor [RoleVariantShell.tsx](../apps/web/src/features/qrm/command-center/components/RoleVariantShell.tsx) to accept a blend and compose section order via weighted interleaving.
- Refactor [ranking.ts](../supabase/functions/_shared/qrm-command-center/ranking.ts) `getRoleWeights()` to accept a blend and produce a weighted ensemble.
- **Exit gate**: A user with blend `[{iron_advisor: 0.5}, {iron_manager: 0.5}]` sees a merged section order that honors both.

**Day 10 — P0.6 Honesty Calibration Index**
- **DEFERRED-DECISION TRIGGER — name the Honesty Calibration political owner BEFORE writing `qrm-honesty-scan`.**
  - Default proposal (from §15 Q2): *Brian as owner, operator TBD at ship.* Operator owns interpreting the signal day-to-day; owner owns what to do with the signal structurally.
  - If no named operator exists by the time the scan is written, default to Brian for both roles until Phase 3.
  - Stamp the owner's user_id into the migration's `qrm_honesty_observations.assigned_owner_id` default so every probe has a human target from day one.
- Write migration `211_honesty_calibration.sql` for `qrm_honesty_observations` + `qrm_honesty_daily` + `qrm_honesty_probes` (probe registry).
- Write the nightly `qrm-honesty-scan` edge function with **8 honesty probes total** (see §4 P0.6 for the full list). Probes 1–6 are implementable against the current schema and ship live on Day 10. Probes 7 (decay-threshold-proximity) and 8 (protected-account gaming) ship as **registered-but-disabled stubs** — their probe functions exist and are wired in, but short-circuit to `return []` until Phase 2 Slice 2.X and Phase 3 Slice 3.3 respectively enable the surfaces they depend on.
- Each implementable probe (1–6) is a pure function with a Deno test. Stub probes (7, 8) have placeholder tests that assert "when `depends_on` surface does not exist, the probe returns `[]` without throwing." The probes are the contract.
- **Exit gate**: Nightly scan runs. Observations land for probes 1–6. Daily rollup computes. Probes 7 and 8 are registered in `qrm_honesty_probes` with `is_enabled = false` and `depends_on` set. **Day 10 exit gate asserts: 8 probes registered, exactly 2 stubbed, exactly 6 producing observations.** Index is not yet visible to anyone. Named owner stamped on every observation.

**Day 11 — P0.7 Time Primitive + P0.8 Trace substrate**
- **P0.7 BACKFILL SCOPE CORRECTION (from Day 2 verification §7)**: the original roadmap said "walk `crm_activities` and `deal_composite` to reconstruct historical transitions." This is impossible — `crm_activities.activity_type` has no stage-change enum values (`'note', 'call', 'email', 'meeting', 'task', 'sms'` only), no dedicated stage-history table exists, and `crm_deals.updated_at` is unreliable as a proxy (fires on any column change). **P0.7 backfill is now cold-start, not historical replay.**
- Migration `212_time_primitive.sql`:
  - Table `qrm_stage_transitions` — `id, deal_id, from_stage_id, to_stage_id, at timestamptz, source text`.
  - **Cold-start backfill loop**: insert one observation row per open deal with `from_stage_id = NULL`, `to_stage_id = current stage_id`, `at = crm_deals.updated_at`, `source = 'cold_start_backfill_2026_04_08'`. Honest about the limitation: historical transitions before the migration are not recoverable.
  - **New trigger** `crm_deals_log_stage_transition` on `AFTER UPDATE OF stage_id ON crm_deals FOR EACH ROW` — inserts a row into `qrm_stage_transitions` with `from_stage_id = OLD.stage_id`, `to_stage_id = NEW.stage_id`, `at = now()`, `source = 'trigger'`. This is the only way stage transitions become observable going forward.
  - Function `qrm_stage_age(deal_id uuid)` returns days in current stage. Handles the cold-start case: if no transition row exists for the deal at all, falls back to `now() - crm_deals.updated_at`. If transitions exist, reads the most recent transition's `at` and computes `now() - at`.
- Shared TS primitive `_shared/time-primitive.ts` — `timeBalance(subject, budget)` pure function.
- Extend `qrm_predictions` (from P0.3) with `trace_id` + `trace_steps jsonb` columns (atomic — P0.3 already flagged this).
- Add `qrm-prediction-trace` function + frontend route `/qrm/command/trace/:predictionId`. Route uses the manager-gated pattern from [App.tsx:636](../apps/web/src/App.tsx#L636) (`["admin", "manager", "owner"].includes(profile.role)`). Extract shared timeline component from [FlowRunHistoryDrawer.tsx](../apps/web/src/features/admin/components/flow/FlowRunHistoryDrawer.tsx) into `apps/web/src/components/trace/` so both surfaces share one implementation.
- Extend `TrackEventInput` in [supabase/functions/_shared/event-tracker.ts](../supabase/functions/_shared/event-tracker.ts) to add `trace_id?: string | null`.
- Wire Slice 1's `RecommendationCard` Accept/Dismiss/Snooze to call `trackRecommendationEvent()` with the prediction's `trace_id`.
- Deno tests for `qrm_stage_age()` cold-start fallback, trigger firing on stage updates, and trace round-trip.
- **~~DEFERRED-DECISION CLOSED — Slice 1 push timing~~** — SUPERSEDED by user override 2026-04-08. Slice 1 was pushed to `origin/main` on Day 1 as two commits (`0ba1498` + `79e767b`). The P0.2–P0.8 refactors now ship as normal follow-up commits against the pushed Slice 1 code, not as a single pre-push refactor. No force-pushes. See §15 Q1 for the full override note.
- **Exit gate**: All P0 migrations through 212 applied. All P0 Deno tests green. All P0 gates passed. `qrm_stage_age(any_deal)` returns a sensible number for both cold-start deals (fallback path) and post-trigger deals (transition path).

**Day 12 — Phase 0 exit audit**
- Refactor the Slice 1 edge function one more time to confirm it uses: P0.2 bridge view, P0.3 ledger writes, P0.4 flow engine publish on recommendation emit, P0.5 role blend, P0.8 trace.
- Run the full verification from Slice 1 again: every functional check in the Slice 1 verification section of [/Users/brianlewis/.claude/plans/reflective-scribbling-bear.md](/Users/brianlewis/.claude/plans/reflective-scribbling-bear.md).
- Write a Phase 0 exit report at `/Users/brianlewis/.claude/plans/phase-0-exit-report.md` naming which contracts are now clean to cite and which (if any) leaked scope into Phase 2.
- **Exit gate**: Phase 0 signed off. Phase 2 Slice 2.1 can open.

**Day 13 — Phase 2 Slice 2.1 backend (Revenue Reality Board)**
- Write `_shared/qrm-command-center/revenue-reality.ts`.
- Extend the edge function response with the `revenueReality` block.
- Hook DGE optimizer output for `closeProbability` adjustments.
- Write Deno tests for the aggregations.
- **Exit gate**: Backend returns a valid `revenueReality` payload. Edge function type-checks. Tests green.

**Day 14 — Phase 2 Slice 2.1 frontend + ship**
- Write [RevenueRealityBoard.tsx](../apps/web/src/features/qrm/command-center/components/RevenueRealityBoard.tsx).
- Register in [roleVariant.ts](../apps/web/src/features/qrm/command-center/lib/roleVariant.ts).
- Run all gates. Commit as "Slice 2.1 — Revenue Reality Board".
- Update this roadmap file: mark IDEA-006 as shipped in the idea index. Mark IDEA-009 as partially shipped (DGE hook landed, full DGE centerpiece still pending).
- **Exit gate**: Slice 2.1 committed. Roadmap updated. Day 15 opens Slice 2.2.

### After Day 14
Week 3 starts Slice 2.2 (Dealer Reality Grid). Slices 2.3–2.9 follow the same day-by-day cadence. When every Phase 2 slice is shipped, the cutover PR (Slice 2.9) flips `/qrm` and deletes [QrmHubPage.tsx](../apps/web/src/features/qrm/pages/QrmHubPage.tsx) in a single commit with a capability-diff.

---

## 15. Open questions and deferred-decision register

**Governance model**: Just-in-Time Governance (Recommendation 3, accepted 2026-04-08). Decisions are resolved at the slice that forces them, not pre-resolved in bulk. Every deferred decision carries an explicit trigger day or slice so nothing rots.

### Q1 — Push Slice 1 commit to `main`, or keep it local until Phase 0 is complete?
**Status**: RESOLVED 2026-04-08 (JIT governance) → **USER OVERRIDE 2026-04-08 — pushed early.**

**Original resolution** (JIT governance): Hold the push until Day 12 (Phase 0 exit audit) so the Phase-0-clean version of Slice 1 — refactored to use P0.2 bridge view, P0.3 ledger writes, P0.4 Flow Engine publish, P0.5 role blend, P0.8 trace — is what lands on `origin/main`. Pushing now and force-pushing the refactor over it later was the argued alternative.

**User override** (same day): After the post-build audit produced fix commit `79e767b` (P0-1 `functions.invoke` contract + P1-1 localStorage snooze prune), user instructed "Commit and push". Both Slice 1 commits landed on `origin/main` at the override:
- `0ba1498` — feat(qrm): Slice 1 — QRM Moonshot Command Center spine
- `79e767b` — fix(qrm): Slice 1 post-build audit — invoke contract + snooze hygiene

**What this means for the remaining Phase 0 refactor**: Days 3–11 of Phase 0 will now produce **normal follow-up commits** against the pushed Slice 1 code, not a single pre-push refactor. Each P0 track (P0.2 signal bridge, P0.3 ledger, P0.4 Flow Engine, P0.5 role blend, P0.8 trace) ships as its own commit refactoring the Slice 1 edge function and frontend hooks in place. No force-pushes, no history rewrites. This is strictly more commits and more reviews, but it's the honest path given the override.

**Trigger**: None — closed. Any future Slice 1 refactor commits are normal Phase 0 work.

### Q2 — Who owns the Honesty Calibration Index politically?
**Status**: DEFERRED to Day 10 (P0.6 ship date).
**Trigger**: Day 10 — naming the owner is a prerequisite to writing `qrm-honesty-scan` (see §14 Day 10 DEFERRED-DECISION TRIGGER).
**Default**: Brian as owner; operator TBD at ship. If no named operator exists by Day 10, default to Brian for both roles until Phase 3.
**Non-optional**: P0.6 cannot ship without a named `assigned_owner_id` default on `qrm_honesty_observations`.

### Q3 — Flow Engine dual-write cutover date
**Status**: RESOLVED 2026-04-08 (JIT governance).
**Resolution**: **End of Phase 2 Slice 2.2 (Dealer Reality Grid).** Dual-write continues until that slice ships; then the side-effect paths are retired and the Flow Engine becomes the sole publisher. Any later cutover pollutes Phase 3.
**Trigger**: Phase 2 Slice 2.2 exit gate — add "retire dual-write side-effects" to that slice's exit criteria.

### Q4 — Prediction Ledger retention policy + Meaningful Contact governance
**Status**: RESOLVED 2026-04-08 (JIT governance) for retention; DRAFT-AWAITING-OWNER for Meaningful Contact.

**Q4a — Prediction Ledger retention** (resolved + shipped 2026-04-08):
- **Resolution**: *Keep predictions with outcomes forever; prune ungraded predictions older than 180 days; reviewable in Phase 4.*
- **Shipped in commit `89a1c23` (Day 4)** — the policy lives in [migration 208's header comment](../supabase/migrations/208_prediction_ledger.sql), NOT a per-row column.
- **Implementation diverges from the original Day 4 plan in two honest ways**:
  1. The original plan said to add a `qrm_predictions.retention_policy` column with `'graded_forever_ungraded_180d'` as the default. This was rejected as wasteful (storing the same string on every row) and ineffective (a column doesn't enforce anything). The policy lives in the migration header instead. Phase 4 enforcement reads from a constant or workspace_settings entry.
  2. The original plan said to write a `qrm-prediction-retention` nightly job skeleton in Day 4. **This was deferred to Phase 4** alongside the actual retention enforcement. Day 4 only shipped the grader (`qrm-prediction-scorer`), which closes out predictions against deal outcomes — that is a different function from the pruner that deletes old ungraded rows. Two distinct nightly jobs, one shipped, one deferred.
- **Trigger for the actual pruner**: Phase 4. No earlier action needed unless retention cost becomes a problem before Phase 4 lands, in which case a manual one-off `DELETE FROM qrm_predictions WHERE outcome IS NULL AND predicted_at < now() - interval '180 days'` is the safe escape hatch.

**Q4b — Meaningful Contact definition** (draft, awaiting owner sign-off):
The main roadmap's original §15 Q4 asked: *"What is the definition of meaningful contact?"* The conflict-marked merge [plans/2026-04-08-qrm-addendum-merge.md](./2026-04-08-qrm-addendum-merge.md) §6 drafted the answer. The draft below is the complete definition, inserted here for visibility. It ships into enforcement across three slices (P0.6 probes, Phase 2 calculation engine, Phase 3 Account Command Center decay automation). **Owner sign-off required before the Phase 2 Slice 2.X calculation engine PR opens.**

**Draft definition** (from merge §6.1):
> A meaningful contact is an event that satisfies BOTH a TYPE condition and a SIGNAL condition. TYPE is weighted by activity quality (in-person visit with geolocation = 1.0; voice capture with extracted intent = 1.0; demo scheduled/delivered = 0.9; quote presented = 0.9; inbound call ≥60s = 0.8; trade walkaround = 0.8; deposit discussion = 0.7; outbound call with customer response ≥60s = 0.6; email the customer opened AND clicked/replied = 0.5; service complaint logged and acknowledged = 0.3). SIGNAL must be bilateral (customer did something in response) OR physical (visit/demo/walkaround) OR voice-intent-extracted. Weight decays as `weight_today = original_weight × exp(-days_since / 30)`. Accounts decay when the sum of weights < 0.5.

**What does NOT count** (from merge §6.2): opening a contact record; pinning a task without completing it; auto-drafted emails never sent; outbound emails with no customer engagement; "checking in" texts; bulk marketing touches; retroactive activity creation (48h audit); activity created within 24h of decay threshold (primary anti-gaming guard).

**Anti-gaming guardrails** (from merge §6.3): weights NOT visible to reps; retroactive activity auditing; decay-threshold-proximity auditing; bilateral verification required for email weight; versioned weights; decay rate configurable per workspace, not per rep.

**Protected Strategic Account Override** (from merge §6.4): owner/manager-authorized override that suspends automated ownership decay but NOT contact-health calculation, audit visibility, or manager review. Hard rule (verbatim): *"Protected strategic account status suspends automated ownership decay but does not suppress contact-health calculation, audit visibility, or manager review."* Override record requires: `account_id`, `reason`, `start_date`, `review_date`, `approving_authority`, `expiry_behavior`. Operational rules: visible, auditable, expires without renewal, does not erase calculation, never silent, not self-applied, bounded (default max 180 days per override).

**Enforcement phases** (from merge §6.5):
- **Phase 0 P0.6**: decay-threshold-proximity + retroactive-activity + protected-account-gaming probes land in the honesty-probe set (Day 10).
- **Phase 2 Slice 2.X (new)**: `qrm-meaningful-contact` nightly function + `qrm_account_meaningful_contact_daily` rollup table.
- **Phase 3 Slice 3.3 (Account Command Center)**: decay automation + override workflow (create/renew/expire).
- **Phase 3 Slice 3.30 (Rep Reality Reflection)**: rep sees only "meaningful contact in last 30d: yes/no" per account; protected status visible as a chip.

**Owner sign-off checklist** (from merge §6.6):
- [ ] Weights table in §6.1 approved or adjusted
- [ ] Exclusions in §6.2 approved or adjusted
- [ ] Anti-gaming guardrails in §6.3 approved (especially 24-hour decay-proximity audit)
- [ ] Weights adjustable per workspace — yes/no (proposed: yes, within owner-set bounds)
- [ ] Protected strategic account override policy approved, including:
  - [ ] Who can authorize overrides (owner only / managers too / both)
  - [ ] Default maximum override duration (proposed: 180 days)
  - [ ] Disproportionate protection ratio threshold (proposed: 20% of rep's book)
  - [ ] Override reason format (fixed enum / free text / both)
  - [ ] Rep can request protection on own accounts (proposed: yes)
  - [ ] Expired-override behavior (auto-decay immediately / 14-day grace period)

**Trigger**: Phase 2 Slice 2.X calculation-engine PR — owner sign-off on the checklist above must land inside that PR description, not after.

### Q5 — Mobile Field Command in Phase 3 — native or web?
**Status**: DEFERRED to Phase 3 Slice 3.6 planning.
**Default inclination**: Web PWA in-repo. Native wrapper is a separate decision that doesn't belong inside the dependency-ordered roadmap. If Phase 3 data (after Branch/Territory Command Centers ship) reveals a specific native requirement the PWA can't satisfy, the decision gets reopened at Slice 3.6 planning time.
**Trigger**: Phase 3 Slice 3.6 opens.

### Q6 — Ethical review for Phase 5 slices (Rep Mythology, Body of Operator, Shadow Org Chart)
**Status**: DEFERRED to Phase 4 exit gate (calendar hold only).
**Resolution**: Calendar hold the review slot for Phase 4 exit. No ethics content drafted now — it would be premature. Name the process owner at Phase 4 exit; draft the actual process design at Phase 4 exit after Phase 4 data reveals what ethics concerns are concrete vs. hypothetical.
**Trigger**: Phase 4 exit audit. Also: before any Phase 5 slice opens (5.5, 5.9, 5.12), the ethics review must have a named owner AND a documented process — both can land in the same artifact at Phase 4 exit.

### Conflict 1 — ADD-030 rep scoring (from merge §5)
**Status**: RESOLVED-TENTATIVE 2026-04-08 (JIT governance).
**Resolution**: **Option B** — manager-only quality-weighted score + private rep reflection in Slice 3.30, with the permanent prohibition on raw counts as a primary KPI. Final binding decision deferred to Phase 3 Slice 3.30 planning where the implementation details (private vs. manager visibility, formula versioning, kill criterion wiring) get designed.
**Trigger**: Phase 3 Slice 3.30 opens.

### Conflict 2 — ADD-038 parallel top-level roadmap layer (from merge §5)
**Status**: RESOLVED 2026-04-08.
**Resolution**: **Option A** — reject the top-level-layer framing entirely. The addendum is decomposed into slices via the merge document and spliced into Phase 2/3/4. Main roadmap structure is unchanged. No parallel track exists.
**Trigger**: None — closed.

---

## 16. What this document is not

- **It is not a capacity plan.** It does not say how many engineers, designers, ML, infra, or ops. That artifact has to exist separately and anchor "the next two weeks" to real throughput. Until it does, "Week 1" and "Week 2" are nominal.
- **It is not a contract with ownership.** It is a technical roadmap. The business tradeoffs — which phase to accelerate, which to defer, which to kill — belong to ownership, not to this file.
- **It is not immutable.** Every phase ends with an exit audit. Exit audits change the roadmap. When they do, this file gets updated in the same PR as the exit report.

---

## 17. Where to start tomorrow morning

Open this file. Go to §14 Day 1. Do exactly what it says. When the exit gate is green, move to Day 2. Do not skip ahead. Do not reorder days. The dependencies are load-bearing.

When we finish Day 14, the Phase 0 substrate is in place, Slice 1 is clean against real contracts, and Slice 2.1 (Revenue Reality Board) is live. That is the "next two weeks."

After that, we open Week 3 against the same pattern: the next slice, day by day, until Phase 2 cutover is complete. Then Phase 3, then Phase 4, then Phase 5.

This is the roadmap.
