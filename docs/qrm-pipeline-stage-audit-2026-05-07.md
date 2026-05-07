# QRM Pipeline Stage & Kanban Header Audit

**Date:** 2026-05-07
**Scope:** QRM Pipeline page (`/qrm/pipeline`) — Kanban swim-lane headers, the 21 stage labels, and the gates that separate pre-quote / quote / post-quote / close.
**Source of truth read:** `supabase/migrations/066_pipeline_21_step_reconfiguration.sql` plus the React rendering layer.

---

## Context / Scope

The QRM Pipeline is the primary sales operating surface. An operator should be able to glance at the board and answer:

1. *Where in the buying journey is this deal?*
2. *What is the deal waiting on right now?*
3. *Who must act next — the rep, the manager, the bank, the customer, the delivery team?*

This audit checks whether the **stage labels** and the **swim-lane headers** that bucket those stages tell that story for the autonomous QRM flow described by the user:

> Lead received → initial contact → needs assessment → quote created → supervisor / pending approval → quote sent / presented → signed / deposit / close.

No code is being modified by this review — it is an analysis pass.

---

## What ships today

### The 21 stages (`migration 066`)

| # | Stage Name | Prob. | SLA | Notes from SOP |
|---|---|---|---|---|
| 1 | Lead Received | 5% | 15 min | Inbound lead routed by territory |
| 2 | Initial Contact | 10% | — | First conversation, SLA <30 min from lead receipt |
| 3 | Needs Assessment | 15% | 60 min | Application, machine, timeline, budget, trade-in, decision maker |
| 4 | QRM Entry | 15% | — | All assessment data entered in QRM |
| 5 | Inventory Validation | 20% | — | Stock check via IntelliDealer or manual |
| 6 | Quote Created | 25% | — | Quote generated. SLA <1 hr from needs assessment |
| 7 | Quote Sent | 30% | 30 min | Quote + photos + brochure + credit app + video link |
| 8 | Quote Presented | 35% | — | Walk-through with customer, SLA <30 min after sent |
| 9 | Ask for Sale | 40% | — | Close attempt. Next step identified |
| 10 | QRM Updated | 40% | — | Post-presentation status entered |
| 11 | Follow-Up Set | 45% | — | Auto-cadence activated |
| 12 | Ongoing Follow-Up | 45% | — | Active follow-up until decision |
| 13 | Sales Order Signed | 70% | — | Margin <10% routes to manager |
| 14 | Credit Submitted | 75% | — | Credit app submitted to bank |
| 15 | Deal Shared | 80% | — | Invoice shared with bank + Iron Woman |
| 16 | Deposit Collected | 85% | — | **Hard gate** — no deposit, no order |
| 17 | Equipment Ready | 90% | — | Wash, attachments, PDI, payment confirmed |
| 18 | Delivery Scheduled | 92% | — | Traffic ticket, delivery date confirmed |
| 19 | Delivery Completed | 95% | — | Delivery report signed, hour meter recorded |
| 20 | Invoice Closed | 98% | — | Warranty registered (`is_closed_won = false`) |
| 21 | Post-Sale Follow-Up | 100% | — | 1 wk / 1 mo / 90 d / quarterly (`is_closed_won = true`) |

### The board's three swim lanes (`PipelineSwimLanesBoard.tsx`)

```ts
const SWIM_LANES = [
  { label: "Pre-Sale Pipeline", range: [1, 12]  },
  { label: "Close Process",     range: [13, 16] },
  { label: "Post-Sale",         range: [17, 21] },
];
```

### Gate enforcement (`pipeline-gates.ts`)

| Lane | Gate |
|---|---|
| Pre-Sale (1–12) | None |
| Close Process (13–16) | **Soft warn** if `marginPct < 10%` |
| Post-Sale (17–21) | **Hard block** if `depositStatus !== "verified"` |

### Page subtitle (`QrmPipelinePage.tsx`)

> "21-step deal pipeline with SLA enforcement, drag-and-drop stage transitions, and real-time follow-up tracking."

---

## Findings

### F1 — Supervisor / pending approval has no Kanban presence (HIGH)

The user's flow includes a clear "supervisor approval / pending approval" wait state. The repo has the *data* for this:

- `crm_deals.margin_check_status` (`flagged`, `approved_by_manager`)
- The Approval Center surface (`ApprovalCenterPage`, `useApprovals`, `approvalTypes.ts` — sample copy: *"Quote awaiting sales manager approval"*)
- A soft warning in `pipeline-gates.ts` for stages 13–16 that surfaces a manager-approval toast

What is missing is a **column** for that wait state. A flagged deal continues to live in whichever stage the rep last set it to (typically Quote Created or Sales Order Signed). For an autonomous, glanceable Kanban this is opaque — there is no visual cue that says "this deal is parked until a manager clears it."

The strongest fix is to introduce one of:

1. A pseudo-column (`Quote Pending Approval`) inserted between **6 Quote Created** and **7 Quote Sent**, populated by `margin_check_status = 'flagged'`. Real stage_id stays unchanged; the lane just renders a virtual bucket.
2. A real stage **6.5 Quote Pending Approval** with hard gate: cannot move to **7 Quote Sent** while flagged.

Option 1 preserves SOP fidelity (no schema migration). Option 2 makes the gate explicit but adds a 22nd stage and a new SLA.

The current "soft warn at 13–16" rule does not prevent a flagged quote from going to **7 Quote Sent**, so customers can receive low-margin quotes the manager has not seen yet. That is a real moonshot-mission failure: autonomous flow loses pressure-test value the moment the board hides who is blocking whom.

### F2 — Lane labels do not match the actual flow phases (HIGH)

| Lane label today | Stages bucketed | What it actually contains |
|---|---|---|
| **Pre-Sale Pipeline** | 1–12 | Pre-quote (1–5) + Quote work (6–10) + Follow-up (11–12). Calling 12 stages "pre-sale" is misleading — the deal is heavily worked, has been quoted, and may be on the verge of signing. |
| **Close Process** | 13–16 | Signed / credit / deposit. Reasonable. |
| **Post-Sale** | 17–21 | Equipment Ready (17), Delivery Scheduled (18), Delivery Completed (19), Invoice Closed (20), Post-Sale Follow-Up (21). Stages 17–19 are **delivery operations**, not post-sale. The actual "post-sale" cohort is just stage 21. |

The user's mental model exposes at least four phases (pre-quote → quote → close → post-sale). The board collapses them to three, and labels them in ways that don't reflect what's in the bucket.

**Recommended lane structure (UI label change only — no schema change):**

| Lane label | Stage range | Rationale |
|---|---|---|
| Pre-Quote | 1–5 | Lead → Inventory Validated. Everything before a quote document exists. |
| Quote | 6–10 | Created → Sent → Presented → Asked → QRM Updated. The "make and pitch the quote" loop. |
| Close | 11–16 | Follow-Up Set → Ongoing → Signed → Credit → Shared → Deposit. The "convert pitched quote into a paid order" loop. |
| Delivery & Post-Sale | 17–21 | Equipment Ready → Delivery Scheduled → Delivered → Invoice Closed → Post-Sale Follow-Up. |

This survives the 21-step SOP intact while making lane headers match operator language.

### F3 — Page subtitle understates structure (LOW)

`QrmPipelinePage.tsx` line 218:

> "21-step deal pipeline with SLA enforcement, drag-and-drop stage transitions, and real-time follow-up tracking."

This is technically accurate but says nothing about the buyer-journey phases. An autonomous operator dropped onto this page sees 21 columns wrapped in three lanes and has to decode the meaning. A subtitle like:

> "Pre-quote, quote, close, and delivery — 21 SOP-tracked steps with SLA enforcement and drag-and-drop transitions."

…makes the phase structure self-documenting.

### F4 — `QRM Entry` (4) and `QRM Updated` (10) are operator events, not buyer states (MEDIUM)

These two stages capture rep behavior ("I entered the data" / "I updated the status after presenting"), not deal progression. On a Kanban board this produces sideways drags that don't represent the deal advancing — purely paperwork.

The cost shows up in three places:

1. **Time-in-stage analytics** (`pipeline-analytics.ts`) flag these as bottlenecks at 14 days when in reality the rep just forgot to mark a checkbox.
2. **Conversion rates** (`conversionToNextPct`) become noisy because the funnel narrows for non-buyer reasons.
3. **Stage probability** is identical to neighbours (15% = 15%, 40% = 40%) — these stages convey no probability shift.

Two ways to keep the SOP requirement without polluting the board:

- Demote `QRM Entry` and `QRM Updated` to **completion checkboxes within the previous stage**; the board renders a `▢ QRM updated` chip on the deal card and the next-stage move is gated until checked.
- Or keep them in the schema for audit but hide them from the swim-lane render (they remain available in the stage filter dropdown for managers who care about SOP compliance).

This is a UI shape change; it can be tried in option 1 form first because it requires no migration.

### F5 — `Ask for Sale` (9) is a moment, not a duration (MEDIUM)

Stage 9 is a single event ("close attempt"). Treating it as a column means it accumulates deals just because the rep didn't drag them out of it immediately. The 14-day bottleneck rule will paint this column red almost continuously.

Same fix family as F4: render Ask for Sale as a chip/button on the **Quote Presented** card ("✓ Asked for the sale on May 7"), advance automatically once recorded.

### F6 — `Follow-Up Set` (11) and `Ongoing Follow-Up` (12) are duplicative (LOW)

Both are 45% probability, both describe nurture, and they read as "Follow-up" twice on the board. Either:

- Stage 11 fires a one-time auto-cadence trigger and the deal auto-advances to 12 immediately, leaving 11 effectively invisible — in which case the Kanban should not render 11 at all.
- Or merge into one stage `Follow-Up Active` with the cadence-activation timestamp on the deal card.

### F7 — Probability cliff between stages 12 and 13 (LOW)

Probability jumps 45% → 70% on signature. Real-world pre-signature signals (verbal commit, financing prep, deposit requested) live in `deal-signals.ts` but are not a stage progression. This is acceptable as long as **weighted pipeline numbers** continue to be driven by `crm_deals.amount * probability` — which they are, via `listCrmWeightedOpenDeals`. Flagging only because it's a 25-point cliff that can mask near-close revenue in manager forecasts.

### F8 — Empty-lane suppression hides phase boundaries (LOW)

`PipelineSwimLanesBoard` does:

```tsx
if (laneColumns.length === 0) return null;
```

If a workspace has zero open deals in (say) the Close Process stages, the lane disappears entirely. For an autonomous operator this looks like the pipeline only has two phases. Recommend rendering the lane header with a "No deals" state instead of dropping it — the *structure* of the funnel is part of the user's model.

### F9 — Subtitle "21-step" vs reality of 21 columns scrolling horizontally (LOW)

The board renders all 21 columns inside three horizontally scrolling lanes (`overflow-x-auto`, `min-w-max`, columns are `w-[280px]`). On a 1440px laptop the operator sees ~4 columns of any one lane at a time. That's fine — but the lane *header* is the only stable phase indicator, so the lane labels (F2) carry more weight than the current naming gives them.

### F10 — Stage filter dropdown is unsorted by lane (LOW)

`PipelineFiltersBar` lists stages flat ("All open stages" + sorted by `sort_order`). For 21 stages this is workable but a manager scanning for "Quote Sent" has to count down a long list. Group the dropdown by the four recommended lanes (F2) once the lane structure is finalized.

---

## Recommendations (prioritized)

| # | Change | Type | Risk | Reward |
|---|---|---|---|---|
| R1 | Insert a **virtual `Quote Pending Approval` column** between Quote Created (6) and Quote Sent (7), populated when `margin_check_status = 'flagged'`. | UI only | Low — data already exists. | High — closes the autonomy gap; flagged quotes are visible. |
| R2 | Rename swim lanes to **Pre-Quote / Quote / Close / Delivery & Post-Sale** with ranges 1–5, 6–10, 11–16, 17–21. | UI only | Low — single constant in `PipelineSwimLanesBoard.tsx`. | High — lane labels match operator language. |
| R3 | Add a **hard gate**: cannot move a deal to Quote Sent (7) while `margin_check_status = 'flagged'`. Pair with R1. | Gate logic only (`pipeline-gates.ts`). | Low — extends an existing pattern (deposit hard gate at 17+). | High — prevents low-margin quotes from leaving the dealership unreviewed. |
| R4 | Demote **QRM Entry (4)** and **QRM Updated (10)** from columns to completion chips on the prior stage card; auto-advance once checked. | UI + gate logic. | Medium — needs a new "step completion" widget; SOP semantics preserved. | Medium — cleans up sideways drags and stale-bottleneck false positives. |
| R5 | Demote **Ask for Sale (9)** to a one-tap action on the Quote Presented card with a recorded timestamp; auto-advance. | UI + gate. | Medium. | Medium — analytics no longer flag a moment as a duration. |
| R6 | Update page subtitle to expose phase structure: *"Pre-quote, quote, close, and delivery — 21 SOP-tracked steps with SLA enforcement and drag-and-drop transitions."* | Copy only. | None. | Low — but free improvement. |
| R7 | Render empty lanes with a "No deals" placeholder instead of suppressing them. | UI only. | None. | Low. |
| R8 | Group the stage filter dropdown by lane (`<optgroup>`). | UI only. | None. | Low. |
| R9 | Reconsider whether **Follow-Up Set (11)** should be a column at all. Either auto-advance it on cadence activation, or merge it with stage 12. | Schema change OR UI suppression. | Low (UI only) / Medium (schema). | Low — clarity. |

R1, R2, R3, and R6 are the highest-leverage changes and are all UI-only. R4 and R5 require small gate-logic additions but no migration. R9 should be discussed with the SOP owner because the cadence-activation event is itself audit-worthy.

---

## Mission alignment verdict

| Check | Verdict | Evidence |
|---|---|---|
| Mission Fit | ✅ | Pipeline serves field reps, sales managers, and ops; touches every recommended role. |
| Transformation | ⚠️ Partial | The 21-stage model and SLA enforcement are SOP fidelity wins; however a Kanban board that hides supervisor approvals is not transformational — it's commodity behavior wrapped in fancier columns. R1 + R3 close that gap. |
| Pressure Test | ⚠️ | Flagged quotes today can be sent without manager review (F1). This must be fixed before the board can claim it pressure-tests the sales motion. |
| Operator Utility | ✅ for present, ⚠️ for autonomous mode | Today's labels work for someone who knows the SOP; they do not work for an autonomous flow that should narrate itself. R1 + R2 + R6 fix that. |

---

## Files referenced

- `supabase/migrations/066_pipeline_21_step_reconfiguration.sql` — canonical 21 stages.
- `apps/web/src/features/qrm/pages/QrmPipelinePage.tsx` — page header, subtitle, layout.
- `apps/web/src/features/qrm/components/PipelineSwimLanesBoard.tsx` — `SWIM_LANES` constant, lane render.
- `apps/web/src/features/qrm/components/PipelineFiltersBar.tsx` — stage filter dropdown.
- `apps/web/src/features/qrm/components/PipelineManagerSummary.tsx` — manager summary.
- `apps/web/src/features/qrm/lib/pipeline-gates.ts` — gate severity rules.
- `apps/web/src/features/qrm/hooks/useCrmPipelineDragDrop.ts` — gate consumption.
- `apps/web/src/features/qrm/lib/pipeline-analytics.ts` — bottleneck/velocity analytics.
- `apps/web/src/features/qrm/command-center/lib/approvalTypes.ts` — quote approval modeling (today's home for the missing approval-state bucket).

No code was modified.
