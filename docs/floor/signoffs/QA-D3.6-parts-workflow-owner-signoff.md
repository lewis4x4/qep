# QA-D3.6 Parts Workflow Document — Owner Sign-Off (Juan + Norman)

Roadmap item: D3.6 / QEP-100 (Stream D / Wave D3 — Parts module refinement gate)
Document under review: `docs/designs/qep-parts-workflow-document-2026-05-29-review-candidate.md` (committed at `c383df0d`)
Source evidence: review candidate §3–§21; `docs/operations/QEP_OWNER_BLOCKER_QUESTION_PACKET_2026-07-03.md` (Parts — Norman + Juan/Bobby); Linear QEP-100 note dated 2026-07-03; engineering segment gate `test-results/agent-gates/20260630T042056Z-d3-6-parts-workflow-document.json` (passed); pricing baseline `docs/architecture/parts-pricing-ruleset.md`
Status: **UNSIGNED — owner-review gated.** The engineering segment gate passed and the review candidate is refreshed, but no source-controlled Juan + Norman signed v1, dated red-line, or pass / pass-with-exceptions decision exists. **D3.6 must NOT be marked shipped until this file is completed.**

Owner: Norman (Parts Manager) + Juan/Bobby (Parts Counter).
Required before: promoting the review candidate to signed v1 and moving D3.6 / QEP-100 from owner-review-gated to shipped.

This is a **sign-off addendum**, not a new spec. It extracts the two things the owners must produce to close the gate: a **red-line of §3–§15** and a **Confirm / Correct / Defer decision on every §20 question (D-1…D-14)**. Answers here are what promote the review candidate to signed v1.

---

## Reviewer legend

Red-line dispositions (workflow sections, per review candidate §0):

- **Confirmed** — matches how the floor actually works.
- **Correct-as-noted** — mostly right; see the correction in the notes.
- **Wrong** — does not match operations; describe the real workflow.

Decision dispositions (§20, per review candidate §20/§21):

- **Confirm** — accept the described behavior / answer the question as stated.
- **Correct** — answer differently; write the owner answer.
- **Defer** — not resolved now; name the owner and the follow-up before v1. A deferral is acceptable for `pass with exceptions` only when explicitly accepted below.

---

## Decision Record

- Review candidate reviewed (path + commit): `docs/designs/qep-parts-workflow-document-2026-05-29-review-candidate.md` @ `c383df0d`
- Reviewer names (Norman / Juan):
- Review date:
- Signed by:
- Signed at:
- **Overall decision:** `pass` / `pass with exceptions` / `fail`

---

## Preconditions (already true — no owner action)

- Review candidate is committed in-repo at `c383df0d`.
- Engineering segment gate passed: `test-results/agent-gates/20260630T042056Z-d3-6-parts-workflow-document.json`.
- Parts pricing baseline (D3.7 / QEP-101) is closed and documented: `docs/architecture/parts-pricing-ruleset.md` (list price, 35% target / 25% floor, 5% counter cap, manager approval above 5%, internal WO sell−10% with 25% floor).

**D-0 — assumption confirmation (owner action, blocks v1).** The external discovery inputs the workflow depends on — the 28 Parts Department Discovery answers, `QEP_PHASE3_PARTS_BLUEPRINT`, and `CLAUDE_CODE_HANDOFF §8` — are **not committed in this repo** (review candidate §19.1). Every §19 assumption stays an assumption until confirmed. Owners either confirm these inline while answering §20, or supply the files.

- D-0 disposition: ☐ Confirmed inline via §20 answers ☐ Files to be supplied (owner: ____) ☐ Defer

---

## Part A — Red-line of §3–§15 (mark each row)

Mark **Confirmed / Correct-as-noted / Wrong** and add floor reality where code and operations disagree.

| § | Workflow section | Disposition | Correction / operator reality (required if not Confirmed) |
|---|---|---|---|
| 3 | Workflow stage model (10 stages) | ☐ Confirmed ☐ Correct-as-noted ☐ Wrong | |
| 4 | End-to-end workflow narratives | ☐ Confirmed ☐ Correct-as-noted ☐ Wrong | |
| 5 | Counter / retail sales | ☐ Confirmed ☐ Correct-as-noted ☐ Wrong | |
| 6 | Parts lookup & identification | ☐ Confirmed ☐ Correct-as-noted ☐ Wrong | |
| 7 | Quoting | ☐ Confirmed ☐ Correct-as-noted ☐ Wrong | |
| 8 | Ordering & purchasing | ☐ Confirmed ☐ Correct-as-noted ☐ Wrong | |
| 9 | Vendor management | ☐ Confirmed ☐ Correct-as-noted ☐ Wrong | |
| 10 | Pricing | ☐ Confirmed ☐ Correct-as-noted ☐ Wrong | |
| 11 | Inventory & fulfillment | ☐ Confirmed ☐ Correct-as-noted ☐ Wrong | |
| 12 | Returns / cores / exceptions | ☐ Confirmed ☐ Correct-as-noted ☐ Wrong | |
| 13 | Invoicing & financial handoff | ☐ Confirmed ☐ Correct-as-noted ☐ Wrong | |
| 14 | Service department integration | ☐ Confirmed ☐ Correct-as-noted ☐ Wrong | |
| 15 | AI-native Iron capability layer | ☐ Confirmed ☐ Correct-as-noted ☐ Wrong | |

---

## Part B — §20 decisions (answer or defer each)

Questions are copied from review candidate §20. **Route** flags which decisions are owner business calls vs. engineering confirmations the owners authorize routing for.

### Top decisions (highest impact)

**D-1 — Canonical stage model.** *Route: owner.*
Question: Is the 10-stage model in §3 the workflow QEP wants parts staff trained on? Rename/reorder as needed.
Disposition: ☐ Confirm ☐ Correct ☐ Defer
Owner answer / correction:

**D-2 — One spine or two?** *Route: owner (shapes everything downstream).*
Question: Should counter/retail orders (`parts_orders`) and service-job parts (`service_parts_requirements`) stay separate coordinated spines, or converge into one parts-fulfillment model?
Disposition: ☐ Confirm ☐ Correct ☐ Defer
Owner answer / correction:

**D-3 — Order status state machine of record.** *Route: owner decides canonical; engineering aligns.*
Question: Resolve the verified UI-vs-backend inconsistency — the UI offers `draft → submitted` and `draft → confirmed`, but the backend allows only `draft → cancelled` and forces `submit_internal_order`. Which is canonical? Also confirm server-side enforcement of the 8-state vendor-PO and fulfillment-run machines.
Disposition: ☐ Confirm ☐ Correct ☐ Defer
Owner answer / correction:
Route-to (engineering issue):

**D-4 — Parts quoting & invoicing ownership.** *Route: owner.*
Question (a): Standalone Parts Quote workflow, or parts-as-lines inside the unified deal quote (`quote_line_kind='part'`)?
Question (b): Is QEP the system of record for **parts invoices** (requiring the missing quote→invoice and consume-staging→`customer_invoices` converters), or does CDK/IntelliDealer remain the invoicing system with QEP mirroring?
Disposition: ☐ Confirm ☐ Correct ☐ Defer
Owner answer / correction:

**D-5 / D-7 — Pricing authority & auto-apply guardrails.** *Route: owner (+ Controller for internal WO).*
Question: Who owns final pricing authority, and what approval thresholds (monetary/percentage) gate `auto_apply` price changes beyond the per-rule flag?
Current status: baseline **resolved** by D3.7 / QEP-101 (`parts-pricing-ruleset.md`). Remaining: the numeric `auto_apply` guardrail thresholds, and Controller sign-off on the internal work-order formula before G11.
Disposition: ☐ Confirm baseline + set thresholds ☐ Correct ☐ Defer
Owner answer (thresholds + Controller sign-off):

### Operational decisions

**D-6 — Vendor escalation & contacts readiness.** *Route: owner.*
Question: Which vendor contacts/escalation policies are production-ready vs. placeholder? Should `vendor_escalations` get an explicit status field? (Owner packet also asks: who owns vendor contact data and vendor portal credentials?)
Disposition: ☐ Confirm ☐ Correct ☐ Defer
Owner answer / correction:

**D-8 — Cores / reman returns operating model.** *Route: owner.*
Question: Schema exists (`is_reman`, `core_charge_cents`, `core_part_id`, `return_part`) but there is no dedicated cores/returns UI. How should counter staff handle core charges, core returns, and reman exchanges in the daily workflow?
Disposition: ☐ Confirm ☐ Correct ☐ Defer
Owner answer / correction:

**D-9 — ADR reconciliation.** *Route: architect/engineering; owner confirms intent.*
Question: `ADR-003` (progressive customer capture) and `ADR-004` (serial-number-primary entry) are absent from the repo but referenced as shipped design basis. Are these shipped, planned, or dropped? Author the ADRs or correct the roadmap.
Disposition: ☐ Confirm ☐ Correct ☐ Defer
Owner answer / correction:
Route-to (engineering issue):

**D-10 — Legacy parity scope.** *Route: owner.*
Question: Which IntelliDealer screens are **must-match** before staff switch (candidates: Invoicing, Price Matrix, Purchase Orders) vs. reference-only?
Disposition: ☐ Confirm ☐ Correct ☐ Defer
Owner answer / correction:

**D-11 — Voice-order defect routing.** *Route: engineering; owner confirms desired behavior.*
Question: Record the verified `voice-to-parts-order` temporal-dead-zone defect (`adminClient` used line 263, declared line 270) and route to engineering. Confirm whether voice **auto-submit** of machine-down orders is desired behavior at all.
Disposition: ☐ Confirm auto-submit desired ☐ Correct (change behavior) ☐ Defer
Owner answer / correction:
Route-to (engineering issue):

**D-12 — Workspace-scoping hardening.** *Route: engineering; owner authorizes.*
Question: Confirm and, if needed, fix `counter_inquiries` / `parts_preferences` RLS (currently `user_id`-only) and add a DB-level enum/CHECK on `parts_orders.status`.
Disposition: ☐ Confirm (route to engineering) ☐ Defer
Route-to (engineering issue):

### Lower-impact / confirmations

**D-13 — RPC inventory confirmation.** *Route: engineering.*
Question: Confirm the predictive/forecast RPCs (`predict_parts_needs`, `compute_seeded_forecast`, `customer_fleet_llm_context`, `recent_orders_for_part`, `match_parts_hybrid`) exist and behave as the functions assume.
Disposition: ☐ Confirm (route to engineering) ☐ Defer
Route-to (engineering issue):

**D-14 — Customer-visible statuses.** *Route: owner.*
Question: Which order statuses + ETAs should the portal expose, and what is the supported portal-draft → submitted promotion path (portal RLS allows insert only)?
Disposition: ☐ Confirm ☐ Correct ☐ Defer
Owner answer / correction:

---

## Deferred items register (fill only for anything marked Defer)

| Decision | Deferred owner | Follow-up issue / where tracked | Accepted for `pass with exceptions`? |
|---|---|---|---|
| | | | |

---

## Evidence path to signed v1

1. **Complete this file** — reviewer names, review date, every §3–§15 row dispositioned, a Confirm/Correct/Defer recorded for every D-1…D-14 (and D-0), and the overall decision set.
2. **Fold answers into the document** — apply corrections to the review candidate, remove the `REVIEW CANDIDATE` banner, promote to `v1` (retitle/version the file), and change the §19 assumptions that are now confirmed into stated facts.
3. **Route the engineering confirmations** — open issues for D-3, D-9, D-11, D-12, D-13 and link each issue in the Route-to slots above.
4. **Commit** this completed sign-off plus the promoted v1 document.
5. **Record the evidence path** — write the signed v1 file path and reviewer names into the roadmap row for D3.6 (Supabase `qep_roadmap_tasks` via the QEP roadmap UI — do not hand-edit the mirrored Linear body) and note completion on QEP-100.
6. **Only then** may D3.6 / QEP-100 move to shipped.

---

## Completion rule

D3.6 / QEP-100 can move from owner-review-gated to **shipped** only when this file is completed with reviewer names (Norman + Juan), a dated red-line of §3–§15, a Confirm / Correct / Defer disposition recorded for every §20 decision D-1…D-14, and an overall `pass` or explicitly accepted `pass with exceptions`. If the overall decision is `fail`, leave D3.6 gated and link the remediation issue(s). Deferred decisions must name an owner and a follow-up issue; a deferral is not a resolution, but is acceptable under `pass with exceptions` when accepted in the Deferred items register above.

---

## Next manual step (Juan + Norman)

1. Open the review candidate: `docs/designs/qep-parts-workflow-document-2026-05-29-review-candidate.md`.
2. In **Part A** of this file, mark each §3–§15 row Confirmed / Correct-as-noted / Wrong, adding the real floor workflow anywhere it's Wrong.
3. In **Part B**, check Confirm / Correct / Defer for each decision D-1…D-14 and write your answer. If a discovery input in D-0 is already on file, name where it lives.
4. Put your names and the date in the Decision Record, set the overall decision, and send it back to Brian.

---

## Owner questionnaire (what Juan + Norman receive)

The owner-facing packet sent to Juan + Norman is the branded fillable PDF `QEP (1)/QEP_D3.6_PARTS_WORKFLOW_REVIEW_2026-07-04.pdf` (generator `docs/operations/QEP_D3.6_PARTS_WORKFLOW_REVIEW_2026-07-04.gen.py`; plain-text companion `.md` alongside). Its ten decisions map back to this file:

- Section A (write-up red-line) → §3–§15 red-line table
- Q1 → D-1 · Q2 → D-2 · Q3 → D-3 (stages only) · Q4 → D-4 · Q5 → D-5 / D-7 · Q6 → D-6 · Q7 → D-8 · Q8 → D-11 (behavior only) · Q9 → D-10 · Q10 → D-14
- Section C (documents / inputs) → D-0

Not asked of the owners — routed to engineering: D-3 UI-vs-backend fix, D-9 missing ADR-003/004, D-11 voice code defect, D-12 RLS + status-enum hardening, D-13 RPC existence checks.
