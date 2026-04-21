# Opening Assessment

**Date:** 2026-04-21  
**Repo:** `/Users/brianlewis/Projects/qep-knowledge-assistant`  
**Canonical manifest path:** `/Users/brianlewis/Projects/qep-knowledge-assistant/docs/IntelliDealer/_Manifests`  
**Official verification baseline:** committed `main` at `754bee963b303971153ae739203fe648cc73a021`  

## Verification Method

- Trusted only primary evidence: committed repo state, workbook cells, IntelliDealer phase `INDEX.md` files, PDFs/screenshots, and runnable repo checks.
- Treated `QEP_Codebase_Audit.md` and `PARITY_BUILD_SYSTEM_PROMPT.md` as guidance artifacts to verify, not as truth by default.
- Treated the current dirty working tree as unverified drift, not retirement truth.
- Performed manifest mirror verification between repo and Desktop copies for:
  - `PARITY_BUILD_SYSTEM_PROMPT.md`
  - `QEP_Codebase_Audit.md`
  - `IntelliDealer_Field_Inventory.json`
  - `QEP_Parity_Worksheet.xlsx`

## Assessment Verdict

**Verdict:** the parity framework artifacts are present and internally usable, and the committed codebase materially matches the audit at the module level, but the audit and prompt contain count/structure drift that must be corrected before parity execution is treated as fully grounded.

## Verified Facts

- Repo and Desktop copies of the four core parity artifacts listed above are byte-identical.
- The workbook structure matches the prompt assumptions. Verified sheets:
  - `Executive Summary`
  - `Field Parity Matrix`
  - `Gap Register`
  - `Phase Build Status`
- The workbook currently contains:
  - `Executive Summary`: 33 rows, 6 columns
  - `Gap Register`: 21 rows, 6 columns
  - `Field Parity Matrix`: 353 rows, 9 columns
  - `Phase Build Status`: 11 rows, 7 columns
- IntelliDealer source evidence is organized as expected. Verified phase entrypoints:
  - `Phase-1_CRM/INDEX.md`
  - `Phase-2_Sales-Intelligence/INDEX.md`
  - `Phase-3_Parts/INDEX.md`
  - `Phase-4_Service/INDEX.md`
  - `Phase-5_Deal-Genome/INDEX.md`
  - `Phase-6_Rental/INDEX.md`
  - `Phase-7_Trade-In/INDEX.md`
  - `Phase-8_Financial-Operations/INDEX.md`
  - `Phase-9_Advanced-Intelligence/INDEX.md`
  - `Cross-Cutting/INDEX.md`
- Sample IntelliDealer evidence files are present and aligned with the `INDEX.md` manifests, including:
  - `Phase-1_CRM/Customer Profile: Search and Listing.pdf`
  - `Phase-1_CRM/Prospect Board.pdf`
  - multiple CRM screenshots
  - `Phase-8_Financial-Operations` screenshots and PDF references for AR/AP, invoice history, billing queue, and customer pricing
- Committed `HEAD` currently contains:
  - `341` numbered `.sql` migration files under `supabase/migrations`
  - highest migration prefix `343`
  - `166` edge function directories under `supabase/functions`
  - `25` first-level feature directories under `apps/web/src/features`
- `bun run migrations:check` passes on the current tree with: `migration check passed: 341 files, sequence 001..343`
- Known migration gaps are explicitly allowlisted in `scripts/migration-gaps.json`: `[250, 251]`

## Spot Checks Against Committed HEAD

### Representative schema + function checks

- CRM foundation is present in committed history:
  - `supabase/migrations/021_crm_core.sql` creates `public.crm_companies`
  - the same migration enables RLS and defines workspace/role-aware policies on `crm_companies`
  - `supabase/functions/crm-hubspot-import/index.ts` exists
- Quote Builder foundation is present in committed history:
  - `supabase/migrations/167_wave5_closeout_tax_incentives.sql` creates `public.quote_tax_breakdowns`
  - `supabase/migrations/285_qb_programs.sql` creates `public.qb_programs`
  - `supabase/functions/qb-calculate/index.ts` exists
  - `apps/web/src/features/quote-builder` contains active feature code
- Parts foundation is present in committed history:
  - `supabase/migrations/108_service_tat_inventory_planner.sql` creates `public.parts_inventory`
  - `supabase/migrations/262_predictive_parts_plays.sql` creates `public.predicted_parts_plays`
  - `supabase/functions/ai-parts-lookup/index.ts` exists
  - `apps/web/src/features/parts` contains active feature code

### Random spot-check sample required by the system prompt

- Random migration sample verified present and readable:
  - `072_pipeline_enforcer_cron.sql`
  - `092_security_lockdown.sql`
  - `257_parts_intelligence_schema.sql`
- Random feature-module sample verified present and populated:
  - `apps/web/src/features/deal-timing`
  - `apps/web/src/features/dge`
  - `apps/web/src/features/sales`

## Drift Between Prompt/Audit and Committed Truth

- The audit states `343` migrations and the prompt speaks about a clean sequential migration chain. Committed truth is:
  - `341` numbered `.sql` files are present
  - highest prefix is `343`
  - `250` and `251` are absent from the repo and are allowlisted as known gaps
  - the migration checker passes because those two gaps are explicitly permitted
- The audit states `168 edge functions`. Committed `HEAD` contains `166` function directories.
- The audit states `27 feature modules`. Committed `HEAD` contains `25` first-level feature directories.
- The audit describes a monorepo structure with `packages/`. Committed `HEAD` has no top-level `packages/` directory.
- The prompt assumes schema/RLS tests live in `supabase/tests/`. The current repo has no `supabase/tests/` directory.
- The runtime state does not satisfy the prompt handoff checklist:
  - branch is `main`
  - working tree is dirty
  - current drift count is `31` modified files and `1` untracked path

## Verified Top 3 P0/P1 Items To Close First

1. **Phase-3 Parts — VitalEdge / IntelliDealer API access blocker**
   - Source: `QEP_Parity_Worksheet.xlsx` → `Gap Register` row 2
   - Verification: this is an external dependency blocker, not a missing-code claim the repo can close on its own
2. **Cross-Cutting — HubSpot API key blocker**
   - Source: `QEP_Parity_Worksheet.xlsx` → `Gap Register` row 3
   - Verification: `crm-hubspot-import` and `qrm-hubspot-import` exist in committed `HEAD`, so the blocker is plausibly credential/access, not absence of import code
3. **Phase-8 Financial Operations — QuickBooks GL posting not wired**
   - Source: `QEP_Parity_Worksheet.xlsx` → `Gap Register` row 4
   - Verification: repo-wide search found documentation references to QuickBooks and GL posting gaps, but no committed QuickBooks integration implementation. Existing billing-related functions are service-internal invoice posting/generation, not QuickBooks sync.

## Next Verified Internal Candidate After the Top 3

- **Phase-4 Service — mobile technician UX validation**
  - Source: `QEP_Parity_Worksheet.xlsx` → `Gap Register` row 5
  - Verification:
    - `apps/web/src/features/service` is populated and active
    - committed `HEAD` includes `ServiceDashboardPage.tsx` and broader service surfaces
    - only one service-local test file was found: `apps/web/src/features/service/lib/planner-rules.test.ts`
    - no committed Playwright/mobile viewport validation artifacts were found for service

## Framework Corrections Needed Before Execution

- Update parity execution assumptions to reflect the real migration state:
  - committed repo truth is `341` numbered migration files with known allowlisted gaps `250` and `251`
  - do not describe the repo as gapless today
- Update the audit’s structural counts:
  - edge functions: `166`, not `168`
  - feature directories: `25`, not `27`
  - no top-level `packages/` directory in committed `HEAD`
- Clarify official baseline language:
  - use committed `HEAD` as the parity truth baseline until the dirty working tree is cleaned or intentionally incorporated
- Correct the schema-test assumption:
  - `supabase/tests/` does not currently exist, so parity schema/RLS testing will need either a new location or a prompt adjustment before execution
- Normalize future parity-era ship reports to the `QEP-Phase-*-Ship-Report-*` naming convention from this point forward
- Freeze QEP-only moonshot surface expansion during parity execution unless a change directly supports or unblocks verified parity work

## Codebase State vs Audit

**Summary:** the audit is directionally right about major shipped surfaces existing across CRM, Quote Builder, Parts, and Service, but it is not exact enough to use as a literal execution baseline without correction.

**Matches observed:**

- CRM schema and HubSpot import surfaces exist
- Quote Builder schema, UI, and compute surfaces exist
- Parts schema, UI, and AI lookup surfaces exist
- Service feature surfaces exist and are non-trivial

**Drift observed:**

- counts and monorepo structure are stale
- migration chain description is overstated if interpreted as gapless
- test-path assumptions are incomplete for the current repo

Awaiting go-ahead to begin execution.
