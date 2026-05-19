# QEP OS — Quote Process Tier 1: Margin & Pricing Discovery

**Audience:** Dealership owner / principal, VP Sales
**Read time:** ~25 minutes
**Decision time:** ~60 minutes with the engineering team
**Companion doc:** [QEP-OEM-PRICE-FEEDS-OWNER-DISCOVERY.md](QEP-OEM-PRICE-FEEDS-OWNER-DISCOVERY.md) — read first; this doc assumes those answers exist.
**Status:** Awaiting answers before build kickoff
**Date:** 2026-05-17

---

## 1. Why this document exists

QEP OS can already build a quote, gate margin, store an incentive stack, and route an approval. What it *cannot* do is read your mind about the **policy** behind any of those mechanics. Today, every rep makes pricing judgment calls without a written rulebook. That works until it doesn't — until a $400K deal closes 3 margin points underwater and nobody can point to who approved what.

This document records the rulebook. Once answered, every quote in QEP OS will be evaluated against your written policy, not against rep tribal knowledge.

It covers three clusters:

- **Pricing Build** — how a quote gets to a number
- **Rebates, Incentives & SPRs** — how OEM money flows through that number
- **Approval Workflow** — when a human has to bless that number before it leaves the building

---

## 2. What we are proposing to build

The infrastructure already exists across these migrations:

- [560_quote_line_cost_visibility.sql](supabase/migrations/560_quote_line_cost_visibility.sql) — per-line cost visibility flag
- [563_rebate_stack_kind_tag.sql](supabase/migrations/563_rebate_stack_kind_tag.sql) — rebate categorization
- [565_approval_bypass_rules.sql](supabase/migrations/565_approval_bypass_rules.sql) — approval bypass mechanism
- [566_quote_post_approval_action.sql](supabase/migrations/566_quote_post_approval_action.sql) — post-approval edit hooks
- [572_manufacturer_incentive_stack_kind.sql](supabase/migrations/572_manufacturer_incentive_stack_kind.sql) — OEM incentive stacks
- [578_equipment_override_price_column.sql](supabase/migrations/578_equipment_override_price_column.sql) — equipment price override

What is missing is **policy data** — values to put in these tables and rules to enforce in the application layer. This doc captures those policies, then engineering wires them up. Estimated effort once answers are in: **~10 days** for full Tier 1 enforcement, including audit dashboards.

---

## 3. What the rep will see when this lands

- **Pricing builder** shows cost only if your policy says reps can see cost (Decision 1.1). Otherwise: margin % only.
- **Discount lines** auto-cap at the customer's tier limit (Decision 1.2). Going above the cap requires manager unlock with reason capture.
- **Volume discount waterfall** auto-applies once unit count crosses your defined steps (Decision 1.4).
- **Rebate eligibility** auto-evaluates per customer per OEM; ineligible rebates are hidden, not greyed out (Decision 2.5).
- **Approval routing** computes who must sign off based on dollar, margin, and bypass rules — visible to the rep before they hit Send so there are no surprises.

The owner sees a **Pricing Policy Dashboard** with: bypass usage frequency, out-of-policy approvals last 30 days, average margin by rep, and SPR submission rates.

---

## 4. Decision Points

Each Decision Point follows the format: question, options table, engineering's sample answer, blank for your answer.

---

### Cluster A — Pricing Build

#### DP 1.1 — Cost visibility to reps

**Question:** Can reps see true landed cost on the quote builder, or only margin percentage?

| Option | What it means | Tradeoff |
|---|---|---|
| **A. Full cost visibility for all reps** | Reps see landed cost line-by-line. | Maximum rep autonomy. Risk: cost leaks to customer in conversation. |
| **B. Cost hidden, margin % shown** | Rep sees margin but not dollar cost. | Engineering recommendation for new reps. Cost stays internal. |
| **C. Tenured reps see cost, new reps see only margin %** | Permission tied to a `cost_visibility` flag per rep. | Best of both. Adds an admin step (per-rep flag). |
| **D. Cost visible only above a tenure or volume threshold** | E.g. reps with $5M+ lifetime sold get cost view automatically. | Same as C but rule-driven. Hard to explain to new reps. |

**Sample answer:** C. Owner controls who sees cost; new hires start without.

**Your answer:** _____________

---

#### DP 1.2 — Customer-specific discount mechanism

**Question:** How do customer-specific discounts work in your dealership?

| Option | What it means |
|---|---|
| **A. Percentage off list** | Customer X always gets 8% off list across the board. |
| **B. Dollar off per unit** | Customer X gets $500 off any compact track loader. |
| **C. Tier-based** | Customers are tagged Platinum / Gold / Standard, each tier has a fixed discount schedule. |
| **D. Contract-locked** | Specific price written in a contract attached to the customer record. |
| **E. Combination** | Multiple of the above can apply — rule needed for stacking. |

**Sample answer:** E with default tier-based (C), and contract-locked (D) overrides where contracts exist. No percentage-off-list (A) without explicit owner sign-off — it's the loosest and most-leaked policy.

**Your answer:** _____________

**Follow-up if E:** What is the stacking order? (E.g., contract beats tier beats percentage.) _____________

---

#### DP 1.3 — Dealer-applied margin uplift

**Question:** Does QEP apply a uniform margin uplift across all categories, or per-category?

| Option | What it means |
|---|---|
| **A. Uniform** | E.g. 18% target margin on everything. |
| **B. Per-category** | New equipment 14%, used equipment 22%, parts 35%, service labor 60%. |
| **C. Per-OEM** | Some manufacturers carry richer margins than others; track separately. |
| **D. Per-category + per-OEM matrix** | Most accurate, most policy maintenance. |

**Sample answer:** B for Phase 1. Add D if margin variance across OEMs is wide enough to matter.

**Your answer (provide actual target margins per category if B or D):**

| Category | Target margin % | Margin floor % |
|---|---|---|
| New equipment | | |
| Used equipment | | |
| Parts | | |
| Service labor | | |
| Rental | | |
| Other: ______ | | |

---

#### DP 1.4 — Volume / multi-unit discount waterfalls

**Question:** When a customer buys multiple units in one deal, does the per-unit price drop at certain unit counts?

| Option | What it means |
|---|---|
| **A. No volume discount** | Each unit priced individually. |
| **B. Stepped waterfall** | E.g. 1 unit = list, 2–4 units = 2% off, 5+ = 4% off. |
| **C. Negotiated per deal** | No standard schedule; rep negotiates each time, manager approves. |
| **D. Hybrid** | Standard waterfall for new equipment, negotiated for used or mixed-category bundles. |

**Sample answer:** B for new equipment, D allowing negotiation for used. Define the schedule below.

**Your answer (if B or D, provide the step table):**

| Unit count | Discount % off list |
|---|---|
| 1 | 0% |
| 2–4 | |
| 5–9 | |
| 10+ | |

---

#### DP 1.5 — Trade-in valuation source and authority

**Question:** Who appraises trade-ins and when does that value lock?

| Option | What it means |
|---|---|
| **A. Sales rep appraises, no second opinion required** | Fastest. Highest risk on overvaluation. |
| **B. Used Equipment Manager (UEM) must lock the value** | UEM in the loop before quote can show trade. |
| **C. Third-party reference required (Sandhills, Black Book, Iron Planet) plus UEM lock** | Most defensible. Slowest. |
| **D. Rep appraises with reference, UEM only required above a dollar threshold** | Engineering recommendation. Threshold of $25K trade value as a starting point. |

**Sample answer:** D with $25K threshold.

**Your answer (and threshold if applicable):** _____________

**Follow-up — When does the trade value lock?**
- At quote send to customer
- At customer acceptance
- At physical inspection (post-acceptance)
- Other: _____________

---

#### DP 1.6 — Trade-in over-allowance accounting

**Question:** When the rep gives the customer more than the trade is actually worth to move a deal, where does that loss live?

| Option | What it means |
|---|---|
| **A. Always against sales commission** | Punishes rep for over-allowing. Tightest control. |
| **B. Always against used inventory** | Cleanest accounting. Removes rep incentive to negotiate tight. |
| **C. Split: first $X against used, remainder against sales** | Engineering recommendation. Threshold makes rep feel the over-allowance without killing the deal incentive. |
| **D. Owner-discretion per deal** | Manual every time. Doesn't scale. |

**Sample answer:** C with $1,000 free-allowance per deal, anything beyond hits sales credit.

**Your answer:** _____________

---

#### DP 1.7 — Freight handling

**Question:** When the OEM charges freight to deliver equipment to your yard, how does that show on the customer quote?

| Option | What it means |
|---|---|
| **A. Always pass through as a line item** | Customer sees freight transparently. |
| **B. Always absorbed into unit price** | Customer sees one number. Hides cost. |
| **C. Pass-through above a threshold, absorbed below** | Small-freight deals stay clean, big-freight deals are explicit. |
| **D. Rep discretion per quote** | Maximum flexibility. Inconsistent across reps. |

**Sample answer:** A for transparency unless the customer specifically requests an all-in price. Allow rep to switch to absorbed mode with one click, but log the choice for audit.

**Your answer:** _____________

**Follow-up:** When *you* eat freight to win a deal (i.e. customer doesn't pay it), how is that captured?
- As a discount line on the quote
- As an internal margin hit (invisible to customer)
- Requires owner approval
- Other: _____________

---

#### DP 1.8 — PDI / setup / dealer prep fees

**Question:** Pre-Delivery Inspection (PDI), setup, and dealer prep — how do these show up?

| Option | What it means |
|---|---|
| **A. Mandatory line item on every quote** | Always charged, always visible. |
| **B. Optional line, rep can include or omit** | Flexibility. Lost revenue risk if reps habitually omit. |
| **C. Bundled into unit price, invisible** | Customer sees clean number. Loses optionality to break out for warranty disputes. |
| **D. Mandatory line, but waivable with manager approval** | Engineering recommendation. Default = charged, waiver requires approval. |

**Sample answer:** D.

**Your answer:** _____________

**Follow-up:** Provide the current PDI / setup / prep fee schedule per category:

| Category | Standard fee |
|---|---|
| Compact equipment (skid steers, CTLs, mini-ex) | |
| Mid-size equipment | |
| Heavy equipment | |
| Implements / attachments | |
| Used equipment (varies) | |

---

#### DP 1.9 — Pricing rounding

**Question:** Final customer-facing quote prices — rounded how?

| Option | What it means |
|---|---|
| **A. No rounding, penny-accurate** | $186,427.39 |
| **B. Round to nearest dollar** | $186,427 |
| **C. Round to nearest $100** | $186,400 |
| **D. Round to "psychological" price points** | $186,500 or $186,000 — rep discretion within a band |

**Sample answer:** B. No reason to expose pennies; "psychological" rounding tempts under-the-floor discounts.

**Your answer:** _____________

---

### Cluster B — Rebates, Incentives & Special Pricing Requests (SPRs)

#### DP 2.1 — Rebate visibility to reps

**Question:** Which rebates can reps see on their pricing screen, and which are hidden (owner margin protection)?

| Option | What it means |
|---|---|
| **A. All rebates visible to reps** | Maximum transparency. Rebates often get "given away" in negotiation. |
| **B. Customer-facing rebates visible; dealer-only rebates hidden** | Customer-facing = the OEM intends the customer to know. Dealer-only = OEM is funding margin. |
| **C. All hidden except published OEM customer programs** | Most conservative. Reps may feel disempowered. |
| **D. Per-rebate-type visibility flag** | Engineering recommendation. You categorize each rebate as rep-visible or owner-only. |

**Sample answer:** D, with a default of "owner-only" for any newly added rebate until you flip it.

**Your answer:** _____________

---

#### DP 2.2 — Stackable vs. exclusive rebates

**Question:** Can multiple manufacturer rebates apply to the same quote line?

| Option | What it means |
|---|---|
| **A. All stackable by default** | Maximum margin, simplest UX. |
| **B. Exclusive by default — only the largest applies** | Conservative. Reflects most OEM contracts. |
| **C. Per-rebate stackability flag** | Engineering recommendation. Each rebate row carries `is_stackable_with_kinds[]`. |
| **D. Rep / manager decides per quote** | Manual every time. Errors. |

**Sample answer:** C — most accurate to how OEMs actually write their programs.

**Your answer:** _____________

---

#### DP 2.3 — Stacking rebates with customer-specific discounts

**Question:** Can a customer-specific discount (DP 1.2) stack on top of an OEM rebate?

| Option | What it means |
|---|---|
| **A. Always allowed** | Customers get both. Best price to customer, worst margin. |
| **B. Never allowed — pick the better one** | Customer gets the better of (rebate, discount), not both. |
| **C. Allowed up to combined-discount cap** | E.g. combined never exceeds 12% off list. |
| **D. Allowed only with manager approval** | Slows down quotes, protects margin. |

**Sample answer:** C with a 12% combined cap as a starting point.

**Your answer (and cap %):** _____________

---

#### DP 2.4 — Special Pricing Requests (SPRs)

**Question:** When a rep needs to ask the OEM for a special price (volume deal, government bid, competitive displacement), how does that flow?

| Option | What it means |
|---|---|
| **A. Rep emails OEM directly, manually updates quote when response comes back** | Current state at most dealerships. Slow, no audit. |
| **B. System generates the SPR submission, rep approves and sends, OEM response auto-applied to quote** | Engineering target. Requires OEM email parsing or portal integration. |
| **C. SPR routes through owner before going to OEM** | Conservative. Slow. Best margin protection. |
| **D. Hybrid: under $X SPR is rep-driven, above $X routes through owner** | Engineering recommendation. Threshold of $100K deal value as default. |

**Sample answer:** D with $100K threshold; build B-style auto-submission for top 3 OEMs in Phase 2.

**Your answer (and threshold if D):** _____________

---

#### DP 2.5 — Rebate eligibility by customer

**Question:** Some rebates exclude certain end-users (e.g., competitor rentals, government, end-user vs. dealer-installed). How do we encode that?

| Option | What it means |
|---|---|
| **A. Manual rep judgment per quote** | Fastest. Most error-prone. |
| **B. Per-customer tags (`rebate_ineligible_kinds[]`)** | Rep tags customer once, system enforces forever. |
| **C. Per-rebate eligibility rules** | E.g. rebate row says `excludes_segments: ['government', 'rental_houses']`. |
| **D. Both B and C** | Engineering recommendation. Rebate AND customer carry their own constraints; system intersects. |

**Sample answer:** D.

**Your answer:** _____________

---

#### DP 2.6 — Co-op fund tracking

**Question:** Many OEMs offer co-op marketing funds. Does QEP OS need to track them, or are they handled outside the quote process?

| Option | What it means |
|---|---|
| **A. Out of scope — handled in marketing/finance separately** | Cleanest. Quote stays focused on price. |
| **B. Track co-op accrual per quote** | Quote earns co-op dollars at order; finance reconciles. |
| **C. Track AND apply co-op to deal margin in real-time** | Most accurate margin number per deal. Most complex. |

**Sample answer:** A for Phase 1, B for Phase 2 if finance asks for it.

**Your answer:** _____________

---

### Cluster C — Approval Workflow

#### DP 3.1 — Dollar thresholds beyond margin floor

**Question:** Margin Floor Gate handles low-margin approvals. What other thresholds trigger approval requirements?

**Sample policy to react to:**

| Quote value | Approval required |
|---|---|
| < $25K | Rep self-approve |
| $25K – $100K | Sales Manager approval |
| $100K – $500K | VP Sales approval |
| $500K – $1M | Owner approval |
| > $1M | Owner + Finance approval |

**Your policy (amend the table above or write your own):**

| Quote value | Approval required |
|---|---|
| | |

---

#### DP 3.2 — Escalation when approver is unavailable

**Question:** Approver is on vacation, sick, or unreachable. What happens to a quote needing their sign-off?

| Option | What it means |
|---|---|
| **A. Quote waits indefinitely** | Safest. Worst for revenue. |
| **B. Auto-escalates to designated alternate after 24h** | Engineering recommendation. Define each role's alternate below. |
| **C. Auto-approves below a tighter threshold after 48h** | Risky. Could ship under-floor quotes. |
| **D. Notifies rep to escalate manually** | Puts burden on rep. |

**Sample answer:** B with 24h timeout.

**Your answer:** _____________

**Follow-up — provide the alternate chain:**

| Primary approver role | Alternate (24h) | Second alternate (48h) |
|---|---|---|
| Sales Manager | | |
| VP Sales | | |
| Owner | | |
| Finance | | |

---

#### DP 3.3 — Out-of-policy approval reason capture

**Question:** When an approver overrides policy (e.g. approves below floor), how is the reason captured?

| Option | What it means |
|---|---|
| **A. Click-to-approve, no reason required** | Fastest. Worst audit trail. |
| **B. Free-text reason required (typed)** | Standard. Reasons get terse. |
| **C. Reason picker from a curated list, with optional free-text** | Engineering recommendation. Forces categorization. |
| **D. Voice note required** | Best signal. Slowest. |

**Sample answer:** C, with the reason list:
- Competitive displacement
- Long-term customer relationship
- Strategic OEM relationship
- Volume play (multi-unit)
- Trade-in rebalance
- One-time exception (rep notes free-text)

**Your answer (and amend the list):** _____________

---

#### DP 3.4 — Approval bypass rules

**Question:** Existing migration [565_approval_bypass_rules.sql](supabase/migrations/565_approval_bypass_rules.sql) can encode bypass conditions (e.g., "skip approval if customer is in tier 'Strategic' and margin is above floor"). When do bypasses fire?

| Option | What it means |
|---|---|
| **A. No bypasses — everything routes through normal approval** | Simplest. Slowest. |
| **B. Bypasses defined and visible to owner; rep doesn't see them** | Owner controls; rep just sees "no approval needed." |
| **C. Bypasses defined, visible to rep too** | Reps understand the rules. Risk: reps game the rules. |

**Sample answer:** B. Reps never know exactly why a quote bypassed approval, prevents gaming.

**Your answer:** _____________

**Follow-up — define initial bypass conditions:**

| Bypass rule | Example | Active? (Y/N) |
|---|---|---|
| Strategic customer tier + margin above floor | Tier-tagged accounts above 18% | |
| Repeat customer + same equipment + price within 5% of prior | "Same as last year" deals | |
| Internal customer / employee purchase | Pre-defined customer list | |
| Other: _____________ | | |

---

#### DP 3.5 — Post-approval edits

**Question:** Quote is approved. Rep adds a line, changes a quantity, or applies a new rebate. What happens? (Hooks exist via [566_quote_post_approval_action.sql](supabase/migrations/566_quote_post_approval_action.sql).)

| Option | What it means |
|---|---|
| **A. Any edit re-routes for full approval** | Safest. Most friction. |
| **B. Margin-affecting edits re-route; cosmetic edits proceed** | Engineering recommendation. System computes whether the edit affects margin. |
| **C. Rep can edit freely; approver notified after the fact** | Worst margin protection. |
| **D. Per-field rules — quantity changes re-route, line-item text changes don't** | Most accurate. Most policy maintenance. |

**Sample answer:** B.

**Your answer:** _____________

**Follow-up:** Define "margin-affecting" — any change >X% or >$Y?
- Engineering default: any change that moves quote total by more than 2% OR $500
- Your number: _____________

---

#### DP 3.6 — Manager approval on behalf of absent rep

**Question:** Rep is at a jobsite with no signal. Customer says "do the deal." Can a Sales Manager send the quote on the rep's behalf?

| Option | What it means |
|---|---|
| **A. Never — rep must send their own quotes** | Cleanest attribution. Misses deals. |
| **B. Manager can send with rep's verbal authorization captured (voice note attached)** | Engineering recommendation. Audit trail intact. |
| **C. Manager can send freely on behalf of any rep** | Worst attribution. |

**Sample answer:** B.

**Your answer:** _____________

**Follow-up:** Does the rep still earn full commission when a manager sends on their behalf? _____________

---

## 5. Data we need from you to start

- [ ] Answered DPs 1.1 through 3.6 (28 decision points)
- [ ] Margin floor by category (DP 1.3)
- [ ] Volume discount waterfall table (DP 1.4)
- [ ] Trade-in valuation threshold (DP 1.5)
- [ ] PDI fee schedule (DP 1.8)
- [ ] Approval threshold table (DP 3.1)
- [ ] Approver alternate chain (DP 3.2)
- [ ] Out-of-policy reason list (DP 3.3)
- [ ] Initial bypass rules (DP 3.4)
- [ ] List of customer tiers with discount schedules (if DP 1.2 = C or E)
- [ ] List of strategic customers eligible for bypass rules
- [ ] List of customers under contract-locked pricing (overlaps with OEM Decision 6)
- [ ] Categorization of every active OEM rebate as "rep-visible" or "owner-only" (DP 2.1)

---

## 6. Data we will be touching

| Table | What it holds | Who can see it |
|---|---|---|
| `pricing_policy` | Per-category margin floor, target margin, rounding rule | Owner, VP Sales, Engineering |
| `customer_pricing_tiers` | Tier definitions, discount schedules | Owner, VP Sales, Sales Managers |
| `customer_rebate_eligibility` | Per-customer rebate exclusions | Owner, Sales Managers |
| `volume_discount_schedule` | Unit-count waterfall steps per category | Owner, VP Sales |
| `approval_policy` | Dollar/margin thresholds → required approver role | Owner |
| `approval_bypass_rules` | (existing — populate with your rules) | Owner only |
| `approval_alternate_chain` | Primary → alternate → second alternate per role | Owner, IT |
| `quote_approval_audit` | Every approval, override, and bypass with reason and approver | Owner, Finance, Engineering (read-only) |

All RLS-enforced by workspace and role.

---

## 7. Risks if we get this wrong

| Risk | Mitigation |
|---|---|
| **Policy too tight — reps can't quote without approval** | Phase 1 launches with permissive thresholds; we tighten quarterly based on data. |
| **Policy too loose — margin leak continues** | Owner dashboard surfaces variance from policy weekly. If reps are bypassing rules regularly, the rules are wrong (or the reps are wrong). |
| **Approver becomes bottleneck** | Alternate chain (DP 3.2) plus 24h timeout. Owner gets weekly report on approval response time. |
| **Bypass rules become rep gossip** | DP 3.4 keeps bypasses invisible to reps; only owner sees the rule set. |
| **Trade-in over-allowance becomes silent rep tool** | DP 1.6 forces accounting visibility per deal; owner reviews monthly. |
| **Customer-specific discount becomes "for any customer you like"** | Discounts are tied to customer record, not quote — rep can't just type a discount without naming who it's for. |

---

## 8. What success looks like

90 days after launch:

- 100% of quotes routed against the written policy (no untracked side-channel approvals)
- < 10% of approvals are out-of-policy overrides (high override rate = policy is wrong)
- Average margin within 1 point of category target (DP 1.3)
- Approval response time median under 4 business hours
- Owner can answer "what's our average gross margin this quarter, and which 3 reps are dragging it down" in 30 seconds from the dashboard
- Zero quotes shipped below margin floor without explicit owner override on file

---

## 9. What happens after this document is answered

1. **Day 1–2** — Schema additions for policy tables; admin UI for entering thresholds and tier schedules
2. **Day 3–4** — Pricing builder reads policy; cost visibility flag enforced (DP 1.1)
3. **Day 5–6** — Approval engine wires DP 3.1 thresholds, DP 3.2 escalation, DP 3.5 post-edit re-route
4. **Day 7** — Bypass rules engine (DP 3.4); rebate eligibility evaluator (DP 2.5)
5. **Day 8** — Trade-in over-allowance accounting (DP 1.6); freight handling flag (DP 1.7)
6. **Day 9** — Out-of-policy reason capture (DP 3.3); audit dashboard for owner
7. **Day 10** — End-to-end test with pilot reps; soft launch
8. **Day 11–40** — 30-day calibration period; weekly variance reports to owner

---

## 10. Open questions we expect pushback on

1. **DP 1.1 (cost visibility):** This is the most political. Tenured reps will argue they need cost to negotiate. New hires will argue they're being treated as untrustworthy. Owner has to make this call directly; we will not infer.
2. **DP 3.4 (bypass rules):** Reps will eventually figure out the bypasses exist. Once they do, they will try to engineer their quotes into the bypass conditions. Owner should plan to refresh the rule set quarterly.
3. **DP 1.6 (trade over-allowance):** This is the single biggest unspoken margin leak at most dealerships. If reps push back hard on this one, that's evidence we're touching something real.
4. **DP 2.4 (SPR routing):** Auto-submission requires OEM-side integration that varies wildly. We may have to do D (hybrid) forever for some OEMs because their SPR process is email-only.
5. **DP 3.1 (thresholds):** Our sample thresholds are starting points. Real numbers depend on QEP's average deal size, which we'll calibrate from `crm_deals` history before locking the policy.

---

## 11. Returning your answers

Send answers back to engineering as a markdown reply, an email with the questions and your answers numbered, or a meeting recording with engineering present. Format doesn't matter; clarity does.

If you skip any decision point, engineering will default to the sample answer and flag it as "owner-deferred." You can override later, but the system will run on the default until you do.

---

## Appendix A — Glossary

- **Margin floor** — the minimum margin % allowed before a quote needs sign-off (already enforced by Margin Floor Gate).
- **Target margin** — the *aimed-for* margin in the pricing builder. Reps see how far above/below target they are in real-time.
- **Landed cost** — dealer cost including freight, PDI, and any other inbound charges. Distinct from list price.
- **Stack** — multiple rebates/incentives applied to one quote line.
- **SPR (Special Pricing Request)** — formal request to an OEM for pricing outside the published program, usually for volume or competitive displacement.
- **Bypass rule** — a condition that lets a quote skip normal approval routing.
- **Over-allowance** — paying more for a trade-in than its true market value, used as a hidden discount mechanism.

---

*End of Tier 1. Companion doc:* [Tier 2 — Lifecycle & Conversion](QEP-QUOTE-PROCESS-TIER-2-LIFECYCLE-CONVERSION-OWNER-DISCOVERY.md).
