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

## 2026-04-22 — InspectionPlus Dedicated Schema (Phase-4_Service) — CLOSED
**Gap row:** `9`
**Gap description:** ID InspectionPlus dedicated schema may be needed (separate from work orders).
**Change type:** Schema + UI
**Files:**
- `supabase/migrations/348_service_inspectionplus.sql`
- `apps/web/src/features/service/lib/inspectionplus-utils.ts`
- `apps/web/src/features/service/lib/inspectionplus-utils.test.ts`
- `apps/web/src/features/service/pages/ServiceInspectionPlusPage.tsx`
- `apps/web/src/features/service/pages/ServiceInspectionDetailPage.tsx`
- `apps/web/src/features/service/pages/__tests__/ServiceInspectionPlusPage.integration.test.tsx`
- `apps/web/src/features/service/components/ServiceSubNav.tsx`
- `apps/web/src/features/service/pages/ServiceCommandCenterPage.tsx`
- `apps/web/src/App.tsx`
**Verification:** file-level TypeScript diagnostics on `ServiceInspectionPlusPage.tsx`, `ServiceInspectionDetailPage.tsx`, `ServiceSubNav.tsx`, and `App.tsx`, `bun test apps/web/src/features/service/lib/inspectionplus-utils.test.ts apps/web/src/features/service/pages/__tests__/ServiceInspectionPlusPage.integration.test.tsx`, `bun run build`, and `bun run segment:gates --segment phase4-inspectionplus --ui` all passed. Gate report: `test-results/agent-gates/20260422T013526Z-phase4-inspectionplus.json`.
**Deployment:** `supabase db push` applied `348_service_inspectionplus.sql`; `supabase migration list` confirms remote migration `348`. During deploy, the migration was corrected to reference `qrm_companies` and `qrm_equipment` because the legacy `crm_*` relations are compatibility views in the remote environment.
**Parity status update:** GAP → BUILT

## 2026-04-22 — Service Agreements (Phase-4_Service) — CLOSED
**Gap row:** `17`
**Gap description:** Service Agreements (PM contracts) may need dedicated schema.
**Change type:** Schema + UI
**Files:**
- `supabase/migrations/349_service_agreements.sql`
- `apps/web/src/features/service/lib/service-agreement-utils.ts`
- `apps/web/src/features/service/lib/service-agreement-utils.test.ts`
- `apps/web/src/features/service/pages/ServiceAgreementsPage.tsx`
- `apps/web/src/features/service/pages/ServiceAgreementDetailPage.tsx`
- `apps/web/src/features/service/pages/__tests__/ServiceAgreementsPage.integration.test.tsx`
- `apps/web/src/features/service/components/ServiceSubNav.tsx`
- `apps/web/src/features/service/pages/ServiceCommandCenterPage.tsx`
- `apps/web/src/App.tsx`
**Verification:** file-level TypeScript diagnostics on `ServiceAgreementsPage.tsx`, `ServiceAgreementDetailPage.tsx`, and `App.tsx`, `bun test apps/web/src/features/service/lib/service-agreement-utils.test.ts apps/web/src/features/service/pages/__tests__/ServiceAgreementsPage.integration.test.tsx`, `bun run build`, and `bun run segment:gates --segment phase4-service-agreements --ui` all passed. Gate report: `test-results/agent-gates/20260422T020210Z-phase4-service-agreements.json`.
**Deployment:** `supabase db push` applied `349_service_agreements.sql`; `supabase migration list` confirms remote migration `349`.
**Parity status update:** GAP → BUILT

## 2026-04-22 — Work In Process Tracking (Phase-4_Service) — CLOSED
**Gap row:** `19`
**Gap description:** Work in Process tracking — confirm service_stage_timing covers all states.
**Change type:** Validation + UI
**Files:**
- `supabase/migrations/350_service_work_in_process.sql`
- `apps/web/src/features/service/lib/service-wip-utils.ts`
- `apps/web/src/features/service/lib/service-wip-utils.test.ts`
- `apps/web/src/features/service/pages/ServiceWorkInProcessPage.tsx`
- `apps/web/src/features/service/pages/__tests__/ServiceWorkInProcessPage.integration.test.tsx`
- `apps/web/src/features/service/components/ServiceSubNav.tsx`
- `apps/web/src/features/service/pages/ServiceCommandCenterPage.tsx`
- `apps/web/src/App.tsx`
**Verification:** file-level TypeScript diagnostics on `ServiceWorkInProcessPage.tsx`, `ServiceSubNav.tsx`, and `App.tsx`, `bun test apps/web/src/features/service/lib/service-wip-utils.test.ts apps/web/src/features/service/pages/__tests__/ServiceWorkInProcessPage.integration.test.tsx`, `bun run build`, and `bun run segment:gates --segment phase4-work-in-process --ui` all passed. Gate report: `test-results/agent-gates/20260422T025038Z-phase4-work-in-process.json`.
**Deployment:** `supabase db push` applied `350_service_work_in_process.sql`; `supabase migration list` confirms remote migration `350`.
**Parity status update:** GAP → BUILT

## 2026-04-22 — Labor Pricing Tier Logic (Phase-4_Service) — CLOSED
**Gap row:** `21`
**Gap description:** Labor Pricing may have tiered rate logic not obvious in current schema.
**Change type:** Schema + UI + Quote Engine Wiring
**Files:**
- `supabase/migrations/351_service_labor_pricing.sql`
- `supabase/functions/_shared/service-labor-pricing.ts`
- `supabase/functions/_shared/service-labor-pricing.test.ts`
- `supabase/functions/service-quote-engine/index.ts`
- `apps/web/src/features/service/lib/service-labor-pricing-utils.ts`
- `apps/web/src/features/service/lib/service-labor-pricing-utils.test.ts`
- `apps/web/src/features/service/components/ServiceQuoteBuilder.tsx`
- `apps/web/src/features/service/pages/ServiceLaborPricingPage.tsx`
- `apps/web/src/features/service/pages/__tests__/ServiceLaborPricingPage.integration.test.tsx`
- `apps/web/src/features/service/components/ServiceSubNav.tsx`
- `apps/web/src/features/service/pages/ServiceCommandCenterPage.tsx`
- `apps/web/src/App.tsx`
**Verification:** file-level TypeScript diagnostics on `ServiceLaborPricingPage.tsx`, `ServiceQuoteBuilder.tsx`, and `App.tsx`, `deno test supabase/functions/_shared/service-labor-pricing.test.ts --allow-read`, `deno check supabase/functions/service-quote-engine/index.ts supabase/functions/_shared/service-labor-pricing.ts`, `bun test apps/web/src/features/service/lib/service-labor-pricing-utils.test.ts apps/web/src/features/service/pages/__tests__/ServiceLaborPricingPage.integration.test.tsx`, `bun run build`, and `bun run segment:gates --segment phase4-labor-pricing --ui` all passed. Gate report: `test-results/agent-gates/20260422T120227Z-phase4-labor-pricing.json`.
**Deployment:** `supabase db push` applied `351_service_labor_pricing.sql`; remote migration verification completed.
**Parity status update:** GAP → BUILT

## 2026-04-22 — QuickBooks GL Posting (Phase-8_Financial-Operations) — BUILT / CREDENTIALS PENDING
**Gap row:** `4`
**Gap description:** QuickBooks GL posting not wired. Invoices don't sync to QB.
**Change type:** Schema + Edge + Admin UI
**Files:**
- `supabase/migrations/352_quickbooks_gl_sync.sql`
- `supabase/functions/_shared/quickbooks-gl.ts`
- `supabase/functions/_shared/quickbooks-gl.test.ts`
- `supabase/functions/quickbooks-gl-sync/index.ts`
- `supabase/functions/_shared/service-invoice.ts`
- `apps/web/src/features/admin/pages/QuickBooksGlSyncPage.tsx`
- `apps/web/src/features/admin/pages/__tests__/QuickBooksGlSyncPage.integration.test.tsx`
- `apps/web/src/features/service/components/ServiceQuoteBuilder.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/components/AdminPage.tsx`
- `supabase/config.toml`
**Verification:** file-level TypeScript diagnostics on `QuickBooksGlSyncPage.tsx`, `ServiceQuoteBuilder.tsx`, and `App.tsx`, `deno test supabase/functions/_shared/quickbooks-gl.test.ts supabase/functions/_shared/service-labor-pricing.test.ts --allow-read --allow-env`, `deno check supabase/functions/quickbooks-gl-sync/index.ts supabase/functions/_shared/quickbooks-gl.ts supabase/functions/service-quote-engine/index.ts`, `bun test apps/web/src/features/service/lib/service-labor-pricing-utils.test.ts apps/web/src/features/admin/pages/__tests__/QuickBooksGlSyncPage.integration.test.tsx`, `bun run build`, and `bun run segment:gates --segment phase8-quickbooks-gl --ui` all passed. Gate report: `test-results/agent-gates/20260422T125224Z-phase8-quickbooks-gl.json`.
**Deployment:** `supabase db push` applied `352_quickbooks_gl_sync.sql`; `supabase functions deploy quickbooks-gl-sync` succeeded; remote function list shows `quickbooks-gl-sync` active version `1`. Follow-up migration `357_backfill_quickbooks_integration_status.sql` restored the missing `integration_status` row in workspace `default`.
**Remaining manual acceptance:** live QuickBooks credentials, realm id, and account ids must be supplied before the sync can actually post transactions.
**Parity status update:** GAP → BUILT (repo-side) / CREDENTIALS PENDING

## 2026-04-22 — QuickBooks Configuration Command Center (Phase-8_Financial-Operations) — BUILT / OPERATOR ENTRY PENDING
**Gap row:** `4`
**Gap description:** QuickBooks GL posting requires a first-class configuration/operator surface, not just backend hooks.
**Change type:** Edge + Admin UI follow-up
**Files:**
- `supabase/functions/_shared/quickbooks-gl.ts`
- `supabase/functions/_shared/quickbooks-gl.test.ts`
- `supabase/functions/quickbooks-gl-sync/index.ts`
- `apps/web/src/features/admin/lib/quickbooks-config-utils.ts`
- `apps/web/src/features/admin/lib/quickbooks-config-utils.test.ts`
- `apps/web/src/features/admin/pages/QuickBooksGlSyncPage.tsx`
- `apps/web/src/features/admin/pages/__tests__/QuickBooksGlSyncPage.integration.test.tsx`
- `supabase/migrations/357_backfill_quickbooks_integration_status.sql`
**Verification:** file-level TypeScript diagnostics on `QuickBooksGlSyncPage.tsx`, `quickbooks-config-utils.ts`, and `QuickBooksGlSyncPage.integration.test.tsx`, `deno test supabase/functions/_shared/quickbooks-gl.test.ts --allow-read --allow-env`, `deno check supabase/functions/quickbooks-gl-sync/index.ts supabase/functions/_shared/quickbooks-gl.ts`, `bun test apps/web/src/features/admin/lib/quickbooks-config-utils.test.ts apps/web/src/features/admin/pages/__tests__/QuickBooksGlSyncPage.integration.test.tsx`, `bun run build`, and `bun run segment:gates --segment phase8-quickbooks-config-ui --ui` all passed. Gate report: `test-results/agent-gates/20260422T152738Z-phase8-quickbooks-config-ui.json`.
**Deployment:** `supabase db push` applied `357_backfill_quickbooks_integration_status.sql`; `supabase functions deploy quickbooks-gl-sync` succeeded and remote function list now shows `quickbooks-gl-sync` active version `2`.
**Remaining manual acceptance:** operator still needs to enter the real QuickBooks OAuth credentials and production account ids in the new command center.
**Parity status update:** BUILT (repo-side) / CONFIG UI COMPLETE / CREDENTIAL ENTRY PENDING

## 2026-04-22 — Accounts Payable Module (Phase-8_Financial-Operations) — CLOSED
**Gap row:** `8`
**Gap description:** AP module not implemented. Accounts Payable Outstanding report has no QEP analog.
**Change type:** Schema + UI
**Files:**
- `supabase/migrations/353_ap_module.sql`
- `apps/web/src/features/admin/lib/ap-aging-utils.ts`
- `apps/web/src/features/admin/lib/ap-aging-utils.test.ts`
- `apps/web/src/features/admin/pages/AccountsPayablePage.tsx`
- `apps/web/src/features/admin/pages/AccountsPayableDetailPage.tsx`
- `apps/web/src/features/admin/pages/__tests__/AccountsPayablePage.integration.test.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/components/AdminPage.tsx`
**Verification:** file-level TypeScript diagnostics on `AccountsPayablePage.tsx`, `AccountsPayableDetailPage.tsx`, and `App.tsx`, `bun test apps/web/src/features/admin/lib/ap-aging-utils.test.ts apps/web/src/features/admin/pages/__tests__/AccountsPayablePage.integration.test.tsx`, `bun run build`, and `bun run segment:gates --segment phase8-ap-module --ui` all passed. Gate report: `test-results/agent-gates/20260422T130902Z-phase8-ap-module.json`.
**Deployment:** `supabase db push` applied `353_ap_module.sql`; `supabase migration list` confirms remote migration `353`.
**Parity status update:** GAP → BUILT

## 2026-04-22 — Portal Invoice History + Payment Transcript Views (Phase-9_Advanced-Intelligence) — CLOSED
**Gap row:** `10`
**Gap description:** Customer Portal invoice history + payment transcript views incomplete.
**Change type:** Portal UI + Portal API
**Files:**
- `apps/web/src/features/portal/lib/portal-api.ts`
- `apps/web/src/features/portal/lib/portal-invoice-history-utils.ts`
- `apps/web/src/features/portal/lib/portal-invoice-history-utils.test.ts`
- `apps/web/src/features/portal/pages/PortalInvoicesPage.tsx`
- `apps/web/src/features/portal/pages/PortalInvoiceDetailPage.tsx`
- `apps/web/src/features/portal/PortalRoutes.tsx`
- `supabase/functions/portal-api/index.ts`
**Verification:** file-level TypeScript diagnostics on `PortalInvoicesPage.tsx`, `PortalInvoiceDetailPage.tsx`, and `PortalRoutes.tsx`, `bun test apps/web/src/features/portal/lib/portal-invoice-history-utils.test.ts`, `deno check supabase/functions/portal-api/index.ts`, `bun run build`, and `bun run segment:gates --segment phase9-portal-invoices --ui` all passed. Gate report: `test-results/agent-gates/20260422T132535Z-phase9-portal-invoices.json`.
**Deployment:** `supabase functions deploy portal-api` succeeded.
**Parity status update:** GAP → BUILT

## 2026-04-22 — OEM Portal SSO Dashboard (Phase-9_Advanced-Intelligence) — BUILT / CONFIGURATION PENDING
**Gap row:** `16`
**Gap description:** OEM Portal SSO dashboard missing.
**Change type:** Schema + Admin UI
**Files:**
- `supabase/migrations/354_oem_portal_profiles.sql`
- `apps/web/src/features/oem-portals/lib/oem-portal-utils.ts`
- `apps/web/src/features/oem-portals/lib/oem-portal-utils.test.ts`
- `apps/web/src/features/oem-portals/pages/OemPortalDashboardPage.tsx`
- `apps/web/src/features/oem-portals/pages/__tests__/OemPortalDashboardPage.integration.test.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/components/AdminPage.tsx`
**Verification:** file-level TypeScript diagnostics on `OemPortalDashboardPage.tsx`, `App.tsx`, `AdminPage.tsx`, `oem-portal-utils.ts`, and `OemPortalDashboardPage.integration.test.tsx`, `bun test apps/web/src/features/oem-portals/lib/oem-portal-utils.test.ts apps/web/src/features/oem-portals/pages/__tests__/OemPortalDashboardPage.integration.test.tsx`, `bun run build`, and `bun run segment:gates --segment phase9-oem-portal-sso --ui` all passed. Gate report: `test-results/agent-gates/20260422T134252Z-phase9-oem-portal-sso.json`.
**Deployment:** `supabase db push` applied `354_oem_portal_profiles.sql`; `supabase migration list` confirms remote migration `354`.
**Remaining manual acceptance:** OEM launch URLs, credential ownership, and real dealer login workflows still need to be configured per manufacturer inside the new dashboard.
**Parity status update:** GAP → BUILT (repo-side) / CONFIGURATION PENDING

## 2026-04-22 — Data Miner Equivalents (Phase-9_Advanced-Intelligence) — CLOSED
**Gap row:** `18`
**Gap description:** Data Miner reports don't have 1:1 QEP analog; QEP has different BI approach.
**Change type:** Schema + Owner / Dashboard UI
**Files:**
- `supabase/migrations/355_owner_data_miner_equivalents.sql`
- `apps/web/src/features/owner/lib/data-miner-utils.ts`
- `apps/web/src/features/owner/lib/data-miner-utils.test.ts`
- `apps/web/src/features/owner/pages/DataMinerEquivalentsPage.tsx`
- `apps/web/src/features/owner/pages/__tests__/DataMinerEquivalentsPage.integration.test.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/features/owner/pages/OwnerDashboardPage.tsx`
- `apps/web/src/features/dashboards/pages/OperatingSystemHubPage.tsx`
**Verification:** file-level TypeScript diagnostics on `DataMinerEquivalentsPage.tsx`, `data-miner-utils.ts`, `DataMinerEquivalentsPage.integration.test.tsx`, `App.tsx`, `OwnerDashboardPage.tsx`, and `OperatingSystemHubPage.tsx`, `bun test apps/web/src/features/owner/lib/data-miner-utils.test.ts apps/web/src/features/owner/pages/__tests__/DataMinerEquivalentsPage.integration.test.tsx`, `bun run build`, and `bun run segment:gates --segment phase9-data-miner --ui` all passed. Gate report: `test-results/agent-gates/20260422T140931Z-phase9-data-miner.json`.
**Deployment:** `supabase db push` applied `355_owner_data_miner_equivalents.sql`; `supabase migration list` confirms remote migration `355`.
**Parity status update:** GAP → BUILT

## 2026-04-22 — Traffic Management Scope Decision (Cross-Cutting) — CLOSED
**Gap row:** `12`
**Gap description:** Traffic Management (equipment movement) not in QEP roadmap. IntelliDealer has dedicated module.
**Change type:** Scope Decision + Existing Surface Verification
**Files / evidence:**
- `supabase/migrations/078_traffic_logistics.sql`
- `supabase/migrations/191_command_center_operations.sql`
- `apps/web/src/features/ops/pages/TrafficTicketsPage.tsx`
- `apps/web/src/App.tsx`
- `docs/IntelliDealer/_Manifests/QEP-Cross-Cutting-Traffic-Management-Scope-Decision-20260422.md`
**Verification:** IntelliDealer `Traffic Management.pdf` + OCR reviewed against the committed QEP traffic implementation, file-level TypeScript diagnostics on `TrafficTicketsPage.tsx` and `App.tsx` passed, and the folded traffic surface was confirmed in ops, rental, branch, and COO layers through committed route/schema evidence.
**Decision:** close this as a folded implementation. QEP already chose the “integrate into existing ops/service/rental surfaces” path rather than building a separate standalone module.
**Deployment:** none required; traffic logistics route and schema were already deployed in earlier committed work.
**Parity status update:** GAP → BUILT / SCOPE RESOLVED

## 2026-04-22 — IntelliDealer Dependency Decommissioned (Phase-3_Parts) — CLOSED
**Gap row:** `2`
**Gap description:** VitalEdge / IntelliDealer API access blocker.
**Change type:** Product Decision + Runtime Decommission
**Files:**
- `supabase/migrations/356_decommission_hubspot_intellidealer.sql`
- `apps/web/src/App.tsx`
- `apps/web/src/components/IntegrationHub.tsx`
- `apps/web/src/components/IntegrationCard.tsx`
- `apps/web/src/components/IntegrationPanel.tsx`
- `apps/web/src/components/DataSourceBadge.tsx`
- `apps/web/src/lib/replaced-integrations.ts`
- `apps/web/src/lib/replaced-integrations.test.ts`
- `supabase/functions/integration-availability/index.ts`
- `supabase/functions/integration-test-connection/index.ts`
**Verification:** remote `integration_status` row for `intellidealer` now shows `status = demo_mode`, `config.lifecycle = replaced`, `replacement_surface = QEP Catalog + QRM`, and `external_dependency_required = false`; file-level TypeScript diagnostics on changed frontend files passed; `deno check supabase/functions/integration-availability/index.ts supabase/functions/integration-test-connection/index.ts`, `bun test apps/web/src/lib/replaced-integrations.test.ts`, and `bun run build` all passed.
**Deployment:** `supabase db push` applied `356_decommission_hubspot_intellidealer.sql`; `supabase functions deploy integration-availability` succeeded. The `integration-test-connection` deploy command was updated in code but its remote version still needs a later successful redeploy because the CLI stalled during this pass.
**Decision:** close this blocker as intentionally decommissioned. QEP will not wait on or rely on live IntelliDealer API access.
**Parity status update:** BLOCKER → CLOSED / REPLACED

## 2026-04-22 — HubSpot Dependency Decommissioned (Cross-Cutting) — CLOSED
**Gap row:** `3`
**Gap description:** HubSpot API key blocker.
**Change type:** Product Decision + Runtime Decommission
**Files:**
- `supabase/migrations/356_decommission_hubspot_intellidealer.sql`
- `apps/web/src/components/HubSpotConnectPage.tsx`
- `apps/web/src/components/IntegrationHub.tsx`
- `apps/web/src/components/IntegrationCard.tsx`
- `apps/web/src/components/IntegrationPanel.tsx`
- `apps/web/src/components/DataSourceBadge.tsx`
- `apps/web/src/lib/replaced-integrations.ts`
- `apps/web/src/lib/replaced-integrations.test.ts`
**Verification:** remote `integration_status` row for `hubspot` now shows `status = demo_mode`, `config.lifecycle = replaced`, `replacement_surface = QRM`, and `external_dependency_required = false`; `bun test apps/web/src/lib/replaced-integrations.test.ts` and `bun run build` passed; remote secret/config audit confirmed HubSpot credentials are no longer required for the core product posture.
**Deployment:** `supabase db push` applied `356_decommission_hubspot_intellidealer.sql`.
**Decision:** close this blocker as intentionally decommissioned. QRM is the CRM system of record; HubSpot is not a required future dependency.
**Parity status update:** BLOCKER → CLOSED / REPLACED
