## 2026-04-21 — Customer Profile Ship To (Phase-1_CRM) — CLOSED
**Gap row:** Ship To addresses table missing. IntelliDealer Customer Profile has Ship To tab.
**Change type:** Combined
**Files:**
- `supabase/migrations/344_crm_company_ship_to_addresses.sql`
- `supabase/functions/_shared/crm-router-data.ts`
- `supabase/functions/crm-router/index.ts`
- `apps/web/src/features/qrm/components/QrmCompanyShipToSection.tsx`
- `apps/web/src/features/qrm/components/QrmCompanyShipToSheet.tsx`
- `apps/web/src/features/qrm/pages/QrmCompanyDetailPage.tsx`
- `apps/web/src/features/qrm/components/__tests__/QrmCompanyShipToSection.integration.test.tsx`
**Verification:** `bun run migrations:check`, `deno check supabase/functions/crm-router/index.ts supabase/functions/_shared/crm-router-data.ts`, `bun test apps/web/src/features/qrm/components/__tests__/QrmCompanyShipToSection.integration.test.tsx`, `bun run --filter @qep/web build`, and `bun run build` all passed in a clean verification worktree created from committed `main`. Segment gate remained blocked by repo-level missing scripts/env in committed `HEAD`, not by the Ship To slice itself.
**Parity status update:** GAP → BUILT

## 2026-04-21 — Customer Profile Search 1 / Search 2 (Phase-1_CRM) — CLOSED
**Gap row:** Search 1 / Search 2 legacy fields not stored. Used heavily in IntelliDealer.
**Change type:** Combined
**Files:**
- `supabase/migrations/345_crm_company_search_fields.sql`
- `supabase/functions/_shared/crm-router-data.ts`
- `apps/web/src/features/qrm/lib/qrm-supabase.ts`
- `apps/web/src/features/qrm/lib/qrm-api.ts`
- `apps/web/src/features/qrm/lib/types.ts`
- `apps/web/src/features/qrm/components/QrmCompanyEditorSheet.tsx`
- `apps/web/src/features/qrm/pages/QrmCompaniesPage.tsx`
- `apps/web/src/features/sales/lib/customer-search.ts`
- `apps/web/src/features/sales/lib/customer-search.test.ts`
- `apps/web/src/features/sales/hooks/useCustomers.ts`
- `apps/web/src/features/sales/lib/types.ts`
- `apps/web/src/features/sales/components/CustomerSearchBar.tsx`
**Verification:** `bun run migrations:check`, `deno check supabase/functions/crm-router/index.ts supabase/functions/_shared/crm-router-data.ts`, `bun test apps/web/src/features/sales/lib/customer-search.test.ts apps/web/src/features/qrm/components/__tests__/QrmCompanyShipToSection.integration.test.tsx`, and `bun run build` all passed on the working branch. Segment gate runner entered the repo-level KB eval leg and did not produce a usable completion artifact for this slice.
**Parity status update:** GAP → BUILT

## 2026-04-21 — CRM Marketing Campaigns (Phase-1_CRM) — CLOSED
**Gap row:** Marketing Campaigns functionality exists in IntelliDealer CRM.
**Change type:** Combined
**Files:**
- `apps/web/src/features/qrm/pages/QrmCampaignsPage.tsx`
- `apps/web/src/features/qrm/lib/campaign-utils.ts`
- `apps/web/src/features/qrm/lib/campaign-utils.test.ts`
- `apps/web/src/features/qrm/lib/types.ts`
- `apps/web/src/features/qrm/lib/qrm-router-api.ts`
- `apps/web/src/features/qrm/lib/qrm-api.ts`
- `apps/web/src/features/qrm/components/QrmSubNav.tsx`
- `apps/web/src/features/qrm/shell/shellMap.ts`
- `apps/web/src/App.tsx`
- `supabase/functions/_shared/crm-campaigns.ts`
- `supabase/functions/crm-router/index.ts`
**Verification:** `deno check supabase/functions/crm-router/index.ts supabase/functions/_shared/crm-campaigns.ts`, `bun test apps/web/src/features/qrm/lib/campaign-utils.test.ts apps/web/src/features/sales/lib/customer-search.test.ts apps/web/src/features/qrm/components/__tests__/QrmCompanyShipToSection.integration.test.tsx`, and `bun run build` all passed on the working branch. Existing segment gate runner behavior still blocks on the repo-level KB eval leg and was not used as closure evidence for this slice.
**Parity status update:** GAP → BUILT

## 2026-04-21 — Base & Options (Phase-2_Sales-Intelligence) — CLOSED
**Gap row:** Base & Options configuration for equipment quotes needs parity check.
**Change type:** UI + Existing Catalog Wiring
**Files:**
- `apps/web/src/features/admin/pages/BaseOptionsPage.tsx`
- `apps/web/src/features/admin/lib/base-options-api.ts`
- `apps/web/src/features/admin/lib/base-options-utils.ts`
- `apps/web/src/features/admin/lib/base-options-utils.test.ts`
- `apps/web/src/features/admin/pages/PriceSheetsPage.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/features/quote-builder/lib/quote-api.ts`
- `apps/web/src/features/quote-builder/components/EquipmentSelector.tsx`
- `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx`
**Verification:** `bun test apps/web/src/features/admin/lib/base-options-utils.test.ts apps/web/src/features/qrm/lib/campaign-utils.test.ts apps/web/src/features/sales/lib/customer-search.test.ts`, file-level TypeScript diagnostics on the new admin/quote-builder surfaces, and `bun run build` all passed on the working branch. No new migrations or edge functions were required for this slice because the underlying `qb_equipment_models`, `qb_attachments`, and price-sheet ingestion stack already existed.
**Parity status update:** REVIEW → BUILT

## 2026-04-21 — Vendor Self-Service Portal UI (Phase-3_Parts) — CLOSED
**Gap row:** Vendor Self-Service Portal UI incomplete. Vendors can't update their own pricing.
**Change type:** Combined
**Files:**
- `supabase/migrations/346_vendor_price_portal_submissions.sql`
- `supabase/functions/vendor-pricing-portal/index.ts`
- `supabase/config.toml`
- `apps/web/src/features/service/pages/VendorProfilesPage.tsx`
- `apps/web/src/features/service/pages/VendorPricingPortalPage.tsx`
- `apps/web/src/features/service/lib/vendor-pricing-portal-utils.ts`
- `apps/web/src/features/service/lib/vendor-pricing-portal-utils.test.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/components/NoProfileShell.tsx`
**Verification:** `bun test apps/web/src/features/service/lib/vendor-pricing-portal-utils.test.ts apps/web/src/features/admin/lib/base-options-utils.test.ts apps/web/src/features/qrm/lib/campaign-utils.test.ts`, file-level TypeScript diagnostics on the vendor portal/internal approval surfaces, `deno check supabase/functions/vendor-pricing-portal/index.ts`, and `bun run build` all passed on the working branch.
**Parity status update:** GAP → BUILT

## 2026-04-22 — Purchase Orders (Phase-3_Parts) — CLOSED
**Gap row:** `13`
**Gap description:** Purchase Orders (vendor PO for non-parts) may need dedicated table.
**Change type:** Schema + UI
**Files:**
- `supabase/migrations/347_vendor_purchase_orders.sql`
- `apps/web/src/features/parts/lib/purchase-order-utils.ts`
- `apps/web/src/features/parts/lib/purchase-order-utils.test.ts`
- `apps/web/src/features/parts/pages/PurchaseOrdersPage.tsx`
- `apps/web/src/features/parts/pages/PurchaseOrderDetailPage.tsx`
- `apps/web/src/features/parts/components/PartsSubNav.tsx`
- `apps/web/src/App.tsx`
- `package.json`
**Verification:** `bun test apps/web/src/features/parts/lib/purchase-order-utils.test.ts`, file-level TypeScript diagnostics on `PurchaseOrdersPage.tsx`, `PurchaseOrderDetailPage.tsx`, and `App.tsx`, `bun run build`, `bun run pressure:parts`, `KB_INTEGRATION_REQUIRED=true bun run test:kb-integration`, and `bun run segment:gates --segment phase3-purchase-orders --ui` all passed. Gate report: `test-results/agent-gates/20260422T005137Z-phase3-purchase-orders.json`.
**Deployment:** `supabase db push` applied `347_vendor_purchase_orders.sql`; `supabase migration list` confirms remote migration `347`.
**Parity status update:** GAP → BUILT

## 2026-04-22 — Service Mobile Technician Workspace (Phase-4_Service) — BUILT / FIELD UAT PENDING
**Gap row:** `5`
**Gap description:** Service Mobile Web UI not production-validated for technicians.
**Change type:** UI + Validation Harness
**Files:**
- `apps/web/src/features/service/pages/ServiceTechnicianMobilePage.tsx`
- `apps/web/src/features/service/lib/mobile-tech-utils.ts`
- `apps/web/src/features/service/lib/mobile-tech-utils.test.ts`
- `apps/web/src/features/service/pages/__tests__/ServiceTechnicianMobilePage.integration.test.tsx`
- `apps/web/src/features/service/components/ServiceSubNav.tsx`
- `apps/web/src/features/service/pages/ServiceCommandCenterPage.tsx`
- `apps/web/src/App.tsx`
**Verification:** file-level TypeScript diagnostics on `ServiceTechnicianMobilePage.tsx`, `ServiceSubNav.tsx`, and `App.tsx`, `bun test apps/web/src/features/service/lib/mobile-tech-utils.test.ts apps/web/src/features/service/pages/__tests__/ServiceTechnicianMobilePage.integration.test.tsx`, `bun run build`, and `bun run segment:gates --segment phase4-service-mobile --ui` all passed. Gate report: `test-results/agent-gates/20260422T010934Z-phase4-service-mobile.json`.
**Deployment:** no new migrations or edge functions were required for this slice.
**Remaining manual acceptance:** workbook row `5` still calls for in-field UAT with a service technician. That manual production validation was not executable from the workspace and remains open.
**Parity status update:** GAP → BUILT (repo-side) / FIELD UAT PENDING
