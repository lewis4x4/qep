# QEP OS — Claude Code Handoff

**Source:** Weekly App Check-In, 2026-04-23
**Author:** Brian Lewis (CEO, BlackRock AI)
**Client ID:** `qep-usa`
**Pipeline Target:** Paperclip CEO → Architect → Engineer → QA → DevOps → Security → Data & Integration
**Status:** Supersedes prior Phase 1 sprint plan. Re-route all in-flight work through this document.

---

## 0. READ THIS FIRST

This handoff shifts the current roadmap based on three inputs:

1. **Meeting commitments** Brian made to the QEP team on 2026-04-23.
2. **Improvements and workflow changes** the team agreed to on that call.
3. **Fly-on-the-wall call-outs** — signals in the meeting that were heard but under-engaged, or never raised but materially affect build quality, adoption, or legal exposure.

Every ADR, sprint item, and anti-pattern below is traceable to one of those three sources. Source tags:
- `[COMMIT]` — Brian explicitly promised QEP
- `[CHANGE]` — Workflow or scope change agreed on the call
- `[CALLOUT]` — Fly-on-the-wall signal requiring action

**Non-negotiables before any module ships live to QEP users:**
- Full brand compliance per `qep_brand_guide.pdf` (colors, fonts, voice).
- Real customer + inventory data replaces seed data.
- TILA disclaimer module on any screen rendering payment math.
- Record-concurrency model (ADR-001) is decided and implemented.

**Priority order:** ADRs first, then blocking gates, then Phase 1 sprint revisions, then module-specific changes, then workflow capture, then roadmap shifts for Phases 2–9.

---

## 1. PROJECT CONTEXT SNAPSHOT

| Field | Value |
|---|---|
| Client | Quality Equipment & Parts Inc. (QEP USA) |
| Locations | Lake City, FL and Ocala, FL |
| Tagline | Setting a New Standard in Heavy Equipment. It's in the Name. |
| Product Codename | QEP OS (QEP Dealership Operating System) |
| Active Phase | Phase 1 — Core CRM / QRM (REVISED — see Section 6) |
| Meeting Attendees | Rylee McKenzie, Ryan McKenzie, Juan, Angela, Brian Lewis |
| Primary Contact | Rylee McKenzie (Sales & Marketing Manager) — he/him |
| Final Authority | Ryan McKenzie (Owner) — "visual guy," present but quiet on the call |
| Compliance POC | Angela (Sales Admin, former banker — raised TILA concern) |
| Parts POC | Juan (counter) + Norman (manager, not on call) + Bobby (counter, not on call) |

**Naming rule (non-negotiable):** It is `Rylee`, not `Riley`. There is no `Riley`. Do not let any agent output use that name.

---

## 2. BRAND COMPLIANCE — APPLIES TO EVERY UI SURFACE

Source: `qep_brand_guide.pdf` (in client knowledge base).

### Colors (Tailwind / CSS vars)

```css
:root {
  --qep-orange: #F28A07;   /* primary action, headings, emphasis */
  --qep-gear-gray: #BFBFBF; /* borders, secondary UI, hardware accents */
  --qep-charcoal: #111111; /* primary background, headers, hero overlays */
  --qep-white: #FFFFFF;    /* type on dark, negative space */
  --qep-brown: #2A2421;    /* support tone, merch, rugged texture */
}
```

Tailwind extension:
```js
theme: {
  extend: {
    colors: {
      qep: {
        orange: '#F28A07',
        gray: '#BFBFBF',
        charcoal: '#111111',
        brown: '#2A2421',
      },
    },
  },
}
```

### Typography

| Role | Font | Notes |
|---|---|---|
| Primary headline | Bebas Neue or Barlow Condensed Bold | uppercase, high contrast |
| Secondary headline | Montserrat ExtraBold | digital / dashboards |
| Body | Inter or Arial | proposals, forms, long text |
| Numbers / KPI | Montserrat Bold | stats, pricing callouts |

Load fonts via `next/font` or `@fontsource` — no CDN links. Never substitute script or luxury serif fonts.

### Voice rules

- Confident, knowledgeable, practical, relationship-driven.
- No corporate jargon. No AI-sounding copy. No fluffy claims.
- Preferred themes: uptime, support, real-world performance, parts availability, service responsiveness.
- UPPERCASE for CTAs, section titles, labels. Avoid mixed-case buttons.
- Rylee has explicitly flagged AI-generated copy as a dealbreaker. Any LLM-generated user-facing text is edited to sound human before ship.

### Layout rules

- Dark charcoal base + orange accents + white type. Default to dark mode.
- Gears, steel textures, industrial lines as motifs.
- Orange left-rules and dividers for emphasis.
- Clean structured layouts, never over-polished stock photography.
- Logo lockup never stretched, never recolored. Clear space equals the height of the small orange gear above the wordmark.

---

## 3. ADRs — WRITE AND SIGN THESE BEFORE CODE CHANGES

All ADRs are filed at `docs/adr/` in the main repo. Architect agent owns drafting, Brian owns sign-off.

### ADR-001 — Record Concurrency Model `[CALLOUT]`

**Decision:** Optimistic concurrency with Supabase Realtime presence.
**Pattern:**
- Every editable record has a `version` column (int, default 1, auto-incremented via trigger on UPDATE).
- Client sends current `version` with every mutation. Supabase rejects if server version has advanced.
- Supabase Realtime presence broadcasts which users are viewing each record. UI surfaces a soft banner: "Norman is also viewing this invoice."
- Conflict UI: on version mismatch, surface the other user's changes with accept / merge / discard options.

**Rejected:**
- Pessimistic locking (IntelliDealer pattern — frustrating when someone forgets to close a record).
- Full real-time co-editing (too much complexity for a dealership back-office flow).

**Affected modules:** Parts, Service, Sales quotes, Rentals.

### ADR-002 — Multi-Window Workspace Pattern `[CALLOUT]`

**Decision:** Browser-native tabs. Every parts invoice, quote, or service ticket can open in its own tab. Shared session. Writes flow through the same Supabase realtime channel.
**Implementation:**
- Every record has a stable deep-link URL (`/parts/invoice/{uuid}`, `/quotes/{uuid}`, `/service/ro/{uuid}`).
- Cmd/Ctrl+Click or middle-click opens any record in a new tab with full session context.
- Add a "Pop out" button to the detail pane on every record type.
- No popup windows, no single-page slider limitation. Browser handles the window management.

**Rejected:** In-app window manager (reinvents the browser).

### ADR-003 — Progressive Customer Capture in Parts `[CALLOUT]`

**Decision:** Minimum capture is phone number + first name. Anything else is optional and enriched later.
**Why:** Juan explicitly warned that over-strict forms drive counter reps to bypass (enter "WALK-IN" and move on). Rylee needs data for marketing. Solve both: capture the bare minimum on first touch, queue enrichment tasks for off-peak hours.

**Implementation:**
- Parts invoice `customer` field accepts: existing match, phone-number fuzzy match, or new-customer stub (phone + first name).
- System auto-flags stubs as `enrichment_needed = true`.
- `Customers - Enrichment Queue` view on Rylee's dashboard shows all stubs sorted by revenue potential (most recent first, highest ticket value first).
- Per-rep **Capture Quality Score** widget on the manager dashboard: % of invoices with full customer record. No hard block, only visibility. Carrot, not stick.

**Schema addition:**
```sql
ALTER TABLE customers ADD COLUMN enrichment_needed boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN capture_source text; -- 'parts_counter', 'sales_rep', 'data_miner', 'imported', ...
CREATE INDEX customers_enrichment_needed_idx ON customers (enrichment_needed) WHERE enrichment_needed = true;
```

### ADR-004 — Serial Number Is the Primary Entry Point for Parts `[CHANGE]`

**Decision:** The parts command center opens to a single serial-number input. All other filters are downstream.
**Why:** Juan and Rylee independently concluded serial number is mandatory for every parts quote. Everything derives: current customer, machine model, service history, compatible parts, photo library.

**Implementation:**
- Parts landing page hero: one large input, autofocus, labeled `SERIAL NUMBER`.
- Progressive filter: typing filters the `equipment` table. Display top 5 matches with model + current owner.
- Confirm match → auto-attach quote to customer, populate compatible-parts list, surface historical part orders for that serial.
- Fallback: "Can't find serial? Search by customer or part" collapse link below the primary input.

**Deprecates:** Customer-first and part-first parts entry screens. Those remain accessible as secondary paths, not the default.

### ADR-005 — Trade-In Photo-to-Estimate Guardrails `[CALLOUT]`

**Decision:** Photo input produces a labeled **market comp range** (low/mid/high) tied to model only. No single-number estimate. Structured inspection checklist is required before any trade credit moves to the quote.

**Implementation:**
- Photo upload → market comp lookup (existing live-market feed, scoped to model).
- UI always renders three numbers with the header "COMPARABLE MARKET RANGE — NOT A GUARANTEED OFFER."
- Trade-in credit field on the quote is locked until inspection checklist is completed.
- Inspection checklist fields (minimum): hour meter, undercarriage condition, hydraulic leaks (Y/N + notes), engine hours at last service, tires/tracks condition, visible damage photos.
- Sales manager approval required on any trade credit above a configurable threshold.

### ADR-006 — Financing Calculator Compliance Gate `[COMMIT]` `[CALLOUT]`

**Decision:** Financing calculator is feature-flagged OFF globally until three conditions are met:
1. Angela delivers Florida TILA / lending provider notification rule documentation.
2. Disclaimer module is wired and renders on every payment-math surface.
3. Angela signs off in writing.

**Implementation:**
- Environment flag: `FEATURE_FINANCING_CALCULATOR=false` in all environments by default.
- Flag check wraps the entire calculator component tree. When off, surfaces render a "Financing calculator coming soon" placeholder.
- Disclaimer component (reusable): "This is a payment estimate, not a guaranteed rate. Subject to credit approval. Rates shown are manufacturer-published programs, subject to change. QEP is not a lender."
- Any APR display requires source attribution (manufacturer program name + effective date).
- CI gate: lint rule prevents rendering any payment math outside the flagged tree.

**Tracker task:** `QEP-TILA-001 — Receive Florida rule docs from Angela` (blocks calculator launch).

### ADR-007 — Equipment Ownership Transfer Workflow `[CHANGE]`

**Decision:** Same-serial-new-customer triggers a soft-transfer prompt. On confirm, equipment record is cloned to the new owner with full history preserved and linked. Original record is flagged `transferred_on` and retained read-only.

**Schema:**
```sql
ALTER TABLE equipment ADD COLUMN transferred_from uuid REFERENCES equipment(id);
ALTER TABLE equipment ADD COLUMN transferred_on timestamptz;
ALTER TABLE equipment ADD COLUMN status text NOT NULL DEFAULT 'active'; -- 'active' | 'transferred' | 'retired'
```

**UI:**
- When a parts/service/sales action enters a serial already owned, prompt: "This serial is currently owned by {old_owner}. Has it been transferred to {new_owner}?"
- Options: `Yes, transfer` (clones record, links history, marks old record read-only), `No, wrong serial` (aborts), `Not sure — flag for review` (opens Rylee task).

### ADR-008 — Offline-First for All Field Features `[CALLOUT]`

**Decision:** Every field-facing feature (voice capture, photo upload, trade-in intake, quote generation, visit logging) writes to IndexedDB first, syncs via background sync on reconnect.

**Stack:**
- `idb` for IndexedDB access.
- Service worker with `workbox-background-sync` plugin.
- Supabase mutations wrapped in a queue abstraction that writes-through when online, queues when offline, retries on reconnect.
- UI indicator (charcoal pill with orange dot): `ONLINE` / `QUEUED (N)` / `SYNCING`.

**Why:** Florida forestry is rural. Reps lose coverage. Retrofitting offline into online-first React apps is painful — build it now or rebuild it in Phase 9.

### ADR-009 — IntelliDealer Data Miner as Integration Bridge `[CALLOUT]`

**Decision:** Scheduled weekly ingestion of IntelliDealer master-file dump serves as the canonical source for IntelliDealer-side data during parallel-run. Replaces blocking on VitalEdge API.

**Implementation:**
- Dropbox / OneDrive folder watched by an ingestion Edge Function.
- Parser normalizes the master-file dump into `staging_*` tables.
- Reconciliation job matches against QRM records by a composite key (customer name + phone + tax ID when available).
- Diff report generated and surfaced on Rylee's admin dashboard.
- Cadence: weekly on Sundays 2am ET. Configurable to daily later.

**Deprecates:** "Wait for VitalEdge API access" as a blocker for Phase 3+.

### ADR-010 — Sandhills Recording Ingestion Scoping `[CALLOUT]`

**Decision:** Before committing to 8x8 integration timing, scope current Sandhills recording footprint.
**Open questions for QEP:**
- Who owns the Sandhills account?
- What's the current recording volume and retention?
- Can recordings be exported in bulk?
- Is there an API?
- Two-party consent disclosure language currently in use?

**Pipeline task:** Data & Integration agent schedules a call with whoever at QEP owns Sandhills. Deliverable: a one-page scoping memo. Until that memo exists, 8x8 integration remains a Phase 1C scope item, not a Phase 1A commitment.

---

## 4. MEETING COMMITMENTS — `[COMMIT]` DELIVERABLES

These are items Brian explicitly promised on the 2026-04-23 call. Every one gets a Paperclip work item.

| ID | Commitment | Owner | Blocks |
|---|---|---|---|
| C1 | Build attachment compatibility sidebar with one-click add on equipment quote page | Engineer | — |
| C2 | Add extended warranty add-ons to quote review step (Step 6); prefilled for ASV, Bandit, Yanmar | Engineer | — |
| C3 | Improve customer-facing PDF output quality | Engineer + Design | Customer-facing quote launch |
| C4 | Revamp command center UI to simpler, role-based layout with large quick-action buttons per role | Architect + Engineer | Any live user onboarding |
| C5 | Floating mobile action bar — fix to stick to viewport bottom | Engineer | Mobile salesman dashboard |
| C6 | Rename "Morning Briefing" to "AI Briefing" with on-demand refresh | Engineer | — |
| C7 | Build parts dashboard with serial-number-first search and auto-equipment-link workflow | Architect + Engineer | Parts module launch |
| C8 | Implement auto-save + drafts section across parts, sales, service | Engineer | Parts module launch |
| C9 | Parts pop-out card: photo, AI part explanation, branch inventory, activity history | Engineer | Parts module launch |
| C10 | TILA-compliant disclaimer module for any payment-math surface | Engineer + Legal review | Financing calculator launch (ADR-006) |
| C11 | QRM foundation with 100% IntelliDealer field parity for companies and contacts | Architect + Engineer + Data | Phase 1 sales module go-live |
| C12 | Aging fleet queue logic — default to GL stocking date, confirm with Rylee | Architect | Aging fleet module surface |
| C13 | 8x8 call recording + AI transcription + quote pre-fill (pending ADR-010) | Engineer + Data | Phase 1C scope decision |

---

## 5. WORKFLOW CHANGES AGREED ON THE CALL — `[CHANGE]`

### Parts module
- Every parts interaction starts as a **quote**, not a direct invoice. State machine: `quote → processing → follow-up → invoice | lost_sale`.
- Lost sale logging is mandatory with reason code (`price`, `no_stock`, `delivery_timing`, `competitor`, `other_with_note`).
- Drafts section holds any ticket not explicitly saved or closed. Auto-save continuously in background (Word/OneDrive pattern).
- Receiving department captures part photos during intake. Photo library powers the pop-out card visual ID (ADR future: reverse-image lookup for part identification at the counter).
- Serial number is mandatory (ADR-004).

### Sales module
- Sales cadence default: day 0 / day 2-3 / day 7 / day 14 / day 30. AI must suppress redundant prompts if a conversation has advanced the deal.
- Quote save routes to sales manager for approval with four outcomes: approve, approve-with-edits, reject, reject-with-comments.
- Margin-below-floor flag displays the reason captured by the rep (e.g., "5% discount to win competitive deal").
- Customer-facing PDF is gated on C3 before any rep sends externally.

### Cross-department activity timeline
- Single master activity timeline per company/contact record.
- Equipment sale triggers: parts stocking alert (based on maintenance intervals parsed from service manuals), service manager outreach task (+2 day SLA), sales cadence start.
- Recurring service events on the same serial trigger a sales lead when a replacement-opportunity pattern is detected.

### Dashboards
- Manager dashboard: full command center with aging fleet, pipeline metrics, AI briefing, approvals queue, stale-deal alerts.
- Salesman dashboard: mobile vertical layout, priority actions, pipeline, quick capture (new quote, voice note, log visit, take photo), 8x8 tap-to-call/email.
- Parts counter dashboard: serial-number input hero, new invoice / lookup old invoices quick actions, drafts list, capture quality score.
- Navigation: top nav with left submenus (Redex-style reference). Dark charcoal base. QEP Orange accents.

---

## 6. REVISED PHASE 1 SPRINT SEQUENCE

Replaces the prior Phase 1 Sprint 1–5 plan. Re-queue any in-flight work against this.

### Sprint 1A — Foundation Hardening (pre-sales module)
Blocks all subsequent work.
- ADR-001 through ADR-005 written, reviewed by Brian, merged.
- QRM schema migration: `companies`, `contacts`, `equipment`, `deals`, `activities`, `quotes`, `quote_line_items`, `customer_equipment_ownership_transfers`, with full IntelliDealer field parity. Architect produces the field-parity matrix first.
- RLS policies per the role matrix in the project context doc.
- Record-concurrency infrastructure (version column + trigger + realtime presence channel).
- Offline-first scaffolding (service worker, IndexedDB queue abstraction).

### Sprint 1B — Command Center UI Revamp (C4)
- New role-based command center per role matrix.
- Dark charcoal base, QEP Orange accents, Bebas Neue headlines, Montserrat subheads, Inter body.
- Top nav with left submenus.
- Large quick-action buttons per role.
- Floating mobile action bar fix (C5).
- AI Briefing rename + on-demand refresh (C6).
- Engineer delivers two-to-three layout variants — Ryan picks in a dedicated UI-review session (see Section 8, QA-R1).

### Sprint 1C — Sales Module Real-Data Cutover (C11)
- IntelliDealer data miner ingestion job (ADR-009) operational.
- Customer + equipment migration complete against real exports from Rylee.
- Sales rep's quote flow end-to-end on real data: company/contact selection → equipment from real inventory → attachments with compatibility sidebar (C1) → trade-in with ADR-005 guardrails → warranty add-ons (C2) → financing (feature-flagged per ADR-006) → manager approval → customer-facing PDF (C3).
- Sales cadence automation with AI redundancy suppression.
- Deal pipeline kanban with equipment-aware cards.

### Sprint 1D — Parts Module Redesign (C7, C8, C9 + ADR-004)
- Serial-number-first command center.
- Pop-out card with photo, inventory, history, AI part explanation.
- Auto-save + drafts section.
- Progressive customer capture (ADR-003).
- Lost-sale logging with reason codes.
- Quote → processing → follow-up → invoice state machine.

### Sprint 1E — Communication Hub
- Microsoft Graph API OAuth for Outlook email integration (unchanged from original plan).
- Twilio SMS replacing VitalEngage.
- 8x8 integration scoped post-ADR-010.

### Sprint 1F — HubSpot Migration
- As originally planned, subject to HubSpot API key delivery from QEP (blocking).

---

## 7. FLY-ON-THE-WALL CALL-OUTS AS CONSTRAINTS

These are not ticket-level items. They are principles every agent in the pipeline applies throughout Phase 1 work.

### Cultural / change-management constraints

- **Rylee asked for IntelliDealer-familiar navigation.** Deliver a terminology map (`IntelliDealer_to_QEPOS_Terminology.md`), a two-page quickstart per role, and a "where did it move?" cheat sheet before any user logs in. DevOps owns publishing these as onboarding assets.
- **Ryan was present but quiet.** Silence is not approval. Book a Ryan-only branded-UI walkthrough after Sprint 1B lands (before Sprint 1C cutover). Architect + Brian own this session.
- **Rylee has the workflows but cannot code them.** Schedule structured 1-hour workflow-capture sessions per role. Targets: Rylee (sales manager), David or Angela (sales rep), Bobby (parts counter), Norman (parts manager), a service writer, a technician, Tina (finance). Data & Integration agent owns scheduling and transcription. Modules are built from these sessions, not from general check-in chatter.

### Commercial / adoption constraints

- **Commissions are the make-or-break adoption lever for sales.** Sales reps do not trust a new system until they can verify commission. Schedule a dedicated session with Rylee on commission structure — layered logic including base %, manufacturer SPIFFs, margin-tier overrides, trade-in impact, finance reserve splits. Build a per-rep commission-to-date widget on the sales dashboard before pilot users go live. Add to Sprint 1C.
- **Dealership reports run the morning.** Ask Rylee and Ryan separately: "What are the first five reports you open in the morning?" Build parity for those in Sprint 1C. Candidates: daily sales, parts counter summary, WIP by tech, open RO list, AR aging, commission-to-date, unit inventory aging, lost sales by reason, warranty claim status.
- **Never show other-client environments on a QEP call.** Build a private UI reference gallery controlled by BlackRock AI. Retire live Lewis Insurance / Redex demos from QEP sessions.

### Technical constraints

- **Progressive data capture beats mandatory fields every time.** Any form that blocks a workflow on completeness is a form that generates `WALK-IN` junk records. Carrot (capture quality score on manager dashboard), not stick (required-field blocks).
- **AI Briefing is a UI container, not logic.** Until the scoring function exists, do not market AI Briefing as the-thing-that-tells-you-what-to-do-today. Build scoring: weighted sum of lead score, last-touch age decay, pipeline stage weight, customer value band, weighted forecast contribution. Ship scoring before marketing.
- **Parts pricing is 10x more complex than equipment pricing.** Matrix pricing by category, core charges, exchange programs, freight markups, vendor-direct pricing, special pricing agreements, manufacturer dealer-cost overrides. Do not write parts schema until Norman has been interviewed and the pricing ruleset is documented. Add to Sprint 1D prerequisites.

### Compliance constraints

- **TILA / Florida lending rules govern any payment math surface.** See ADR-006. Feature flag is off until Angela signs off.
- **Two-party consent disclosure** for call recording needs verification. See ADR-010.

### Communication constraints

- **Voice standard per brand guide Section 7.** No corporate jargon, no fluffy claims. Rylee will reject AI-sounding copy. All LLM-generated user-facing text is edited by a human (or run through a prompt that enforces the brand voice — see `skills/email-voice` pattern as a starting reference).
- **Transcripts mislabel speakers.** QEP weekly-check-in transcripts split Ryan's dialogue across generic speaker IDs and misattribute to Brian. Do not assume absence from a speaker label. Ask before assuming.
- **Never use "Riley."** Enforce in every agent output. Add to the agent guardrails file.

---

## 8. BLOCKING GATES — CANNOT SHIP WITHOUT

Pipeline cannot close these issues without the matching approval/delivery:

| Gate | Owner | Blocks |
|---|---|---|
| NDA signed | QEP (Ryan) | Production-territory work |
| HubSpot API key delivered | QEP (Rylee) | Sprint 1F migration |
| VitalEdge / IntelliDealer account rep intro | QEP (Rylee) | Phase 3 native API (not blocking if ADR-009 stays in place) |
| Customer list export (final) | QEP (Rylee) | Sprint 1C real-data cutover |
| Stock-numbers-with-costs export | QEP (Rylee) | Sprint 1C real-data cutover |
| Florida TILA / lending rule docs | QEP (Angela) | Financing calculator launch (ADR-006) |
| Parts workflow document | QEP (Juan + Norman review) | Sprint 1D prerequisites |
| Parts pricing ruleset documented | QEP (Norman) | Sprint 1D schema design |
| Agent service accounts in Supabase Auth | BlackRock DevOps | Automation workflows |
| Paperclip env vars set (QEP_AGENT_EMAIL, QEP_AGENT_PASSWORD, QEP_AGENT_ADMIN_EMAIL, QEP_AGENT_ADMIN_PASSWORD) | BlackRock DevOps | Pipeline automation |
| DNS for qep.blackrockai.co (QUA-108) | BlackRock DevOps | Staging access |

**Brian Bundle (what to chase from QEP):** Items 4, 5, 6, 7, 8 above. Next outbound to Rylee should consolidate these into a single ask.

---

## 9. SESSIONS TO SCHEDULE

Data & Integration agent books these on Brian's calendar.

| ID | Session | Attendees | Output |
|---|---|---|---|
| QA-R1 | Ryan-only branded UI walkthrough | Ryan + Brian | Ryan sign-off on UI direction, feedback log |
| QA-R2 | Rylee — commission structure deep dive | Rylee + Brian + Architect | Commission calc spec, widget wireframe |
| QA-R3 | Rylee + Ryan — "first five morning reports" | Rylee + Ryan + Brian | Reports priority list for Sprint 1C |
| QA-N1 | Norman — parts pricing workshop | Norman + Juan + Brian + Architect | Parts pricing ruleset document |
| QA-WF1 | Sales rep workflow capture | David or Angela + Brian | Sales rep workflow doc |
| QA-WF2 | Parts counter workflow capture | Bobby + Brian | Parts counter workflow doc |
| QA-WF3 | Service writer workflow capture | TBD + Brian | Service workflow doc |
| QA-WF4 | Technician workflow capture | TBD + Brian | Technician workflow doc |
| QA-WF5 | Finance workflow capture | Tina + Brian | Finance workflow doc |
| QA-S1 | Sandhills account scoping | Sandhills account owner at QEP + Brian | Recording export feasibility memo (feeds ADR-010) |

---

## 10. MODULE-BY-MODULE CHANGE MANIFEST

### Equipment quote builder
- `[COMMIT C1]` Attachment compatibility sidebar with one-click add.
- `[COMMIT C2]` Warranty add-ons in review step; ASV, Bandit, Yanmar prefilled.
- `[COMMIT C3]` PDF output quality pass.
- `[CHANGE]` Trade-in flow: photo produces comp range (ADR-005), inspection checklist required, sales manager approval over threshold.
- `[CHANGE]` Financing calculator wrapped in ADR-006 feature flag.

### Sales pipeline
- `[CHANGE]` Sales cadence defaults (day 0 / 2-3 / 7 / 14 / 30) with AI redundancy suppression.
- `[CHANGE]` Deal card equipment-aware.
- `[CHANGE]` Sales manager approval routing: approve / approve-with-edits / reject / reject-with-comments.
- `[CALLOUT]` Per-rep commission-to-date widget (pending QA-R2).
- `[CALLOUT]` Morning report parity (pending QA-R3).

### Parts module
- `[ADR-004]` Serial-number-first entry.
- `[COMMIT C7]` Auto-equipment-link workflow from serial search.
- `[COMMIT C8]` Auto-save + drafts section.
- `[COMMIT C9]` Pop-out part card with photo + AI explanation + branch inventory + history.
- `[ADR-003]` Progressive customer capture.
- `[CHANGE]` Quote-first state machine with lost-sale reason codes.
- `[CHANGE]` Receiving-dept photo capture into parts catalog.
- `[CALLOUT]` Parts pricing ruleset (pending QA-N1 before schema).

### Command center / dashboards
- `[COMMIT C4]` Role-based layout.
- `[COMMIT C5]` Floating mobile action bar fix.
- `[COMMIT C6]` AI Briefing rename + refresh.
- `[CALLOUT]` AI Briefing scoring function (lead score + last-touch age + pipeline stage + customer value + forecast weight).
- `[BRAND]` Dark charcoal base, QEP Orange accents, Bebas Neue / Montserrat / Inter type stack.

### Cross-department
- `[CHANGE]` Single master activity timeline per company/contact.
- `[CHANGE]` Equipment sale triggers parts stocking + service outreach + sales cadence.
- `[CHANGE]` Service recurrence triggers sales lead when replacement pattern detected.

### Integrations
- `[ADR-009]` IntelliDealer data-miner scheduled ingestion (replaces blocking on VitalEdge).
- `[ADR-010]` Sandhills scoping before 8x8 commitment.
- Microsoft Graph / Outlook — unchanged.
- Twilio SMS — unchanged.

---

## 11. ANTI-PATTERNS — DO NOT

- Do not ship any user-facing surface without QEP brand compliance verified against the brand guide.
- Do not render payment math outside the ADR-006 feature-flag boundary.
- Do not force mandatory customer fields on parts quotes (ADR-003).
- Do not default to customer-first or part-first search on the parts landing page (ADR-004).
- Do not use any transcription-generated name that could be "Riley." Autocorrect to "Rylee" in every pipeline agent output.
- Do not show other-client environments on a QEP call.
- Do not market the AI Briefing as a task-directing assistant until the scoring function exists.
- Do not write parts schema until Norman has been interviewed (QA-N1).
- Do not block sales module launch on VitalEdge API — use ADR-009 data miner as the bridge.
- Do not treat Ryan's silence as approval. Book QA-R1.
- Do not deliver user-facing copy that sounds like AI generated it. Edit every LLM output through a human voice pass.

---

## 12. ACCEPTANCE CRITERIA FOR PHASE 1 CLOSE-OUT

Phase 1 is considered complete when all of the following are true:

- All ADRs above are merged and signed off.
- Sprints 1A–1F have closed.
- All `[COMMIT]` items delivered.
- All `[BLOCKING]` gates cleared or explicitly descoped in writing.
- QA-R1 (Ryan UI sign-off) completed.
- QA-R2 (commission structure) closed and widget live.
- QA-R3 (morning reports) closed and reports shipped.
- Real customer + inventory data is running the sales module in production.
- HubSpot is cancelled at QEP.
- Terminology map, role quickstarts, and "where did it move?" cheat sheet published.
- Brand voice pass applied to every user-facing text surface.

---

## 13. REFERENCE DOCUMENTS IN THIS CLIENT FOLDER

| File | Purpose |
|---|---|
| `qep_brand_guide.pdf` | Colors, typography, voice, logo rules |
| `QEP_Weekly_App_Checkin_Summary_2026-04-23.docx` | Meeting minutes (branded) |
| `BlackRock_AI_Action_Sheet_QEP_2026-04-23.docx` | Brian's punch list |
| `QEP_Team_Action_Sheet_2026-04-23.docx` | QEP's punch list |
| `QEP_Builders_Post_Meeting_Analysis_2026-04-23.docx` | 20-observation fly-on-the-wall doc |
| `CLAUDE_CODE_HANDOFF_2026-04-23.md` | This document — authoritative for all pipeline work |

---

## 14. HANDOFF ENTRY POINT FOR CLAUDE CODE

Initial prompt for the Paperclip CEO agent:

> Read `CLAUDE_CODE_HANDOFF_2026-04-23.md` in the `qep-usa` client knowledge base. Supersede the prior Phase 1 Sprint plan. Create Paperclip issues for every ADR (ADR-001 through ADR-010), every `[COMMIT]` item (C1 through C13), every scheduled session (QA-R1 through QA-S1), and every blocking gate. Tag issues by source — `commit`, `change`, `callout`, `adr`, `gate`, `session`. Route ADRs to Architect first, commits to Engineer after ADR sign-off, sessions to Data & Integration. Respect the priority order in Section 0. Confirm receipt with a one-page plan back to Brian before kicking off any engineer work.

---

**End of handoff. Reply with the one-page plan before executing.**
