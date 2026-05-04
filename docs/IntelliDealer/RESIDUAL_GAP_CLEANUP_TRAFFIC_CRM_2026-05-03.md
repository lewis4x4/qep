# IntelliDealer Residual Gap Cleanup: Traffic + CRM

Date: 2026-05-03

## Scope

Worker A changed only the owned Traffic/CRM residual cleanup files, then a follow-on UI wiring pass completed both rows:

- `traffic_ticket.mass_change_print`
- `customer.search_extended_fields`

`prospect.jdquote_upload` remains a truthful external/OEM integration deferral. No JD Quote II payload, credential, provider adapter, PDF ingestion, or upload run schema was added.

## Traffic Mass Change / Print

Status changed from `MISSING` to `PARTIAL` in the backend slice, then to `BUILT` in the UI wiring pass.

Implemented backend support:

- `traffic-ticket-bulk-actions` edge function accepts `bulk_update`, `print_receipts`, and `mass_change_print`.
- Bulk update is limited to selected operational fields on existing `traffic_tickets`.
- Print marking uses `public.traffic_ticket_mark_printed(uuid[])` to increment `printed_count`, set `last_printed_at`, and return delivery-receipt fields for caller-side print rendering.

Follow-on UI completion:

- `TrafficTicketsPage` exposes selected/visible bulk print and mass change/print controls.
- Receipt rendering uses the edge function response and opens a browser print window.

## CRM Extended Search

Status changed from `PARTIAL` to `BUILT` in the UI wiring pass.

Implemented backend support:

- `public.list_crm_companies_page` now accepts `p_include_extended_fields boolean default false`.
- When enabled, the listing search also matches primary contact full/first/last name and active ship-to label/contact name.
- Added trigram indexes for the extended-field search plan.

Follow-on UI completion:

- `QrmCompaniesPage` exposes an explicit Extended IntelliDealer search toggle.
- `listCrmCompanies` passes `p_include_extended_fields` through to the RPC.
