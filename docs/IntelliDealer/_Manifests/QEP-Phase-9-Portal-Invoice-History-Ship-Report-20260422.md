# QEP Phase 9 Portal Invoice History Ship Report

**Date:** 2026-04-22  
**Phase:** `Phase-9_Advanced-Intelligence`  
**Gap Register row:** `10`  
**Gap:** Customer Portal invoice history + payment transcript views incomplete.

## Scope Closed

- Extended portal invoice history filtering:
  - search
  - status
  - date mode
  - date range
- Added dedicated portal invoice detail route:
  - `/portal/invoices/:invoiceId`
- Added explicit payment transcript view and invoice timeline view per invoice
- Added statement download from the dedicated detail view
- Extended `portal-api` invoice endpoint to support filtered history and single-invoice lookup

## Files Changed

- `apps/web/src/features/portal/lib/portal-api.ts`
- `apps/web/src/features/portal/lib/portal-invoice-history-utils.ts`
- `apps/web/src/features/portal/lib/portal-invoice-history-utils.test.ts`
- `apps/web/src/features/portal/pages/PortalInvoicesPage.tsx`
- `apps/web/src/features/portal/pages/PortalInvoiceDetailPage.tsx`
- `apps/web/src/features/portal/PortalRoutes.tsx`
- `supabase/functions/portal-api/index.ts`

## Primary Evidence

- Workbook source: `/Users/brianlewis/Desktop/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx`
  - `Gap Register` row `10`
- IntelliDealer source evidence:
  - `/Users/brianlewis/Desktop/IntelliDealer/Phase-8_Financial-Operations/Invoice History Listing.pdf`
  - `/Users/brianlewis/Desktop/IntelliDealer/Phase-8_Financial-Operations/Real-time Billing Queue.pdf`
  - `/Users/brianlewis/Desktop/IntelliDealer/_OCR/Phase-8_Financial-Operations/Invoice History Listing.txt`
  - `/Users/brianlewis/Desktop/IntelliDealer/_OCR/Phase-8_Financial-Operations/Real-time Billing Queue.txt`
- Segment gate artifact:
  - `/Users/brianlewis/Projects/qep-knowledge-assistant-qb-gl/test-results/agent-gates/20260422T132535Z-phase9-portal-invoices.json`

## Verification

- file-level TypeScript diagnostics on:
  - `apps/web/src/features/portal/pages/PortalInvoicesPage.tsx`
  - `apps/web/src/features/portal/pages/PortalInvoiceDetailPage.tsx`
  - `apps/web/src/features/portal/PortalRoutes.tsx`
- `bun test apps/web/src/features/portal/lib/portal-invoice-history-utils.test.ts`
- `deno check supabase/functions/portal-api/index.ts`
- `bun run build`
- `bun run segment:gates --segment phase9-portal-invoices --ui`

## Deployment

- `supabase functions deploy portal-api`

## Remaining Backlog After This Slice

- `Gap Register` row `12` Traffic Management scope decision
- `Gap Register` row `16` OEM Portal SSO dashboard
- `Gap Register` row `18` Data Miner equivalents
- `Gap Register` row `20` IronGuides contract dependency
- manual blockers:
  - row `2`
  - row `3`
  - row `5`
