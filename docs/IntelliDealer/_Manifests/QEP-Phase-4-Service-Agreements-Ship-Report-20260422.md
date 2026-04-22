# QEP Phase 4 Service Agreements Ship Report

**Date:** 2026-04-22  
**Phase:** `Phase-4_Service`  
**Gap Register row:** `17`  
**Gap:** Service Agreements (PM contracts) may need dedicated schema.

## Scope Closed

- Added a dedicated service agreement contract register:
  - `service_agreements`
- Added service agreement UI:
  - `/service/agreements`
  - `/service/agreements/:agreementId`
- Added search/listing fields aligned to IntelliDealer evidence:
  - contract number
  - stock number
  - location
  - customer
  - program
  - category
  - expiry date
- Bridged service agreements to downstream `maintenance_schedules` so the PM contract and PM schedule remain separate but connected

## Files Changed

- `supabase/migrations/349_service_agreements.sql`
- `apps/web/src/features/service/lib/service-agreement-utils.ts`
- `apps/web/src/features/service/lib/service-agreement-utils.test.ts`
- `apps/web/src/features/service/pages/ServiceAgreementsPage.tsx`
- `apps/web/src/features/service/pages/ServiceAgreementDetailPage.tsx`
- `apps/web/src/features/service/pages/__tests__/ServiceAgreementsPage.integration.test.tsx`
- `apps/web/src/features/service/components/ServiceSubNav.tsx`
- `apps/web/src/features/service/pages/ServiceCommandCenterPage.tsx`
- `apps/web/src/App.tsx`

## Primary Evidence

- Workbook source: `/Users/brianlewis/Desktop/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx`
  - `Gap Register` row `17`
- IntelliDealer source evidence:
  - `/Users/brianlewis/Desktop/IntelliDealer/Phase-4_Service/Service Agreements (Product Support Quick Links).pdf`
  - `/Users/brianlewis/Desktop/IntelliDealer/_OCR/Phase-4_Service/Service Agreements (Product Support Quick Links).txt`
- Segment gate artifact:
  - `/Users/brianlewis/Projects/qep-knowledge-assistant/test-results/agent-gates/20260422T020210Z-phase4-service-agreements.json`

## Verification

- file-level TypeScript diagnostics on:
  - `apps/web/src/features/service/pages/ServiceAgreementsPage.tsx`
  - `apps/web/src/features/service/pages/ServiceAgreementDetailPage.tsx`
  - `apps/web/src/App.tsx`
- `bun test apps/web/src/features/service/lib/service-agreement-utils.test.ts apps/web/src/features/service/pages/__tests__/ServiceAgreementsPage.integration.test.tsx`
- `bun run build`
- `bun run segment:gates --segment phase4-service-agreements --ui`

## Deployment

- `supabase db push`
- `supabase migration list`

Remote state verified through migration `349`.

## Remaining Phase 4 Rows

- `Gap Register` row `19`
- `Gap Register` row `21`
- plus row `5` field technician UAT remains open as a manual acceptance step
