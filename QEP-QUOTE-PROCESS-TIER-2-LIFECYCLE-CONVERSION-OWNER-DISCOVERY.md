# QEP OS — Quote Process Tier 2: Lifecycle & Conversion Discovery

**Audience:** VP Sales, Operations Lead, Finance Lead, Owner (final sign-off on conversion policy)
**Read time:** ~30 minutes
**Decision time:** ~75 minutes
**Companion docs:**
- [Tier 0 — OEM Price Feeds](QEP-OEM-PRICE-FEEDS-OWNER-DISCOVERY.md)
- [Tier 1 — Margin & Pricing](QEP-QUOTE-PROCESS-TIER-1-MARGIN-PRICING-OWNER-DISCOVERY.md)

**Status:** Awaiting answers before build kickoff
**Date:** 2026-05-17

---

## 1. Why this document exists

Tier 1 settled *how a quote gets priced*. This document settles *what happens to that quote from the moment a rep creates it to the moment money changes hands — and what happens when it dies along the way.*

These are the questions that most CRMs leave unanswered, and as a result reps invent their own behavior. The day a rep leaves the company, their tribal knowledge walks out the door with them — and the dealership discovers it had no policy for "who owns this rep's 47 open quotes."

This doc covers five clusters:

- **Quote Initiation & Ownership** — who can create what, who owns it
- **Quote Delivery to the Customer** — channels, branding, e-sign, attachments
- **Quote Lifecycle** — expiration, revisions, versioning, locks
- **Quote-to-Order Conversion** — what "yes" means, ERP handoff, inventory allocation
- **Win / Loss / Dead Deal Capture** — what gets recorded when a deal dies

Estimated build effort once answers are in: **~15 days** for Tier 2 enforcement and audit dashboards.

---

## 2. What we are proposing to build

Existing infrastructure:

- [567_m365_token_refresh_cron.sql](supabase/migrations/567_m365_token_refresh_cron.sql), [571_m365_mailbox_sync.sql](supabase/migrations/571_m365_mailbox_sync.sql) — M365 inbox sync (powers delivery + customer reply capture)
- [568_intellidealer_snapshot_generic_stage.sql](supabase/migrations/568_intellidealer_snapshot_generic_stage.sql), [570_intellidealer_stage_rls_initplan_fix.sql](supabase/migrations/570_intellidealer_stage_rls_initplan_fix.sql) — IntelliDealer ERP staging
- [573_quote_delivery_preview_artifact_policy.sql](supabase/migrations/573_quote_delivery_preview_artifact_policy.sql) — delivery preview policy
- [575_audit_quote_packages_metadata_delivery_storage.sql](supabase/migrations/575_audit_quote_packages_metadata_delivery_storage.sql) — delivery audit
- [576_quote_send_package_commit_transaction.sql](supabase/migrations/576_quote_send_package_commit_transaction.sql) — send transaction
- [577_documents_storage_insert_initplan_fix.sql](supabase/migrations/577_documents_storage_insert_initplan_fix.sql) — document attachments

What's missing: **lifecycle policy** — when each of those mechanisms fires, who is allowed to use them, and what happens when something goes wrong.

---

## 3. What the rep / customer / owner will see when this lands

**Rep on the Today screen:**
- Quotes with read receipts (customer opened) appear as hot signals
- Quotes nearing expiration get a 7-day-prior alert
- Dead quotes prompt a one-tap loss-reason capture flow before disappearing

**Customer:**
- Receives quote via their preferred channel (default tied to customer record, not rep preference)
- Sees clean branded PDF, optional e-sign, no surprise attachments
- Cannot receive a re-send within 24 hours unless rep explicitly overrides (anti-harassment)

**Owner:**
- **Conversion Funnel Dashboard** — quotes created → sent → opened → accepted → ordered → delivered, with drop-off rates per stage
- **Dead Deal Intel** — competitor wins, loss reasons by category, by rep, by OEM
- **Quote Quality Audit** — which reps' quotes get accepted vs. revised vs. died, average revision count per accepted quote

---

## 4. Decision Points

---

### Cluster A — Quote Initiation & Ownership

#### DP 1.1 — Who can create a quote

**Question:** Which roles can create a new quote from scratch?

| Option | What it means |
|---|---|
| **A. Only the assigned rep on the deal** | Tightest attribution. Blocks coordinators and managers. |
| **B. Assigned rep + their manager + sales coordinators** | Engineering recommendation. Covers vacation coverage, multi-rep teams. |
| **C. Any rep in the workspace** | Permissive. Fine for small dealerships. |
| **D. Per-role configurable** | Most flexible. Most policy maintenance. |

**Sample answer:** B.

**Your answer:** _____________

---

#### DP 1.2 — Quote-before-deal vs. deal-first

**Question:** Must a CRM deal exist before a quote can be created?

| Option | What it means |
|---|---|
| **A. Deal must exist first** | Cleanest pipeline data. Forces rep to set up deal stages. |
| **B. Quote can exist standalone (no deal)** | Faster for walk-ins. Pipeline data weakens. |
| **C. Quote can exist standalone; system auto-creates deal at send** | Engineering recommendation. Rep gets speed, pipeline stays clean. |
| **D. Quote standalone is allowed but never converts to a deal automatically** | Two parallel object types forever. Confusing. |

**Sample answer:** C.

**Your answer:** _____________

---

#### DP 1.3 — Rep departure: quote ownership transfer

**Question:** A rep resigns or is terminated. What happens to their in-flight quotes (drafted, sent, awaiting customer response)?

| Option | What it means |
|---|---|
| **A. Manager manually reassigns each quote** | Most thoughtful. Slowest. |
| **B. Auto-reassign to a designated territory backup** | Fast. Requires defined territory backups. |
| **C. Reassign to manager queue; manager triages within 7 days** | Engineering recommendation. Forces a review, no quote falls through cracks. |
| **D. Mark all as "house" until manually picked up** | Causes orphaning. Avoid. |

**Sample answer:** C.

**Your answer:** _____________

**Follow-up:** What happens to commission already earned on a quote that converts after the rep departed?
- Paid to departed rep per separation agreement
- Forfeited
- Split: 50% departed rep, 50% reassigned rep
- Other: _____________

---

#### DP 1.4 — Split commission and quote-of-record

**Question:** Two reps tag-team a deal (one for relationship, one for technical). Whose quote is it?

| Option | What it means |
|---|---|
| **A. One rep is always primary; secondary gets a fixed split** | Cleanest record. Hardest negotiation. |
| **B. Both reps named on the quote; split defined per deal** | Engineering recommendation. Track both, settle split at conversion. |
| **C. Manager assigns primary at quote creation** | Removes rep negotiation. |
| **D. No split tracking — primary takes all** | Causes resentment. |

**Sample answer:** B with default 70/30 split until reps agree otherwise.

**Your answer:** _____________

---

#### DP 1.5 — House quotes (walk-ins, e-commerce, parts counter)

**Question:** Are "house quotes" (no assigned rep) allowed?

| Option | What it means |
|---|---|
| **A. Never — every quote must have a rep** | Cleanest. Forces walk-in coverage rotation. |
| **B. Allowed for walk-ins, assigned to a "house" pseudo-rep** | House margin goes to dealership. |
| **C. Allowed; first rep to follow up claims the deal** | Encourages hustle. Can cause poaching. |
| **D. Auto-assign to a rotating rep by territory or duty schedule** | Engineering recommendation. Fairest, automatic. |

**Sample answer:** D.

**Your answer:** _____________

---

### Cluster B — Quote Delivery to the Customer

#### DP 2.1 — Default delivery channel

**Question:** When a rep sends a quote, what channel goes out by default?

| Option | What it means |
|---|---|
| **A. Always email** | Universal. Old-school. |
| **B. Tied to customer record preference** | Engineering recommendation. Customer picks; system remembers. |
| **C. Rep selects per quote** | Maximum flexibility. Forgotten setting risk. |
| **D. Multi-channel by default — email + SMS link** | Most reach. Looks pushy if customer didn't ask. |

**Sample answer:** B with email as the dealership-wide default for new customers until they express a preference.

**Your answer:** _____________

**Follow-up:** Supported channels — which do you want enabled?
- [ ] Email
- [ ] SMS link (link to PDF on portal)
- [ ] Customer portal notification only
- [ ] Hand-delivered PDF print
- [ ] Other: _____________

---

#### DP 2.2 — E-signature requirement

**Question:** Does the quote require an electronic signature to be considered "accepted"?

| Option | What it means |
|---|---|
| **A. All quotes require e-sign** | Cleanest accept signal. Adds customer friction on small deals. |
| **B. E-sign required above a dollar threshold** | Engineering recommendation. Threshold of $25K as default. |
| **C. Optional — rep chooses per quote** | Inconsistent. |
| **D. Never — verbal acceptance is enough** | Fastest. Highest dispute risk. |

**Sample answer:** B with $25K threshold.

**Your answer (and threshold if B):** _____________

**Follow-up:** E-signature vendor preference?
- DocuSign
- Dropbox Sign (formerly HelloSign)
- Adobe Sign
- Native QEP OS e-sign (build it ourselves)
- No preference, engineering picks
- Other: _____________

---

#### DP 2.3 — Branding and template ownership

**Question:** Quote PDF branding — uniform across the dealership, or differentiated?

| Option | What it means |
|---|---|
| **A. One template, dealership-wide** | Cleanest. |
| **B. Per-branch templates** | Multi-location dealerships need this. |
| **C. Per-OEM co-branded templates** | Required by some OEM dealer agreements. |
| **D. B and C combined** | Most flexible. Most maintenance. |

**Sample answer:** A unless you have multiple branches; then B.

**Your answer:** _____________

**Follow-up:** Who owns the template — marketing, ops, owner?
- Marketing
- Operations
- Owner / GM
- Engineering (we build, you approve)
- Other: _____________

---

#### DP 2.4 — Mandatory attachments

**Question:** Which documents must be attached to every quote of certain types?

**Sample policy table (amend):**

| Quote type | Mandatory attachments |
|---|---|
| New equipment sale | Spec sheet, OEM warranty terms, dealership T&Cs |
| Used equipment sale | Inspection report, "as-is" disclosure, dealership T&Cs |
| Rental | Rental agreement, damage waiver terms, insurance requirements |
| Parts | Return policy |
| Service | Labor rate sheet, parts return policy |
| Financing-included | Lender disclosure, payment schedule, OAC terms |

**Your amendments:** _____________

---

#### DP 2.5 — Quote re-send cooldown

**Question:** Rep accidentally hits send twice, or wants to re-send a "friendly reminder." Is there a cooldown?

| Option | What it means |
|---|---|
| **A. No cooldown — rep can send as often as they like** | Customer harassment risk. |
| **B. 24-hour cooldown** | Engineering recommendation. Prevents accidental dupes. |
| **C. 24-hour cooldown, manager override** | Lets manager bypass for legitimate "friendly reminder." |
| **D. 7-day cooldown** | Very conservative. |

**Sample answer:** C.

**Your answer:** _____________

---

#### DP 2.6 — Read receipts / open tracking

**Question:** Should the system track when a customer opens the quote email or downloads the PDF?

| Option | What it means |
|---|---|
| **A. Yes, always, surfaced to rep in real-time** | Powerful sales signal ("Customer opened your quote 3 times today — call now"). Privacy-grey. |
| **B. Yes, but only aggregate to owner dashboard** | Owner sees conversion data; reps don't see individual opens. |
| **C. No tracking** | Cleanest privacy posture. |

**Sample answer:** A. The conversion-rate uplift from this signal alone is large enough to justify the privacy compromise (every modern CRM does it). But it should be **disclosable** — quote PDF includes a small footnote that opens are tracked.

**Your answer:** _____________

---

#### DP 2.7 — Customer portal access

**Question:** Should customers have a login to QEP OS to see their quotes?

| Option | What it means |
|---|---|
| **A. No portal** | Simplest. Email-only. |
| **B. Portal showing only the most recently sent quote** | Light-touch. |
| **C. Portal showing all open quotes from this dealership** | Customer can compare across reps. Surfacing risk if reps quoted differently for same customer. |
| **D. Portal showing all history including past invoices and service** | Full customer self-service. Largest scope. |

**Sample answer:** B for Phase 1, expand to D in a later phase.

**Your answer:** _____________

---

### Cluster C — Quote Lifecycle

#### DP 3.1 — Default expiration window

**Question:** How long is a quote valid?

| Option | What it means |
|---|---|
| **A. 30 days uniform** | Standard. |
| **B. Per-category** | New = 30d, used = 14d, parts = 7d (prices change fast on parts), rental = 7d. |
| **C. Per-OEM** | Tied to OEM pricing cadence. |
| **D. Rep selects per quote within bounds** | Engineering recommendation. Rep picks 7/14/30/60, defaults to category default. |

**Sample answer:** D, with B-style category defaults.

**Your answer (and defaults if B/D):**

| Category | Default expiration |
|---|---|
| New equipment | |
| Used equipment | |
| Parts | |
| Service | |
| Rental | |

---

#### DP 3.2 — Auto-renewal at expiration

**Question:** Quote hits expiration. What happens?

| Option | What it means |
|---|---|
| **A. Auto-renew at current prices** | Convenient. **Dangerous** — prices may have changed. |
| **B. Expire silently** | Quiet. Risk losing live deals. |
| **C. Alert rep 7 days before, expire if no action** | Engineering recommendation. Rep gets a chance to re-engage. |
| **D. Auto-extend with explicit customer ask only** | Conservative. Misses passive interest. |

**Sample answer:** C.

**Your answer:** _____________

---

#### DP 3.3 — Revisions: new quote vs. in-place edit

**Question:** Customer asks for a change. Is the next iteration a new quote or an edit of the existing one?

| Option | What it means |
|---|---|
| **A. New quote, old quote marked superseded** | Cleanest audit. Quote numbers proliferate. |
| **B. In-place edit with version history** | Same quote number; rep and customer track via version. |
| **C. Hybrid — minor edits in place, major changes spawn new quote** | Engineering recommendation. "Major" = anything that changes total by >10% or adds/removes a unit. |
| **D. Always in-place, no version history** | Worst audit. |

**Sample answer:** C.

**Your answer:** _____________

---

#### DP 3.4 — Final quote lock

**Question:** Can a rep mark a quote as "final, do not change"?

| Option | What it means |
|---|---|
| **A. No lock mechanism** | Quotes always editable. |
| **B. Rep can lock; manager can unlock** | Engineering recommendation. Reduces accidental edits. |
| **C. Auto-lock on customer acceptance** | Prevents post-acceptance changes without re-approval. |
| **D. B and C combined** | Both manual and automatic locking. |

**Sample answer:** D.

**Your answer:** _____________

---

#### DP 3.5 — Customer-driven changes mid-quote

**Question:** Customer responds to a sent quote with "add two more units and remove the trailer." How does the rep respond?

| Option | What it means |
|---|---|
| **A. Create a brand-new quote** | Clean. Slow. |
| **B. Revise in place** | Fast. Requires DP 3.3 to be answered as B or C. |
| **C. Create amendment document attached to original** | Legalistic. Confusing. |

**Sample answer:** B (via DP 3.3 hybrid rule).

**Your answer:** _____________

---

#### DP 3.6 — Quote expiration + OEM price change interplay

**Question:** OEM raises prices. A live quote was sent 5 days ago and is still in its 30-day window. What happens?

| Option | What it means |
|---|---|
| **A. Quote honors old prices until it expires naturally** | Customer-friendly. Margin hit if customer accepts. |
| **B. Quote auto-expires the moment OEM prices change** | Customer-hostile. Customer trust risk. |
| **C. Quote remains valid; rep is alerted with re-price option (links to OEM doc Decision 2)** | Engineering recommendation. Rep chooses. |
| **D. Per-OEM pricing protection window honored, then re-price** | Most accurate. Requires OEM doc Decision 7 answered. |

**Sample answer:** C for Phase 1, D after OEM-by-OEM pricing protection windows are documented.

**Your answer:** _____________

---

### Cluster D — Quote-to-Order Conversion

#### DP 4.1 — What constitutes "yes"

**Question:** What event marks a quote as converted to an order?

| Option | What it means |
|---|---|
| **A. Verbal yes captured by rep (voice note attached)** | Fastest. Lowest paper trail. |
| **B. E-signature on the quote** | Standard. Requires DP 2.2 = B. |
| **C. PO received from customer** | Cleanest legal. Slowest. |
| **D. Deposit received** | Money is the truth. |
| **E. Combination per deal type** | Engineering recommendation. Cash deals = D, financed = B + lender approval, government = C. |

**Sample answer:** E.

**Your answer (and rules per type):** _____________

---

#### DP 4.2 — Deposit policy

**Question:** Above what deal value is a deposit required, and what percentage?

**Sample policy:**

| Deal value | Deposit required | Refundable? |
|---|---|---|
| < $25K | Not required | N/A |
| $25K – $100K | 10% | Refundable until order placed with OEM |
| $100K – $500K | 15% | Refundable until equipment scheduled for delivery |
| > $500K | 20% | Non-refundable once OEM build slot allocated |

**Your policy (amend or replace):** _____________

---

#### DP 4.3 — ERP handoff timing

**Question:** IntelliDealer integration exists. When does quote data push to ERP?

| Option | What it means |
|---|---|
| **A. At quote send to customer** | Earliest. ERP gets data that may never convert. |
| **B. At customer acceptance (per DP 4.1)** | Engineering recommendation. ERP only sees real deals. |
| **C. At deposit receipt** | Most conservative. Delays inventory allocation. |
| **D. At PO receipt** | Latest. Inventory may have been sold to another rep meanwhile. |

**Sample answer:** B.

**Your answer:** _____________

---

#### DP 4.4 — Order modification window

**Question:** Customer says "yes," order is created, ERP gets the data. Now customer wants to swap a model. How long after conversion can the order be modified?

| Option | What it means |
|---|---|
| **A. Until physical delivery** | Most flexible. Most rework. |
| **B. Until OEM build slot is allocated** | Reflects real OEM constraint. |
| **C. 24 hours, then locked** | Tightest. Reduces churn. |
| **D. Per-OEM rules (each OEM has its own change-window policy)** | Most accurate. Requires data per OEM. |

**Sample answer:** D, falling back to B when OEM-specific rule isn't loaded.

**Your answer:** _____________

---

#### DP 4.5 — Inventory allocation timing

**Question:** Stock unit is in the yard. Rep includes it on a quote. When is it allocated (i.e. invisible to other reps)?

| Option | What it means |
|---|---|
| **A. At quote draft creation** | Earliest. Encourages reps to over-quote and hoard inventory. |
| **B. At quote send to customer** | Middle ground. |
| **C. At customer acceptance** | Engineering recommendation. Honest about availability. |
| **D. At deposit receipt** | Most conservative. Risk: stock sold to another rep mid-negotiation. |

**Sample answer:** C with a "soft hold" flag on draft (visible to other reps as "potentially committed") that becomes a hard hold at acceptance.

**Your answer:** _____________

---

#### DP 4.6 — Conflict resolution: two reps quote the same stock unit

**Question:** Rep A quotes Unit #123. Rep B also quotes Unit #123 before A converts. Who wins?

| Option | What it means |
|---|---|
| **A. First to convert wins** | Reflects deposit-driven reality. Loser eats the work. |
| **B. First to soft-hold (draft) wins; system warns Rep B at draft time** | Engineering recommendation. Transparency upfront. |
| **C. Manager arbitrates each conflict** | Slow. Political. |
| **D. Auto-substitute Rep B with the next equivalent unit, alert Rep B** | Most automated. Requires inventory similarity engine. |

**Sample answer:** B with a "this unit is on another quote — proceed anyway?" prompt.

**Your answer:** _____________

---

### Cluster E — Win / Loss / Dead Deal Capture

#### DP 5.1 — Loss-reason capture requirement

**Question:** Quote dies (customer says no, ghosts, or expires). What must the rep capture?

| Option | What it means |
|---|---|
| **A. Nothing required — quote disappears** | Worst data. |
| **B. Loss reason from a pre-defined picker (required)** | Engineering recommendation. |
| **C. Picker + free-text required** | Best data. Most rep friction. |
| **D. Picker + voice note required** | Best signal. Adds capture time. |

**Sample answer:** B for Phase 1, upgrade to C after 90 days.

**Your answer:** _____________

---

#### DP 5.2 — Loss-reason taxonomy

**Question:** What loss reasons should reps choose from?

**Sample taxonomy (amend):**

- Price — lost to lower price
- Timing — customer not ready to buy
- Financing — customer couldn't secure financing
- Competitor — name competitor in free-text
- Spec / fit — equipment didn't match need
- Trade-in valuation — couldn't agree on trade value
- Relationship — went with another dealer
- Internal — customer's project cancelled / postponed
- No response — customer ghosted (≥ 14 days no contact)
- Other (free-text required)

**Your taxonomy (additions/removals):** _____________

---

#### DP 5.3 — Competitor capture

**Question:** When loss reason is "Competitor," do we capture which competitor and at what price?

| Option | What it means |
|---|---|
| **A. Optional free-text field** | Easy. Data quality varies. |
| **B. Picker for competitor name + optional price field** | Engineering recommendation. Names normalized for analytics. |
| **C. Required: name AND price** | Best data for OEM negotiations. Most friction. |
| **D. Required: name only; price optional** | Compromise. |

**Sample answer:** D.

**Your answer:** _____________

**Follow-up:** Provide initial competitor list to seed the picker: _____________

---

#### DP 5.4 — Dead-deal review cadence

**Question:** How often does sales leadership review dead deals as a group?

| Option | What it means |
|---|---|
| **A. Weekly with VP Sales** | Tight loop. Discipline-heavy. |
| **B. Bi-weekly with VP Sales** | Engineering recommendation. Balanced. |
| **C. Monthly with VP Sales; quarterly with owner** | Hands-off. |
| **D. No formal cadence; ad-hoc** | What happens today. |

**Sample answer:** B with monthly owner review of the rollup.

**Your answer:** _____________

---

#### DP 5.5 — Re-engagement triggers for dead deals

**Question:** A deal died 6 months ago. Should QEP OS proactively re-surface it under certain conditions?

| Option | What it means |
|---|---|
| **A. No — dead is dead** | Simple. Misses recovery opportunities. |
| **B. Re-surface on customer activity (visit to website, opened an unrelated email, etc.)** | Requires marketing/tracking integration. |
| **C. Re-surface on time-based triggers (6mo since loss, equipment age threshold on customer's current fleet)** | Engineering recommendation. Pure data, no integrations needed. |
| **D. B and C combined** | Most powerful. |

**Sample answer:** C for Phase 1.

**Your answer:** _____________

**Follow-up:** Sample trigger to react to: "Customer's competing equipment has crossed 5,000 engine hours" — does QEP OS know enough about customer fleets to fire this? (We have `crm_equipment` per [migration 283](supabase/migrations/283_qb_crm_extensions.sql).) If so, what's the engine-hour threshold by category?

| Category | Engine hours / age threshold for re-surface |
|---|---|
| Compact track loaders | |
| Skid steers | |
| Mini-excavators | |
| Heavy excavators | |
| Wheel loaders | |
| Other: ______ | |

---

## 5. Data we need from you to start

- [ ] All 26 decision points (1.1–5.5) answered
- [ ] Default expiration windows per category (DP 3.1)
- [ ] Deposit policy table (DP 4.2)
- [ ] Mandatory attachments table (DP 2.4)
- [ ] E-sign vendor choice (DP 2.2)
- [ ] Branding template files (PDF templates, dealership logo, brand color) (DP 2.3)
- [ ] Loss reason taxonomy approval (DP 5.2)
- [ ] Initial competitor list (DP 5.3)
- [ ] Engine-hour / age re-engagement thresholds per category (DP 5.5)
- [ ] Confirmation that IntelliDealer has the API endpoints we need for DP 4.3 timing (engineering will verify with IT)
- [ ] Confirmation that M365 mailbox sync (migration 571) can attach a `quotes@yourdealer.com` mailbox for delivery + reply capture
- [ ] Customer portal scope confirmation (DP 2.7)

---

## 6. Data we will be touching

| Table | What it holds | Who can see it |
|---|---|---|
| `quote_ownership` | Primary rep, secondary reps, split %, manager, transfer history | Owner, VP Sales, the reps involved |
| `quote_delivery_log` | Sent timestamp, channel, opened timestamp, read receipt events | Rep, VP Sales, Owner |
| `quote_version_history` | Per-revision snapshot of line items, prices, totals, who edited | Rep, VP Sales, Owner |
| `quote_lifecycle_events` | Created → drafted → sent → opened → accepted → ordered → delivered | Rep, VP Sales, Owner |
| `quote_locks` | Locked-by, locked-at, lock reason | Rep, manager |
| `quote_to_order_handoff` | Conversion event, ERP push status, inventory allocation status | Operations, Finance, Engineering |
| `inventory_soft_holds` | Per-unit soft holds from draft quotes (DP 4.5) | All reps (so they see contention) |
| `dead_deal_capture` | Loss reason, competitor, competitor price, free-text, voice note | Rep, VP Sales, Owner, Marketing (for competitive intel) |
| `re_engagement_triggers` | Conditions to re-surface dead deals; per-customer trigger fire history | VP Sales, Owner |

All RLS-enforced by workspace and ownership.

---

## 7. Risks if we get this wrong

| Risk | Mitigation |
|---|---|
| **Inventory contention causes rep arguments** | DP 4.5 + 4.6 make contention visible upfront. Conflict resolution rule is transparent. |
| **Quote re-sends spam customers** | DP 2.5 cooldown. Owner sees re-send frequency in audit. |
| **Departed rep's quotes orphaned** | DP 1.3 forces manager triage within 7 days; system alerts owner if any quote sits unowned > 14 days. |
| **Read receipts trigger creepy customer experiences** | DP 2.6 disclosure footnote on every quote. Reps trained to not say "I see you opened my quote three times." |
| **Quote auto-renews at stale prices** | DP 3.2 = C prevents this; OEM Price Feeds Decision 7 layered on top. |
| **ERP gets bad data from quotes that never converted** | DP 4.3 = B prevents this. |
| **Loss reason data is garbage** | DP 5.1 = B-C-D escalation forces minimum data quality. Owner reviews loss-reason distribution quarterly; if reasons cluster suspiciously (e.g., 80% "no response"), the taxonomy is wrong or reps are gaming it. |
| **Customer portal exposes one rep's pricing to another rep's deal** | DP 2.7 = B prevents this in Phase 1 (one quote at a time). Phase 2 portal scoping requires careful UX. |

---

## 8. What success looks like

90 days after launch:

- 100% of quotes have an assigned rep at all times (no orphans)
- 100% of dead deals have a loss reason captured
- Quote-to-order conversion rate is *measurable* (today it likely isn't)
- Average days-from-send-to-acceptance is tracked per rep and per category
- Re-send cooldown violations < 5% of total sends (i.e. reps respect the policy)
- Inventory contention warnings fire and are resolved without owner involvement in 90% of cases
- Owner can answer "which 3 reps have the worst conversion rate and why are they losing" in 30 seconds from the dashboard
- Dead-deal re-engagement triggers fire and generate at least 1 conversion in the 90-day window (proves the loop closes)

---

## 9. What happens after this document is answered

1. **Day 1–2** — Ownership and lifecycle event schema
2. **Day 3–4** — Delivery channel router; M365 mailbox provisioning; PDF template wiring
3. **Day 5** — E-signature vendor integration (whichever DP 2.2 selects)
4. **Day 6–7** — Quote version history; revision rules (DP 3.3); lock mechanism (DP 3.4)
5. **Day 8** — Re-send cooldown; read receipt tracking
6. **Day 9–10** — Conversion event handler (DP 4.1 rules); ERP handoff trigger (DP 4.3)
7. **Day 11** — Inventory soft-hold + contention warnings (DP 4.5/4.6)
8. **Day 12** — Dead deal capture flow (DP 5.1, 5.2, 5.3)
9. **Day 13** — Re-engagement trigger engine (DP 5.5)
10. **Day 14** — Conversion funnel dashboard for owner
11. **Day 15** — End-to-end test; pilot launch
12. **Day 16–45** — 30-day pilot, weekly metrics reports to owner

---

## 10. Open questions we expect pushback on

1. **DP 1.3 (rep departure):** This is operationally painful at most dealerships because departed reps' quotes often die in transition. The 7-day manager triage rule will surface how many quotes you're losing this way today.
2. **DP 2.6 (read receipts):** Legal may push back on the disclosure footnote. The alternative — silent tracking — has reputational risk if a customer ever asks "how did you know I opened your quote?"
3. **DP 4.5 (inventory soft-hold):** Reps with the most pipeline-padding habits will hate this. That's a feature, not a bug.
4. **DP 4.6 (inventory contention):** Decide whether soft-hold reservation lasts indefinitely (encouraging hoarding) or has a TTL (e.g. 7 days, then released). We recommend a 14-day TTL.
5. **DP 5.5 (re-engagement):** Marketing may want to own this surface instead of sales. Recommendation: data lives in QEP OS, marketing can read it for campaigns, but the re-surface action is a sales rep alert, not a marketing email.
6. **DP 4.2 (deposit policy):** Today, most dealerships handle deposits inconsistently. Codifying this is the right move but will create new conversations with returning customers who weren't asked for a deposit last time.

---

## 11. Returning your answers

Same as Tier 1 — markdown reply, email, or recorded session. Unsigned decision points default to the sample answer with an "owner-deferred" flag for later override.

---

## Appendix A — Glossary

- **Quote of record** — the single quote attributed to the deal for commission and audit purposes.
- **House quote** — a quote not assigned to a specific rep; commission goes to the dealership.
- **Soft hold** — an inventory unit tentatively reserved by a draft quote; visible to other reps with a "potentially committed" flag.
- **Hard hold** — an inventory unit firmly allocated to an accepted quote; invisible to other reps for new quotes.
- **Conversion event** — the system-recognized moment a quote becomes an order (per DP 4.1).
- **ERP handoff** — the push of quote/order data from QEP OS into IntelliDealer.
- **Dead deal** — a quote that did not convert and will not be revived without intervention.
- **Re-engagement trigger** — a system condition that re-surfaces a dead deal for rep follow-up.

---

*End of Tier 2. Companion docs:* [Tier 0 — OEM Price Feeds](QEP-OEM-PRICE-FEEDS-OWNER-DISCOVERY.md) · [Tier 1 — Margin & Pricing](QEP-QUOTE-PROCESS-TIER-1-MARGIN-PRICING-OWNER-DISCOVERY.md) · [Tier 3 — Specialty Flows](QEP-QUOTE-PROCESS-TIER-3-SPECIALTY-FLOWS-OWNER-DISCOVERY.md)
