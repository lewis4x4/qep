# QEP Finance K-Stream Decision Artifact

Prepared: 2026-07-03
Scope: K1.1 / QEP-221, K3.1 / QEP-223, K4.1 / QEP-224

## Decision

QEP OS is the forward accounting system of record. IntelliDealer is the current operational system of record during transition. QuickBooks Desktop is not the ledger of record; it is a downstream check-register and CPA-reporting destination that QEP OS feeds. Full AR, AP, invoicing, reporting, tax evidence, close/reopen audit, job costing, and financial source data belong in QEP OS.

This reconciles the prior Phase-8 QuickBooks-GL build as a bridge/outbound feed, not the target accounting architecture. Any "QuickBooks as ledger" wording is superseded for Stream K.

## Sources Read

- `docs/operations/rewherewestandqep/QEP_Finance_Questionnaire_Responses.docx`
- `docs/QEP_Finance_Questionnaire_Round3_Addendum.docx`
- `docs/operations/rewherewestandqep/E01420.pdf`
- `docs/operations/rewherewestandqep/R00265.pdf`
- `docs/operations/rewherewestandqep/W07299.pdf`
- `QEP (1)/QEP_FINANCE_RYAN_RESPONSES_MAPPING_2026-07-01.md`
- `QEP (1)/QEP_FINANCE_ROUND3_MAPPING_2026-07-02.md`
- `QEP (1)/QEP_Finance_TradeIn_Recon_Approval_Answer_2026-07-03.md`
- `QEP (1)/QEP_SERVICE_ROADMAP_SYNC_2026-05-29.PART1.sql`
- `QEP (1)/QEP_QUOTE_BUILD_LOCK_MEMO_2026-05-21.md`
- Linear read-only snapshot, 2026-07-03: QEP-221, QEP-223, QEP-224 and their comments.
  - QEP-221: `https://linear.app/jarvislewis/issue/QEP-221/k11-qep-os-native-arap-reporting-as-system-of-record` - status `Decision` as of Linear `updatedAt` 2026-07-03T14:55:46Z.
  - QEP-223: `https://linear.app/jarvislewis/issue/QEP-223/k31-quickbooks-reduced-to-vendor-pay-cash-migration-path` - status `Decision` as of Linear `updatedAt` 2026-07-03T14:55:47Z.
  - QEP-224: `https://linear.app/jarvislewis/issue/QEP-224/k41-revisit-build-lock-memo-g5-vs-accounting-sor-direction` - status `Decision` as of Linear `updatedAt` 2026-07-03T14:55:48Z.
- Finance foundation migrations already in repo: `655` through `663`.

## System-Of-Record Boundary

| Domain | System of record after cutover | QuickBooks role | Evidence |
| --- | --- | --- | --- |
| Customer invoices | QEP OS | Receives downstream accounting/check-register output only | Main questionnaire sections 1.2, 3.1-3.5; sample invoices |
| AR, terms, statements, dunning, holds | QEP OS | Not the decision engine | Main questionnaire section 4; Round 3 section 6 |
| AP capture, approval, match | QEP OS | Cuts checks after approved bills port | Main questionnaire section 5.1 |
| GL/reporting/close evidence | QEP OS | CPA-reporting destination/export | Main questionnaire sections 7.1-7.3; Round 3 section 1 |
| Payroll | ADP for now; QEP OS consumes payroll/job-costing facts | Possible future QB Payroll connector only | Main questionnaire section 10 |
| Legacy operational transition | IntelliDealer until cutover/parallel closeout | Not the legacy SoR | Main questionnaire sections 1.1, 1.4, 10.3 |

Cutover target is January 1, 2027 with at least two months of parallel run. Customer and vendor masters port first; open balances attach to those masters. Open service WOs remain the hardest cutover case and stay on the working-session list.

## Invoice Evidence From PDFs

Equipment sample `E01420.pdf`:
- Branch `01 - LAKE CITY`, account `ASPLU001`, invoice `E01420`, stock `Q002947`, serial `CMI175CUD209508`.
- Equipment line amount `332500.00`; deposit appears as negative miscellaneous charge `94500.00-`.
- Subtotal `238000.00`, Florida state tax `14280.00`, Columbia County surtax `75.00`, total `252355.00`.
- Footer carries no-return/restocking/electrical-parts, 1.5 percent finance charge, and cash-over-10000 IRS reporting disclosures.

Rental sample `R00265.pdf`:
- Branch `01 - LAKE CITY`, account `ROWE009`, contract `R00265`, customer flagged `AG EXEMPT`.
- Billing period 2026-05-13 to 2026-06-12, equipment stock/serial and machine hours captured.
- Security deposit `5000.00`; subtotal and `IBS CHARGED SALE` both `34500.00`.
- Remittance says invoices are assigned to and billed by Interstate Billing Service, with payment remitted to IBS. This is evidence for floor-plan/factoring treatment, not a reason to make QuickBooks the SoR.

Service sample `W07299.pdf`:
- Branch Lake City, account `COOPE001`, invoice `W07299`, customer flagged `AG EXEMPT`.
- Service invoice is segment-based; Segment 1 includes warranty code/context and labor `3022.90`.
- Segment 2 is billed on another work order, proving cross-WO billing notes must remain visible.
- Work-order totals show labor and charge sale `3022.90`; remittance is to Quality Equipment & Parts.

## K-Stream Issue Trail Patch

| Issue | Current trail state | Patch |
| --- | --- | --- |
| K1.1 / QEP-221 | Linear still shows `Decision` and the original blocker text, but comments say the SoR decision was unblocked and then re-held. | Split the issue into decided scope plus implementation work. The SoR question is answered: QEP OS owns AR/AP/reporting. The build-now foundation is evidenced by questionnaire/addendum and migrations `655`-`663`. Remaining values are parameterized/configured, not blockers to the SoR direction. |
| K3.1 / QEP-223 | The QuickBooks downgrade direction is confirmed, but the issue correctly remains gated for migration-path details. | Narrow the gate. Do not ask again whether QuickBooks is the ledger; it is not. Keep the issue open only for migration working-session decisions: allocation basis, depreciation, floor-plan terms, CPA adjustment posting, open-WO migration, master-ID final strategy, invoice width, finance-charge basis, and missing finance exports. |
| K4.1 / QEP-224 | The original task asked to pull Build-Lock memo G5, diff it against accounting-SoR direction, and log the decision. | Decision logged here: G5 said native AR/AP long-term with QuickBooks API as the Phase 1-7 bridge. Ryan/Tina finance evidence supersedes any QuickBooks-as-ledger interpretation. G5 remains valid only as a bridge/outbound-feed precedent; Stream K target architecture is QEP OS as SoR. This is ready to move out of `Decision` once the roadmap source receives this evidence link. |

### Suggested QEP-221 Evidence Note

```md
2026-07-03 repo evidence patch: Ryan + Tina finance questionnaire and Round 3 addendum confirm QEP OS as the forward accounting system of record. IntelliDealer remains the legacy transition SoR; QuickBooks Desktop is downstream check-register/CPA-reporting output only. Build-now foundation exists in migrations 655-663 for invoice numbering, quarter reopen, AR dunning, AP 3-way match, county/rental tax, equipment-reversal approvals, FET/Form 8300, margin segments, and IntelliDealer master-match dry run. Remaining open business values are config/working-session items, not blockers to the SoR decision.
```

### Suggested QEP-223 Evidence Note

```md
2026-07-03 repo evidence patch: QuickBooks downgrade is decided. Do not reopen the "QB as ledger" question. QEP-223 remains open only for migration-path decisions: corporate-to-branch allocation basis, per-unit depreciation rules, lender-specific floor-plan terms for Wells Fargo / Bank of Oklahoma / Northpoint / Incredible Bank / US Bank / Mitsubishi Finance plus IBS, CPA adjustment posting target, open service-WO migration, invoice width, master-ID strategy, finance-charge basis, and missing exports/attachments.
```

### Suggested QEP-224 Evidence Note

```md
2026-07-03 repo evidence patch: Build-Lock memo G5 is reconciled. G5 accepted "Native AR/AP long-term; QuickBooks API as Phase 1-7 bridge." Ryan/Tina finance materials supersede any QuickBooks-as-ledger interpretation: QEP OS is the target accounting SoR; QuickBooks is a downstream bridge/feed. K4.1 acceptance evidence is this decision artifact plus the questionnaire/addendum and G5 memo.
```

## Still-Open Working-Session Decisions

Open business decisions:
- Invoice zero-pad width: Ryan/Tina answered 5 digits; build recommendation and current migrations default to 6 via config.
- Master-record ID strategy: carry IntelliDealer account number as the ID, or mint a fresh QEP OS ID and keep IntelliDealer number as permanent cross-reference. Recommendation remains fresh QEP OS ID plus cross-reference.
- Finance-charge basis: principal-only vs compounding on unpaid prior finance charges, capped at lawful maximum.
- CPA adjusting-entry posting target: reopen/source period vs current-period adjustment.
- Material recon change threshold that forces sales-manager re-approval after an approved trade-reconditioning estimate changes.
- Corporate-to-branch allocation basis: headcount, revenue, transaction volume, or another driver.
- Per-unit depreciation allocation schedule and responsible department mapping.
- Floor-plan terms by lender: Wells Fargo, Bank of Oklahoma, Northpoint Financial, Incredible Bank, US Bank, Mitsubishi Finance, plus Interstate Billing Service treatment.
- Open service-WO migration at the January 1, 2027 cutover.
- Net 45 account list.
- Internal WO door rate and internal parts markup.
- DR-15 collection allowance choice.
- Whether deposit and rental-security-deposit liability accounts are reconciled at monthly balance.
- Exact bank account list and whether cash is tracked separately by branch.
- Inventory turnover basis and aged-inventory threshold.
- QuickBooks Desktop exact version.

Missing evidence package:
- Chart of accounts export.
- Most recent P&L and balance sheet.
- Parts sample invoice.
- Current AR aging.
- Sample quarter-end reporting package.
- Customer and vendor master exports.
- Floor-plan curtailment schedules/terms for all lenders.

## Current Repo Implementation Evidence

The finance-foundation schema already has source-controlled migrations for the buildable subset:

- `655_finance_foundation_invoice_numbering.sql`
- `656_finance_foundation_quarter_close_reopen.sql`
- `657_finance_foundation_ar_dunning_cycle.sql`
- `658_finance_foundation_ap_three_way_match.sql`
- `659_finance_foundation_county_tax_rentals.sql`
- `660_finance_foundation_equipment_reversal_approvals.sql`
- `661_finance_foundation_fet_form8300.sql`
- `662_finance_foundation_margin_segments.sql`
- `663_finance_foundation_intellidealer_master_match_dry_run.sql`

This means the artifact should unblock documentation/roadmap cleanup and evidence linking. It should not be treated as authorization to hard-code the open values above.

## Operational Conclusion

K1.1 can move forward as implementation work with the SoR decision satisfied and remaining business values parked/config-driven.

K3.1 stays open, but only for the concrete migration-path decisions listed above. The QuickBooks role itself is decided.

K4.1 has its decision evidence: Build-Lock G5 is superseded/reinterpreted as a bridge/outbound-feed memo under the QEP-OS-as-SoR direction. The issue can move forward once this artifact is linked into the roadmap source.
