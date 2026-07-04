# QEP-223 K3.1 Migration Path Worksheet

Prepared: 2026-07-04
Audience: Ryan, Tina, and engineering handoff
Scope: K3.1 / QEP-223 only

## Boundary

Do not reopen the accounting system-of-record question. QEP OS is the forward AR/AP/reporting system of record. IntelliDealer is the transition operational system of record until cutover. QuickBooks Desktop is downstream vendor-pay, cash/check-register, and CPA-reporting output only.

This worksheet exists only to collect the remaining migration-path decisions in an implementation-ready shape.

## Sources Read

- `docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md`
- `docs/operations/QEP_OWNER_BLOCKER_QUESTION_PACKET_2026-07-03.md`
- `apps/web/src/features/finance-enforcement/lib/finance-enforcement-api.ts`
- `supabase/migrations/662_finance_foundation_invoice_numbering.sql`
- `supabase/migrations/663_finance_foundation_quarter_close_reopen.sql`
- `supabase/migrations/664_finance_foundation_ar_dunning_cycle.sql`
- `supabase/migrations/665_finance_foundation_ap_three_way_match.sql`
- `supabase/migrations/666_finance_foundation_county_tax_rentals.sql`
- `supabase/migrations/667_finance_foundation_equipment_reversal_approvals.sql`
- `supabase/migrations/668_finance_foundation_fet_form8300.sql`
- `supabase/migrations/669_finance_foundation_margin_segments.sql`
- `supabase/migrations/670_finance_foundation_intellidealer_master_match_dry_run.sql`
- Related finance foundations: `supabase/migrations/368_quickbooks_gl_sync_jobs.sql`, `441_gl_accounts.sql`, `442_gl_journal_entries.sql`, `443_gl_journal_lines.sql`, `444_vendor_invoices.sql`, `500_wave3_service_gl_routing.sql`, `503_wave4_service_reporting_views.sql`, and `523_deal_genome_service_analysis_foundation.sql`

## Fill Rules

- Ryan/Tina should answer in the JSON-like shape shown for each row or mark `requires_live_session`.
- Every answer must name the evidence file/export or the person who owns it.
- Safe defaults already in code are not owner-approved answers unless Ryan/Tina explicitly accept them.
- If a row says "status-only key", the K1.1 finance-enforcement status page already expects the key, but the migration has not seeded a `finance_foundation_config` row yet.
- If a row says "new QEP-223 key", engineering should add that key in the QEP-223 migration/config pass.

## Decision Rows

### 1. Invoice Width And Branch/Department Starting Numbers

Config key:
- Existing: `invoice_pad_width`
- New QEP-223 key: `invoice_sequence_seed_plan`

Tables:
- `public.finance_foundation_config`
- `public.finance_invoice_sequences`
- `public.branches.legacy_invoice_branch_code`
- `public.customer_invoices.qep_invoice_number`
- `public.customer_invoices.invoice_department_code`

Migration touchpoint:
- Existing foundation: `662_finance_foundation_invoice_numbering.sql`
- QEP-223 pass: update/insert `finance_foundation_config.invoice_pad_width`; seed `finance_invoice_sequences` by branch and department after owner-reviewed starting numbers are provided.

Missing evidence export:
- Current invoice number ranges by branch and department from IntelliDealer or finance records.
- Sample invoices for every department prefix Ryan/Tina expect to preserve.

Acceptable answer shape:

```json
{
  "digits": 5,
  "branch_department_starting_numbers": [
    {
      "branch_legacy_code": "01",
      "department_code": "E",
      "first_qep_sequence": 1421,
      "source_export": "attached invoice sequence export or screenshot"
    }
  ],
  "owner_approved_by": "Ryan or Tina"
}
```

Owner answer:


### 2. CPA Adjustment Posting Target

Config key:
- Existing: `cpa_adjustment_posting_target`

Tables:
- `public.finance_foundation_config`
- `public.workspace_settings.cpa_adjustment_posting_target`
- `public.gl_periods`
- `public.quarter_reopen_log`
- `public.gl_journal_entries`
- `public.gl_journal_lines`

Migration touchpoint:
- Existing foundation: `663_finance_foundation_quarter_close_reopen.sql`
- QEP-223 pass: update config row and align `workspace_settings.cpa_adjustment_posting_target` if Ryan/Tina choose a final target.

Missing evidence export:
- CPA adjustment example, quarter-end packet, or CPA instruction showing whether adjustments post to current period or reopen/source period.

Acceptable answer shape:

```json
{
  "target": "current_period",
  "source_period_reopen_allowed": false,
  "required_approvals": ["owner", "finance_admin"],
  "evidence_export": "CPA adjustment example or quarter-end packet path"
}
```

Valid `target` values: `current_period`, `source_period`.

Owner answer:


### 3. Finance-Charge Basis And Dunning Workflow

Config key:
- Existing: `finance_charge_basis`
- Existing: `florida_finance_charge_lawful_cap`
- New QEP-223 key: `ar_dunning_workflow`

Tables:
- `public.finance_foundation_config`
- `public.workspace_settings` columns `ar_statement_day_of_month`, `ar_finance_charge_rate_pct`, `ar_finance_charge_days_past_due`, `ar_reminder_min_days`, `ar_reminder_max_days`, `ar_auto_hold_days`, `ar_finance_charge_principal_only`, `ar_finance_charge_compounding_enabled`
- `public.ar_dunning_events`
- `public.customer_invoices`
- `public.qrm_companies`

Migration touchpoint:
- Existing foundation: `664_finance_foundation_ar_dunning_cycle.sql`
- QEP-223 pass: update config rows and workspace settings only after Ryan/Tina accept the workflow.

Missing evidence export:
- Current AR aging.
- Statement or finance-charge sample, if one exists.
- Policy/legal confirmation for compounding or lawful cap before live billing.

Acceptable answer shape:

```json
{
  "basis": "principal_only",
  "monthly_rate_pct": 0.015,
  "lawful_annual_cap": 0.18,
  "statement_day_of_month": 1,
  "days": {
    "finance_charge": 30,
    "reminder_min": 30,
    "reminder_max": 60,
    "auto_hold": 60
  },
  "customer_copy_owner": "Tina",
  "evidence_export": "AR aging or statement sample path"
}
```

Valid `basis` values: `principal_only`, `compounding_allowed`. Do not choose `compounding_allowed` without owner/legal approval.

Owner answer:


### 4. Corporate-To-Branch Allocation Basis

Config key:
- Status-only key: `corporate_allocation_basis`

Tables:
- `public.finance_foundation_config`
- `public.gl_journal_entries`
- `public.gl_journal_lines.branch_id`
- `public.gl_cost_centers.branch_id`
- `public.branches`

Migration touchpoint:
- Existing posting tables: `442_gl_journal_entries.sql`, `443_gl_journal_lines.sql`, `438_gl_cost_centers.sql`
- QEP-223 pass: insert `finance_foundation_config.corporate_allocation_basis`; add a dedicated allocation rules table only if the answer cannot be represented as JSON config plus journal-line branch allocation.

Missing evidence export:
- P&L and balance sheet package.
- Current corporate allocation schedule, or the source metric export Ryan/Tina choose: headcount, revenue, transaction volume, or fixed percentages.

Acceptable answer shape:

```json
{
  "basis": "revenue",
  "period": "monthly",
  "source_export": "P&L or allocation schedule path",
  "branch_weights": [
    { "branch_legacy_code": "01", "percent": 0.62 },
    { "branch_legacy_code": "02", "percent": 0.38 }
  ],
  "rounding": "largest_remainder"
}
```

Valid `basis` values: `headcount`, `revenue`, `transaction_volume`, `fixed_percent`, `manual`.

Owner answer:


### 5. Per-Unit Depreciation Rules

Config key:
- Status-only key: `depreciation_allocation_rules`

Tables:
- `public.finance_foundation_config`
- `public.qrm_equipment.current_cost_cents`
- `public.qrm_equipment.net_book_value_cents`
- `public.gl_journal_entries` with `journal_type = 'depreciation'`
- `public.gl_journal_lines`
- `public.finance_margin_segment_facts`

Migration touchpoint:
- Existing cost/NBV columns: `474_qrm_equipment_wave2_columns.sql`
- Existing depreciation journal type: `442_gl_journal_entries.sql`
- Existing finance-only NBV read model: `669_finance_foundation_margin_segments.sql`
- QEP-223 pass: insert `finance_foundation_config.depreciation_allocation_rules`; add depreciation posting logic only after schedule and department mapping are provided.

Missing evidence export:
- Per-unit depreciation schedule.
- Inventory/unit export with stock number, serial, cost/NBV, branch, department, and responsible owner.

Acceptable answer shape:

```json
{
  "basis": "per_unit",
  "method": "manual_schedule",
  "posting_frequency": "monthly",
  "schedule_source": "depreciation schedule export path",
  "department_mapping": [
    {
      "inventory_type": "rental",
      "responsible_department": "rentals",
      "branch_basis": "home_branch"
    }
  ]
}
```

Valid `method` values: `manual_schedule`, `straight_line`, `declining_balance`, `tax_book_separate`.

Owner answer:


### 6. Floor-Plan Lender Terms And IBS Treatment

Config key:
- Status-only key: `floor_plan_lender_terms`

Tables:
- `public.finance_foundation_config`
- `public.qrm_equipment.current_cost_cents`
- `public.qrm_equipment.net_book_value_cents`
- `public.vendor_profiles`
- `public.vendor_invoices`
- `public.ap_payments`
- Future only if needed: `public.finance_floor_plan_terms`

Migration touchpoint:
- Existing equipment cost/floorplan field comments: `474_qrm_equipment_wave2_columns.sql`
- Existing AP bill/payment guard: `665_finance_foundation_ap_three_way_match.sql`
- QEP-223 pass: insert `finance_foundation_config.floor_plan_lender_terms`; create `finance_floor_plan_terms` only if Ryan/Tina provide lender-specific schedules that need row-level querying.

Missing evidence export:
- Floor-plan curtailment schedules/terms for Wells Fargo, Bank of Oklahoma, Northpoint Financial, Incredible Bank, US Bank, Mitsubishi Finance, and IBS.
- Any IBS agreement or remittance instruction confirming whether IBS is treated as factoring, floor-plan, rental receivable assignment, or other.

Acceptable answer shape:

```json
{
  "lenders": [
    {
      "name": "Wells Fargo",
      "treatment": "floor_plan",
      "vendor_profile_match": "vendor number or name from vendor master",
      "curtailment_basis": "manual_schedule",
      "interest_basis": "statement",
      "payment_source": "quickbooks_check_register",
      "evidence_export": "floor-plan schedule path"
    },
    {
      "name": "Interstate Billing Service",
      "treatment": "rental_receivable_assignment",
      "payment_source": "customer_remits_to_ibs",
      "evidence_export": "IBS terms or sample invoice path"
    }
  ]
}
```

Valid `treatment` values: `floor_plan`, `factoring`, `rental_receivable_assignment`, `standard_ap_vendor`, `other`.

Owner answer:


### 7. Open Service-WO Cutover Policy

Config key:
- Status-only key: `open_service_wo_cutover_policy`

Tables:
- `public.finance_foundation_config`
- `public.service_jobs`
- `public.service_job_segments`
- `public.service_labor_ledger`
- `public.service_billing_rows`
- `public.mv_service_jobs_wip`
- `public.qrm_work_order_wip_snapshots`
- `public.gl_routing_rules`

Migration touchpoint:
- Existing WIP snapshots/views: `433_qrm_work_order_wip_snapshots.sql`, `503_wave4_service_reporting_views.sql`
- Existing service billing ledgers: `523_deal_genome_service_analysis_foundation.sql`
- Existing service GL routing: `500_wave3_service_gl_routing.sql`
- QEP-223 pass: insert `finance_foundation_config.open_service_wo_cutover_policy`; write any migration/backfill only after policy is chosen.

Missing evidence export:
- Open service work order export at cutover planning date.
- WIP aging/balancing report.
- Cutover exception list for work orders that must finish in IntelliDealer.

Acceptable answer shape:

```json
{
  "cutover_date": "2027-01-01",
  "policy": "hybrid_by_status",
  "parallel_run_months": 2,
  "migrate_statuses": ["approved", "in_progress", "waiting_parts"],
  "finish_in_intellidealer_statuses": ["ready_to_invoice", "closed_pending_accounting"],
  "wip_basis": "balancing",
  "billing_owner_after_cutover": "qep_os",
  "evidence_export": "open WO and WIP export path"
}
```

Valid `policy` values: `finish_all_open_in_intellidealer`, `migrate_all_open_to_qep_os`, `hybrid_by_status`.

Owner answer:


### 8. Customer/Vendor Master-ID Strategy

Config key:
- Status-only key: `master_id_strategy`
- Existing guard key: `intellidealer_master_live_load_status`

Tables:
- `public.finance_foundation_config`
- `public.qrm_companies.intellidealer_account_number`
- `public.vendor_profiles.intellidealer_account_number`
- `public.qrm_intellidealer_customer_master_stage.match_key_intellidealer_account_number`
- `public.intellidealer_master_match_dry_runs`
- `public.intellidealer_master_match_candidates`

Migration touchpoint:
- Existing dry-run harness: `670_finance_foundation_intellidealer_master_match_dry_run.sql`
- QEP-223 pass: insert/update `master_id_strategy`; keep `intellidealer_master_live_load_status` parked until Ryan/Tina explicitly authorize live load.

Missing evidence export:
- Customer master export.
- Vendor master export.
- Latest dry-run output from `run_intellidealer_master_match_dry_run`.

Acceptable answer shape:

```json
{
  "strategy": "mint_qep_uuid_keep_intellidealer_xref",
  "live_load_allowed": false,
  "display_id_policy": "show_intellidealer_account_number_as_external_ref",
  "dedupe_rules": {
    "exact_account_number": "auto_match",
    "missing_account_number": "manual_review",
    "cross_master_collision": "manual_review",
    "duplicate_account_number": "manual_review"
  },
  "evidence_exports": ["customer master export path", "vendor master export path"]
}
```

Valid `strategy` values: `mint_qep_uuid_keep_intellidealer_xref`, `use_intellidealer_account_as_primary_display_id`, `requires_live_session`.

Owner answer:


### 9. Bank Account List And QuickBooks Desktop Output Contract

Config key:
- Status-only key: `bank_account_list`
- Status-only key: `quickbooks_desktop_version`
- New QEP-223 key: `quickbooks_desktop_output_contract`

Tables:
- `public.finance_foundation_config`
- `public.gl_accounts`
- `public.customer_invoices.cash_code`
- `public.customer_invoices.ar_account_number`
- `public.vendor_invoices.ap_account_number`
- `public.ap_payments.source_system`
- `public.ap_payments.check_number`
- `public.ap_payments.external_payment_id`
- `public.quickbooks_gl_sync_jobs`

Migration touchpoint:
- Existing COA: `441_gl_accounts.sql`
- Existing AR/cash routing fields: `477_customer_invoice_wave2_columns.sql`
- Existing AP bill routing: `444_vendor_invoices.sql`
- Existing AP payment idempotency: `665_finance_foundation_ap_three_way_match.sql`
- Existing QuickBooks bridge: `368_quickbooks_gl_sync_jobs.sql`
- QEP-223 pass: insert `bank_account_list`, `quickbooks_desktop_version`, and `quickbooks_desktop_output_contract`; do not promote QuickBooks beyond downstream output.

Missing evidence export:
- Current chart of accounts.
- Exact bank account list and branch/corporate cash tracking decision.
- QuickBooks Desktop version.
- Sample check register / CPA export / journal import file expected by Tina or CPA.

Acceptable answer shape:

```json
{
  "bank_accounts": [
    {
      "gl_account_number": "1000",
      "name": "Operating Checking",
      "branch_legacy_code": "corporate",
      "track_cash_separately_by_branch": false,
      "quickbooks_account_name": "Operating Checking"
    }
  ],
  "quickbooks_desktop": {
    "version": "QuickBooks Desktop Enterprise 2024",
    "output_modes": ["check_register", "cpa_reporting_export"],
    "file_format": "iif",
    "contains_ar_ap_subledger": false
  },
  "evidence_exports": ["chart of accounts path", "QB sample export path"]
}
```

Valid `output_modes` values: `check_register`, `journal_entry_export`, `cpa_reporting_export`, `manual_summary`.

Owner answer:


### 10. Deposit And Rental-Security-Deposit Monthly Reconciliation Rule

Config key:
- New QEP-223 key: `deposit_liability_reconciliation_policy`

Tables:
- `public.finance_foundation_config`
- `public.deposits`
- `public.crm_deals.deposit_status`
- `public.quote_packages.deposit_required_amount`
- `public.rental_contracts.deposit_required`
- `public.rental_contracts.deposit_amount`
- `public.rental_contracts.deposit_status`
- `public.rental_contracts.deposit_invoice_id`
- `public.rental_returns.deposit_amount`
- `public.rental_returns.deposit_covers_charges`
- `public.customer_invoices`
- `public.gl_accounts`

Migration touchpoint:
- Existing equipment deposits: `070_deposits.sql`
- Existing rental contract deposits: `235_rental_contracts_and_pricing.sql`
- Existing rental return deposit handling: `079_rental_returns_and_payments.sql`
- Existing quote deposit semantics: `715_a52_cash_down_deposit_semantics_closeout.sql`
- QEP-223 pass: insert `deposit_liability_reconciliation_policy`; wire GL account mapping only after liability account(s) are identified.

Missing evidence export:
- Deposit liability account(s) from the chart of accounts.
- Monthly deposit reconciliation report, if one exists.
- Rental deposit sample or monthly rental deposit balance report.

Acceptable answer shape:

```json
{
  "reconcile_monthly": true,
  "equipment_deposit_liability_account": "GL account number",
  "rental_security_deposit_liability_account": "GL account number",
  "reconciliation_owner": "Tina",
  "reconciliation_basis": "monthly_balance",
  "deposit_application_policy": "apply_to_final_invoice_or_refund",
  "evidence_exports": ["COA path", "deposit reconciliation path"]
}
```

Valid `reconciliation_basis` values: `monthly_balance`, `per_contract_closeout`, `not_reconciled_separately`.

Owner answer:


## Evidence Export Checklist

These are the exports named by the K-stream artifact and blocker packet. Attach paths here instead of re-answering the SoR decision.

| Evidence export | Blocks rows | Owner/path |
| --- | --- | --- |
| Chart of accounts | 2, 4, 9, 10 |  |
| Most recent P&L and balance sheet | 4, 9 |  |
| Current AR aging | 3 |  |
| AP aging | 6, 9 |  |
| Customer master export | 8 |  |
| Vendor master export | 6, 8 |  |
| Floor-plan schedules and lender terms | 6 |  |
| CPA adjustment example or quarter-end package | 2 |  |
| Open service WO export and WIP report | 7 |  |
| Current invoice sequences by branch/dept | 1 |  |
| QuickBooks Desktop version and output sample | 9 |  |
| Deposit/rental deposit reconciliation report | 10 |  |

## Engineering Handoff Once Filled

After Ryan/Tina fill the rows:

1. Add one narrow QEP-223 migration that upserts owner-reviewed `finance_foundation_config` rows for the status-only and new keys above.
2. For row 1, seed `finance_invoice_sequences` only after branch/department starting numbers are attached.
3. For row 8, keep `intellidealer_master_live_load_status.allowed = false` unless Ryan/Tina explicitly authorize live load.
4. Update `apps/web/src/features/finance-enforcement/lib/finance-enforcement-api.ts` only if new keys should appear in the K1.1 config-required status surface.
5. Add focused tests proving unanswered rows remain `config_required` and QuickBooks remains downstream output only.
