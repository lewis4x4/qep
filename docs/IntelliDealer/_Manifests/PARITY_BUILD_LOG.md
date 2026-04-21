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
