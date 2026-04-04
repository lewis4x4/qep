# QEP OS — Post-Build Code Audit Report

**Date:** April 4, 2026
**Repository:** `lewis4x4/qep` on GitHub, `main` branch
**Current State:** 90 migrations, 43 edge functions, 538 TypeScript files, `tsc --noEmit` passes clean
**Auditor:** BlackRock AI

---

## Executive Summary

The codebase is structurally sound. TypeScript compiles clean, migrations are sequential, RLS is present on all user-facing tables, and two prior security audits addressed the most critical issues. However, this audit found **1 critical security vulnerability** (cross-workspace data leak in the deal composite RPC), **6 high-priority issues** (service key exposure, missing workspace isolation, type safety bypasses), and **21 medium-priority improvements** across frontend performance, error handling, and schema completeness.

The repo has also progressed beyond the original build session handoff — migrations now go to 090 and several new edge functions exist (`quote-builder-v2`, `deal-composite`, `nudge-scheduler`, `morning-briefing`, `meta-social`, `telematics-ingest`).

**Stale duplicate directory:** A `qep/` subdirectory exists at the repo root containing an older copy of parts of the codebase. This should be removed.

---

## CRITICAL FIXES REQUIRED (P0)

### P0-1: Cross-Workspace Data Leak in deal_composite RPC

**Impact:** Security | **Effort:** Low
**Location:** `supabase/migrations/086_deal_composite_rpc.sql`, lines 29-104

**Problem:** The `get_deal_composite()` SECURITY DEFINER function retrieves deal, contact, company, activities, and all related data by `p_deal_id` only — without verifying the deal belongs to the caller's workspace. Any authenticated user can read any deal's full data by guessing UUIDs.

**Fix:** New migration (091) required:

```sql
-- 091_fix_deal_composite_workspace.sql

create or replace function public.get_deal_composite(p_deal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace text;
  v_result jsonb;
begin
  -- Get caller's workspace
  v_workspace := public.get_my_workspace();

  -- Verify deal belongs to caller's workspace
  if not exists (
    select 1 from public.crm_deals
    where id = p_deal_id
      and workspace_id = v_workspace
      and deleted_at is null
  ) then
    return jsonb_build_object('error', 'Deal not found');
  end if;

  -- ... rest of existing function with workspace filter applied to all subqueries
end;
$$;
```

### P0-2: Service Role Key Exposed in Non-Service Paths

**Impact:** Security | **Effort:** Low
**Location:** `supabase/functions/meta-social/index.ts` line 32-35, `supabase/functions/telematics-ingest/index.ts` line 34

**Problem:** Both functions unconditionally create a `supabaseAdmin` client with the service role key, even when handling user-token requests. The admin client should only be instantiated inside the service-role code path.

**Fix:**
```typescript
// BEFORE (both files)
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// AFTER — only create admin client when needed
let supabaseAdmin: SupabaseClient | null = null;
if (isServiceRole) {
  supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}
```

### P0-3: Missing Workspace Isolation in nudge-scheduler

**Impact:** Security | **Effort:** Low
**Location:** `supabase/functions/nudge-scheduler/index.ts` line 70

**Problem:** Hardcodes `workspace_id: "default"` for notification creation. In multi-tenant deployment, this creates notifications in the wrong workspace or bypasses workspace RLS.

**Fix:** Derive workspace_id from the advisor's profile rather than hardcoding.

---

## HIGH PRIORITY FIXES (P1)

### P1-1: Unguarded JSON.parse in voice-to-qrm

**Impact:** Stability | **Effort:** Low
**Location:** `supabase/functions/voice-to-qrm/index.ts` line 233

**Problem:** `JSON.parse(rawJson)` without try-catch. If OpenAI returns malformed JSON, the entire function crashes with an unhandled exception.

**Fix:**
```typescript
let extracted: VoiceQrmExtraction;
try {
  extracted = JSON.parse(rawJson);
} catch (parseErr) {
  return new Response(JSON.stringify({
    error: 'Failed to parse AI extraction',
    partial: rawJson?.substring(0, 200)
  }), { status: 422, headers: corsHeaders });
}
```

### P1-2: Missing NOT NULL on quote_packages.deal_id

**Impact:** Data Integrity | **Effort:** Low
**Location:** `supabase/migrations/087_quote_builder_v2.sql` line 60

**Problem:** `deal_id uuid` is nullable. Quotes can become orphaned without a parent deal.

**Fix:** Migration 091+:
```sql
alter table public.quote_packages
  alter column deal_id set not null;
```

### P1-3: Unchecked Cron Job Configuration

**Impact:** Operational | **Effort:** Low
**Location:** `supabase/migrations/088_post_sale_automation.sql` lines 15-28

**Problem:** `cron.schedule()` uses `current_setting('app.settings.supabase_url')` and `current_setting('app.settings.service_role_key')` without NULL checks. If settings are unset, the cron job fails silently — the 2 PM prospecting nudge never fires.

**Fix:** Wrap in a `DO` block with NULL guards matching the pattern in migration 059/072.

### P1-4: dge-optimizer Updates Deal Without Workspace Check

**Impact:** Security | **Effort:** Low
**Location:** `supabase/functions/dge-optimizer/index.ts` line 248

**Problem:** Updates `crm_deals.dge_score` using admin client without verifying the deal belongs to the caller's workspace.

**Fix:** Use the user-scoped client for the deal update (RLS will enforce workspace), or add explicit workspace check before the admin update.

### P1-5: portal-api Accepts Client-Controlled IP Header

**Impact:** Security | **Effort:** Low
**Location:** `supabase/functions/portal-api/index.ts` line 204

**Problem:** `signer_ip: req.headers.get("x-forwarded-for")` — this header is client-spoofable in many deployment configurations. E-signature IP should come from a trusted source.

**Fix:** Use `req.headers.get("cf-connecting-ip")` (Cloudflare) or `req.headers.get("x-real-ip")` depending on deployment, with fallback chain.

### P1-6: Missing Indexes on New Tables

**Impact:** Performance | **Effort:** Low
**Location:** `supabase/migrations/087_quote_builder_v2.sql`, `090_social_telematics.sql`

**Missing indexes:**

```sql
-- 087: quote_packages
create index idx_packages_created_by on public.quote_packages(created_by) where created_by is not null;
create index idx_catalog_external_id on public.catalog_entries(external_id) where external_id is not null;

-- 090: needs_assessments
create index idx_needs_assessments_verified_by on public.needs_assessments(verified_by) where verified_by is not null;
```

---

## MEDIUM PRIORITY ISSUES (P2)

### Frontend — Type Safety

**32 instances of `as any` across the codebase.** Root cause: `database.types.ts` doesn't include the newer tables (086-090). Fix by regenerating types: `supabase gen types typescript` after deploying migrations.

Key locations:
- `apps/web/src/features/dashboards/hooks/useDashboardData.ts` — 4x `supabase as any`
- `apps/web/src/features/crm/pages/CrmHubPage.tsx` — 2x `supabase as any`
- `apps/web/src/components/SalesCommandCenter.tsx` — 1x `supabase as any`
- `supabase/functions/dge-optimizer/index.ts` — 2x `supabaseAdmin as any`
- `supabase/functions/pipeline-enforcer/index.ts` — 2x `deal as any`
- Portal pages (4 files) — `any` on mapped data arrays

**Fix:** Regenerate types, then replace all casts with typed queries.

### Frontend — Oversized Components

| Component | Lines | Recommended Split |
|-----------|-------|-------------------|
| IntegrationPanel.tsx | 2,651 | CredentialForm + HubSpotReconciliation + SyncScope + AuditPanel + wrapper |
| VoiceCapturePage.tsx | 2,028 | AudioRecorder + TranscriptDisplay + DealLookup + wrapper |
| CrmActivitiesPage.tsx | 1,966 | ActivityList + ActivityFilters + ApprovalWorkflow + wrapper (well-memoized, lower priority) |
| QuoteBuilderPage.tsx | 1,555 | CustomerStep + MachineStep + ReviewStep + wrapper |
| SalesCommandCenter.tsx | 1,308 | Extract section components |
| AdminPage.tsx | 1,255 | Extract tab panels |

### Frontend — Missing Error Handling

| Component | Issue |
|-----------|-------|
| SalesCommandCenter.tsx | No error UI for query failures. Zero toast notifications. |
| VoiceCapturePage.tsx | 6 error checks with `console.error` but only 1 user-facing toast |
| QuoteBuilderPage.tsx | `.catch(() => {})` empty catch on line 250 — swallows errors silently |
| AdminPage.tsx | No error boundary, no retry logic |

### Frontend — Missing Memoization

| Component | Issue |
|-----------|-------|
| VoiceCapturePage.tsx | `startRecording`, `stopRecording`, `resetCapture` handlers recreated every render — should use `useCallback` |
| IntegrationPanel.tsx | Zero memoization in 2,651 lines — form handlers and computed values recreated every render |
| AdminPage.tsx | Zero memoization in 1,255 lines |

### Frontend — Hardcoded Magic Numbers

Multiple files use raw millisecond values: `60_000`, `120_000`, `86_400_000`, `30_000`. Extract to:

```typescript
// lib/constants.ts
export const CACHE_TIMING = {
  SHORT: 15_000,
  MEDIUM: 30_000,
  LONG: 60_000,
  VERY_LONG: 120_000,
} as const;

export const TIME_MS = {
  HOUR: 3_600_000,
  DAY: 86_400_000,
  WEEK: 7 * 86_400_000,
} as const;
```

### Edge Functions — CORS Inconsistency

`morning-briefing/index.ts` uses custom CORS headers instead of the shared `safe-cors.ts` utility that was created specifically to eliminate this inconsistency. Consolidate to use `safeCorsHeaders`.

### Edge Functions — Error Message Leaking

`quote-builder-v2/index.ts` (line 257), `voice-to-qrm/index.ts` (line 552) return `err.message` to clients, potentially leaking internal details. Replace with generic messages.

### Database — Deposit Tier Function Volatility

`supabase/migrations/070_deposits.sql` line 101 marks the deposit calculation function as `IMMUTABLE`. If tier thresholds ever change, cached results won't be invalidated. Change to `STABLE`.

### Database — Missing CHECK Constraint on telematics_feeds

`supabase/migrations/090_social_telematics.sql` lines 34-35: Both `equipment_id` and `subscription_id` are nullable with no constraint requiring at least one. Add:
```sql
check ((equipment_id is not null or subscription_id is not null))
```

### Database — quote_signatures Missing updated_at

`supabase/migrations/087_quote_builder_v2.sql` lines 111-134: Table has `created_at` and `signed_at` but no `updated_at` column, violating CLAUDE.md conventions.

### Stale Repository Copy

A `qep/` directory at the repo root contains an older partial copy of the codebase (timestamped April 2). This should be removed to avoid confusion and prevent accidental edits to stale files.

### console.log Statements

10 `console.log` calls remain in production code (outside `node_modules`). Audit and remove or replace with structured logging.

### TODO/FIXME Comments

Two files have outstanding TODO markers:
- `supabase/functions/meta-social/index.ts` — TODO for actual Meta API integration
- `supabase/functions/hubspot-scheduler/index.ts` — existing TODO

---

## Verification Commands

```bash
# TypeScript type check (currently passes clean)
cd apps/web && npx tsc --noEmit

# Migration sequence check
bun run migrations:check

# Full build
bun run build

# Edge function type check
deno check supabase/functions/*/index.ts

# Find remaining as any casts after fix
grep -rn "as any" --include="*.ts" --include="*.tsx" apps/ supabase/ | grep -v node_modules | grep -v database.types

# Find console.log in production code
grep -rn "console\.log" --include="*.ts" --include="*.tsx" apps/ supabase/ | grep -v node_modules
```

---

## Priority Order for Fixes

1. **P0-1:** Fix deal_composite workspace leak (migration 091) — **BLOCKS DEPLOYMENT**
2. **P0-2:** Fix service key exposure in meta-social + telematics-ingest
3. **P0-3:** Fix nudge-scheduler workspace hardcoding
4. **P1-1 through P1-6:** JSON parse guard, NOT NULL, cron guards, workspace checks, indexes
5. **P2:** Regenerate types → eliminate `as any` → split oversized components → add error handling
6. **Cleanup:** Remove `qep/` directory, console.logs, TODO markers
