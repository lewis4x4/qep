# QRM Cross-Department Addendum — Conflict-Marked Merge

## Context

The user produced an addendum ([QRM_Cross_Department_Signals_Alerts_Opportunity_Engine_Addendum.md](../QRM_Cross_Department_Signals_Alerts_Opportunity_Engine_Addendum.md)) that extends QRM from a sales command center into a cross-department event/alert/routing/drafting platform covering Sales, Rental, Service, Parts, and Management. The addendum proposes a new top-level roadmap layer (Phase Add-A/B/C).

The user's own analysis is that accepting the addendum as a parallel top-level layer would directly violate the reason Phase 0 exists in [plans/2026-04-08-qrm-moonshot-exhaustive-roadmap.md](./2026-04-08-qrm-moonshot-exhaustive-roadmap.md) — it would rebuild existing modules, create a second orchestration architecture beside the Flow Engine, ship AI ranking before the honesty/trace contracts are live, and outrun the role-blend data model. The correct path is to decompose the addendum into slices and splice them into the existing Phase 2/3/4, honoring seven hard constraints.

The seven rules (non-negotiable):
1. **No rebuilds** of existing modules (follow-up engine, deposits, voice-to-QRM, trade valuation, pipeline enforcer, quote-builder-v2).
2. **No second orchestration** beside the Phase 0 P0.4 Flow Engine.
3. **No parallel top-level roadmap** — addendum items splice into Phase 2/3/4.
4. **No rep-facing gamified activity score** in first wave; manager-only, quality-weighted.
5. **No faux-automations** — honor always-render/live-degraded-unavailable for unconnected data.
6. **Nothing that assumes exclusive roles** until P0.5 Role Blend ships.
7. **Nothing that AI-ranks deals** until P0.3 Prediction Ledger and P0.8 Trace are live.

## Deliverable

This document is the conflict-marked merge. It sits beside [the main roadmap](./2026-04-08-qrm-moonshot-exhaustive-roadmap.md) as a decision layer, not a redesign. The main roadmap file is NOT modified by this merge — only §6 governance is lifted into the main roadmap's §15 Open Question #4 when the owner signs off.

Six sections follow: (§1) Intake ledger, (§2) Classification table, (§3) Proposed splice list, (§4) Duplicate integration map, (§5) Conflict log, (§6) Meaningful contact governance.

---

## §1 — Intake ledger

Every addendum item, verbatim where possible, with a stable id. Source = section of the addendum the item came from.

| ID | Source | Verbatim item |
|---|---|---|
| ADD-001 | §3.1 | lead assignment by territory |
| ADD-002 | §3.1 | lead assignment by product line |
| ADD-003 | §3.1 | quote follow-up cadence |
| ADD-004 | §3.1 | no-activity alerts on open deals |
| ADD-005 | §3.1 | trade appraisal intake |
| ADD-006 | §3.1 | machine recommendation drafts |
| ADD-007 | §3.1 | lead-form-to-drafted-opportunity workflow |
| ADD-008 | §3.1 | call summarization into next steps |
| ADD-009 | §3.1 | auto-generated follow-up sequences after a quote |
| ADD-010 | §3.2 | overdue off-rent follow-up |
| ADD-011 | §3.2 | utilization alerts (over-utilized / under-utilized / idle-unit risk) |
| ADD-012 | §3.2 | rent-to-purchase conversion prompts |
| ADD-013 | §3.2 | damaged machine intake workflow |
| ADD-014 | §3.2 | rental fallback when sales deal stalls but equipment need is immediate |
| ADD-015 | §3.3 | PM due alerts |
| ADD-016 | §3.3 | customer update texts |
| ADD-017 | §3.3 | technician-note summarization into customer-facing updates |
| ADD-018 | §3.3 | parts-needed approval messages |
| ADD-019 | §3.3 | warranty pre-check |
| ADD-020 | §3.3 | service complaint classification and routing |
| ADD-021 | §3.3 | service-to-sales opportunity alerts |
| ADD-022 | §3.4 | special-order status updates |
| ADD-023 | §3.4 | backorder alerts |
| ADD-024 | §3.4 | customer reorder reminders |
| ADD-025 | §3.4 | cross-sell based on machine model |
| ADD-026 | §3.4 | scanning inbound emails for parts requests and creating drafts |
| ADD-027 | §3.5 | margin leakage alerts |
| ADD-028 | §3.5 | slow-moving inventory alerts |
| ADD-029 | §3.5 | stale used inventory alerts |
| ADD-030 | §3.5 | salesperson daily activity scoring |
| ADD-031 | §4.1 | replacement propensity score (from age, hours, repair spend, rental usage, PM, parts, complaints, trade, quote, demo, category, seasonality, financing) |
| ADD-032 | §4.1 | conversion path recommendation (replace / upgrade / rental fallback / rent-to-purchase / hold-nurture) |
| ADD-033 | §6 | canonical event object model (event_id, event_type, source_module, customer_id, company_id, equipment_id, deal_id, severity, commercial_relevance, suggested_owner, required_action, recommended_deadline, draft_message, escalation_rule, status, created_at) + event types catalog |
| ADD-034 | §7.1 | Dealership Signals Hub — cross-functional signals page with severity / owner / department / unresolved / escalated filters |
| ADD-035 | §7.2 | Department Alert Queues — Sales, Rental, Service, Parts, Management queues |
| ADD-036 | §7.3 | Drafts & Communications Center — review/approve/edit/send/audit customer texts, emails, quote follow-ups, backorder updates, service updates, parts approval requests |
| ADD-037 | §7.4 | Opportunity Conversion Panel — embedded in customer/account/deal views; service-to-sales, rent-to-purchase, replacement, rental fallback, cross-sell signals |
| ADD-038 | §2 + §8 | "Add this as a new top-level roadmap layer" / "Phase Add-A / Add-B / Add-C sequencing" |

**Total**: 38 items intake.

Addendum sections that are cross-cutting constraints rather than discrete items (§5 voice-first extension rule, §9 non-negotiable design rules, §10 acceptance gate, §11 builder instruction) are handled inline inside §3's splice list — they are rules the splice honors, not work items.

---

## §2 — Classification table

One row per ADD. Primary classification (one of: `ALREADY BUILT`, `ALREADY PLANNED`, `NEW — BLOCKED BY P0`, `NEW — PHASE 2`, `NEW — PHASE 3`, `NEW — PHASE 4`, `NEW — PHASE 5`, `CONFLICT`, `DEFER`) plus secondary tags from the seven rules.

| ID | Primary | Secondary tags | Notes |
|---|---|---|---|
| ADD-001 | NEW — PHASE 2 | BLOCKED BY P0.5, MUST PUBLISH TO FLOW ENGINE | Territory assignment rules; territories exist as data but automated lead-→-rep assignment does not. Paired with ADD-002 + ADD-007. |
| ADD-002 | NEW — PHASE 2 | BLOCKED BY P0.5 | Needs new `product_line` field; paired with ADD-001. |
| ADD-003 | ALREADY BUILT | DUPLICATE — integrate | Covered by existing `follow-up-engine` + `follow_up_cadences` / `sequence_enrollments`. Hook via P0.4 Flow Engine Day 7 refactor. |
| ADD-004 | ALREADY BUILT | DUPLICATE — integrate, MUST PUBLISH TO FLOW ENGINE | Covered by existing `anomaly-scan` (7d/14d stalling-deal detection) + deal-timing-scan. Publish existing outputs to the bus. |
| ADD-005 | ALREADY PLANNED | — | Phase 3 Slice 3.8 (Trade Walkaround Workflow). Confirm intake modal absorbs the addendum's intake event. |
| ADD-006a | NEW — PHASE 2 | MUST PUBLISH TO FLOW ENGINE | **Deterministic** machine recommendation draft — rules/catalog-based only, no AI ranking, no predictive scoring, transparent rationale. Runs from product line, machine class, known need, form inputs, and deterministic mapping. Must be clearly labeled rules-based; must not claim optimization; does NOT block on Prediction Ledger. See §3 Slice 2.X-MR. |
| ADD-006b | NEW — PHASE 4 | WRITES TO PREDICTION LEDGER | **AI-ranked** machine recommendation draft — ranked, personalized, predictive, strategy-aware. Uses customer operating profile (Slice 4.2), account context, learned signals. Requires P0.3 + P0.8. Must render confidence and rationale; must be traceable. See §3 Slice 4.4a. |
| ADD-007 | NEW — PHASE 2 | BLOCKED BY P0.4, BLOCKED BY P0.5 | Lead-form → drafted opportunity. Publishes `lead_submitted` on Flow Engine; assignment uses role-blend. |
| ADD-008 | ALREADY BUILT | DUPLICATE — integrate | `voice-to-qrm` function + `voice_captures.extracted_data` already performs this. Surface existing next-step output in the recommendation card rationale. |
| ADD-009 | ALREADY BUILT | DUPLICATE — integrate | Same engine as ADD-003. Triggered by `quote_sent` Flow Engine event. |
| ADD-010 | NEW — PHASE 3 | MUST PUBLISH TO FLOW ENGINE | Splice into Rental Command Center (Slice 3.14). |
| ADD-011 | NEW — PHASE 3 | MUST PUBLISH TO FLOW ENGINE, DEGRADE IF UNCONNECTED | Utilization thresholds depend on telematics/rental-hours data. |
| ADD-012 | ALREADY PLANNED | WRITES TO PREDICTION LEDGER | Phase 4 Slice 4.6 (Rental Conversion Engine, IDEA-039 Contrarian Bet #1). |
| ADD-013 | NEW — PHASE 3 | MUST PUBLISH TO FLOW ENGINE | Splice into Slice 3.20 (Exception-handling surfaces). |
| ADD-014 | NEW — PHASE 3 | MUST PUBLISH TO FLOW ENGINE, WRITES TO PREDICTION LEDGER | Depends on Rental Command Center (3.14) + Flow Engine; rental-fallback recommendation is a ranked output. |
| ADD-015 | NEW — PHASE 3 | DEGRADE IF UNCONNECTED, MUST PUBLISH TO FLOW ENGINE | PM data source may not be cleanly ingestible; tile ships as `status='unavailable'` if not. |
| ADD-016 | NEW — PHASE 3 | BLOCKED BY P0.5, DEGRADE IF UNCONNECTED | Part of Drafts & Communications Center (ADD-036). |
| ADD-017 | NEW — PHASE 3 | WRITES TO PREDICTION LEDGER, DEGRADE IF UNCONNECTED | AI summarization output — must be traced. |
| ADD-018a | NEW — PHASE 2 | MUST PUBLISH TO FLOW ENGINE | **Minimal** parts-needed approval messages — approval event + visible owner + visible reason + visible next action + basic templated outbound message + audit trail. No generalized communication workbench. Splice into Approval Center (Slice 2.4a). Phase 2 does NOT wait on Phase 3. |
| ADD-018b | NEW — PHASE 3 | MUST PUBLISH TO FLOW ENGINE, WRITES TO PREDICTION LEDGER | **Full** parts-needed approval messages — edit/approve/review/audit workflow + reusable draft handling + broader multi-channel management. Splice into Drafts & Communications Center (Slice 3.33). |
| ADD-019 | NEW — PHASE 3 | DEGRADE IF UNCONNECTED | Warranty eligibility check requires warranty-master data connected. |
| ADD-020 | NEW — PHASE 3 | BLOCKED BY P0.4, BLOCKED BY P0.5, DEGRADE IF UNCONNECTED | Routing depends on Flow Engine + role-blend. Classifier is AI-ranked → WRITES TO PREDICTION LEDGER. |
| ADD-021 | ALREADY PLANNED | MUST PUBLISH TO FLOW ENGINE | Phase 3 Slice 3.15 (Service-to-Sales). Confirm slice absorbs signal publication. |
| ADD-022 | NEW — PHASE 3 | DEGRADE IF UNCONNECTED, MUST PUBLISH TO FLOW ENGINE | Splice into Parts Intelligence (Slice 3.16) as a sub-slice with a degraded tile if data source is absent. |
| ADD-023 | NEW — PHASE 3 | DEGRADE IF UNCONNECTED, MUST PUBLISH TO FLOW ENGINE | Same parent as ADD-022. |
| ADD-024 | NEW — PHASE 3 | — | Splice into Slice 3.16 (Parts Intelligence). |
| ADD-025 | NEW — PHASE 4 | WRITES TO PREDICTION LEDGER | AI-ranked cross-sell — earliest Phase 4. |
| ADD-026 | NEW — PHASE 3 | DEGRADE IF UNCONNECTED, WRITES TO PREDICTION LEDGER, CONFIDENCE-GATED DRAFTS | Inbound email ingestion is a hard prerequisite. If not connected, ship as `unavailable` tile. **Drafts may only be created when thread resolution, sender resolution, and account-match confidence all pass threshold.** Sub-threshold events route to a human review queue; no auto-bind to account. See Slice 3.16d in §3. |
| ADD-027 | NEW — PHASE 2 | MUST PUBLISH TO FLOW ENGINE | Splice into Revenue Reality Board (Slice 2.1) + Approval Center (2.4). |
| ADD-028 | ALREADY PLANNED | — | Phase 3 Slice 3.11 (Inventory Pressure Board). |
| ADD-029 | ALREADY PLANNED | — | Phase 3 Slice 3.11 — used inventory is a facet of the same board. |
| ADD-030 | **CONFLICT** | MANAGER-ONLY FIRST, BLOCKED BY P0.5, BLOCKED BY P0.6 | Violates Rule 4. See §5. |
| ADD-031 | ALREADY PLANNED | WRITES TO PREDICTION LEDGER | Phase 4 Slice 4.13 (Replacement Prediction). Addendum's factor list expands the slice's input set — splice as sub-bullet. |
| ADD-032 | NEW — PHASE 4 | WRITES TO PREDICTION LEDGER | New composite recommendation engine on top of ADD-031, IDEA-039, IDEA-054. |
| ADD-033 | ALREADY PLANNED | DUPLICATE — integrate | Phase 0 P0.4 Flow Engine is the canonical event model. Addendum's proposed field list must be absorbed into the P0.4 schema (see §4). |
| ADD-034 | NEW — PHASE 3 | BLOCKED BY P0.4, BLOCKED BY P0.5 | New Phase 3 slice 3.31 — Dealership Signals Hub. |
| ADD-035 | NEW — PHASE 3 | BLOCKED BY P0.4, BLOCKED BY P0.5 | New Phase 3 slice 3.32 — 5 department queues. |
| ADD-036 | NEW — PHASE 3 | BLOCKED BY P0.4, WRITES TO PREDICTION LEDGER | New Phase 3 slice 3.33 — Drafts & Communications Center. |
| ADD-037 | NEW — PHASE 4 | WRITES TO PREDICTION LEDGER | New Phase 4 slice 4.26 — embedded in Account Command Center (3.3). |
| ADD-038 | **CONFLICT** | — | Violates Rule 3. See §5. |

**Totals after edits**: 5 `ALREADY BUILT`, 6 `ALREADY PLANNED`, 0 `NEW — BLOCKED BY P0` (ADD-006 split into 006a/006b), 7 `NEW — PHASE 2` (ADD-006a and ADD-018a added), 13 `NEW — PHASE 3` (ADD-018b added, 018 removed as single-classification), 4 `NEW — PHASE 4` (ADD-006b added), 0 `NEW — PHASE 5`, 2 `CONFLICT`, 0 `DEFER`. Total: **40 classified rows** (38 original addendum items; ADD-006 and ADD-018 each produce 2 classified rows to enforce the two-stage split).

---

## §3 — Proposed splice list

One row per `NEW — PHASE N` item. Tables + bullets only.

### Phase 2 insertions

**Slice 2.1a — Margin Leak Alerts** (ADD-027)
- **Insert**: between Slice 2.1 (Revenue Reality Board) and 2.2 (Dealer Reality Grid).
- **One-sentence statement**: Flow-Engine-published alerts when a deal's margin drops below workspace thresholds at any stage, rendered as a band on the Revenue Reality Board and an entry in the Approval Center queue.
- **Dependencies**: P0.4 Flow Engine; Slice 2.1 Revenue Reality Board; Slice 2.4 Approval Center (parallel).
- **Fragility note**: Margin-leak alerts fire on deals reps haven't priced yet (draft quotes with placeholder margins). Must gate on `quote.status != 'draft'` or the alert becomes noise within a week.
- **Rules honored**: MUST PUBLISH TO FLOW ENGINE.

**Slice 2.2a — Dealer Reality Grid: Parts Approval tile + Parts Backorder tile** (ADD-018a partial, ADD-023)
- **Insert**: as additional tiles inside Slice 2.2 (Dealer Reality Grid).
- **One-sentence statement**: Two tiles (Parts Approval queue count; Parts Backorder count) surfaced on the grid, both degraded if parts-data integration is not connected.
- **Dependencies**: P0.4 Flow Engine; parts data source connected (or `status='unavailable'`).
- **Fragility note**: Parts backorder data freshness varies by ERP integration. Must stamp per-tile freshness per the §4 per-section freshness contract, not a single grid-wide freshness.
- **Rules honored**: DEGRADE IF UNCONNECTED, MUST PUBLISH TO FLOW ENGINE.

**Slice 2.4a — Parts-Needed Approval Messages (MINIMAL)** (ADD-018a)
- **Insert**: sub-slice of Slice 2.4 (Approval Center).
- **One-sentence statement**: Parts-needed approvals appear in the Approval Center queue with visible owner, visible reason, visible next action, a one-click approve/deny, a basic templated outbound message, and an audit trail — no generalized communication workbench.
- **Dependencies**: Slice 2.4 Approval Center. **Does NOT wait on Slice 3.33.**
- **Explicit staging rule (verbatim)**:
  > **ADD-018 ships in two stages: a minimal Approval Center implementation in Phase 2, and a full Drafts & Communications Center implementation in Phase 3. Phase 2 does not wait on Phase 3.**
- **Scope of minimal version**:
  - Approval event created + visible inside the Approval Center.
  - Owner named (via P0.5 role-blend).
  - Reason + next action fields required.
  - A basic templated outbound message (single template per event type, no edit workbench — edit is Phase 3).
  - Audit trail via Flow Engine `parts_approval_decided` event.
  - No multi-channel routing, no reusable draft handling, no review/approve/audit workflow beyond approve/deny.
- **What Phase 3 adds (Slice 3.33 — ADD-018b)**: full edit/approve/review/audit workflow, reusable draft handling, multi-channel communications management, broader draft workbench.
- **Fragility note**: The minimal template must be obviously a template so reps don't treat it as a polished draft. Label it "template" and show the variables inline.
- **Rules honored**: MUST PUBLISH TO FLOW ENGINE.

**Slice 2.10 — Lead-Form-to-Drafted-Opportunity** (ADD-001, ADD-002, ADD-007)
- **Insert**: as new Slice 2.10, after the Phase 2 cutover (Slice 2.9) — this is net-new work that should NOT delay the cutover.
- **One-sentence statement**: Incoming lead form submissions publish a `lead_submitted` Flow Engine event, auto-match or create company/contact, auto-assign by territory + product line (using role-blend), create a drafted opportunity, and queue an initial outreach draft.
- **Dependencies**: P0.4 Flow Engine; P0.5 Role Blend; Phase 2 cutover complete.
- **Fragility note**: Auto-assignment mis-routes to reps on PTO. Role-blend from P0.5 must consider `effective_from`/`effective_to` windows, not just the current blend snapshot.
- **Rules honored**: BLOCKED BY P0.5, MUST PUBLISH TO FLOW ENGINE.

**Slice 2.11 (Slice 2.X-MR) — Deterministic Machine Recommendation Draft** (ADD-006a)
- **Insert**: new Slice 2.11, positioned after Slice 2.10 Lead-Form-to-Drafted-Opportunity.
- **One-sentence statement**: A rules/catalog-based machine recommendation draft generator that runs from product line, machine class, known need, form inputs, and a deterministic mapping — with transparent rationale and no AI ranking.
- **Dependencies**: Slice 2.10 Lead-Form-to-Drafted-Opportunity; P0.4 Flow Engine.
- **Explicit scope**:
  - **Rules/catalog-based only.** No AI ranking. No predictive scoring. No learned signals.
  - **Transparent rationale.** Every recommendation shows the deterministic mapping that produced it ("Lead indicated backhoe, property size 5–15 acres → catalog maps to category X, units {A, B, C}").
  - **Inputs**: product line, machine class, explicit need statement, form fields, inventory-available filter.
  - **Labeled `rules-based`** on every surfaced draft. Must NOT claim to be "optimized" or "personalized" or "strategy-aware."
  - **Publishes** `machine_recommendation_drafted` to Flow Engine as a normal event.
- **Does NOT require**:
  - P0.3 Prediction Ledger — no AI ranking means no ledger write. The ledger write requirement only applies to AI-ranked outputs (per Rule 7).
  - P0.8 Trace — the deterministic mapping is self-documenting.
  - Slice 4.2 Customer Operating Profile — that's a Phase 4 dependency for the AI-ranked version only.
- **Fragility note**: A deterministic recommendation that's obviously wrong (customer asked for a backhoe, got an excavator) erodes trust faster than a silent gap. The catalog mapping must ship with a monthly manual audit against recent lost deals to catch category drift.
- **Rules honored**: MUST PUBLISH TO FLOW ENGINE. Deliberately NOT WRITES TO PREDICTION LEDGER (no AI ranking).

### Phase 3 insertions

**Slice 3.14a — Off-Rent Overdue Follow-Up** (ADD-010)
- **Insert**: sub-slice of Slice 3.14 (Rental Command Center).
- **Dependencies**: Slice 3.14; P0.4 Flow Engine.
- **Fragility note**: Off-rent-overdue is only meaningful if the customer's expected return date is accurate. If the rental system's expected-return is stale, alerts collapse to noise. Needs a "return-date last confirmed" timestamp on every active rental.
- **Rules honored**: MUST PUBLISH TO FLOW ENGINE.

**Slice 3.14b — Utilization Alerts** (ADD-011)
- **Insert**: sub-slice of Slice 3.14.
- **Dependencies**: Slice 3.14; telematics or rental-hours data source.
- **Fragility note**: Utilization thresholds vary by equipment class. A bulldozer at 4 hours/day is high; a scissor lift at 4 hours/day is idle. Must carry per-category thresholds from day one.
- **Rules honored**: DEGRADE IF UNCONNECTED, MUST PUBLISH TO FLOW ENGINE.

**Slice 3.14c — Rental Fallback Prompt** (ADD-014)
- **Insert**: sub-slice of Slice 3.14; cross-wired to Slice 3.18 (Deal Room).
- **Dependencies**: Slice 3.14; P0.3 Prediction Ledger; P0.4 Flow Engine.
- **Fragility note**: Offering rental as a fallback on a stalled sales deal competes with the rep's commission structure. Must not auto-suggest to the customer — only to the rep, and only with a clear opt-in pattern.
- **Rules honored**: WRITES TO PREDICTION LEDGER, MUST PUBLISH TO FLOW ENGINE.

**Slice 3.15a — PM Due Alerts** (ADD-015)
- **Insert**: sub-slice of Slice 3.15 (Service-to-Sales).
- **Dependencies**: Service data connected; P0.4 Flow Engine.
- **Fragility note**: PM cadence data is frequently out of date or attached to the wrong hour meter. Ship as a degraded tile with a per-customer confidence chip.
- **Rules honored**: DEGRADE IF UNCONNECTED, MUST PUBLISH TO FLOW ENGINE.

**Slice 3.15b — Warranty Pre-Check** (ADD-019)
- **Insert**: sub-slice of Slice 3.15.
- **Dependencies**: warranty-master data connected.
- **Fragility note**: A false-positive warranty pre-check is worse than no pre-check — it commits the dealership to a conversation with the customer that warranty may not actually cover. Must ship with an explicit "pending final review" disclaimer embedded in any customer-facing output.
- **Rules honored**: DEGRADE IF UNCONNECTED.

**Slice 3.15c — Service Complaint Classification & Routing** (ADD-020)
- **Insert**: sub-slice of Slice 3.15.
- **Dependencies**: P0.4 Flow Engine; P0.5 Role Blend; P0.3 Prediction Ledger.
- **Fragility note**: Classifier mis-routes a hydraulic complaint to the electrical tech for the first 90 days until training data accumulates. The fallback must always be "route to the service writer" — never "drop on the floor."
- **Rules honored**: WRITES TO PREDICTION LEDGER, BLOCKED BY P0.5, BLOCKED BY P0.4, DEGRADE IF UNCONNECTED.

**Slice 3.15d — Tech-Note → Customer-Safe Summary** (ADD-017)
- **Insert**: sub-slice of Slice 3.15; also feeds Slice 3.33 (Drafts & Communications Center).
- **Dependencies**: P0.3 Prediction Ledger; P0.8 Trace.
- **Fragility note**: A single mistranslation ("cracked frame" → "minor wear") is a lawsuit. Every auto-summary must be human-approved before send; the slice must not include an auto-send path.
- **Rules honored**: WRITES TO PREDICTION LEDGER, DEGRADE IF UNCONNECTED.

**Slice 3.15e — Customer Update Texts** (ADD-016)
- **Insert**: sub-slice of Slice 3.33 (Drafts & Communications Center); surfaced from Slice 3.15.
- **Dependencies**: Slice 3.33; P0.5.
- **Fragility note**: See ADD-017 — auto-send is forbidden without explicit policy.
- **Rules honored**: BLOCKED BY P0.5, DEGRADE IF UNCONNECTED.

**Slice 3.16a — Parts Special-Order Status Updates** (ADD-022)
- **Insert**: sub-slice of Slice 3.16 (Parts Intelligence).
- **Dependencies**: parts ERP integration; P0.4 Flow Engine.
- **Fragility note**: Part-status changes from the ERP arrive in batches hours apart. Customers do NOT want one update per batch — they want one update per meaningful state change. Debounce on status value, not timestamp.
- **Rules honored**: DEGRADE IF UNCONNECTED, MUST PUBLISH TO FLOW ENGINE.

**Slice 3.16b — Parts Backorder Alerts (full)** (ADD-023)
- **Insert**: sub-slice of Slice 3.16.
- **Dependencies**: parts ERP integration.
- **Fragility note**: Backorder alerts without an ETA are worse than no alert. Must be gated on the availability of an ETA field, even a soft one.
- **Rules honored**: DEGRADE IF UNCONNECTED, MUST PUBLISH TO FLOW ENGINE.

**Slice 3.16c — Customer Reorder Reminders** (ADD-024)
- **Insert**: sub-slice of Slice 3.16.
- **Dependencies**: Slice 3.16.
- **Fragility note**: Reorder cadence varies wildly by customer (fleet size, season, machine mix). A fixed threshold will look spammy to some and sparse to others. Must be per-customer, not per-SKU.
- **Rules honored**: — (none cross-rule).

**Slice 3.16d — Inbound Parts Email Parsing** (ADD-026)
- **Insert**: sub-slice of Slice 3.16.
- **Dependencies**: inbound email ingestion pipeline; P0.3 Prediction Ledger; P0.8 Trace.
- **Fragility note**: Email parsing that mis-identifies a customer creates a drafted response to the wrong account. A wrong-customer draft is a serious failure mode and cannot be treated as a normal "degraded" state.
- **Hard prerequisite (verbatim, non-negotiable)**:
  > **No customer-facing or account-bound draft may be auto-created from inbound email parsing unless sender resolution, thread resolution, and account-match confidence all pass threshold.**
- **Required prerequisites** — a draft may be created **only if ALL** of these are true:
  1. **Thread identity resolved** — the email thread is matched to an existing thread or is unambiguously a new thread with no collisions.
  2. **Sender identity resolved** — the sender's email address matches a known contact or a known domain with exactly one plausible contact.
  3. **Customer/account match confidence** meets threshold — a quantitative score above a workspace-configurable minimum (default ≥ 0.85).
  4. **Requested part or intent extraction confidence** meets threshold — parsing produced a specific SKU, part description, or intent above a workspace-configurable minimum (default ≥ 0.75).
  5. **Fallback route exists** for sub-threshold events (see below).
- **Required fallback behavior when any prerequisite fails**:
  - **Do NOT** create a customer-bound draft.
  - **Do NOT** auto-bind the email to any account.
  - **Route** the parsed email to a human review queue surfaced inside Slice 3.33 Drafts & Communications Center.
  - **Preserve** the extracted candidate matches as an ordered list for human confirmation (so the reviewer picks, not re-types).
  - **Log** the sub-threshold event with its confidence scores to the Prediction Ledger so calibration improvements can be measured.
- **Traceability**: every draft and every sub-threshold event writes to P0.3 Prediction Ledger with a trace id accessible via `/qrm/command/trace/:predictionId`.
- **Rules honored**: WRITES TO PREDICTION LEDGER, DEGRADE IF UNCONNECTED, CONFIDENCE-GATED DRAFTS.

**Slice 3.20a — Damaged Machine Intake Workflow** (ADD-013)
- **Insert**: sub-slice of Slice 3.20 (Exception-handling surfaces).
- **Dependencies**: Slice 3.20; P0.4 Flow Engine.
- **Fragility note**: Damage classification during intake is inherently subjective. Must require photos AND a second-opinion checkbox before the record is considered final.
- **Rules honored**: MUST PUBLISH TO FLOW ENGINE.

**Slice 3.31 — Dealership Signals Hub** (ADD-034)
- **Insert**: new slice, positioned after Slice 3.30 (Rep Reality Reflection).
- **One-sentence statement**: Single cross-functional page at `/qrm/signals` subscribing to the Flow Engine, with role-opinionated default filters applied on load.
- **Dependencies**: P0.4 Flow Engine; P0.5 Role Blend; all prior Phase 3 slices that publish signals.
- **Fragility note**: A Signals Hub that shows every signal becomes a second email inbox and gets ignored within a week.
- **Hard requirement (verbatim, non-negotiable)**:
  > **These surfaces must never open in a neutral or all-signals state. Each role must receive a role-opinionated default view with pre-applied filters, priority ordering, and queue framing. "Show all" may exist as an advanced action only.**
- **Minimum required default views**:
  - **Sales (iron_advisor)**: revenue-relevant unresolved items first (deal-no-activity, quote-idle, lead_submitted, service-to-sales opportunities).
  - **Rental**: off-rent overdue, utilization thresholds, damage intake, rent-to-purchase conversion signals first.
  - **Service**: routed complaints, PM due, parts-needed approvals, tech-note customer-safe summaries first.
  - **Parts**: parts order-state changes, backorder alerts, customer reorder prompts first.
  - **Management (iron_manager)**: escalated items, stalled deals, margin leakage, inventory aging, handoff-trust seam failures first.
- **"Show all" rule**: "Show all signals" must be an explicit advanced action requiring an extra click. It must never be the default landing state. The advanced action must be logged via `event-tracker.ts` so we can detect if reps start using it as a workaround.
- **Role-blend composition**: For users with a blended role (e.g., manager covering advisor), the default view is composed from BOTH role defaults weighted by P0.5 blend weights — not a third "neutral" view.
- **Rules honored**: BLOCKED BY P0.4, BLOCKED BY P0.5, ROLE-OPINIONATED DEFAULT.

**Slice 3.32 — Department Alert Queues** (ADD-035)
- **Insert**: new slice, immediately after 3.31.
- **One-sentence statement**: Five per-department queues (Sales, Rental, Service, Parts, Management) each rendered as a lane-style view over the Flow Engine event stream, each with the same role-opinionated default rule as Slice 3.31.
- **Dependencies**: P0.4; P0.5; Slice 3.31.
- **Fragility note**: "Management Queue" is meaningless without a named manager per signal. Must use P0.5 role-blend to resolve the actual current covering manager, not a static lookup.
- **Hard requirement (verbatim, non-negotiable — same rule as Slice 3.31)**:
  > **These surfaces must never open in a neutral or all-signals state. Each role must receive a role-opinionated default view with pre-applied filters, priority ordering, and queue framing. "Show all" may exist as an advanced action only.**
- **Per-queue defaults** (identical to Slice 3.31 minimum required defaults — Sales, Rental, Service, Parts, Management). Each queue opens with its own role default, not with the full workspace firehose.
- **Rules honored**: BLOCKED BY P0.4, BLOCKED BY P0.5, ROLE-OPINIONATED DEFAULT.

**Slice 3.33 — Drafts & Communications Center** (ADD-036, ADD-018b)
- **Insert**: new slice, immediately after 3.32.
- **One-sentence statement**: Review/approve/edit/send/audit surface for all AI-drafted customer texts, emails, quote follow-ups, backorder updates, service updates, and parts approval requests. Supersedes the minimal Phase 2 Slice 2.4a implementation of parts-needed approval messages with a full workbench.
- **Dependencies**: P0.3 Prediction Ledger; P0.4 Flow Engine; P0.8 Trace.
- **Fragility note**: Any auto-send pathway becomes the source of the first lawsuit within 18 months. This slice MUST ship without auto-send for any customer-facing channel; auto-send is a separate, later decision gated on explicit workspace policy and legal sign-off.
- **Rules honored**: WRITES TO PREDICTION LEDGER, BLOCKED BY P0.4.

### Phase 4 insertions

**Slice 4.6a — Rent-to-Purchase Fit (sub-signal of IDEA-039)** (covered by ADD-012)
- **Insert**: sub-slice inside existing Slice 4.6 (Rental Conversion Engine). No new slice needed.
- **Note**: addendum adds detail to an already-planned slice; see §4.

**Slice 4.13a — Replacement Propensity Factor Expansion** (ADD-031)
- **Insert**: sub-bullet inside existing Slice 4.13 (Replacement Prediction page).
- **Note**: the addendum expands the factor list beyond the slice's original design. Factor additions: PM history, repeat parts orders, service complaint patterns, trade-in behavior, quote stall behavior, demo history, machine category fit, seasonality, financing posture. Must all write to P0.3 Prediction Ledger.

**Slice 4.25a — Conversion Path Recommendation Engine** (ADD-032)
- **Insert**: new slice immediately after Slice 4.25 (Unmapped Territory Surface).
- **One-sentence statement**: Composite recommendation engine that takes the output of Slice 4.6 (Rental Conversion), Slice 4.13 (Replacement Prediction), and Slice 3.15 (Service-to-Sales) and produces a single recommended conversion path per customer: replace, upgrade, rental fallback, rent-to-purchase, or hold-nurture.
- **Dependencies**: Slices 4.6, 4.13, 3.15; P0.3 Prediction Ledger with 90+ days of data.
- **Fragility note**: A single composite recommendation can hide a disagreement between the three input signals. Must always render the three underlying recommendations alongside the composite so a rep can see which input dominated.
- **Rules honored**: WRITES TO PREDICTION LEDGER.

**Slice 4.25b — Machine Model Cross-Sell** (ADD-025)
- **Insert**: new slice after 4.25a.
- **One-sentence statement**: AI-ranked recommendation of related parts and attachments based on the customer's owned machine model, surfaced in the Parts Intelligence surface (Slice 3.16) and the Opportunity Conversion Panel (Slice 4.26).
- **Dependencies**: Slice 3.16; P0.3 Prediction Ledger.
- **Fragility note**: Cross-sell recommendations on machines the customer no longer owns are worse than no recommendation. Must be gated on `fleet_intelligence.status = active`.
- **Rules honored**: WRITES TO PREDICTION LEDGER.

**Slice 4.26 — Opportunity Conversion Panel** (ADD-037)
- **Insert**: new slice at the end of Phase 4 (after Slice 4.25b).
- **One-sentence statement**: Embedded panel on every account, deal, and customer view that renders the five conversion signals (service-to-sales, rent-to-purchase, replacement, rental fallback, cross-sell).
- **Dependencies**: Slices 3.3 (Account Command Center), 4.6, 4.13, 4.25a; P0.3; P0.8.
- **Fragility note**: Five panels ALL showing "no signals" on a quiet account becomes visual noise. Must collapse to a single "No active opportunity signals" line when all five are empty.
- **Rules honored**: WRITES TO PREDICTION LEDGER.

**Slice 4.4a — AI-Ranked Machine Recommendation Draft** (ADD-006b)
- **Insert**: sub-slice inside Slice 4.9 (AI Customer Strategist), surfaced from Slice 4.4 (Relationship Map) and the Opportunity Conversion Panel (Slice 4.26).
- **One-sentence statement**: Ranked, personalized, predictive machine recommendation that layers on top of the Phase 2 deterministic draft (Slice 2.11 / ADD-006a) using customer operating profile, account context, and learned signals from the Prediction Ledger.
- **Relationship to the Phase 2 deterministic version**: The Phase 2 Slice 2.11 deterministic draft is the baseline. Slice 4.4a does NOT replace it; it *re-ranks* it. When 4.4a ships, the deterministic draft remains the fallback and the confidence label shifts from "rules-based" to "rules-based + AI-ranked" on the same card.
- **Dependencies**: P0.3 Prediction Ledger (with ≥90 days of outcome data); P0.8 Trace; Slice 4.2 (Customer Operating Profile) populated for the account; Slice 2.11 (deterministic version) shipped; Slice 4.9 (AI Customer Strategist).
- **Hard requirements**:
  - Must render a confidence chip on every recommendation.
  - Must render rationale bullets sourced from the trace.
  - Must be traceable via `/qrm/command/trace/:predictionId`.
  - Must write every recommendation to the Prediction Ledger at issue time (inputs_hash + signals_hash).
  - Must NOT ship before P0.3 and P0.8 are live.
  - Must show the deterministic (Phase 2) recommendation alongside the AI-ranked one when they disagree, so the rep can see which input dominated.
- **Fragility note**: An AI-ranked recommendation shown before the customer's operating profile (Slice 4.2) is complete will default to the dealership's current inventory, not the customer's need. Must be gated on `customer_operating_profile.completeness >= 0.6` for the account. Below that threshold, the card falls back to the Phase 2 deterministic draft only.
- **Rules honored**: WRITES TO PREDICTION LEDGER.

---

## §4 — Duplicate integration map

One-liner per `ALREADY BUILT` or `ALREADY PLANNED` item. Where to hook.

- **ADD-003 — Quote follow-up cadence** → `ALREADY BUILT`. Integrates with [supabase/functions/follow-up-engine/index.ts](../supabase/functions/follow-up-engine/index.ts) + `follow_up_sequences` / `sequence_enrollments` / `follow_up_cadences` tables. Hook via the Phase 0 P0.4 Flow Engine Day 7 refactor — the follow-up engine becomes a publisher of `quote_followup_step_due` events rather than a direct inserter.
- **ADD-004 — No-activity alerts on open deals** → `ALREADY BUILT`. Integrates with [supabase/functions/anomaly-scan/index.ts](../supabase/functions/anomaly-scan/index.ts) (detects stalling deals at the 7d / 14d thresholds) + [supabase/functions/deal-timing-scan/index.ts](../supabase/functions/deal-timing-scan/index.ts). Hook via P0.4 Day 7 — both functions publish existing alerts to `flow_events` instead of inserting directly to `anomaly_alerts`.
- **ADD-005 — Trade appraisal intake** → `ALREADY PLANNED` (Phase 3 Slice 3.8 Trade Walkaround Workflow). Confirm slice acceptance criteria include the addendum's `trade_appraisal_requested_at` field and the intake event publishes a `trade_appraisal_requested` Flow Engine event.
- **ADD-008 — Call summarization into next steps** → `ALREADY BUILT`. Integrates with [supabase/functions/voice-to-qrm/index.ts](../supabase/functions/voice-to-qrm/index.ts) + `voice_captures.extracted_data` (fields: `follow_up_suggestions[]`, `qrm_narrative`). Surface the existing next-step output in the Slice 1 recommendation card rationale via the P0.2 signal bridge.
- **ADD-009 — Auto-generated follow-up sequences after quote** → `ALREADY BUILT`. Same engine as ADD-003. Add a Flow Engine subscription: on `quote_sent`, the follow-up engine creates a new `sequence_enrollment` against the cadence for quote-sent.
- **ADD-012 — Rent-to-purchase conversion prompts** → `ALREADY PLANNED` (Phase 4 Slice 4.6 Rental Conversion Engine, IDEA-039 Contrarian Bet #1). The addendum's `rent_to_purchase_score` becomes an output of that slice's ranker.
- **ADD-021 — Service-to-sales opportunity alerts** → `ALREADY PLANNED` (Phase 3 Slice 3.15 Service-to-Sales). Confirm the slice publishes a `service_to_sales_opportunity_detected` Flow Engine event. Also: the addendum's `repair_spend_rolling_12m` field must be added to the slice's data model — splice as sub-bullet.
- **ADD-028 / ADD-029 — Slow-moving + stale used inventory alerts** → `ALREADY PLANNED` (Phase 3 Slice 3.11 Inventory Pressure Board). Addendum adds the explicit new/used separation — splice as sub-bullet on the slice acceptance criteria.
- **ADD-031 — Replacement propensity score** → `ALREADY PLANNED` (Phase 4 Slice 4.13 Replacement Prediction page). Addendum expands the factor list — handled in Slice 4.13a splice above.
- **ADD-033 — Canonical event object model** → `ALREADY PLANNED` (Phase 0 P0.4 Flow Engine). Addendum proposes these fields: `event_id, event_type, source_module, source_record_id, customer_id, company_id, equipment_id, deal_id, severity, commercial_relevance, suggested_owner, required_action, recommended_deadline, draft_message, escalation_rule, status, created_at`. The P0.4 migration `209_flow_events.sql` must be updated BEFORE the migration is written so these fields land in the initial schema rather than requiring a follow-up migration. **This is the only place the merge requires a change to a Phase 0 file — and it's a proactive addition, not a rework.**

**Cross-references introduced by the edits** (not duplicates — cross-links between the two-stage splits):

- **ADD-006a ↔ ADD-006b** → Phase 2 deterministic recommendation (Slice 2.11) is the baseline; Phase 4 AI-ranked recommendation (Slice 4.4a) re-ranks it. Both are surfaced; the AI version never fully replaces the deterministic one. See §3 Slice 2.11 and Slice 4.4a.
- **ADD-018a ↔ ADD-018b** → Phase 2 minimal parts approval (Slice 2.4a) ships independently; Phase 3 full Drafts & Communications Center (Slice 3.33) supersedes the minimal template with the full workbench. Phase 2 does not wait on Phase 3. See §3 Slice 2.4a and Slice 3.33.

---

## §5 — Conflict log

Two items cannot be silently resolved. Both need user sign-off.

### Conflict 1 — ADD-030 — Salesperson daily activity scoring

**STATUS: RESOLVED-TENTATIVE 2026-04-08 — Option B accepted in principle; final binding decision at Phase 3 Slice 3.30 planning.**
> Option B (manager-only quality-weighted score + private rep reflection in Slice 3.30) is accepted as the governing direction, along with the permanent prohibition on raw counts as a primary surfaced KPI (the verbatim prohibition below is binding and carries forward to every future slice touching rep scoring). The final implementation details — exact formula, private-vs-manager visibility wiring, formula-versioning UX, kill-criterion rollback plumbing — are designed at Phase 3 Slice 3.30 planning when the rep reflection surface is being built. No Phase 2 or earlier slice may ship a rep-facing activity score of any kind until Slice 3.30 lands.

**Verbatim**: "salesperson daily activity scoring" (§3.5) + "rep daily activity score" + "rep daily quality score" (§3.5 data additions).

**Conflicts with**:
- Rule 4 (no rep-facing gamified daily activity scoring in first wave).
- Main roadmap §7 Phase 3 Slice 3.30 — Rep Reality Reflection (NEW-RES-062): explicitly private, rep-owned mirror, never visible to managers. The addendum's item goes the opposite direction.
- Main roadmap §6 Phase 2 Slice 2.7 — Absence Engine (NEW-RES-064): explicitly *manager-only*, never shown to the rep directly. The addendum's item proposes a dual-visibility score.
- Fragility audit on IDEA-042 in the main roadmap (Customer Health Score): "Goodhart's Law... the moment the score is visible to reps, they will avoid hard accounts to protect their scoreboard." Same dynamic applies to rep activity scoring.

**Why it cannot be silently resolved**: The addendum's "rep_daily_quality_score" is almost exactly the right idea, but pairing it with a raw "rep_daily_activity_score" and exposing both creates the exact anti-pattern the main roadmap's fragility audit was written to prevent. Shipping both as rep-facing would train the team to perform activity instead of sell.

**Resolution options**:

| Option | Trade-off |
|---|---|
| **A** — Ship manager-only, quality-weighted score in Phase 3 as a sub-slice of Slice 3.30. No raw count visible anywhere. | Honors all seven rules. Loses the addendum's implicit "reps can see their own number." |
| **B** — Ship manager-only in Phase 3; expose the rep's own score privately in Slice 3.30's Rep Reality Reflection mirror (not comparable to peers, not visible to manager). | Honors Rule 4 if the private mirror cannot be aggregated across reps. Adds complexity: the same score computed two ways (absolute for manager, self-relative for rep). |
| **C** — Defer entirely until Phase 4 once Prediction Ledger has 90+ days of outcome data; score becomes "quality of activity as measured by deal outcomes" rather than "quantity of activity today." | Honors all rules with the strongest anti-gaming guarantee. Loses speed — addendum wants this in Phase 2/3. |

**Recommendation**: **Option B**, with the following hard constraints:

**Permanent prohibition (verbatim, non-negotiable):**
> **Raw activity count must never be a primary surfaced KPI for reps or managers. Raw counts may exist only as hidden diagnostic inputs to a quality-weighted, outcome-aware score.**

This prohibition carries forward to every future slice that touches rep scoring. It is a permanent rule, not a Phase 2/3 constraint.

**Specific enforcement:**
1. **No leaderboard based on count.** Not on any surface, not for any role, not as a "motivational" card.
2. **No default dashboard card for count.** Not in the Command Strip, not in Action Lanes, not in Executive Layer, not in any role variant.
3. **No rep comparison based on count.** Peer comparisons may only be rendered on the quality-weighted, outcome-aware score — never on raw calls, visits, emails, or meetings.
4. **No daily scoreboard based on count.** Daily surfaces must either show the quality score or show nothing. A "calls today: N" chip is forbidden.
5. **Manager-facing score is the addendum's `rep_daily_quality_score` only**, never `rep_daily_activity_score`. The raw activity count is a hidden diagnostic input to the quality score, not a displayed field.
6. **Rep's private view in Slice 3.30** shows the same score with the same formula, but with no peer comparison and no manager-visibility indicator.
7. **The score formula is versioned** and the version number is shown next to every value. When the formula changes, all historical values are re-labeled with the old version, never silently recomputed.
8. **Kill criterion**: if the score's standard deviation across reps collapses within 30 days of ship (i.e., everyone performs the same), the slice is rolled back. That's the Goodhart signal.

**Preserved principles from the main roadmap**:
- Manager-only quality interpretation (§6 Phase 2 Slice 2.7 Absence Engine pattern).
- Optional private rep reflection (§7 Phase 3 Slice 3.30 Rep Reality Reflection pattern).
- No public gamified scoring, anywhere, ever.

**✅ Accepted in principle 2026-04-08 (Option B with the permanent prohibition). Final implementation binding at Phase 3 Slice 3.30 planning.**

### Conflict 2 — ADD-038 — "Add this as a new top-level roadmap layer" / "Phase Add-A/B/C sequencing"

**STATUS: RESOLVED 2026-04-08 — Option A accepted (Just-in-Time Governance).**
> The addendum is decomposed into slices via the §3 splice list and spliced into Phase 2/3/4. No parallel track exists. The main roadmap's 6-phase dependency-ordered structure (0–5) remains the shipping artifact. This conflict is closed.

**Verbatim**: "Add this as a new top-level roadmap layer: QRM Event, Alert, and Opportunity Orchestration Engine" (§2) + "Phase Add-A — Foundation... Phase Add-B — Cross-department operations... Phase Add-C — Management and predictive orchestration" (§8).

**Conflicts with**:
- Rule 3 (no parallel top-level roadmap).
- Main roadmap §1: "This document replaces the thematic 4-phase roadmap in [QRM_Comprehensive_Idea_Inventory_Roadmap.md]. That roadmap grouped ideas by what they were about; this one sequences them by what they depend on. Those are different artifacts. Only the second one ships."
- Main roadmap §3: the 6-phase model (0–5) is explicitly the shipping structure.

**Why it cannot be silently resolved**: Accepting the addendum's Phase Add-A/B/C framing would recreate the exact structural error the main roadmap was written to fix. It would place cross-department work on a parallel track that runs against Phase 0's substrate — meaning every item in Add-A/B/C would either duplicate Phase 0 work or build on top of an un-shipped substrate.

**Resolution options**:

| Option | Trade-off |
|---|---|
| **A** — Reject the top-level-layer framing entirely. Splice every addendum item into Phase 2/3/4 via §3 of this merge. Main roadmap structure is unchanged. | Honors Rule 3. The addendum's intent is preserved; its framing is not. |
| **B** — Accept a parallel track structure but align its phase boundaries to Phase 0 gates. | Violates Rule 3. Creates two roadmaps. Not recommended. |
| **C** — Rename Phase Add-A/B/C as "cross-department tracks inside Phase 2/3/4" for communication purposes, but implement identically to Option A. | Cosmetic. Can happen in a README if needed. |

**Recommendation**: **Option A**. Reject the top-level-layer framing. The 40-row merge in §2 and §3 above IS the correct operationalization of the addendum's intent. No main roadmap change required.

**✅ Accepted 2026-04-08. Closed.**

---

## §6 — Meaningful Contact governance gap

The owner vision referenced in the addendum (§5) says "account ownership decays after inactivity." The main roadmap §15 Open Question #4 flagged this as needing a definition of "meaningful contact" before it ships or it will create bad incentives. This section writes that definition so it can be reviewed in isolation before it lands in the main roadmap.

### 6.1 — Concrete definition

**A meaningful contact is an event that satisfies BOTH a TYPE condition and a SIGNAL condition.**

**TYPE — must be one of:**
| Weight | Event type | Source |
|---|---|---|
| 1.0 | In-person visit logged with geo-confirmation | `crm_activities` with `activity_type='visit'` + geolocation |
| 1.0 | Voice capture with extracted intent (buying, budget, timeline, trade, urgency) | `voice_captures.extracted_data` with non-empty intent fields |
| 0.9 | Demo scheduled or delivered | `demo_requests.status in ('scheduled', 'delivered')` |
| 0.9 | Quote presented (not sent — presented) | `quotes` with an explicit `presented_at` timestamp |
| 0.8 | Inbound customer call with logged duration ≥ 60s | `crm_activities` with `activity_type='call'` + `duration_seconds >= 60` + `direction='inbound'` |
| 0.8 | Trade walkaround completed | Phase 3 Slice 3.8 output |
| 0.7 | Deposit discussion (logged as activity, not just the deposit record itself) | `crm_activities` linked to `deposits` |
| 0.6 | Outbound call with bilateral response (customer answered, duration ≥ 60s) | `crm_activities` with `activity_type='call'` + `direction='outbound'` + `reached='true'` |
| 0.5 | Email the customer opened AND either replied to OR clicked a tracked link | integration-level event — requires email tracking |
| 0.3 | Service complaint logged and acknowledged | Phase 3 Slice 3.15c output |

**SIGNAL — must satisfy AT LEAST ONE of:**
- The event is bilateral (the customer did something in response — answered, replied, clicked, attended).
- The event is a physical act (visit, demo, walkaround).
- The event contains extracted intent from voice capture.

**A meaningful contact's weight decays over time**: `weight_today = original_weight × exp(-days_since / 30)`. A visit today is worth 1.0; a visit 30 days ago is worth ~0.37; a visit 90 days ago is worth ~0.05. Accounts decay when the sum of their meaningful-contact weights drops below 0.5 — which is approximately one high-quality touch every 21–28 days.

### 6.2 — What does NOT count

- Opening a contact record.
- Pinning a task without completing it.
- Auto-drafted emails that were never sent.
- Outbound emails with no customer open, click, or reply.
- "Checking in" texts with no customer engagement.
- Bulk marketing touches.
- Logging a retroactive activity to reset the decay clock.
- Any activity created by the rep on the same day the account was about to decay (within 24h of the decay threshold — this is the primary anti-gaming guardrail).

### 6.3 — Anti-gaming guardrails

1. **The weights are NOT visible to reps.** Not on any surface, including the private Slice 3.30 Rep Reality Reflection. Reps see "meaningful contact in last 30 days: yes/no" and an approximate freshness chip. They do not see the weight table. If they can see the weights, they optimize the weights.
2. **Retroactive activity creation is audited.** Any activity created with an `occurred_at` more than 48 hours in the past is flagged for manager review and does NOT count toward meaningful-contact weight until a manager approves it. Ships as a Phase 0 P0.6 honesty probe.
3. **Decay-threshold-proximity activity is audited.** Any activity created within 24 hours of an account's decay threshold is flagged for manager review and contributes 50% of its normal weight until approved. Also a P0.6 probe.
4. **Bilateral verification is required for email weight.** An email with no open + no reply + no click gets zero weight, regardless of subject or length.
5. **Weights are versioned.** Every meaningful-contact calculation stores the version number used. Changing the weights does not retroactively revalue history.
6. **Decay rate is configurable per workspace but NOT per rep.** No rep can be given a longer decay window than their peers.

### 6.4 — Protected Strategic Account Override

Some accounts should not decay under the standard rule even when normal contact cadence is sparse. Strategic accounts in long sales cycles, accounts mid-negotiation with delayed purchasing windows, legacy accounts with low-cadence-high-value patterns, and accounts in protected pursuit windows all need an explicit override class. Without this, the decay rule will strip ownership from exactly the accounts where continuity of relationship matters most.

**Hard rule (verbatim, non-negotiable)**:
> **Protected strategic account status suspends automated ownership decay but does not suppress contact-health calculation, audit visibility, or manager review.**

**Definition**
A Protected Strategic Account is an account in an owner-authorized or manager-authorized override state that:
- Remains under its current ownership despite falling below the normal meaningful-contact decay threshold.
- Is explicitly flagged as protected, not silently exempted.
- Carries a structured override record with all required fields.

**Required override record fields**
Every protected-account override must carry:
| Field | Purpose |
|---|---|
| `account_id` | Account being protected |
| `reason` | Explicit written reason — "strategic", "mid-negotiation", "long-cycle", "relationship-pause", or free text if none fit |
| `start_date` | When the override takes effect |
| `review_date` | When the override must be re-evaluated |
| `approving_authority` | The owner or manager (named user) who authorized the override |
| `expiry_behavior` | What happens when `review_date` passes without renewal: `auto_expire` or `require_renewal_blocks_decay` |

**Operational rules**
1. **Override is visible to managers.** Every protected account shows a chip on the Account Command Center (Slice 3.3) and in the Executive Layer (Slice 2.8) indicating protected status, approver, reason, and review date.
2. **Override is auditable.** Every create/renew/expire event on a protected-account record publishes a Flow Engine event (`account_override_created`, `account_override_renewed`, `account_override_expired`).
3. **Override expires unless actively renewed.** No silent perpetuity. At `review_date`, the override either auto-expires or blocks decay until a manager renews it (per `expiry_behavior`). Expired overrides must be visible in a "recently expired" queue for 14 days after expiry.
4. **Override does not erase meaningful-contact calculation.** The weighted-sum calculation continues to run on protected accounts. Only the automated ownership decay is suspended. Managers still see the true health trend.
5. **Override must never be set silently.** No API path, no admin panel shortcut, no bulk operation may set protected status without writing the full override record. Any attempt to bypass this is a P0.6 honesty probe violation.
6. **Override cannot be self-applied by the rep.** Only managers or owners can authorize. A rep requesting protection on their own account is fine; authorization is not.
7. **Override is bounded.** A workspace-configurable maximum duration applies (default: 180 days per override, renewable). No override can be set for "indefinite."

**Anti-gaming guardrails specific to overrides**
- A rep whose accounts are disproportionately under protected status (above a workspace-configurable ratio, default 20% of their book) triggers a P0.6 honesty probe that escalates to ownership review.
- An override created within 7 days of an account approaching decay is flagged for manager review with a visible "protective timing" chip.
- Overrides that are renewed more than twice without a corresponding change in meaningful-contact trend are flagged for ownership review as "chronic protection."

**What override does NOT do**
- It does not hide the account from Absence Engine scans (Slice 2.7).
- It does not exclude the account from Customer Health Score calculation (Slice 3.17).
- It does not prevent the account from appearing in the Competitive Threat Map, Silence Map, or any Phase 5 hidden-forces surface.
- It does not suppress the Tempo Conductor (Slice 5.13) noticing that the account is out of tempo with the dealership's normal rhythm.
- In short: an override suspends **automated decay**, not **visibility**.

### 6.5 — Phase and slice where this becomes enforceable

- **Definition landed**: Phase 0 P0.6 (Honesty Calibration Index) — the decay-threshold-proximity audit, the retroactive-activity audit, and the protected-account gaming audits (disproportionate protection ratio, protective-timing flag, chronic-protection flag) are new honesty probes in the P0.6 probe set. Landing the definition here couples it to the contract that the roadmap already treats as non-negotiable.
- **Calculation engine**: Phase 2 Slice 2.X (new) — `qrm-meaningful-contact` nightly Deno function that computes the weighted sum per account per day and writes to a new `qrm_account_meaningful_contact_daily` rollup table. Protected accounts are calculated normally; the flag is applied at the decay-automation layer, not the calculation layer.
- **Decay automation**: Phase 3 Slice 3.3 (Account Command Center) — the decay rule ("accounts with weight < 0.5 enter decay review") becomes enforceable inside the Account Command Center. Automated ownership reassignment is a Phase 3 capability, not a Phase 2 one; Phase 2 ships the calculation and the visibility, Phase 3 ships the enforcement AND the override workflow.
- **Protected-account override workflow**: Phase 3 Slice 3.3 — create / renew / expire UI and audit trail live inside the Account Command Center. Flow Engine events (`account_override_*`) publish from here.
- **Rep visibility** (limited): Phase 3 Slice 3.30 (Rep Reality Reflection) — reps see only "meaningful contact in last 30d: yes/no" per account. No weights, no decay arithmetic. Protected-account status IS visible to the rep as a chip, because the rep needs to know the account's continuity does not depend on routine cadence pressure.

### 6.6 — Owner sign-off

This is a **business policy**, not just an engineering contract. The owner (not engineering) must sign off on:
- The weights table in §6.1.
- The exclusions in §6.2.
- The anti-gaming guardrails in §6.3, especially the 24-hour decay-proximity audit.
- Whether the weights are adjustable per workspace (default: yes, within owner-set bounds).
- **The protected strategic account override policy in §6.4**, specifically:
  - Who can authorize overrides (owner only, or managers too, or both).
  - The default maximum override duration (proposed: 180 days).
  - The workspace-configurable "disproportionate protection ratio" threshold that triggers honesty-probe escalation (proposed: 20% of a rep's book).
  - Whether overrides require a written reason from a fixed enum, free text, or both.
  - Whether a rep can *request* protection on their own accounts (proposed: yes, request is fine; authorization is not).
  - What happens to an expired override: auto-decay immediately, or 14-day grace period before decay resumes.

When the owner signs off, this section is lifted verbatim into [plans/2026-04-08-qrm-moonshot-exhaustive-roadmap.md](./2026-04-08-qrm-moonshot-exhaustive-roadmap.md) §15 Open Question #4, replacing the open question with a closed definition.

---

## Changelog — Six Required Edits Applied

| # | Edit | Section(s) touched | Old logic | New logic |
|---|---|---|---|---|
| **1** | Split machine recommendation drafts into deterministic (Phase 2) + AI-ranked (Phase 4) | §2 (ADD-006 row replaced by ADD-006a + ADD-006b); §3 new Slice 2.11 added; §3 Slice 4.4a rewritten; §4 cross-reference added | Single ADD-006 classified as `NEW — BLOCKED BY P0`, blocking the entire capability on P0.3+P0.8, earliest Phase 4. | Two tracks: **006a** — rules/catalog-based deterministic draft shipping in Phase 2 with no AI ranking, no predictive scoring, transparent rationale, `rules-based` label, no Prediction Ledger dependency. **006b** — AI-ranked/personalized/predictive draft in Phase 4, writes to Prediction Ledger, requires Trace, rendered alongside the deterministic version when they disagree. |
| **2** | Split parts-needed approval messages into minimal (Phase 2) + full (Phase 3) | §2 (ADD-018 row replaced by ADD-018a + ADD-018b); §3 Slice 2.4a rewritten as MINIMAL variant; §4 cross-reference added | Single ADD-018 classified `NEW — PHASE 2` but body text tied it to Slice 3.33 Drafts & Communications Center, effectively making Phase 2 wait on Phase 3. | Two tracks: **018a** — minimal Phase 2 Approval Center implementation (approval event + visible owner/reason/next action + basic templated outbound message + audit trail + no generalized workbench). Phase 2 does NOT wait on Phase 3. **018b** — full Phase 3 Drafts & Communications Center implementation (edit/approve/review/audit workflow + reusable draft handling + multi-channel management). Verbatim staging rule added. |
| **3** | Permanently prohibit raw activity counts as a primary surfaced KPI | §5 Conflict 1 (ADD-030) recommendation body | Option B recommendation with 4 hard constraints that still left room for someone to reintroduce raw counts as a surfaced KPI later. | Verbatim permanent prohibition added: "Raw activity count must never be a primary surfaced KPI for reps or managers. Raw counts may exist only as hidden diagnostic inputs to a quality-weighted, outcome-aware score." Plus 8 specific enforcement rules (no leaderboard, no default dashboard card, no rep comparison, no daily scoreboard, manager-facing quality-only, private rep reflection only, versioned formula, Goodhart kill criterion) and 3 preserved principles from the main roadmap. |
| **4** | Force role-opinionated default views on Signals Hub + Department Queues | §3 Slice 3.31 (Dealership Signals Hub) rewritten; §3 Slice 3.32 (Department Alert Queues) rewritten | Fragility note warned about the "inbox" risk but did not enforce a concrete requirement on the surfaces. | Verbatim hard requirement added to both slices: "These surfaces must never open in a neutral or all-signals state. Each role must receive a role-opinionated default view with pre-applied filters, priority ordering, and queue framing. 'Show all' may exist as an advanced action only." Plus explicit minimum required defaults per department (Sales / Rental / Service / Parts / Management), plus a role-blend composition rule for covering managers, plus a logged-event rule when anyone actually uses "Show all". |
| **5** | Tighten inbound parts email parsing prerequisites against wrong-customer drafts | §2 (ADD-026 row secondary tag `CONFIDENCE-GATED DRAFTS` added); §3 Slice 3.16d rewritten | Fragility note said parse result "must always surface for human confirmation before any action" but did not specify the confidence gates, the fallback behavior, or the prohibition on auto-binding sub-threshold events. | Verbatim hard prerequisite added: "No customer-facing or account-bound draft may be auto-created from inbound email parsing unless sender resolution, thread resolution, and account-match confidence all pass threshold." Plus 5 explicit prerequisites (thread identity resolved, sender resolved, account match ≥ 0.85, intent extraction ≥ 0.75, fallback route exists), plus 5 fallback behaviors (no draft, no auto-bind, route to human review queue, preserve candidate matches, log sub-threshold events to Prediction Ledger), plus mandatory trace id on every draft and sub-threshold event. |
| **6** | Add Protected Strategic Account Override class to meaningful-contact governance | §6 new subsection 6.4 inserted; old 6.4 renumbered to 6.5; old 6.5 renumbered to 6.6 and extended with new owner sign-off items | §6 had no concept of override — accounts below weight threshold would decay regardless of strategic status. | New §6.4 Protected Strategic Account Override with verbatim hard rule ("Protected strategic account status suspends automated ownership decay but does not suppress contact-health calculation, audit visibility, or manager review"). Plus definition, 6 required override record fields (account_id, reason, start_date, review_date, approving_authority, expiry_behavior), 7 operational rules (visible, auditable, expires without renewal, does not erase calculation, never silent, not self-applied, bounded), 3 anti-gaming guardrails (disproportionate protection ratio, protective-timing flag, chronic-protection flag), and explicit list of what override does NOT do (does not hide from Absence Engine, Health Score, Threat Map, Silence Map, Tempo Conductor). Updated §6.5 enforcement locations and §6.6 owner sign-off requirements. |

### Totals after edits

- **§2 Classification**: 40 classified rows (38 addendum items; ADD-006 and ADD-018 each split into two rows). 5 `ALREADY BUILT`, 6 `ALREADY PLANNED`, 0 `NEW — BLOCKED BY P0`, 7 `NEW — PHASE 2`, 13 `NEW — PHASE 3`, 4 `NEW — PHASE 4`, 0 `NEW — PHASE 5`, 2 `CONFLICT`, 0 `DEFER`.
- **§3 Splice list**: 2 new slices added (Slice 2.11 Deterministic Machine Recommendation Draft, Slice 2.4a rewritten as MINIMAL variant). Slice 4.4a rewritten to cross-link to 2.11.
- **§4 Duplicate integration map**: 1 new cross-reference block added for the two two-stage splits.
- **§5 Conflict log**: Conflict 1 recommendation body replaced with permanent prohibition + 8 enforcement rules + preserved principles.
- **§6 Governance**: New subsection 6.4 inserted; 6.5 and 6.6 renumbered and extended.

---

## Confirmation Statement

After applying the six required edits above, the following non-negotiable properties of this merge are confirmed:

1. **The dependency-ordered roadmap remains primary.** [plans/2026-04-08-qrm-moonshot-exhaustive-roadmap.md](./2026-04-08-qrm-moonshot-exhaustive-roadmap.md) is the shipping artifact. No edit to this merge document changes that. The merge remains a decision/splice layer on top of the primary roadmap, not a parallel roadmap.

2. **No second orchestration layer was introduced.** Every addendum item that produces events, alerts, routing, or escalations publishes to the Phase 0 P0.4 Flow Engine. No parallel event bus, no separate routing engine, no alternative subscription schema, no "Event Orchestration Platform" competing with the Flow Engine. The verbatim Rule 2 ("No second orchestration beside the Phase 0 P0.4 Flow Engine") is preserved and enforced by the `MUST PUBLISH TO FLOW ENGINE` tag across §2.

3. **No duplicated module was reintroduced.** The 5 `ALREADY BUILT` items (ADD-003, ADD-004, ADD-008, ADD-009, and the ADD-033 substrate element) remain tagged `DUPLICATE — integrate`. Every edit in this pass respected the existing `follow-up-engine`, `anomaly-scan`, `deal-timing-scan`, and `voice-to-qrm` modules and routed work through them rather than around them. Edit 1 (split machine recommendations) deliberately did NOT create a second recommendation engine — the Phase 2 deterministic version and the Phase 4 AI-ranked version are the same surface with different scoring layers.

4. **No premature AI-ranked recommendation was allowed through.** Every AI-ranked output in the merge (ADD-006b, ADD-011 derivatives, ADD-014, ADD-017, ADD-020 classifier, ADD-025, ADD-026 drafts, ADD-032, ADD-037, Slice 4.4a) carries the `WRITES TO PREDICTION LEDGER` tag and an explicit dependency on P0.3 + P0.8. Edit 1 is specifically designed to prevent the premature-AI failure mode: the deterministic Phase 2 version (ADD-006a) is rules-based and carries NO ledger dependency, while the AI-ranked version (ADD-006b) is correctly gated behind P0.3 + P0.8 + Slice 4.2. Edit 5 extends the same principle to inbound email parsing by requiring confidence gates before any draft is created.

5. **No role-pure assumption was added back.** Every edit respected the P0.5 Role Blend contract. Edit 4 explicitly requires role-blend composition for covering managers on Slice 3.31 and 3.32 — the default view for a blended user is NOT a fallback "neutral" view but a weighted blend of role defaults. Edit 6's Protected Strategic Account Override uses P0.5 role-blend to resolve the approving authority. Slice 2.10 (Lead-Form-to-Drafted-Opportunity) still requires `effective_from`/`effective_to` role-blend windows. No edit reintroduced exclusive-role assumptions.

### Two Conflict Recommendations Preserved (Unchanged in Principle)

- **Conflict 1 (ADD-030)**: Direction preserved — manager-first, quality-weighted, private rep reflection only if implemented, no public gamification. Edit 3 strengthened the language without weakening the principle.
- **Conflict 2 (ADD-038)**: Direction preserved — reject the addendum as a top-level parallel roadmap layer, retain the dependency-ordered roadmap as the shipping artifact, use the merge as a splice/decision document only. No edit touched this principle.

### Execution Posture

After this review is accepted:

- The merge document remains the decision layer.
- The main roadmap structure is NOT modified.
- No new slice opens based on the addendum until the two conflicts are resolved.
- Once resolved, the roadmap proceeds in order: Day 1 (commit Slice 1) → Day 2 (dependency verification) → Day 3 onward through Phase 0.
- When a future slice touches one of the merged addendum items, this revised merge document is the authoritative splice rule.
