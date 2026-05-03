# IntelliDealer Non-Must Gap Cleanup Burndown

Date: 2026-05-03

## Scope

This slice cleaned up the remaining non-must IntelliDealer gap-audit rows after the must-blocker inventory reached zero.

Raw IntelliDealer files and `COL/` remain untracked and were not used as committed artifacts.

## Agent Workstreams

| Workstream | Output |
| --- | --- |
| CRM and cross-cutting traffic/audit cleanup | `526_intellidealer_crm_cross_cutting_non_must.sql` |
| Sales/Base & Options cleanup | `527_intellidealer_sales_base_options_non_must.sql` |
| Parts/finance cleanup | `528_intellidealer_parts_finance_non_must.sql` |
| Service/Deal Genome cleanup | `529_intellidealer_service_deal_genome_non_must.sql` |
| Rental/customer portal cleanup | `530_intellidealer_rental_portal_non_must.sql` |

## Result

Final regenerated gap-audit inventory:

| Metric | Count |
| --- | ---: |
| Total fields | `847` |
| Built | `838` |
| Partial | `2` |
| Missing | `7` |
| Must | `496` |
| Should | `300` |
| Could | `51` |
| Remaining must-fix blockers | `0` |

This slice reduced the non-must residual inventory from `40` missing plus `18` partial rows to `7` missing plus `2` partial rows.

## Remaining Rows

| Status | Severity | Field | Reason |
| --- | --- | --- | --- |
| `MISSING` | `should` | `traffic_ticket.mass_change_print` | Requires a bulk-edit/print workflow, not just schema. |
| `PARTIAL` | `must` | `audit.created_by` | Field-level actor audit exists, but there is no universal `created_by` column standard across every table. |
| `MISSING` | `could` | `prospect.jdquote_upload` | JD Quote II remains a Wave 5 external integration pending dealer scope and credentials. |
| `PARTIAL` | `could` | `customer.search_extended_fields` | Search evidence exists, but there is no explicit IntelliDealer-style extended-field toggle. |
| `MISSING` | `could` | `parts_invoice.tethr_it_now` | Tethr remains a Wave 5 external integration pending provider credentials and mapping. |
| `MISSING` | `could` | `parts_invoice.adjust_ldttn` | Requires confirmed LDTTN business semantics before implementation. |
| `MISSING` | `should` | `analysis_wip.create_wip_report_link` | Requires a WIP export/print pipeline, not just reporting views. |
| `MISSING` | `could` | `analysis_payroll.print_action` | Requires a payroll-hours PDF/print job. |
| `MISSING` | `should` | `rental_counter.action_tethr_it` | Tethr remains a Wave 5 external integration pending provider credentials and mapping. |

## Evidence

- Migrations `526` through `530` were applied to the remote Supabase project.
- `bun run db:push` reports `pending to apply: 0`.
- `apps/web/src/lib/database.types.ts` was regenerated from the remote Supabase project after migration application.
- `bun run intellidealer:gap-audit:regen` reports `qepStatusBuilt: 838`, `qepStatusMissing: 7`, `qepStatusPartial: 2`, and `must_fix_blocker_count: 0`.
- `docs/intellidealer-gap-audit/_blockers.csv` contains only the header row.
