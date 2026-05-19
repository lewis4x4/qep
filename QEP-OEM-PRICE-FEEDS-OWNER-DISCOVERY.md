# QEP OS — OEM Price Feeds: Owner Discovery & Sign-Off

**Audience:** Dealership owner / principal, sales leadership, ops leadership
**Read time:** ~15 minutes
**Decision time:** ~30 minutes with the engineering team
**Status:** Awaiting answers before build kickoff
**Author:** QEP OS engineering
**Date:** 2026-05-17

---

## 1. Why this document exists

We are about to spend roughly **one engineering week** building the first phase of an OEM Price Feed system inside QEP OS. The feature can deliver real margin protection — *or* it can drown reps in noise and damage customer trust. Before we sink the time, we need a half-dozen calls made by you (the owner) that engineering cannot make.

This document explains:

1. What we are proposing to build, in plain English
2. What the rep will experience on Day 1 vs. Day 90
3. The questions only you can answer
4. The data we need from you to start
5. The risks if we get this wrong

Treat the "Decision Points" sections as **required reading** — engineering will not start building until each one has an answer recorded against it.

---

## 2. What we are proposing to build

### The problem we are solving

Today, when an OEM raises list prices, lowers freight, or changes a rebate stack, **nothing in QEP OS notices**. A rep can have a $186K open quote that is suddenly 4 percent under-priced, and the rep will not know until either:

- The customer accepts the quote and we eat the margin, **or**
- The rep happens to re-check the manufacturer's price sheet manually before closing.

This is a daily margin leak. We do not have a number for it yet, but every dealer principal we have asked estimates it conservatively at "five figures a year, easy."

### The system in plain English

Imagine a quiet background process that:

1. **Ingests** the latest price sheet from each OEM the moment it lands (CSV, PDF, email attachment, or admin upload).
2. **Diffs** it against the last known prices — what went up, what went down, what is new, what was discontinued.
3. **Scans** every open quote and identifies which lines are now mispriced.
4. **Surfaces** the impact to the rep on their Today screen the next morning with a one-line summary:
   > **OEM raised list 4% — 6 of your open quotes affected. Re-price all?**
5. **Drafts** new quote variants ready for the rep to review and send, with margin floor protection baked in (we already have the margin floor gate built — this plugs into it).
6. **Tracks** which reps acted, which did not, and how much margin was protected.

That is the goal. The questions below decide *how* we get there without breaking customer trust.

### Phases

| Phase | Scope | Effort | When |
|---|---|---|---|
| **1** | Manual CSV upload by an ops admin → diff → impact surfacing → rep approval flow | ~7 days | After this doc is answered |
| **2** | Auto-ingest from a dedicated `oem-pricing@yourdealer.com` inbox using the M365 mailbox sync we already have | ~5 days | After Phase 1 has been live for 30 days |
| **3** | Predictive: flag OEMs likely to raise prices in the next 30 days based on signals (freight indices, raw material costs, prior cadence) | ~10 days | After Phase 2 proves trust |

**You are signing off on Phase 1 only.** Phase 2 and 3 will get their own owner check-in.

---

## 3. What the rep will see

### Day 1 (Phase 1 launched)

On the Today screen, when an OEM price change affects the rep's open quotes, a new chip appears in the Live Signals strip:

> **6 Quotes affected** — orange chip, tappable

Tapping the chip opens a **Price Impact card** that shows:

- The OEM and the date the new sheet posted
- A summary: "6 quotes affected. Total exposure if accepted at old prices: $12,400 in margin."
- A list of the 6 quotes with: customer name, deal value, old margin %, new margin %, delta in dollars
- Two buttons:
  - **Re-price all** (gated by margin floor and your approval policy — see Decision Point 2)
  - **Review one by one** (opens each quote in the existing quote builder)

### Day 90 (system trusted, used daily)

The chip becomes ambient. The rep starts the day with the price-impact summary already folded into the evening briefing line:
> "Overnight: Manitowoc raised list 3.2% — re-priced 4 quotes inside your margin policy, 1 needs your review."

The rep wakes up to find their book already defended. **This is the moonshot version.**

---

## 4. Decision Points (your call)

These are the questions engineering cannot answer. Each one has options laid out with the tradeoffs. **A sample answer** is included at the end of each — that is engineering's recommendation, not a default; please override it freely.

---

### Decision Point 1 — Trust threshold for re-pricing

**Question:** When the system detects price changes, how much trust do you want to give it before a rep can act?

**Options:**

| Option | What it means | Tradeoff |
|---|---|---|
| **A. Always require line-item review** | Rep sees the diff, opens each quote, taps through each affected line, confirms. | Safest. Slowest. Risk reps ignore the alert because it is too much work. |
| **B. One-tap re-price within margin policy** | If the new prices keep margin above your floor, the rep can re-price all 6 quotes with one tap. Below floor → individual review required. | **Engineering recommendation.** Fast for low-risk changes, forced review for high-risk. |
| **C. Fully autonomous** | System re-prices automatically and notifies the rep after the fact. | Fastest. Riskiest. Reps lose ownership of pricing. Customer-facing communication risk if not handled carefully. |

**Sample answer:** Option B for Phase 1. Revisit C after 90 days of clean data.

**Your answer:** _____________

---

### Decision Point 2 — Auto-send to customer vs. rep review

**Question:** When a re-priced quote is generated, what happens next?

**Options:**

| Option | What it means | Tradeoff |
|---|---|---|
| **A. Always rep review before customer sees it** | New quote drafted, rep reviews, rep clicks Send. | Safest customer-facing. Adds rep step. |
| **B. Auto-send if margin improved, review if margin worsened** | If the OEM lowered prices and we are passing savings, customer gets the better quote automatically. If we are raising the quote, rep must review and send. | **Engineering recommendation.** Customer never gets a price hike without rep eyes on it. |
| **C. Auto-send everything** | New quote goes out the door without rep involvement. | Fastest. Severe trust risk if a parser bug ever lets a bad price through. |

**Sample answer:** Option B.

**Your answer:** _____________

---

### Decision Point 3 — Approval thresholds

**Question:** Above what dollar delta or percentage delta does a re-price require manager (or your) sign-off, separate from the rep?

**Sample policy to react to:**

| Quote value | Margin delta requiring manager approval |
|---|---|
| < $25K | No manager approval needed if within margin floor |
| $25K – $100K | Manager approval if margin drops by more than 2 points or $1,000 |
| $100K – $500K | Manager approval if margin drops by more than 1 point or $2,500 |
| > $500K | All re-prices require owner approval, no exceptions |

**Your answer / amendments:** _____________

---

### Decision Point 4 — Which OEMs do we ingest first?

**Question:** We will not build parsers for every OEM at once. Which **three OEMs cover roughly 80% of your quote volume?**

This is the single biggest scoping decision in the project. Each OEM parser is roughly 1–2 days of work depending on file format quality. We will build the top 3, prove the system works, then expand.

**What we need from you:**

| Rank | OEM name | Approx. % of quote volume | File format they send (CSV / PDF / email / portal) | Cadence (monthly / quarterly / ad-hoc) |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 (optional) | | | | |
| 5 (optional) | | | | |

---

### Decision Point 5 — Notification threshold (signal vs. noise)

**Question:** How small a price change is worth waking up the rep for?

**Options:**

| Option | What it means |
|---|---|
| **A. Any change > 0%** | Even a $5 list change on a single part triggers a notification. Maximum visibility, maximum noise. |
| **B. > 1% on any line, OR > $500 total impact on any open quote** | Engineering recommendation. Filters out micro-changes, surfaces anything that actually moves margin. |
| **C. > 2% on any line, OR > $1,000 total impact** | Quieter. Risk missing a $900 leak. |
| **D. Custom by OEM** | Some OEMs adjust quarterly in tiny increments; others rarely change. Per-OEM threshold. | 

**Sample answer:** Option B for Phase 1; we add per-OEM tuning in Phase 2 if needed.

**Your answer:** _____________

---

### Decision Point 6 — Contractually locked customers

**Question:** Do you have customers with **negotiated long-term pricing** that should NOT be re-priced when an OEM sheet changes?

Examples: National accounts, government contracts, multi-year rental agreements, key accounts with annual price-lock.

**What we need from you:**

- A list of customer types or specific customers that fall under price-lock agreements.
- The mechanism: is the lock encoded somewhere already (a flag on the customer record, a contract attachment), or do reps "just know"?
- Should the system flag these explicitly ("Beacon Ridge is on a 2026 price lock — re-price suppressed") or silently exclude them?

**Sample answer:** Flag explicitly so the rep is reminded of the lock. Silent exclusion looks like a bug.

**Your answer:** _____________

---

### Decision Point 7 — Pricing protection windows

**Question:** Some OEMs grant a **pricing protection window** — they will honor old prices on quotes dated before the change for, e.g., 30 days. Do any of your OEMs do this?

If yes, we need to know:

| OEM | Protection window | How they communicate it (e.g. on the price sheet itself, separate memo) |
|---|---|---|
| | | |

If we know about the window, the system can correctly leave the older quotes untouched and only re-price the new ones.

**Sample answer:** Most OEMs do not formally offer this; assume "no protection" unless you tell us otherwise per OEM.

**Your answer:** _____________

---

### Decision Point 8 — In-stock vs. on-order pricing

**Question:** When equipment is **already in your yard at the old cost**, does the new OEM list price apply to it, or only to new orders?

This is a critical accounting question. The rep needs to know whether they are quoting:

- **Stock unit at old landed cost** → re-pricing is your *choice* (capture margin or pass savings), not forced
- **Build-to-order at new cost** → re-pricing is *necessary* (you genuinely owe more)

**Sample answer:** In-stock units stay at old cost in the system; re-pricing only applies to non-stock lines. We will flag stock units explicitly in the impact card.

**Your answer:** _____________

---

### Decision Point 9 — Freight, rebates, and incentive stacks

**Question:** When an OEM changes any of: **list price**, **freight schedule**, **rebate program**, or **incentive stack** — do you want all four treated the same way, or different escalation paths?

**Why this matters:** A freight change of $200 is small. A rebate program rebuild can shift margin by 4 points across dozens of quotes silently.

**Sample policy to react to:**

| Change type | Treatment |
|---|---|
| List price | Standard impact flow per Decisions 1–2 |
| Freight | Standard impact flow |
| Rebate program | **Always** require manager review — rebate changes are political and often retroactive |
| Incentive stack | Always require manager review |

**Your answer / amendments:** _____________

---

### Decision Point 10 — Rep commission impact

**Question:** Re-pricing a quote can change a rep's earned commission. Will reps trust the system if it can lower their commission without their explicit consent?

**Options:**

| Option | What it means |
|---|---|
| **A. Re-pricing never auto-lowers commission** | If a re-price would lower the rep's commission, the system forces the rep to acknowledge before applying. |
| **B. Re-pricing always recalculates commission silently** | Cleanest engineering. Rep frustration risk. |
| **C. Re-pricing recalculates, but rep gets a "commission delta" line in the impact card** | Engineering recommendation. Transparent without blocking. |

**Sample answer:** Option C.

**Your answer:** _____________

---

## 5. Data we need from you to start

To begin Phase 1, engineering needs the following from your team. This is the **complete intake list** — if anything is missing, we will not start the work.

### From you (owner)

- [ ] Signed answers to all 10 Decision Points above
- [ ] Approval authority document: who can approve a re-price above the auto-approve threshold (you? Sales VP? Both?)
- [ ] Customer communication policy: are we OK auto-sending re-priced quotes that *lower* the price to the customer? (Decision 2 covers this but it deserves a separate explicit yes/no.)

### From sales leadership

- [ ] Top 5 OEMs by quote volume, with a rough percentage breakdown
- [ ] List of price-locked customers or customer types (Decision 6)
- [ ] Margin floor by product category, if it differs from a single dealership-wide floor
- [ ] Names of the 2–3 reps you want in the pilot (we recommend your most skeptical reps — if they trust it, everyone will)

### From ops / parts / pricing

- [ ] **Sample price sheets**: 3 most recent sheets from each of the top 3 OEMs, in their original format. PDF, CSV, Excel, raw email — whatever the OEM actually sends.
- [ ] The current price sheet load process: who downloads it, where it gets saved, who updates the ERP, how long that takes today
- [ ] Freight schedule format: how OEMs communicate freight changes (some bundle it into the price sheet, some send separately)
- [ ] Rebate program documents for the top 3 OEMs (current and one prior version, so we can model how they change)
- [ ] Confirmation that legal/compliance is OK with us storing OEM price data inside QEP OS (most dealers are; some have NDAs with the OEM that restrict redistribution — we need to know)

### From IT

- [ ] Confirmation that the M365 mailbox sync (already deployed, see migration 571) can have a dedicated mailbox provisioned: `oem-pricing@yourdealer.com` (for Phase 2)
- [ ] Confirmation that finance/ERP has an API or export we can read for *current* part costs (so we can compute true margin, not just list-vs-list)

---

## 6. Data we will be touching

Engineering transparency: here is the surface area of new database tables, in plain language.

| Table | What it holds | Who can see it |
|---|---|---|
| `oem_price_sheets` | One row per uploaded sheet — manufacturer, effective date, source file pointer, parsed status | Ops admins, sales leadership, engineering |
| `oem_price_lines` | One row per priced item on each sheet — part or model identifier, list price, freight, rebate stack | Ops admins, sales leadership, engineering |
| `quote_price_impact` | Computed nightly — one row per affected quote with the dollar/margin delta | The owning rep, their manager, sales leadership |
| `quote_reprice_actions` | Audit log — who re-priced what, when, with what approval, what the customer-facing result was | Sales leadership, owner, engineering (read-only for reps on their own actions) |

**RLS enforcement:** Every table above is row-locked by workspace and by rep ownership where applicable. A rep at Dealer A cannot see Dealer B's sheets. A rep cannot see another rep's impact rows. This is enforced both in the API logic and in the database (per QEP OS standard).

**No price data is exposed to the frontend in clear form** — only the diffs and impact computations the rep needs to act. Raw OEM pricing stays server-side.

---

## 7. Risks if we get this wrong

Each risk is paired with the **mitigation** that protects against it. We are not asking you to accept risk blindly.

| Risk | Mitigation |
|---|---|
| **Parser bug ships a bad price** — A CSV parsing error mistakes a column, every quote gets re-priced wrong, a customer accepts | Decision 2 (always rep-review on price increases) prevents customer exposure. Plus: every re-price action is reversible from the audit log for 7 days. |
| **Rep ignores the alert** | The chip appears prominently on Today; if the rep dismisses without acting, JARVIS escalates to their manager after 48h on quotes > $50K. |
| **Customer trust damage** — "Your quote went up because the manufacturer changed prices" feels like bait-and-switch | Decision 2: customer never sees a price increase without rep eyes on it. The customer-facing email template (which we will draft for you to approve) explains the change without throwing the OEM under the bus. |
| **Reps lose pricing autonomy and resent the system** | Decision 1 (re-pricing is rep-initiated, not autonomous, in Phase 1) keeps the rep in control. Decision 10 makes commission impact transparent. |
| **OEM NDA violation** — Some OEM agreements restrict storage of price data outside the ERP | Section 5 includes a legal check item. We will not load any OEM sheet whose agreement we have not confirmed allows it. |
| **Margin floor gate disagrees with re-pricing logic** | We will write a contract test that fails the build if any code path can produce a re-price that violates the existing margin floor. This is a CI gate, not a runtime check. |
| **Spam fatigue** — Too many low-impact notifications and reps tune out | Decision 5 sets the noise floor. We also rate-limit: a single OEM cannot generate more than one notification per rep per 24h regardless of how many sheets they post. |

---

## 8. What success looks like

We will know Phase 1 is working if, **90 days after launch**:

- At least 70% of impact alerts are acted on (re-priced or explicitly dismissed with a reason) within 48 hours
- Average margin recovery per re-pricing event is positive — meaning we are capturing more than we are giving up on average
- Zero customer complaints traceable to a system-generated re-price (Decision 2 should make this trivial)
- Reps in the pilot opt to keep the feature when asked (open-ended exit survey)
- At least one dealership-wide "saved" number we can put on a slide: *"OEM Price Feeds protected $X in margin in Q3"*

If any of those criteria miss, we pause Phase 2 and diagnose before continuing.

---

## 9. What happens after this document is answered

The moment you sign Section 11, engineering does the following in this order:

1. **Day 1** — Schema migrations land (the four tables above), behind a feature flag. Zero user-visible change.
2. **Day 2** — Admin CSV upload UI built. You can manually ingest a test sheet.
3. **Day 3** — Diff engine + impact computation. We re-run against historical quotes to validate.
4. **Day 4** — Rep-facing UI (chip + Price Impact card). Wired to a single dummy OEM.
5. **Day 5** — Re-price action + approval routing per Decision 3. Margin floor integration.
6. **Day 6** — Audit log + manager escalation. End-to-end test with one real OEM sheet.
7. **Day 7** — Pilot launches with 2–3 reps. Feature flag stays on for them only.
8. **Day 8–37** — 30-day pilot. Engineering instruments everything; you get a weekly summary.
9. **Day 38** — Go/no-go meeting. Decide if we expand to all reps or iterate.

---

## 10. Open questions we expect you to push back on

We have not figured everything out. These are the things engineering is least confident about, where your operational instinct will beat ours:

1. **Who in your org owns the OEM relationship when a parser breaks?** When the parser fails because Manitowoc redesigned their price sheet PDF in April, who escalates that to the OEM rep vs. who patches it on our side?
2. **Is there a quarterly business review with each OEM where price changes are previewed?** If so, we should be capturing that signal too — predictive, not just reactive.
3. **Do you want the system to learn rep behavior?** If Rep A always rejects re-prices on quotes for "Customer X," should the system stop suggesting them? (Phase 3 territory, but architecture decisions in Phase 1 lock this in or out.)
4. **What is your honest read on adoption?** Is there a rep on your team who will actively sabotage this because they make money on the margin gap? We need to know before we pilot, not after.

---

## 11. Sign-off

The following sign-off authorizes engineering to begin Phase 1 build.

| Role | Name | Signature | Date |
|---|---|---|---|
| Dealership Owner / Principal | | | |
| VP of Sales | | | |
| Operations / Pricing Lead | | | |
| IT Lead (confirms migration 571 + ERP access) | | | |

**Effective date of build kickoff:** Engineering will begin work on the first business day after all four signatures are recorded.

**This document supersedes all prior verbal discussions about OEM Price Feeds.** Anything not written here is not committed to scope.

---

## Appendix A — Glossary for non-engineering readers

- **OEM (Original Equipment Manufacturer)** — Manitowoc, Komatsu, Kubota, etc. The companies whose equipment you sell or rent.
- **List price** — The OEM's published price before any dealer discount.
- **Margin floor** — The minimum margin percentage a quote can have before requiring manager approval. Already built into QEP OS via the Margin Floor Gate.
- **Rebate stack** — Layered incentives from the OEM that reduce dealer cost; can be complex (volume + co-op + spiff + program).
- **Freight kind** — Whether freight is included, FOB factory, or dealer-paid; affects landed cost calculation.
- **Price sheet** — The document an OEM sends listing current prices for the items in their catalog.
- **Pricing protection window** — A grace period some OEMs grant where quotes dated before a price change can still honor the old price.

---

## Appendix B — One-page summary for the rep pilot kickoff

(To be distributed to the 2–3 pilot reps after sign-off. Engineering will draft this once Decisions 1–10 are recorded.)

Sections:

- "Here is what changed on your Today screen this morning"
- "When you see the orange '6 Quotes affected' chip, here is what to do"
- "When to re-price, when to ask your manager, when to ignore"
- "What we are measuring and why your feedback matters"
- "How to flag a wrong price to engineering in 30 seconds"

---

*End of document. Send completed answers to engineering at the channel discussed in your last sync. If you have questions reading this document, do not guess — ask. The cost of a 10-minute clarification call is zero; the cost of building the wrong thing is one week.*
