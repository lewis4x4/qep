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
