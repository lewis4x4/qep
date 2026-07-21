# QEP Owner Answer Placement and Execution Register

Prepared: 2026-07-20

Source: `QEP_Owner_Answer_Packet_Responses.docx`

Scope: Finance, Service, Rentals, Sales, and Iron Quote

## Authority and corrections

Ryan McKenzie answered the packet, with Tina McKenzie on Finance. These answers supersede conflicting defaults and earlier auto-ratified decisions.

- QEP OS is the forward accounting system of record.
- IntelliDealer is the current operational system of record during transition.
- QuickBooks Desktop remains the downstream check register **and** CPA-reporting destination fed by QEP OS until QEP OS can stand alone. It is not reduced to check writing alone.
- Parts P1-P8 are outside this packet. Existing Parts owner-review and source-data blockers remain unchanged.

The source packet is retained as the human evidence. Migration `825_owner_answer_source_truth_reconciliation.sql` stores the coded answers in `qep_decisions`, revises the conflicting Q6/Q7/Q10/Q14/Q15/Q16 decisions, and updates `qep_roadmap_tasks`, which remains the source that Linear mirrors.

## Placement map

| Answer group | Canonical destination | Implementation disposition |
| --- | --- | --- |
| F1 department + segment accounting | `finance_margin_segment_facts`, `finance_margin_segment_matrix`, invoice/quote line classification | Extend the existing model; do not create parallel line tables. Parts revenue stays Parts even on a service WO; hauling/sublet/labor stay Service; Rental remains its own department. |
| F2 headcount allocation | `finance_foundation_config` plus an effective-dated branch allocation source | Method is answered. Exact branch headcounts remain a value-collection blocker. |
| F3 book depreciation | Equipment book-basis/depreciation ledger and CPA export | Straight-line book depreciation for owned equipment; rental buy-down reduces basis. Bonus depreciation and Section 179 stay CPA-only. |
| F4 lender terms | A new lender-specific floor-plan configuration slice | Still blocked until Tina supplies the six schedules and IBS treatment. |
| F5 quarter close/reopen | `gl_periods`, close/reopen audit, dual approval | Monthly balance, quarterly lock, Ryan + Tina approval and reason required to reopen. |
| F6 cutover WOs | `service_jobs` migration provenance and accumulated-cost fields | January 1 cutover; migrate jobs unlikely to close within about two weeks and carry accumulated cost. |
| F7 numbering | Existing `invoice_number_sequences` / finance-numbering compatibility layer | Canonical format `[branch]-[department][five digits]`, branch 01 Lake City / 02 Belleview, E/R/P/W, starts 00001, never resets. Preserve existing issued identifiers. |
| F8 master matching | IntelliDealer staging/cross-reference in migration 670 | Match on IntelliDealer account number; issue a fresh QEP ID and retain the legacy number permanently. |
| F9 statements/dunning | `workspace_settings`, `ar_dunning_events`, `run_ar_dunning_cycle` | Statements on the 1st; 1.5% monthly at 30 days; reminder 30-60; hold at 60. Monthly idempotency and legal approval are mandatory before compounding. |
| F10 QuickBooks/banks | Normalized export ledger, then Desktop adapter | Preserve check register + CPA reports. Bank accounts: First Federal Operating, First Federal Wire, Campus USA Savings. Final file format waits on Tina/CPA samples. |
| F11 deposits | Unified deposit liability subledger over existing sale/rental sources | Apply sale deposits at invoice close; rental deposits apply to damage first, then bill/refund; reconcile both monthly. |
| SV1-SV3 service plans | `service_agreement_programs`, program intervals, PM generator, entitlement ledger | BlackRock is authorized to draft a provisional catalog. No provisional program becomes customer-live without review. |
| SV4-SV8 rates/types/holds/efficiency | Existing service pricing, intake, hold, and efficiency structures | Rates and margin rules already match. Split parts and sublet holds and preserve hold-excluded efficiency. |
| SV9 roster | Profiles, technician/driver qualification data | Still blocked on the service-manager roster. |
| SV10-SV17 driver/haul/GPS | `traffic_tickets`, haul rate sheets, provider-neutral mileage evidence | Driver is a distinct role. Internal haul rates may be seeded; retail figures remain provisional until Ryan's corrected sheet. Manual mileage stays zero-blocking but requires review. |
| SV18-SV20 grapple | Dedicated grapple-build tables and release gate | Builds remain outside service WOs. Release requires service-manager signoff plus checklist, test run, serial/component evidence, and photos. Scorecard metrics remain open. |
| RN1-RN8 operations | Existing rental inspection, PM, tax, deposit, billing, and transport structures | Add only exact gaps: seven abuse categories, statistical lifetime-cost accumulation, certificate verification, and dual retail/internal haul snapshots. |
| RN9-RN10 conversion economics | Rental-to-sale conversion settlement and commission ledger | Negotiated rent credit; conversion commission is 15% of margin less rental commission already paid on the unit; refunded rent creates a proportional 5% clawback. |
| SA1-SA4 reviews | Existing quote launch/review roadmap rows | Reviews occur after July 24, with dated evidence and pass/pass-with-exceptions/fail. Pilot customers are named only after both reviews pass. |
| SA5 approval disposition | Existing `quote_packages.post_approval_action` and Review UI | Already shipped: rep chooses per submission; route-back remains the default. |
| SA6 prospect lifecycle | Quote Builder, `qrm_prospects`, acceptance/credit approval | Reverse Q7: allow prospect quotes; create prospect at send; convert to customer at acceptance and open Tina/Ryan credit approval. |
| SA7 rebate stacking | Existing OEM/program rule model | Reverse Q10: stacking is per OEM program and effective date. Real seeds remain blocked on OEM worksheets. |
| SA8 availability alerts | Provider-neutral alert request/delivery ledger and rep preferences | Reverse Q14: send SMS and 8x8, dedupe one business query, and allow a rep to mute one channel. |
| SA9 advisor home | Floor action-card layout and persistent quick log | AI daily briefing, open deals, and follow-ups are the top three; quick log remains one tap away. |
| SA10 unified voice | Existing Iron microphone/intent orchestration | Reverse Q16: one combined voice button; show classification and allow correction before navigation or mutation. |

## Remaining external blockers

- F4 lender schedules and IBS handling — Tina.
- Current branch headcounts — Tina / Finance.
- Finance source exports and QuickBooks Desktop/CPA sample output — Tina.
- Service technician/driver roster — Service Manager.
- Corrected retail haul-rate sheet — Ryan.
- Grapple build scorecard metrics — Ryan / Service.
- Rental-use exemption certificate verification — Tina.
- Quote walkthrough, IntelliDealer comparison, and three pilot customers — Ryan + Rylee, after July 24.
- OEM price sheets and rebate rules — Rylee / Norman.
- Florida TILA/lending disclosure wording — Angela.
- Parts owner-review/source-data blockers already represented in the roadmap.

## Backend-ready implementation follow-ons

- Tina's production profile does not yet exist. Her quarter-reopen and sales-credit approval slots remain intentionally unbound and fail closed; Ryan is bound by stable profile ID, never display name.
- H9.1 service-plan review, activation, enrollment, and prompt-handling UI remains required before the inactive BlackRock draft catalog can become customer-live.
- L12.1 rental commission remains `in_progress` until canonical payment, refund/credit, negotiated-conversion approval, correction, and legacy-payroll import producers invoke the inert backend ledger and pass UAT.
- SA8 availability requests have durable, tenant-scoped SMS/8x8 queues and per-rep mute controls; provider dispatchers and credentials remain a separate integration release.
- Service Driver roster verification, manager mileage review UI, and grapple evidence-capture UI remain required before the corresponding backend controls are operationally complete.

## Mission alignment

**Pass.** This placement turns owner intent into governed, reversible operating rules across the equipment, parts, service, rental, finance, and sales system. It avoids parallel schemas, preserves audit evidence, keeps integrations zero-blocking, and converts owner answers into machine-enforceable controls rather than static notes.
