# IntelliDealer Gap-Audit Blocker Mapping Review

Date: 2026-05-03

Worker C scope: review blocker mappings that pointed at missing or duplicate schema and remap only where existing migrations/types prove a canonical QEP table/column.

## Mapping Corrections

- `customer.terms`: changed from `qrm_companies.payment_terms` to canonical `qrm_companies.payment_terms_id`. Evidence: `435_payment_terms.sql` creates `payment_terms`; `472_qrm_company_wave2_columns.sql` adds `payment_terms_id`, `payment_terms_code`, and `terms_code`; `apps/web/src/lib/database.types.ts` exposes `qrm_companies.payment_terms_id`.

- `employee.profit_center`: changed from suggested `employees.profit_center_code` to actual `employees.profit_center`. Evidence: `455_employees.sql` creates enum `profit_center_code` and column `employees.profit_center`; `491_employee_wave2_columns.sql` preserves/adds the same column; generated types expose `employees.profit_center`.

- `parts_invoice.po_number`: changed from duplicate `parts_invoices.po_number` to `customer_invoices.po_number`. Evidence: `477_customer_invoice_wave2_columns.sql` explicitly states Phase-3 parts invoice headers map to `customer_invoices` and adds `po_number`; `468_parts_invoice_lines_customer_invoices.sql` states no duplicate `parts_invoices` header is created; generated types expose `customer_invoices.po_number`.

- `parts_invoice.tax_codes_1_2_3_4`: changed from duplicate `parts_invoices.tax_code_1` to `customer_invoices.tax_code_1..tax_code_4`. Evidence: `477_customer_invoice_wave2_columns.sql` adds all four tax-code slots to `customer_invoices`; generated types expose the four columns.

- `parts_invoice.sold_to_ship_to`: changed from duplicate `parts_invoices.sold_to_address_id` to `customer_invoices.sold_to_address_id` and `customer_invoices.ship_to_address_id`. Evidence: `477_customer_invoice_wave2_columns.sql` adds both columns; `497_wave3_cross_table_relationships.sql` wires the FKs to `qrm_company_ship_to_addresses`; generated types expose both relationships.

- `credit_limit_analysis.select_percentage_of_credit_limit`: changed from no schema mapping to a computed filter over `qrm_companies.total_ar_cents / qrm_companies.credit_limit_cents`, with `qrm_ar_open_items.balance_cents` available for open-item detail. Evidence: `434_qrm_ar_open_items.sql` creates AR open items for credit-limit analysis; `472_qrm_company_wave2_columns.sql` adds `credit_limit_cents`, `total_ar_cents`, and `current_ar_balance`; generated types expose those columns.

- `credit_limit_analysis.col_total_ar`: changed from detail-table `qrm_ar_open_items.balance_cents` to canonical customer-level `qrm_companies.total_ar_cents`, while retaining `qrm_ar_open_items.balance_cents` as detail/source input. Evidence: `472_qrm_company_wave2_columns.sql` comments `total_ar_cents` as cached total outstanding AR; `504_wave4_financial_reporting_views.sql` exposes `v_customer_available_credit.total_ar_cents`; generated types expose both.

- `credit_limit_analysis.col_percentage`: changed from missing to a computed value over `qrm_companies.total_ar_cents / qrm_companies.credit_limit_cents`. Evidence: `472_qrm_company_wave2_columns.sql` adds both inputs; `504_wave4_financial_reporting_views.sql` exposes the same inputs in `v_customer_available_credit`; generated types expose the table and view fields.

## Verified Unchanged

- `credit_limit_analysis.col_credit_limit` already mapped to `qrm_companies.credit_limit_cents`, which matches the canonical schema.

## Follow-Up Completed

- `credit_limit_analysis.show_zero_credit_limit` is now mapped to `v_deal_genome_credit_limit_analysis.credit_limit_cents` as a view-backed filter toggle.

- `analysis_days.grid_location` is now mapped to canonical `branches.name`.

- `profitability.area` is now mapped to canonical `customer_invoices.invoice_source_code`.

- Other `parts_invoice.*` entries that still point at `parts_invoices` were outside the requested candidate list and were not edited. The canonical-header evidence strongly suggests they should be reviewed separately before any duplicate `parts_invoices` DDL is generated.

## Files Changed

- `docs/intellidealer-gap-audit/phase-1-crm.yaml`
- `docs/intellidealer-gap-audit/cross-cutting.yaml`
- `docs/intellidealer-gap-audit/phase-3-parts.yaml`
- `docs/intellidealer-gap-audit/phase-5-deal-genome.yaml`
- `docs/IntelliDealer/GAP_AUDIT_BLOCKER_MAPPING_REVIEW_2026-05-03.md`
