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
| Built | `839` |
| Partial | `7` |
| Missing | `1` |
| Must | `496` |
| Should | `300` |
| Could | `51` |
| Remaining must-fix blockers | `0` |

This slice reduced the non-must residual inventory from `40` missing plus `18` partial rows to `1` missing plus `7` partial rows after follow-on migrations `531` through `533`.

## Remaining Rows

| Status | Severity | Field | Reason |
| --- | --- | --- | --- |
| `PARTIAL` | `should` | `traffic_ticket.mass_change_print` | Backend bulk-update/print-marking function is built; Traffic UI and print rendering smoke remain. |
| `PARTIAL` | `must` | `audit.created_by` | Field-level actor audit exists, but there is no universal `created_by` column standard across every table. |
| `MISSING` | `could` | `prospect.jdquote_upload` | JD Quote II remains a Wave 5 external integration pending dealer scope and credentials. |
| `PARTIAL` | `could` | `customer.search_extended_fields` | Search evidence exists, but there is no explicit IntelliDealer-style extended-field toggle. |
| `PARTIAL` | `could` | `parts_invoice.tethr_it_now` | Generic telematics exists; Tethr provider credentials/adapter/UI smoke remain. |
| `PARTIAL` | `should` | `analysis_wip.create_wip_report_link` | CSV/JSON export backend is built; Service UI and printable/PDF path remain. |
| `PARTIAL` | `could` | `analysis_payroll.print_action` | CSV/JSON export backend is built; Service UI and direct-print/PDF path remain. |
| `PARTIAL` | `should` | `rental_counter.action_tethr_it` | Generic telematics exists; Tethr provider credentials/adapter/rental UI smoke remain. |

## Evidence

- Migrations `526` through `533` were applied to the remote Supabase project.
- `bun run db:push` reports `pending to apply: 0`.
- `apps/web/src/lib/database.types.ts` was regenerated from the remote Supabase project after migration application.
- `bun run intellidealer:gap-audit:regen` reports `qepStatusBuilt: 839`, `qepStatusMissing: 1`, `qepStatusPartial: 7`, and `must_fix_blocker_count: 0`.
- `docs/intellidealer-gap-audit/_blockers.csv` contains only the header row.
