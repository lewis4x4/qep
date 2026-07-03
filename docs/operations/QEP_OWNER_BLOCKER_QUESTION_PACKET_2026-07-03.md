# QEP Owner Blocker Question Packet

Prepared: 2026-07-03
Audience: Ryan, Rylee, Tina, Norman, Juan/Bobby, Angela, and the relevant department owners
Purpose: collect the owner answers, documents, and exports that are still blocking QEP engineering, roadmap closure, or go-live proof.

Reply inline under each section. If an item is already handled, mark it `answered` and point to the file, email, screenshot, export, or person who owns the evidence. Rough answers are acceptable where exact policy is not ready yet.

Do not include cyber insurance in this request. CYBER-INS / D3.12 is already answered and intentionally skipped.

## Current State - Do Not Reopen

- QEP OS is the forward accounting system of record for AR/AP/reporting. IntelliDealer remains the transition operational system of record until cutover. QuickBooks Desktop is downstream check-register / CPA-reporting output only.
- K1.1 / QEP-221 is no longer blocked on the accounting SoR decision. It can move as implementation work, with unresolved values shown as config-required instead of hard-coded.
- K4.1 / QEP-224 is closed. Build-Lock G5 is reconciled as a bridge/outbound-feed precedent, not a QuickBooks-as-ledger decision.
- D3.7 / QEP-101 is closed. Baseline parts pricing rules are documented and enforced: standard list price, 35% target margin, 25% floor, 5% counter discount cap, manager approval above 5%, internal WO sell-minus-10% with the 25% floor.
- D3.6 / QEP-100 is still owner-review gated. Juan + Norman need to red-line the parts workflow document before it can be marked shipped.

## Fastest Unblockers

1. Parts: Juan + Norman red-line the parts workflow document and resolve the open D3.6 workflow questions.
2. Finance: Tina + Ryan answer the remaining K2.1/K3.1 working-session items, especially parts-vs-service revenue split and migration-path rules.
3. Service/rentals: Ryan/service leadership answer hauling, PM/service plans, rental-fleet PM, renter-fault billing, technician roster/certs, efficiency, and Verizon Reveal depth.
4. Sales/go-live: Rylee/Ryan finish Iron Quote manual sign-offs and provide the external docs/samples blocking quote, Omi, HubSpot, DNS, and financing work.

## Finance And Accounting - Ryan + Tina

### K2.1 - Structured Parts-Vs-Service Revenue Split

This remains gated. For mixed jobs, confirm the reporting buckets QEP should use by line item:

- parts
- labor
- hauling / transport
- warranty
- internal
- rental
- sublet
- tax / fees
- other categories QEP wants separated

Owner prompt: Should every mixed invoice split revenue by line item into these buckets? If different buckets are needed, list them.

### K3.1 - Migration Path And Remaining Finance Values

The QuickBooks-as-ledger question is answered: QuickBooks is not the ledger. These remaining values still need owner/finance decisions:

- corporate-to-branch allocation basis
- per-unit depreciation rules
- lender floor-plan terms, including IBS treatment
- CPA adjustment posting target
- open service-WO migration at cutover
- invoice width and starting numbers by branch/department
- master-ID strategy for customer/vendor matching
- finance-charge posting basis and dunning workflow
- bank account list and exact QuickBooks Desktop output expectations
- deposit and rental-security-deposit monthly reconciliation rule

Owner prompt: Which of these can Tina answer by email, and which require a live working session?

### Documents / Exports Still Needed

- one parts invoice sample
- current chart of accounts
- recent P&L and balance sheet package
- AR aging and AP aging
- customer master export
- vendor master export
- floor-plan schedules and lender terms
- CPA adjustment example or quarter-end package

Owner prompt: Please attach what is available now and name the owner for anything missing.

## Parts - Norman + Juan/Bobby

### D3.6 - Parts Workflow Document Review

Current gate: owner red-line required before D3.6 ships.

Document to review:

- `docs/designs/qep-parts-workflow-document-2026-05-29-review-candidate.md`

Owner prompts:

- Is the proposed parts workflow stage model the one QEP wants staff trained on? Rename or reorder stages as needed.
- Should parts workflow use one shared fulfillment spine or separate spines for counter, service, and internal work?
- What is the canonical status state machine for counter inquiries, parts quotes, parts orders, special orders, and service parts?
- Who owns converting a parts quote into a customer invoice: parts counter, parts manager, service writer, or accounting?
- Which pricing exceptions are auto-applied, and which require Parts Manager approval?
- Who owns vendor contact data and vendor portal credentials?
- How should cores, reman returns, substitutions, lost sales, and exceptions appear in the daily workflow?
- Which legacy IntelliDealer screens or reports must match exactly before staff are asked to switch?

### Parts Evidence / Inputs Still Needed

- full 22-brand OEM and portal list
- secure delivery path for portal logins
- current parts kit catalog as CSV, if one exists
- parts usage history export from IntelliDealer to seed reorder levels
- controller sign-off on internal pricing before launch

Owner prompt: Confirm whether each item exists, who owns it, and when it can be provided.

## Service - Ryan + Service Leadership

### Service Plans, PM, And Contract Billing

Owner prompts:

- Provide the service-plan catalog: plan names, included services, PM intervals, covered equipment types, billing structure, prepaid/entitlement rules.
- For each plan, should PM be triggered by hour meter, calendar interval, whichever comes first, or another rule?
- If the catalog does not exist, should QEP create a first-draft catalog for owner review?

### Work Orders, Rates, And Authorization

Known service direction: equipment-class rates, margin by WO type, mandatory hour-meter, three C's, no approval equals no repair, and more than 10% scope increase requires re-authorization.

Owner prompts:

- Confirm whether the current rate list is final: $185 large construction/forestry, $165 grapple/compact, $185 + $2/mile field, $135 lube, $195 specialty, internal 10% off door.
- Confirm 55% target margin and 35% floor for service.
- Confirm the seven work-order types QEP wants, including hauling and comeback.
- Confirm the five hold states and whether hold time is excluded from both appraisal efficiency and pay-ladder efficiency.
- Confirm the exact efficiency formula: billable hours divided by hours present, or something else?

### Technician Roster, Certifications, And Pay Progression

Owner prompts:

- Provide the current technician roster with branch, road/shop/grapple assignment, OEM certifications, in-house certifications, vendor logins, tenure, and skill restrictions.
- Confirm how technician compensation ranges adjust when door rates differ by class.
- Confirm whether driver work is a distinct role/headcount or a road-tech assignment.
- Confirm required driver accountability measures: mileage, route, time, customer handoff, delays, equipment condition, or other.

### Hauling / Transport

Owner prompts:

- Should hauling be its own work order or a dispatch/transport line attached to repair, rental, or sales jobs?
- Which rate sheet applies for customer-owned repair hauls, QEP-deal machines, rental machines, and internal inventory?
- Confirm truck classes, mileage bands, and round-trip mileage rules.

### Verizon Reveal

Owner prompts:

- For the first version, should Verizon Reveal provide mileage only, live map visibility, or full vehicle/location sync?
- If Verizon data is unavailable, should staff enter mileage manually and reconcile later, or should the job wait for GPS data?

### Grapple Repair Vs. Grapple Build

Known direction: grapple-truck production leaves the service module and becomes its own process/dashboard.

Owner prompts:

- What grapple work is a service repair, and what grapple work belongs in the separate production/build process?
- Should grapple repair and grapple build work use the same technician scorecard and pay ladder, or separate ones?
- Who signs final QC for grapple builds, and what evidence must be attached before release?

## Rentals - Ryan + Rentals / Service / Finance

### Rental Fleet PM And Renter-Fault Billing

Owner prompts:

- When a rental unit needs service, which costs stay internal and which should be billed to the renter?
- Provide examples of renter-fault damage that should become customer-billable.
- Should every rental unit carry a PM schedule that auto-generates internal WOs?
- Should rental-fleet service cost roll to the rental P&L, unit landed cost, or another reporting bucket?

### Rental Tax And Exemption Handling

Known finance direction: Florida rental tax is destination-sourced and uses the same county table, but purchase exemption certificates may not always cover rentals.

Owner prompts:

- Confirm whether rental tax is always destination-sourced to delivery/use location.
- Confirm which exemption certificates cover rentals and which only cover purchases.
- Confirm whether rental-security-deposit liability accounts are reconciled monthly.

### Rental / Sales / Service Boundaries

Owner prompts:

- When a rental machine is hauled, which hauling rate sheet applies?
- When a rental customer converts to purchase, how should prior rental amounts affect commission, cost basis, or buy-down accounting?
- Does the rental 5% clawback apply to any returned rent or only early returns?

## Sales, Iron Quote, And Customer Go-Live - Rylee + Ryan + Angela

### A1 Go-Live Proof

Engineering evidence exists. Remaining gate is human proof.

Owner prompts:

- Rylee + architect: complete the manual staging browser walkthrough using `docs/floor/signoffs/QA-A1.1-manual-staging-qa-pass.md`.
- Ryan + architect: complete Q02699 PDF parity review using `docs/floor/signoffs/QA-A1.2-q02699-pdf-parity-sign-off.md`.
- Attach dated screenshots/PDFs and mark each sign-off `pass`, `pass with exceptions`, or `fail`.
- Once A1.1 and A1.2 pass, confirm the three real customers who can receive Iron Quote in writing.

### Sales Policy Decisions To Confirm If Still Open

Owner prompts:

- Post-approval routing: after manager approval, does the quote return to the rep for a personal note before send?
- Prospect quote path: can reps quote prospects before they are full customers, and should conversion happen at send or acceptance?
- Rebate stacking: when cash and finance rebates both apply, do they stack by default or does the rep choose one?
- Source-required alerts: should availability-check alerts go through Twilio, 8x8, both, or another path?
- Sales-advisor home priority: of AI briefing, open deals, follow-ups, voice quote, voice note, prospecting map, and log-action shortcuts, which three must be top-of-screen?
- Voice-route consolidation: keep separate voice quote / voice note / voice CRM buttons, or consolidate?

### External Sales / Quote Inputs Still Blocking Work

- OEM price sheets: ASV, Yanmar, Bandit, CMI sample sheets or confirmed formats, plus column legends, discount/rebate notes, freight/list conventions, and effective-date rules.
- Florida TILA / lending docs: Angela/counsel-approved payment-estimate disclaimers, APR/payment assumptions, rounding rules, and prohibited wording.
- HubSpot API key: required for CRM migration.
- M365 tenant admin consent: confirm tenant-level vs per-user consent if not already complete.
- R2 quote PDF secrets/CORS: required for immutable versioned PDFs and QR/NPS quote landing pages.
- Omi webhook docs/secrets: signature/HMAC rules, event payload examples, event IDs/idempotency behavior, staging endpoint, and secret delivery path.
- DNS for `qep.blackrockai.co`: DNS provider/account owner, target record value, hosting endpoint/TLS expectations.
- IntelliDealer snapshot exports: equipment, parts, quotes/history, service/PDI rows; confirm workspace/source tag if not `default` / `intellidealer_snapshot_2026-05-14`.

Owner prompt: Attach the file, credential handoff path, or contact owner for each missing external input.

## Copy-Paste Email Intro

Subject: QEP owner answers needed to clear current blockers

Team,

I consolidated the open QEP questions into one packet so we are not asking everyone piecemeal. Cyber insurance is intentionally omitted because it has already been answered. The top blockers are parts workflow sign-off, finance migration values, service/rental operating rules, Iron Quote go-live proof, and external docs/exports.

Please reply inline, mark anything already answered, and attach or name the owner for any missing document/export. Rough answers are enough where exact policy is not final; the engineering team can represent unresolved values as config-required instead of guessing.

Thanks.
