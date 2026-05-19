# QEP OS — Quote Process Tier 3: Specialty Flows Discovery

**Audience:** Rental Manager, Service Manager, Parts Manager, Finance Lead, IT Lead, Operations Lead, Owner (final sign-off on commission and reporting)
**Read time:** ~35 minutes
**Decision time:** ~90 minutes (likely across two sessions because audience fans out)
**Companion docs:**
- [Tier 0 — OEM Price Feeds](QEP-OEM-PRICE-FEEDS-OWNER-DISCOVERY.md)
- [Tier 1 — Margin & Pricing](QEP-QUOTE-PROCESS-TIER-1-MARGIN-PRICING-OWNER-DISCOVERY.md)
- [Tier 2 — Lifecycle & Conversion](QEP-QUOTE-PROCESS-TIER-2-LIFECYCLE-CONVERSION-OWNER-DISCOVERY.md)

**Status:** Awaiting answers before build kickoff
**Date:** 2026-05-17

---

## 1. Why this document exists

Tiers 0–2 covered the main road of a sales quote. This document covers the *off-ramps* — the parts of the dealership where the standard quote flow doesn't quite fit:

- Rental and rent-to-own (a different product entirely)
- Customers who can't pay (credit gating)
- Used equipment, reconditioning, and parts kit nuances
- Service contracts and warranty attachments
- Commission structures and the owner's analytics
- The operational reality of multi-branch, offline, mobile-only, and legacy data

The danger of skipping this tier is that QEP OS becomes "great for new equipment sales, useless for everything else." That contradicts the mission statement, which explicitly names equipment **and parts**, **sales and rental**, for **employees, salesman, company corporate operations and management**.

Six clusters, ~34 decision points. We strongly recommend splitting the review across **two sessions**:

- **Session 1 (45 min):** Clusters A, B, C — Customer/Credit, Equipment/Parts, Rental. Audience: Owner + VP Sales + Rental Manager + Parts Manager + Used Eq Manager.
- **Session 2 (45 min):** Clusters D, E, F — Service, Reporting/Commissions, Operational Edge. Audience: Owner + Finance + IT + Service Manager.

Estimated build effort once answers are in: **~20 days** across Tier 3 enforcement, dashboards, and rental builder. Rental alone is ~10 of those days because it's effectively a second product surface.

---

## 2. What we are proposing to build

This tier is the largest in raw scope. Some of the infrastructure is in place, much is not:

**Already exists:**
- [283_qb_crm_extensions.sql](supabase/migrations/283_qb_crm_extensions.sql) — equipment fleet tracking per customer
- [578_equipment_override_price_column.sql](supabase/migrations/578_equipment_override_price_column.sql) — manual price overrides
- IntelliDealer integration ([568_intellidealer_snapshot_generic_stage.sql](supabase/migrations/568_intellidealer_snapshot_generic_stage.sql))
- M365 mailbox sync ([571_m365_mailbox_sync.sql](supabase/migrations/571_m365_mailbox_sync.sql))

**Needs to be built:**
- Rental rate engine and rental quote surface (no existing scaffolding found)
- Customer credit profile and gating
- Used equipment appraisal capture
- Parts kit catalog and rep-build flow
- Service contract / warranty attachment lines
- Commission calculation engine
- Owner analytics dashboard (some of this exists per [QEP-Owner-Dashboard-Moonshot-Ship-Report](QEP-Owner-Dashboard-Moonshot-Ship-Report-2026-04-16.md) — needs reconciliation)
- Offline-first mobile quote capture
- HubSpot legacy data migration plan

---

## 3. What the rep / customer / owner will see when this lands

**Rep:**
- New "Rental" quote type with day/week/month rate selector and pickup/delivery scheduler
- Credit indicator badge on every customer (green / yellow / red) before they start a quote
- Used equipment appraisal flow with photo capture and reference price lookup
- Parts kit picker auto-suggests kits when an equipment line is added
- Service contract and warranty extension auto-attached as optional lines on new equipment
- Commission preview on every quote ("if this closes at this price, you earn $X")

**Customer:**
- Rental quotes show pickup/delivery, damage waiver, insurance requirements upfront
- Service contracts presented as bundles ("3-year peace of mind: $4,800")

**Owner:**
- Per-rep scorecard with the metrics defined in DP 5.5
- Commission accrual and clawback dashboard
- Rental fleet utilization rate by category
- Win/loss intelligence from Tier 2 fed into competitive briefings

---

## 4. Decision Points

---

### Cluster A — Customer Setup & Credit Gating

#### DP 1.1 — New customer credit gating

**Question:** Can a rep build a quote for a brand-new customer who has no credit file on record?

| Option | What it means |
|---|---|
| **A. Yes, no gate** | Fastest. Risk of wasted sales cycles on uncreditworthy customers. |
| **B. Yes, but quote is marked "subject to credit approval" until credit is run** | Engineering recommendation. Rep can proceed, customer-facing PDF carries the caveat. |
| **C. No — credit must be run before quote can be drafted** | Most conservative. Slows down new customer acquisition. |
| **D. Cash deals exempt; financed deals gated** | Hybrid. Requires DP 1.5 answered. |

**Sample answer:** B for Phase 1, D as a refinement.

**Your answer:** _____________

---

#### DP 1.2 — Over-credit-limit handling mid-quote

**Question:** Existing customer is over their credit limit. Rep is building a quote that would push them further over. What happens?

| Option | What it means |
|---|---|
| **A. Block — cannot send quote** | Safest. Loses sales opportunity. |
| **B. Warn rep, allow with manager approval** | Engineering recommendation. |
| **C. Warn rep silently in UI, no approval gate** | Rep judgment. |
| **D. No check** | What happens today at most dealerships. |

**Sample answer:** B.

**Your answer:** _____________

---

#### DP 1.3 — One-time exception authority

**Question:** Who can grant a one-time credit exception (e.g., approve a quote for an over-limit customer)?

| Option | What it means |
|---|---|
| **A. Finance / Controller only** | Cleanest authority. Slowest. |
| **B. Owner only** | Bottleneck risk. |
| **C. Finance or VP Sales, with logging** | Engineering recommendation. |
| **D. Any manager** | Loose. Risks rep-shopping the exception. |

**Sample answer:** C.

**Your answer:** _____________

---

#### DP 1.4 — Customer tiers

**Question:** Do you operate customer tiers (Platinum / Gold / Standard / Cash-only / Prospect / etc.), and do they unlock different pricing or terms?

| Option | What it means |
|---|---|
| **A. No tiers — all customers treated equal** | Simple. Misses revenue from loyalty. |
| **B. Tiers exist informally (rep tribal knowledge)** | Current state. Unmeasurable. |
| **C. Formal tiers tied to pricing (overlaps Tier 1 DP 1.2)** | Engineering recommendation. |
| **D. Formal tiers tied to pricing AND terms (payment days, deposit %, etc.)** | Most comprehensive. |

**Sample answer:** D.

**Your answer:** _____________

**Follow-up — Tier definitions:**

| Tier name | Discount eligibility | Payment terms (net days) | Deposit % | Credit limit policy |
|---|---|---|---|---|
| Platinum | | | | |
| Gold | | | | |
| Standard | | | | |
| Cash-only | | | | |
| Prospect / new | | | | |

---

#### DP 1.5 — Cash vs. financed deal pricing

**Question:** Do cash deals and financed deals have different pricing?

| Option | What it means |
|---|---|
| **A. Same price regardless of payment method** | Cleanest. |
| **B. Cash discount (e.g. 1-2% off list)** | Common practice. Incentivizes cash. |
| **C. Financed deals carry a "finance fee" hidden in margin** | Recovers the cost of dealer-arranged financing. |
| **D. Different pricing only when OEM financing program is involved** | Reflects subvention reality. |

**Sample answer:** D.

**Your answer:** _____________

---

#### DP 1.6 — Tax-exempt / government customers

**Question:** Tax-exempt customers (government, agriculture, non-profit). When is proof of exemption captured?

| Option | What it means |
|---|---|
| **A. At quote time (cannot quote without exemption certificate on file)** | Safest. Slows new exempt customers. |
| **B. At order time (quote can proceed; certificate required before invoice)** | Engineering recommendation. |
| **C. At delivery / invoicing only** | Loosest. Audit risk. |

**Sample answer:** B.

**Your answer:** _____________

**Follow-up:** Where does the exemption certificate live?
- Customer record attachment
- Order record attachment
- Both
- Other: _____________

---

### Cluster B — Equipment & Parts Selection

#### DP 2.1 — Used equipment appraisal source

**Question:** How is used equipment appraised before it lands on a quote (either as a sale unit or as a trade-in)?

| Option | What it means |
|---|---|
| **A. Internal appraisal by Used Equipment Manager (UEM)** | Fastest. Subjective. |
| **B. Reference source required (Sandhills, Black Book, Iron Planet, IronGuides)** | Defensible. Subscription cost. |
| **C. Internal + reference required for trades over $X** | Engineering recommendation. Combines speed and defensibility. |
| **D. AI-assisted (computer vision condition assessment + reference lookup)** | Aspirational. Phase 2 feature. |

**Sample answer:** C with $25K threshold (matches Tier 1 DP 1.5).

**Your answer:** _____________

**Follow-up:** Which reference source do you currently subscribe to? Provide credentials/access for integration: _____________

---

#### DP 2.2 — Stock unit lock mechanism

**Question:** When a rep adds a specific stock unit (with a serial number) to a quote, when is that unit "claimed"?

This overlaps with Tier 2 DP 4.5 (inventory soft-hold). The specific question here is whether *used* equipment behaves the same as new.

| Option | What it means |
|---|---|
| **A. Same as new equipment (soft hold at draft, hard hold at acceptance)** | Consistent. |
| **B. Used equipment requires immediate hard hold at draft** | Used inventory is one-of-a-kind; risk of double-quoting is higher. |
| **C. Hard hold at draft AND requires UEM approval to release** | Most conservative. UEM becomes bottleneck. |

**Sample answer:** B for used; consistent with Tier 2 for new.

**Your answer:** _____________

---

#### DP 2.3 — Reconditioning cost capture

**Question:** Used equipment often needs reconditioning before sale. How is recon cost captured against the unit?

| Option | What it means |
|---|---|
| **A. Captured in ERP, not visible in QEP OS** | Disconnects margin calculation. |
| **B. Captured in QEP OS at intake; rolls into landed cost** | Engineering recommendation. Margin floor (Tier 1) computes against true cost. |
| **C. Captured in QEP OS at sale; subtracted from gross margin at conversion** | Backwards. Hides true margin during pricing. |

**Sample answer:** B.

**Your answer:** _____________

---

#### DP 2.4 — Equipment substitution suggestions

**Question:** Rep quotes a 5T forklift. You only have 6T in stock. Should the system suggest substitution?

| Option | What it means |
|---|---|
| **A. No — rep researches alternatives manually** | Current state. |
| **B. Suggest substitutes from in-stock inventory within ±25% spec** | Engineering recommendation. |
| **C. Suggest substitutes including incoming inventory (PO not yet received)** | More aggressive. Risk of quoting equipment that never arrives. |
| **D. Suggest substitutes including used equipment** | Cross-sells used into new quotes. |

**Sample answer:** B for Phase 1, D as a follow-up after used inventory data is reliable.

**Your answer:** _____________

---

#### DP 2.5 — Parts kit ownership

**Question:** Pre-defined parts kits (e.g., "50-hour service kit for X model") — who owns the kit definitions?

| Option | What it means |
|---|---|
| **A. Parts Manager owns; reps choose from catalog only** | Cleanest data. Reps inflexible. |
| **B. Parts Manager owns standard kits; reps can build one-off kits per quote** | Engineering recommendation. |
| **C. Anyone can build kits; Parts Manager curates them later** | Chaotic. |

**Sample answer:** B.

**Your answer:** _____________

---

#### DP 2.6 — Discontinued / superseded parts on open quotes

**Question:** A part on an open quote is discontinued by the OEM (or superseded by a new part number). What happens?

| Option | What it means |
|---|---|
| **A. Auto-substitute to the new part number; alert rep** | Engineering recommendation. Customer-facing PDF references the substitute. |
| **B. Quote flagged for rep review; line removed** | Conservative. |
| **C. Quote remains valid; rep figures it out at order time** | Risky. |

**Sample answer:** A.

**Your answer:** _____________

---

### Cluster C — Rental & Subscription Quotes

#### DP 3.1 — Rate structure

**Question:** How do you publish rental rates?

| Option | What it means |
|---|---|
| **A. Daily / weekly / monthly schedule per equipment category** | Standard. |
| **B. Same + blended rate option (long-term rentals priced at a per-month blended rate)** | Engineering recommendation. |
| **C. Per-unit rates (each specific stock unit has its own rate)** | Most granular. Most maintenance. |
| **D. Dynamic pricing (utilization-based — higher rates when fleet is tight)** | Aspirational. Phase 3 feature. |

**Sample answer:** B for Phase 1, D as a Phase 3 moonshot.

**Your answer:** _____________

**Follow-up — provide current rate sheet for top 5 rental categories:**

| Category | Daily | Weekly | Monthly | Blended (3mo+) |
|---|---|---|---|---|
| Skid steers | | | | |
| Compact track loaders | | | | |
| Mini-excavators | | | | |
| Telehandlers | | | | |
| Wheel loaders | | | | |

---

#### DP 3.2 — Minimum rental, auto-extend, early-return

**Question:** Default rental terms:

| Term | Sample policy | Your policy |
|---|---|---|
| Minimum rental period | 1 day | |
| Auto-extend if not returned by end date | Yes — charged at daily rate until returned | |
| Early-return refund | Pro-rated refund minus 1-day fee | |
| Notice required to return | None (drop off any time) | |

---

#### DP 3.3 — Damage waiver, insurance, operator, fuel

**Question:** Which of these are required vs. optional vs. customer-supplied?

| Add-on | Required | Optional | Customer-supplied | Pricing |
|---|---|---|---|---|
| Damage waiver | | | | |
| Liability insurance | | | | |
| Operator | | | | |
| Fuel (delivered full, returned full?) | | | | |
| Delivery / pickup | | | | |

**Sample answer:** Damage waiver = optional but heavily upsold; liability insurance = required (customer-supplied OK with proof of insurance); operator = optional; fuel = full-to-full; delivery = optional with mileage-based pricing.

**Your answer (fill table above).**

---

#### DP 3.4 — Pickup/delivery scheduling integration

**Question:** When a rental quote is built with delivery, how does scheduling happen?

| Option | What it means |
|---|---|
| **A. Free-text "preferred date" field; ops schedules separately** | Current state at most dealerships. |
| **B. Quote includes proposed delivery window; ops confirms before quote sends** | Engineering recommendation. |
| **C. Real-time calendar integration (ops calendar visible in quote builder)** | Most accurate. Largest integration scope. |

**Sample answer:** B for Phase 1, C in a later phase.

**Your answer:** _____________

---

#### DP 3.5 — Maintenance responsibility during rental

**Question:** Who handles maintenance and repair during a rental?

| Option | What it means |
|---|---|
| **A. Dealer handles all routine and breakdown maintenance** | Premium offering. |
| **B. Customer handles routine; dealer handles breakdowns** | Standard. |
| **C. Customer handles everything** | Cheapest. Worst for equipment longevity. |
| **D. Per-rental-tier (premium = A, standard = B)** | Engineering recommendation. |

**Sample answer:** D.

**Your answer:** _____________

---

#### DP 3.6 — Rental-to-own / buyout pricing

**Question:** Customer wants to buy the unit they've been renting. How is the buyout priced?

| Option | What it means |
|---|---|
| **A. Current used market value, no rental credit** | Best margin for dealer. Customer dissatisfaction. |
| **B. Used market value minus X% of paid rent (X = 50% typical)** | Engineering recommendation. Industry-standard. |
| **C. Original purchase price minus accumulated depreciation** | Cleanest accounting. May undersell. |
| **D. Negotiated per deal** | Inconsistent. |

**Sample answer:** B with X = 50% as the starting point.

**Your answer (and X% if B):** _____________

---

### Cluster D — Service, Parts & Attached Offerings

#### DP 4.1 — Service plans / maintenance contracts attached at quote

**Question:** When a rep quotes new equipment, should a service plan be auto-attached as an optional line?

| Option | What it means |
|---|---|
| **A. No — service plans sold separately post-delivery** | Current state. Lost attach revenue. |
| **B. Auto-attached as optional, rep can remove** | Engineering recommendation. |
| **C. Mandatory line — customer must explicitly decline** | Aggressive upsell. |

**Sample answer:** B.

**Your answer:** _____________

**Follow-up — provide service plan offerings:**

| Plan name | Coverage | Duration | Price (% of unit price OR fixed) |
|---|---|---|---|
| | | | |

---

#### DP 4.2 — Parts kit auto-suggestions

**Question:** When new equipment is added to a quote, should the standard service-interval parts kits auto-suggest?

| Option | What it means |
|---|---|
| **A. No** | Current state. |
| **B. Suggest first-service kit (typically 50-hour) as optional line** | Engineering recommendation. |
| **C. Suggest first-service AND major-service kits (250hr, 500hr, 1000hr) as bundle option** | Strongest attach. May be overkill at quote time. |

**Sample answer:** B for Phase 1, C as a follow-up.

**Your answer:** _____________

---

#### DP 4.3 — Warranty extension upsell

**Question:** OEM warranties are standard. Should QEP OS surface warranty extensions as optional lines?

| Option | What it means |
|---|---|
| **A. No** | Lost revenue. |
| **B. Surface as optional, rep can omit** | Engineering recommendation. |
| **C. Mandatory mention — customer must explicitly decline (DP 4.1 mirror)** | Aggressive. |

**Sample answer:** B.

**Your answer:** _____________

**Follow-up:** Are warranty extensions OEM-provided or dealer-provided?
- OEM only
- Dealer-provided (third-party administrator)
- Both, customer chooses
- Other: _____________

---

#### DP 4.4 — Training as a quote line

**Question:** Operator training on the equipment — included, paid line, or required for warranty?

| Option | What it means |
|---|---|
| **A. Included free, mentioned in quote notes** | Customer-friendly. Lost training revenue. |
| **B. Optional paid line** | Captures training revenue when relevant. |
| **C. Required line; customer must accept or sign off declination (for liability)** | Most defensible legally. |
| **D. Per-equipment-type (certain dangerous equipment = C, simple equipment = A)** | Engineering recommendation. |

**Sample answer:** D.

**Your answer:** _____________

**Follow-up — which equipment categories require training (DP 4.4 = C)?** _____________

---

### Cluster E — Reporting, Commissions & Analytics

#### DP 5.1 — Commission structure

**Question:** How are rep commissions calculated?

| Option | What it means |
|---|---|
| **A. Flat % of margin** | Cleanest. Rewards margin, not revenue. |
| **B. Flat % of revenue** | Rewards volume, not margin. |
| **C. Tiered % of margin (escalator above margin floor)** | Aligns rep with dealership profit goal. |
| **D. Tiered % of margin + volume accelerator (higher % above quarterly target)** | Engineering recommendation. Standard incentive structure. |

**Sample answer:** D.

**Your answer (and provide the tier schedule):**

| Margin range | Commission % |
|---|---|
| Below floor | 0% (no commission below floor) |
| Floor to target | |
| Above target | |
| Volume accelerator (above quarterly $$ target) | additional % bump |

---

#### DP 5.2 — Commission timing

**Question:** When does the rep actually earn commission?

| Option | What it means |
|---|---|
| **A. At quote send** | Encourages quote spam. Avoid. |
| **B. At customer acceptance (e-sign or PO)** | Earliest reasonable. |
| **C. At delivery to customer** | Standard. |
| **D. At customer-paid in full** | Most conservative. Cash-flow-aligned. |
| **E. Split: 50% at delivery, 50% at customer-paid** | Engineering recommendation. Balances rep cash flow with dealership cash flow. |

**Sample answer:** E.

**Your answer:** _____________

---

#### DP 5.3 — Commission clawback rules

**Question:** Customer returns equipment, refinances elsewhere, or doesn't pay. What happens to paid commission?

| Option | What it means |
|---|---|
| **A. Clawback in full** | Safest for dealership. Hurts rep morale. |
| **B. Clawback pro-rated by time elapsed** | Engineering recommendation. |
| **C. No clawback — dealership eats the loss** | Rep-friendly. Expensive. |
| **D. Per-scenario rules (return = clawback, refinance = no clawback, non-pay = clawback)** | Most fair. Most policy. |

**Sample answer:** D.

**Your answer (and per-scenario table):**

| Scenario | Clawback policy |
|---|---|
| Customer returns equipment within X days | |
| Customer non-payment | |
| Customer refinances with third party | |
| Customer cancels order before delivery | |

---

#### DP 5.4 — House deal margin handling

**Question:** Owner closes a deal directly (house deal — no rep). Where does the margin go?

| Option | What it means |
|---|---|
| **A. All to dealership** | Cleanest. |
| **B. Owner takes a "house commission" equal to the standard rep %** | Treats owner as a rep for incentive consistency. |
| **C. Split: 50% to dealership, 50% to a "house pool" distributed to reps annually** | Builds team morale. Complex. |

**Sample answer:** A.

**Your answer:** _____________

---

#### DP 5.5 — Per-rep scorecard metrics

**Question:** What metrics belong on the per-rep scorecard?

| Metric | Include? (Y/N) | Owner-visible only / rep also sees their own? |
|---|---|---|
| Pipeline value | | |
| Conversion rate (quote → order) | | |
| Average margin % | | |
| Quote velocity (quotes/week) | | |
| Response-to-lead time (median) | | |
| Customer satisfaction score | | |
| Re-engagement success rate | | |
| Approval bypass usage frequency | | |
| Out-of-policy override frequency | | |
| Year-over-year growth | | |
| Other: _____________ | | |

**Sample answer:** All Y, rep sees their own; owner sees all reps side-by-side.

---

#### DP 5.6 — Owner dashboard requirements

**Question:** What does the owner want to see on the dashboard at each cadence?

| Cadence | Metrics |
|---|---|
| **Daily glance** | Quotes sent yesterday, conversions yesterday, top-3 anomalies (large quote, large override, large dead deal) |
| **Weekly review** | Conversion funnel, margin variance vs. policy, rep scorecards, dead deal intel |
| **Monthly review** | Margin trends, OEM rebate capture, inventory turn rate, commission accruals |
| **Quarterly review** | YoY growth, market share trends, competitor displacement wins, training needs identified |

**Engineering recommendation:** above table is a solid starting point. Owner can amend.

**Your additions/removals:** _____________

---

### Cluster F — Operational Edge Cases

#### DP 6.1 — Multi-location rules

**Question:** Does QEP operate from multiple branches with different rules?

| Option | What it means |
|---|---|
| **A. Single-location dealership — no multi-branch rules needed** | Simplest. |
| **B. Multi-location, identical rules everywhere** | Branding/branch tag only. |
| **C. Multi-location, some rules per branch (pricing, OEM allocation, etc.)** | Most complex. |

**Your answer:** _____________

**Follow-up if B or C — list branches:**

| Branch name | Location | Sales / Rental / Both | Distinct rules from HQ? |
|---|---|---|---|
| | | | |

---

#### DP 6.2 — Offline-at-jobsite must-work scope

**Question:** Rep is at a jobsite with no signal. What MUST work in the QEP OS mobile app offline?

| Capability | Must work offline? (Y/N) |
|---|---|
| Log a visit | |
| Voice-record a note | |
| Build a draft quote | |
| Send a quote to customer | |
| Look up customer history | |
| View their pipeline | |
| Update a deal stage | |
| Capture trade-in photos | |
| Schedule a follow-up | |

**Sample answer:** Visit log = Y, voice note = Y, draft quote = Y, view customer history = Y (cached), send to customer = N (queue for sync), update deal stage = Y (queue for sync), photos = Y (queue for sync), follow-up = Y (queue for sync), pipeline view = Y (cached).

**Your answer (override the table):**

---

#### DP 6.3 — Mobile vs. desktop parity

**Question:** Are there things you want to keep desktop-only by design?

| Capability | Mobile + Desktop / Desktop-only |
|---|---|
| Multi-unit complex quote builder | |
| Margin Floor Gate override | |
| Approval bypass rule editing (owner) | |
| Commission reports | |
| Custom report builder | |
| Bulk customer import | |
| OEM price sheet upload (Tier 0 doc) | |
| Other: _____________ | |

**Sample answer:** All admin/configuration surfaces stay desktop-only. Rep-facing surfaces are mobile-first per the existing Wave Mobile Nav work.

**Your answer:** _____________

---

#### DP 6.4 — Voice capture field scope

**Question:** Which fields can a rep fill end-to-end with voice, vs. requires manual confirmation?

| Field | Voice OK end-to-end / Voice → manual confirm / Manual only |
|---|---|
| Visit notes (free-text body) | |
| Customer name selection | |
| Deal stage update | |
| Quote line items (equipment selection) | |
| Quote line items (parts selection) | |
| Quote pricing override | |
| Trade-in valuation | |
| Loss reason on dead deal | |
| Approval bypass reason | |

**Sample answer:** Free-text bodies and reasons = end-to-end. Anything with a dollar amount or that changes pricing requires manual confirmation step (voice fills it, rep taps to confirm).

**Your answer:** _____________

---

#### DP 6.5 — HubSpot legacy data treatment

**Question:** QRM Phase 1 is a HubSpot replacement. What happens to HubSpot data?

| Option | What it means |
|---|---|
| **A. Full migration — all customers, deals, activities, notes ported** | Cleanest customer experience. Largest migration effort. |
| **B. Customers + open deals migrated; activity history archived (read-only access)** | Engineering recommendation. |
| **C. Customers only; deals start fresh in QEP OS** | Forces rep re-engagement. Loses pipeline data. |
| **D. Nothing migrated; HubSpot stays as a read-only archive** | Easiest. Worst rep experience. |

**Sample answer:** B.

**Your answer:** _____________

**Follow-up:** Cutover date target?
- Hard cutover (HubSpot read-only as of date X)
- Soft cutover (parallel operation for Y weeks, then HubSpot read-only)
- Other: _____________

---

#### DP 6.6 — Multi-currency / multi-region planning horizon

**Question:** Will QEP OS need to support non-USD pricing or non-US regional rules in the next 24 months?

| Option | What it means |
|---|---|
| **A. US-only forever** | Cleanest. |
| **B. US-only for now; possibly Canada in 12–24 months** | Plan for CAD-readiness in schema, defer UI. |
| **C. US + Canada launching together** | Build for both from Day 1. |
| **D. US + Canada + Mexico** | Largest scope. |

**Sample answer:** A unless you have concrete expansion plans.

**Your answer:** _____________

---

#### DP 6.7 — Quote PDF language

**Question:** Quote PDF language — English only, or multi-language?

| Option | What it means |
|---|---|
| **A. English only** | Simplest. |
| **B. English + Spanish per customer preference** | Reflects many US dealer markets. |
| **C. English + Spanish + French (Canada)** | Tied to DP 6.6 = B/C/D. |

**Sample answer:** A unless you have a meaningful Spanish-preferring customer base.

**Your answer:** _____________

---

#### DP 6.8 — Integration with non-IntelliDealer systems

**Question:** Beyond IntelliDealer ERP, what other systems must QEP OS speak to?

| System | In scope? | Direction (read / write / both) | Notes |
|---|---|---|---|
| Accounting (QuickBooks, NetSuite, etc.) | | | |
| Inventory management (separate from IntelliDealer?) | | | |
| Marketing automation (HubSpot, Mailchimp) | | | |
| Service dispatch (Fieldpiece, ServiceTitan, etc.) | | | |
| OEM dealer portals | | | |
| Bank / lender portals | | | |
| Other: _____________ | | | |

---

## 5. Data we need from you to start

### From Owner
- [ ] DPs 5.1–5.6 (commission structure, scorecard metrics, dashboard requirements)
- [ ] DP 1.4 (customer tier definitions)
- [ ] DP 6.1 (multi-branch confirmation)
- [ ] DP 6.5 (HubSpot migration scope and cutover target)

### From Finance / Controller
- [ ] DPs 1.1–1.6 (credit gating policy, exception authority)
- [ ] DP 5.3 (clawback rules)
- [ ] Current accounting system integration requirements (DP 6.8)
- [ ] Tax-exemption certificate storage location preference (DP 1.6)

### From Used Equipment Manager
- [ ] DPs 2.1–2.3 (appraisal source, stock unit lock, recon cost)
- [ ] Reference source subscription credentials (DP 2.1)
- [ ] Current recon cost capture process documentation

### From Parts Manager
- [ ] DPs 2.5, 2.6, 4.2 (parts kits, supersession handling, auto-suggest)
- [ ] Current parts kit catalog (CSV export OK)
- [ ] OEM supersession data feed if you have one

### From Service Manager
- [ ] DPs 4.1, 4.3, 4.4 (service plans, warranty extensions, training)
- [ ] Service plan offerings table (DP 4.1)
- [ ] Training requirement list by equipment category (DP 4.4)

### From Rental Manager
- [ ] DPs 3.1–3.6 (rate structure, terms, waivers, scheduling, maintenance, buyout)
- [ ] Current published rate sheet (DP 3.1)
- [ ] Damage waiver and insurance policy documents (DP 3.3)

### From IT Lead
- [ ] DP 6.2 (offline capability scope)
- [ ] DP 6.3 (mobile/desktop parity)
- [ ] DP 6.8 (integration system list)
- [ ] M365 mailbox provisioning confirmation
- [ ] IntelliDealer API access confirmation (overlaps Tier 2)
- [ ] Confirmation that mobile app can store and sync offline data securely

### From VP Sales
- [ ] DP 6.4 (voice capture scope)
- [ ] DP 2.4 (substitution policy)
- [ ] Names of pilot reps for each new capability (overlap with prior tiers)

---

## 6. Data we will be touching

| Table | What it holds | Owner role for RLS |
|---|---|---|
| `customer_credit_profile` | Credit limit, current balance, payment terms, exemption certificates | Finance, Owner |
| `customer_tiers` | Tier assignments per customer | Owner, VP Sales |
| `used_equipment_appraisals` | Appraisal source, value, reconditioning cost, UEM approval | UEM, Owner |
| `parts_kits` | Kit definitions, parts lists, applicable equipment | Parts Manager |
| `rental_rates` | Daily/weekly/monthly/blended rates per category and per unit | Rental Manager, Owner |
| `rental_terms` | Min period, auto-extend, early-return rules | Rental Manager |
| `rental_addons` | Damage waiver, insurance, operator, fuel, delivery pricing | Rental Manager |
| `service_plans` | Plan offerings, coverage, pricing | Service Manager |
| `warranty_extensions` | OEM and dealer-provided extension options | Service Manager |
| `rep_commission_rules` | Tier schedule, accelerators, timing rules | Owner, Finance |
| `commission_accrual_ledger` | Per-rep accrual events, paid events, clawback events | Owner, Finance, the rep (own only) |
| `branch_config` | Multi-branch rules and overrides | Owner |
| `offline_sync_queue` | Pending actions captured offline awaiting sync | Per-rep |
| `hubspot_archive_link` | Mapping QEP OS customer/deal → HubSpot historical record | All authenticated reps |

All RLS-enforced by workspace, role, and ownership.

---

## 7. Risks if we get this wrong

| Risk | Mitigation |
|---|---|
| **Rental quote engine is built incorrectly and reps reject it** | Ship rental separately from sales quotes; pilot with rental-heavy reps before dealership-wide rollout. |
| **Credit gate blocks legitimate sales** | DP 1.1 = B (warn but proceed) for Phase 1; monitor block rate; tighten only if data supports it. |
| **Commission rules feel unfair** | DP 5.1 escalator must be designed with reps in the room. Engineering will draft, owner and reps approve together. |
| **Clawback rules cause rep turnover** | DP 5.3 must be transparent and pre-disclosed. No surprise clawbacks. |
| **HubSpot migration drops customer relationships** | DP 6.5 = B preserves archive access; reps can always click through to old HubSpot data during transition. |
| **Offline sync conflicts overwrite each other** | Last-write-wins is insufficient. We will use operation-based sync (CRDTs or operational transforms) for the high-collision fields per DP 6.2. |
| **Voice fills wrong dollar amount silently** | DP 6.4 enforces manual confirmation on all pricing fields. Engineering will hard-code this — no override. |
| **Multi-branch RLS leaks data across branches** | RLS policies tested against synthetic multi-branch dataset before any branch goes live. |
| **Warranty extension upsell feels pushy to customer** | DP 4.3 = B keeps it optional; never auto-add to total without rep including it. |
| **Rental fleet utilization data is wrong because rentals not captured cleanly** | Build rental capture as a primary path, not a special-case retrofit. |

---

## 8. What success looks like

90 days after launch:

- **Rental:** rental quote-to-order time drops by 50% vs. current process; rental fleet utilization is *measurable* per category
- **Credit:** zero quotes shipped to customers later flagged for non-payment within 12 months without an exception override on file
- **Used equipment:** 100% of trades over $25K have a reference source attached; recon cost is captured before unit reaches the sales floor
- **Parts:** parts kit attach rate on new equipment sales increases by at least 30%
- **Service:** service plan attach rate on new equipment sales increases by at least 20%
- **Commissions:** zero rep escalations about commission calculation; ledger reconciles to-the-penny with finance reports
- **Owner dashboard:** owner uses the dashboard daily without engineering hand-holding; weekly anomaly alerts trigger real conversations
- **Offline:** field reps can complete a full visit-log + draft-quote cycle on a jobsite with no signal, and have it sync cleanly when back online
- **HubSpot:** no customer relationship lost in cutover; <5% of reps need archive lookups beyond 30 days post-cutover

---

## 9. What happens after this document is answered

Phased to avoid 20 days of build before any user sees value:

### Phase A (Days 1–6) — Foundation
1. Customer tier and credit schema
2. Used equipment appraisal capture
3. Multi-branch config (if DP 6.1 = C)

### Phase B (Days 7–12) — Rental
4. Rental rate engine
5. Rental quote builder UI
6. Rental terms, waivers, and add-ons
7. Pickup/delivery scheduling integration
8. Buyout pricing

### Phase C (Days 13–16) — Attached offerings
9. Service plan auto-attach
10. Parts kit auto-suggest
11. Warranty extension upsell
12. Training requirement enforcement

### Phase D (Days 17–20) — Commissions and Owner Analytics
13. Commission calculation engine
14. Accrual ledger and clawback logic
15. Per-rep scorecard
16. Owner dashboard reconciliation with existing moonshot work

### Phase E (Days 21+) — Cross-cutting
17. Offline sync engine improvements
18. Voice capture confirmation gates
19. HubSpot migration tooling and cutover
20. Multi-currency readiness (schema only if DP 6.6 = A)

Each phase ships independently with its own pilot cohort.

---

## 10. Open questions we expect pushback on

1. **DP 1.4 (customer tiers):** Most dealerships have informal tiers in rep heads. Codifying them will surface inconsistencies — Rep A's "Platinum" customer is Rep B's "Standard." This is uncomfortable but valuable.
2. **DP 3.1 (rental rates):** Published rate sheets are often outdated at most dealerships. The migration exercise will force you to confront which rates are real.
3. **DP 5.1–5.3 (commission):** This is the most politically charged section. Reps will argue every clause. Owner should make the structural decision; rep input is welcomed on the *numbers*, not the *structure*.
4. **DP 5.4 (house deals):** Some owners prefer to not draw house commission for tax/equity reasons. We don't have an opinion here — owner's call.
5. **DP 6.2 (offline scope):** Engineering recommends being aggressive on offline capability; PM may push back due to sync complexity. Cost is real, but field rep happiness depends on this.
6. **DP 6.5 (HubSpot):** Migration always takes longer than estimated. We will deliver a dry-run migration into a sandbox before any production cutover; expect at least 2 weeks between dry-run sign-off and production cutover.
7. **DP 4.4 (training):** Liability considerations may push category C harder than the sample recommends. Worth a legal review.
8. **DP 6.6 (multi-currency):** Easy to over-architect for "someday." Schema-readiness has near-zero cost; UI/UX work is significant. Build readiness only when concrete plans exist.

---

## 11. Returning your answers

Given the audience fans out across 6+ people, we recommend:

1. **First pass:** Each role-owner fills in their cluster independently (Rental Manager fills Cluster C, etc.) within 7 days.
2. **Reconciliation session:** 60-minute session with all role-owners + engineering + owner to resolve cross-cluster conflicts (e.g., DP 5.1 commission structure interacts with DP 1.4 customer tiers).
3. **Owner sign-off:** Owner approves the consolidated answers (no formal signature required per your preference, just an "approved" reply on the consolidated doc).

Unanswered DPs default to sample answers with "owner-deferred" flags, same as Tiers 0–2.

---

## Appendix A — Glossary

- **UEM (Used Equipment Manager)** — the role responsible for appraising and managing used inventory.
- **Recon (Reconditioning)** — work performed on used equipment between intake and resale.
- **Subvention** — OEM-funded financing discount (e.g., "0% for 60 months").
- **OAC (On Approved Credit)** — financing terms contingent on credit approval.
- **Buyout** — converting a rental into a sale (customer keeps the unit).
- **Damage waiver** — fee customer pays to limit their liability for equipment damage during rental.
- **Subvention** — OEM-funded financing rate (e.g., "0% for 60 months"); requires the dealer to absorb the spread or the OEM covers it.
- **Soft hold / hard hold** — inventory commitment levels (see Tier 2 glossary).
- **Clawback** — recovery of paid commission when the underlying deal goes bad.
- **Accelerator** — bonus commission % that kicks in above a target threshold.
- **Sync queue** — offline operations stored locally and replayed when connectivity returns.
- **CRDT (Conflict-free Replicated Data Type)** — data structures that merge concurrent edits without conflict; useful for offline-first sync.

---

*End of Tier 3. Companion docs:* [Tier 0 — OEM Price Feeds](QEP-OEM-PRICE-FEEDS-OWNER-DISCOVERY.md) · [Tier 1 — Margin & Pricing](QEP-QUOTE-PROCESS-TIER-1-MARGIN-PRICING-OWNER-DISCOVERY.md) · [Tier 2 — Lifecycle & Conversion](QEP-QUOTE-PROCESS-TIER-2-LIFECYCLE-CONVERSION-OWNER-DISCOVERY.md)
