# IntelliDealer Residual Gap Cleanup: Traffic + CRM

Date: 2026-05-03

## Scope

Worker A changed only the owned Traffic/CRM residual cleanup files:

- `traffic_ticket.mass_change_print`
- `customer.search_extended_fields`

`prospect.jdquote_upload` remains a truthful external/OEM integration deferral. No JD Quote II payload, credential, provider adapter, PDF ingestion, or upload run schema was added.

## Traffic Mass Change / Print

Status changed from `MISSING` to `PARTIAL`.

Implemented backend support:

- `traffic-ticket-bulk-actions` edge function accepts `bulk_update`, `print_receipts`, and `mass_change_print`.
- Bulk update is limited to selected operational fields on existing `traffic_tickets`.
- Print marking uses `public.traffic_ticket_mark_printed(uuid[])` to increment `printed_count`, set `last_printed_at`, and return delivery-receipt fields for caller-side print rendering.

Remaining gap:

- No owned Traffic Management UI button was added.
- No external printer provider, print queue, or PDF renderer was implemented.

## CRM Extended Search

Status remains `PARTIAL`.

Implemented backend support:

- `public.list_crm_companies_page` now accepts `p_include_extended_fields boolean default false`.
- When enabled, the listing search also matches primary contact full/first/last name and active ship-to label/contact name.
- Added trigram indexes for the extended-field search plan.

Remaining gap:

- The Customer Listing page still does not expose an explicit IntelliDealer-style Extended Fields toggle in this slice.
