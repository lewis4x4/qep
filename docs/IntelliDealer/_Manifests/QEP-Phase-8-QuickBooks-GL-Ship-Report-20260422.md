# QEP Phase 8 QuickBooks GL Ship Report

**Date:** 2026-04-22  
**Phase:** `Phase-8_Financial-Operations`  
**Gap Register row:** `4`  
**Gap:** QuickBooks GL posting not wired. Invoices don't sync to QB.

## Scope Closed

- Added invoice-level QuickBooks GL sync state to `customer_invoices`
- Added `quickbooks_gl_sync_jobs` queue + audit table
- Added QuickBooks GL sync edge function:
  - `quickbooks-gl-sync`
- Added encrypted QuickBooks integration seed row in `integration_status`
- Added admin/operator UI at `/admin/quickbooks-gl`
- Added automatic queueing for newly generated service invoices
- Added a configuration command center that:
  - loads non-secret stored QuickBooks settings
  - supports secret rotation without forcing re-entry of unchanged values
  - validates account-map completeness
  - runs a live company handshake against QuickBooks
  - allows clearing and reseeding stored config
  - exposes posting backlog and invoice-level retry actions in the same surface

## Files Changed

- `supabase/migrations/352_quickbooks_gl_sync.sql`
- `supabase/functions/_shared/quickbooks-gl.ts`
- `supabase/functions/_shared/quickbooks-gl.test.ts`
- `supabase/functions/quickbooks-gl-sync/index.ts`
- `supabase/functions/_shared/service-invoice.ts`
- `apps/web/src/features/admin/pages/QuickBooksGlSyncPage.tsx`
- `apps/web/src/features/admin/pages/__tests__/QuickBooksGlSyncPage.integration.test.tsx`
- `apps/web/src/features/admin/lib/quickbooks-config-utils.ts`
- `apps/web/src/features/admin/lib/quickbooks-config-utils.test.ts`
- `apps/web/src/features/service/components/ServiceQuoteBuilder.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/components/AdminPage.tsx`
- `supabase/config.toml`
- `supabase/migrations/357_backfill_quickbooks_integration_status.sql`

## Primary Evidence

- Workbook source: `/Users/brianlewis/Desktop/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx`
  - `Gap Register` row `4`
- IntelliDealer source evidence:
  - `/Users/brianlewis/Desktop/IntelliDealer/Phase-8_Financial-Operations/Invoice History Listing.pdf`
  - `/Users/brianlewis/Desktop/IntelliDealer/Phase-8_Financial-Operations/Real-time Billing Queue.pdf`
  - `/Users/brianlewis/Desktop/IntelliDealer/_OCR/Phase-8_Financial-Operations/Accounts Receivable - Outstanding A:R.txt`
- Intuit primary references consulted:
  - OAuth 2.0 setup and refresh flow on `developer.intuit.com`
  - QuickBooks Online invoice / accounting workflow references on `developer.intuit.com`
- Segment gate artifact:
  - `/Users/brianlewis/Projects/qep-knowledge-assistant-qb-gl/test-results/agent-gates/20260422T125224Z-phase8-quickbooks-gl.json`

## Verification

- file-level TypeScript diagnostics on:
  - `apps/web/src/features/admin/pages/QuickBooksGlSyncPage.tsx`
  - `apps/web/src/features/service/components/ServiceQuoteBuilder.tsx`
  - `apps/web/src/App.tsx`
- `deno test supabase/functions/_shared/quickbooks-gl.test.ts supabase/functions/_shared/service-labor-pricing.test.ts --allow-read --allow-env`
- `deno check supabase/functions/quickbooks-gl-sync/index.ts supabase/functions/_shared/quickbooks-gl.ts supabase/functions/service-quote-engine/index.ts`
- `bun test apps/web/src/features/service/lib/service-labor-pricing-utils.test.ts apps/web/src/features/admin/pages/__tests__/QuickBooksGlSyncPage.integration.test.tsx`
- `bun run build`
- `bun run segment:gates --segment phase8-quickbooks-gl --ui`
- `bun test apps/web/src/features/admin/lib/quickbooks-config-utils.test.ts apps/web/src/features/admin/pages/__tests__/QuickBooksGlSyncPage.integration.test.tsx`
- `bun run segment:gates --segment phase8-quickbooks-config-ui --ui`

## Deployment

- `supabase db push`
- `supabase functions deploy quickbooks-gl-sync`
- `supabase functions list`
- `supabase migration list`

## Remaining Manual Tasks

- Operator entry in `/admin/quickbooks-gl`:
  - QuickBooks OAuth app credentials
  - QuickBooks refresh token
  - QuickBooks realm id
  - QuickBooks account ids for:
  - A/R
  - service revenue
  - parts revenue
  - haul revenue
  - shop supplies
  - misc revenue
  - tax liability
