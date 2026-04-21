# Quote Builder — Moonshot Roadmap

> Source: QEP OS engineering session, 2026-04-20
> Product: QEP Quote Builder (quote-builder-v2)
> Author: Claude (Brian Lewis, owner)
> Status: Forward-looking vision document. Not implementation-ready. Treat as strategic direction for Slice 19 and beyond.

---

## Purpose of This Document

This document captures the strategic roadmap for evolving the QEP Quote Builder from a smart equipment catalog into a transformational AI sales system. It is intended as a reference for future product planning, demo narration, and stakeholder alignment (Rylee, Angela, sales leadership, corporate operations).

Each section below is self-contained. A reader dropping into any single section should be able to understand the concept, why it matters, what it replaces, and what dependencies it has.

---

## Section 1: Current State of the Quote Builder (as of April 2026)

The QEP Quote Builder is an operator-facing tool inside QEP OS that helps equipment sales representatives produce quotes for customers. As of April 2026, the Quote Builder includes the following capabilities:

- Equipment catalog covering approximately 87 active models across 23 manufacturer brands (stored in the `qb_equipment_models` and `qb_brands` Postgres tables), including ASV forestry compact track loaders, Bobcat / Kubota / Case / New Holland / Caterpillar / John Deere / Gehl / Takeuchi skid steer loaders, mainstream compact track loaders, mini excavators, and telehandlers from JCB, Genie, Bobcat, and Caterpillar.
- AI-assisted intake: a sales rep can type or speak a plain-language job description, and an OpenAI `gpt-4o-mini` model selects one recommended equipment match from the catalog.
- Fuzzy catalog search over manufacturer, model, and family.
- Financing calculator driven by the `financing_rate_matrix` table, producing monthly-payment scenarios.
- Quote packages with line items, customer fields, and electronic signature.
- Portal Quote Review: a customer-facing review surface with revision drafts, dealer messages, and publish workflow.
- Competitor intelligence (listing lookup, manager/owner role only).
- Deal Coach (Slices 13, 17, 18): rules-based plus machine-learning scoring of open deals, with adaptive coaching copy.
- Auto Price Sheet Watchdog (Slice 16): monitors stale price sheets and flags them via a cron job.
- Win/Loss Learning Loop (Slice 10): captures deal outcomes and reasons.
- Voice Quote entry (Slice 14): a dedicated voice-driven path into the quote flow.

In its current form, the Quote Builder is a **smart catalog with AI assistance**. It accelerates a rep's existing workflow but does not yet architect deals, simulate outcomes, or negotiate on the rep's behalf.

---

## Section 2: The Moonshot Vision in One Sentence

The moonshot version of the QEP Quote Builder turns the product from *"a rep types a job description and the AI picks a machine"* into *"a customer describes a project, and the system architects the entire deal — fleet mix, financing structure, trade-in orchestration, delivery plan, and post-send follow-up — with win-probability math the rep can defend in front of a customer."*

Every moonshot move described in this document ladders up to that single outcome.

---

## Section 3: The Five Highest-Leverage Moonshot Moves

The following five moves, taken together, move the Quote Builder from commodity to transformational. They are ordered by leverage, not by build sequence.

### Move 1: Project-to-Quote Reasoning

**What it replaces.** Today, the intake is a short text prompt such as *"need to clear 3 acres of light brush"* that returns a single recommended model. This is a job-to-model mapping, not a project-to-fleet architecture.

**What it becomes.** The sales rep (or the customer directly, in the portal) uploads any artifact that describes the project: a bid sheet, a site plan, a permit PDF, a drone or satellite image of the job site. A multi-modal AI model extracts the scope of work, decomposes it into task categories (site prep, grading, trenching, material handling, demo, landscaping), estimates equipment-hours per task, and outputs a recommended fleet with utilization percentages. The recommendation includes rent-versus-buy guidance per machine.

**Example output.** *"For this 3-acre residential site prep, recommended fleet: one Bobcat T76 compact track loader (68% utilization), one Kubota U55-4 mini excavator (42% utilization), one JCB 507-42 telehandler (18% utilization — rent instead of purchase). Total equipment-hours: 340 over 8 weeks. Expected fuel burn: 620 gallons."*

**Why this is moonshot.** Multi-modal reasoning plus job-economics simulation is doable today in a shallow way, but it gets dramatically stronger as large language models improve at document understanding and quantitative reasoning. It is the right bet because the frontier of model capability is exactly where this feature lives.

**Dependencies.**
- Existing equipment catalog in `qb_equipment_models` (already present).
- Equipment-hours model per task category (new; initially rule-based, then learned).
- Rent-versus-buy breakeven logic (new; ties to existing financing calculator).
- Document-upload surface in the Quote Builder page (new).

---

### Move 2: Counterfactual Win-Probability Engine

**What it replaces.** Today, the Deal Coach (Slices 13, 17, 18) scores an existing deal and offers coaching copy. It answers *"how is this deal doing."* It does not answer *"which version of this deal should I be writing."*

**What it becomes.** Every quote triggers a background simulation of roughly 10,000 variants, perturbing financing term, down payment, trade-in value, delivery timing, and equipment substitutions. The system surfaces the **Pareto frontier** of three competing objectives: margin percentage, win probability, and days-to-close. The rep interacts with a curve and selects the operating point they want. The system then writes the quote to match that point.

**Example interaction.** The rep sees a curve with three axes. They drag a point along the curve from *"high margin, low win probability, fast close"* to *"moderate margin, high win probability, moderate close time"*. The quote automatically adjusts financing term and trade-in assumptions to match.

**Why this is moonshot.** Counterfactual simulation at this volume is only useful when the underlying scoring model is accurate. Slice 17 (Machine Learning Deal Coach) and Slice 10 (Win/Loss Learning Loop) supply the training signal. This move converts retrospective learning into prospective optimization — the capability lift comes from the accumulated deal history, not from raw model capability.

**Dependencies.**
- Slice 17 Deal Coach scoring model (already present).
- Slice 10 Win/Loss Learning Loop data (already present; needs volume to train).
- A fast variant-generation and scoring harness (new edge function, likely `qb-deal-simulator`).
- A Pareto-curve UI component in the Quote Builder page (new).

---

### Move 3: Ambient Competitive Pricing Pressure

**What it replaces.** Today, competitor listings are accessible on demand via a `competitors` action in `quote-builder-v2`, restricted to manager and owner roles. Reps cannot see competitive pressure unless they actively look.

**What it becomes.** A continuous ingestion pipeline scrapes competitor dealer listings, public bid awards, Facebook Marketplace, Craigslist, auction results (such as Ritchie Bros), and Original Equipment Manufacturer (OEM) dealer memos. A fusion layer combines these signals with the existing `qb-price-sheet-watchdog` (Slice 16) to maintain a live estimate of regional market price per model. Every active quote shows a **live margin-risk overlay**.

**Example alert.** *"Case cut SR270B dealer discount by 3 points in your region 3 days ago. Your $68,000 list has a 34% chance of being beat on price alone. Suggested counter: drop $1,800 and add one free attachment — maintains 17% margin, raises win probability to 71%."*

**Why this is moonshot.** The scraping and ingestion are incremental infrastructure work, but the real leverage comes when this signal is routed into Move 2 (counterfactual win-probability) and Move 4 (customer digital twin). Competitive pressure becomes a live input to the deal simulator, not a static lookup.

**Dependencies.**
- Existing `competitor_listings` table and `qb-price-sheet-watchdog` edge function.
- New ingestion workers for auction, bid-award, and marketplace sources.
- Regional price estimation model (new).
- UI overlay on the active quote page (new).

---

### Move 4: Customer Digital Twin

**What it replaces.** Today, each customer is a record in the Customer Relationship Management (CRM) system with contact information and deal history. The Quote Builder does not personalize the quote to the individual customer's buying patterns.

**What it becomes.** Each customer is represented as a behavioral model (a digital twin) that captures price sensitivity, brand loyalty, financing preferences, seasonal buying patterns, and expected projects in their pipeline (inferred from public permit and construction-award data in their market). Before a rep sends a quote, the system tunes the quote against the twin.

**Example behavior.** The twin for a customer named Jim notices three patterns: Jim always asks for a second financing option, Jim has purchased three Bobcat machines in a row, and Jim's region issued two new commercial permits last week that match his typical scope. The Quote Builder automatically leads with a Bobcat model, includes two financing scenarios, and adds a note: *"Two new commercial permits issued in Jim's market this week — worth a conversation on fleet expansion."*

**Why this is moonshot.** Personalized negotiation at scale is the clearest example of a capability only unlocked by strong language models. A human rep cannot maintain this depth of customer understanding across a full book of business. Superintelligence-grade models can.

**Dependencies.**
- QRM (QEP Resource Management, the internal HubSpot replacement) data (already present).
- Public permit and construction-award ingestion (new; likely per-region partners).
- Behavioral feature pipeline (new).
- Quote Builder integration point before the send step (new).

---

### Move 5: Quote-as-Simulation (Customer-Facing)

**What it replaces.** Today, the customer receives a PDF or a Portal Quote Review page. Changing a financing term, a down payment, or an equipment option requires a call back to the rep and a revision cycle.

**What it becomes.** The customer receives a live interactive scenario. Sliders adjust financing term, down payment, trade-in valuation, and equipment options. Every adjustment recalculates in real time, and an AI companion explains every trade-off in plain English. The customer self-negotiates into the deal they are comfortable with.

**Companion capability: Autonomous Quote Concierge.** After the quote is sent, an agent handles customer follow-up in the customer's preferred channel (short message service, email, portal chat), answers questions from an embedded knowledge base (including the existing Iron knowledge layer), proposes counter-offers within rep-defined guardrails, and escalates to the human rep only when judgment is needed.

**Why this is moonshot.** Two compounding effects. First, conversion rate increases because the friction of *"please call me back with another number"* collapses to zero. Second, rep capacity expands because follow-up is handled autonomously within guardrails. Deal velocity and rep throughput both increase in the same motion.

**Dependencies.**
- Existing Portal Quote Review infrastructure (already present).
- Live recalculation engine wired to the financing calculator (partial; needs portal-facing path).
- Guardrail definition UI for reps and managers (new).
- Concierge agent with channel adapters (new; likely a new edge function `qb-concierge`).

---

## Section 4: Recommended Next Slice — Fleet Architect

Of the five moves above, **Move 1 (Project-to-Quote Reasoning)** is the recommended next build. It is scoped as **Slice 19 — Fleet Architect**.

**Why Fleet Architect is the right next slice.**

- It delivers a high-impact demo moment in one scope. A rep uploads a bid sheet and gets a complete fleet recommendation in seconds.
- It reuses the existing catalog (87 models after migration 310) and the existing financing calculator. No major new infrastructure.
- It unlocks the most obvious customer value: reps move from *"pick a machine"* to *"architect a deal."*
- It produces the most defensible narrative for stakeholders: *"I gave the AI a bid sheet. It gave me a quote with three machines, two financing structures, and a rent-versus-buy breakdown in 12 seconds."*

**Slice 19 in-scope.**

- Upload endpoint for any project document (PDF, image, text).
- Multi-modal extraction of scope-of-work items.
- Equipment-hours estimate per scope item (initial rule-based mapping, refined by learned model later).
- Multi-machine recommendation output (extend the current single-machine `/recommend` to a multi-line response).
- Auto-seeding of the Quote Builder with the recommended fleet.
- Per-machine utilization and rent-versus-buy tag.

**Slice 19 out-of-scope (defer to later slices).**

- Win-probability simulation (Move 2).
- Competitive pricing overlay (Move 3).
- Customer digital twin (Move 4).
- Customer-facing simulation (Move 5).

---

## Section 5: Sequencing — How the Moves Compound

The five moves are independent enough to build in any order, but they compound most when sequenced as follows:

1. **Fleet Architect (Move 1).** Unlocks the multi-machine quote. Produces the demo moment.
2. **Ambient Competitive Pressure (Move 3).** Feeds live market price into future moves. Can ship before Move 2 is ready.
3. **Counterfactual Win-Probability Engine (Move 2).** Consumes data from Slice 10 (win/loss), Slice 17 (Deal Coach), and Move 3 (competitive pressure).
4. **Customer Digital Twin (Move 4).** Tunes the output of Moves 1, 2, and 3 to each customer.
5. **Quote-as-Simulation plus Concierge (Move 5).** Exposes all of the above to the customer directly.

Each move is independently valuable. Taken together, they define the QEP moonshot end state for the quoting motion.

---

## Section 6: Mission Alignment

This roadmap is vetted against the QEP mission statement (see `CLAUDE.md`, Mission Lock section):

- **Mission Fit.** Every move directly advances equipment sales, rental, and financing operations for field reps, employees, and corporate operations.
- **Transformation.** Each move includes or enables a capability that is materially beyond commodity Quote Request Management (QRM) behavior. Moves 1, 2, 4, and 5 are not fully possible with current consumer AI products.
- **Pressure Test.** Each move must be validated under realistic usage (real bid sheets, real customer histories, real competitive pressure) before promotion to production.
- **Operator Utility.** Each move improves decision speed or execution quality for at least one real dealership role — sales rep, sales manager, or corporate sales operations.

---

## Section 7: Glossary

Definitions for terms used throughout this document. Included here so a reader landing on any section can resolve unfamiliar terms without context.

- **ASV.** A manufacturer of compact track loaders, particularly in the forestry and mulching segment. Seeded as the first brand in migration 299.
- **Compact Track Loader (CTL).** A tracked loader, similar to a skid steer loader but on rubber tracks for better flotation and traction. Used in site prep, landscaping, and forestry.
- **Deal Coach.** A QEP feature (Slices 13, 17, 18) that scores open deals and suggests next actions for the sales rep.
- **Fleet Architect.** Proposed Slice 19; the implementation of Move 1 in this document.
- **Iron knowledge layer.** The QEP embedded knowledge base. Relevant to Move 5's concierge agent.
- **Multi-modal.** Referring to an AI model that processes more than one input modality (for example, text plus image plus document).
- **OEM.** Original Equipment Manufacturer (for example, Caterpillar, John Deere, Kubota).
- **Pareto frontier.** The set of solutions where no objective can be improved without making another objective worse. In Move 2, the three objectives are margin, win probability, and days-to-close.
- **Portal Quote Review.** The customer-facing surface in QEP OS where customers review, comment on, and approve quotes. Referenced by `portal_quote_review_versions` and related tables.
- **Quote Builder.** The QEP product this document describes. Backed by the `quote-builder-v2` Supabase edge function and the `quote_packages` table.
- **QRM.** QEP Resource Management. The internal Customer Relationship Management (CRM) replacement for HubSpot.
- **Skid Steer Loader.** A compact wheeled loader with a rigid frame and lift arms. Common in construction, landscaping, and agriculture.
- **Slice.** A unit of delivery in QEP OS. Each slice is a cohesive feature increment closed by a full build, security, and demo gate.
- **Superintelligence.** In the QEP mission statement, refers to AI capability that is materially beyond current commodity language-model performance. Moves in this document anticipate this capability curve.
- **Telehandler.** A telescopic handler — a forklift with an extending boom. Used in construction and agriculture to lift loads to height and reach.
- **Utilization percentage.** The share of available machine-hours that a given machine is expected to be in productive use on a job. Used in Move 1 to decide rent versus buy.

---

## Section 8: Open Questions

These questions are not blockers. They are flagged here so a future planning session can close them before Slice 19 kickoff.

- Which document formats must the Fleet Architect support at launch? PDF is mandatory. Image and spreadsheet formats are desirable.
- Where does the equipment-hours-per-task model come from at launch? Initial recommendation: a hand-authored mapping reviewed by Rylee and Angela, migrated into a `qb_task_equipment_hours` table.
- What is the right disclaimer when a multi-modal extraction is low-confidence? The rep should always have the final edit; the system should never silently commit a low-confidence recommendation.
- What is the correct guardrail format for the Concierge agent in Move 5? Likely a per-manager or per-workspace policy table, not per-rep.

---

## Document Metadata for NotebookLM

- **Document type.** Strategic roadmap / future feature specification.
- **Primary audience.** Brian Lewis (QEP OS owner), Rylee and Angela (sales leadership and Quote Builder domain experts), future engineering contributors.
- **Retrieval hints.** Key topics covered in this document: Quote Builder roadmap, Fleet Architect, project-to-quote reasoning, counterfactual win-probability, competitive pricing pressure, customer digital twin, quote-as-simulation, autonomous quote concierge, Slice 19, moonshot features, multi-machine quote recommendation, bid-sheet-to-quote, utilization-based fleet sizing, rent-versus-buy logic.
- **Related documents.** `CLAUDE.md` (engineering contract and mission lock), `docs/mission-statement.md`, `supabase/migrations/299_qb_demo_equipment_models.sql` (original ASV seed), `supabase/migrations/310_qb_demo_construction_fleet.sql` (construction fleet seed), `supabase/functions/quote-builder-v2/index.ts` (current implementation).
