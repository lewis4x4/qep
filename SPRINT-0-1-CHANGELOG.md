# Sprint 0 + Sprint 1 Change Log

**Date:** April 4, 2026
**Executed by:** BlackRock AI

---

## Sprint 0: Security Lockdown (8 fixes)

### 0.1 — CRITICAL: deal_composite workspace leak
**File:** `supabase/migrations/092_security_lockdown.sql`
- Rewrote `get_deal_composite()` to call `get_my_workspace()` and filter deals by workspace
- Added workspace filter to contact and company subqueries
- Without this fix, any authenticated user could read any deal by guessing UUIDs

### 0.2 — Service key exposure in meta-social and telematics-ingest
**Files:** `supabase/functions/meta-social/index.ts`, `supabase/functions/telematics-ingest/index.ts`
- Moved `supabaseAdmin` client creation inside conditional blocks
- Admin client now only instantiated when actually needed (service-role path or after user verification)

### 0.3 — nudge-scheduler workspace hardcoding
**File:** `supabase/functions/nudge-scheduler/index.ts`
- Changed profile query to include `workspace_id`
- Replaced `workspace_id: "default"` with `advisor.workspace_id` when creating notifications

### 0.4 — dge-optimizer workspace bypass
**File:** `supabase/functions/dge-optimizer/index.ts`
- Changed deal score update from `supabaseAdmin` to `supabase` (user-scoped client)
- RLS now enforces workspace isolation on the deal update
- Replaced `(supabaseAdmin as any)` casts with user-scoped `supabase` for needs_assessments and trade_valuations queries
- Replaced `(bestScenario?.expected_value as number)` with proper typeof check

### 0.5 — voice-to-qrm JSON.parse crash
**File:** `supabase/functions/voice-to-qrm/index.ts`
- Wrapped `JSON.parse(rawJson)` in try-catch
- Returns 422 with "Data extraction returned malformed JSON" on parse failure
- Logs first 500 chars of raw response for debugging

### 0.5b — voice-to-qrm workspace hardcoding
**File:** `supabase/functions/voice-to-qrm/index.ts`
- Changed profile query to include `workspace_id`
- Replaced `const workspace = "default"` with `const workspace = profile.workspace_id`

### 0.5c — voice-to-qrm error message leaking
**File:** `supabase/functions/voice-to-qrm/index.ts`
- Removed `err.message` from client response
- Now returns generic "Internal server error" while logging full error server-side

### 0.6 — portal-api IP spoofing
**File:** `supabase/functions/portal-api/index.ts`
- Replaced `x-forwarded-for` with proper header fallback chain:
  `cf-connecting-ip` → `x-real-ip` → first value of `x-forwarded-for` → "unknown"

### 0.7 — morning-briefing CORS standardization
**File:** `supabase/functions/morning-briefing/index.ts`
- Removed custom 12-line `corsHeaders()` function and `ALLOWED_ORIGINS` array
- Replaced with shared `safe-cors.ts` imports: `safeCorsHeaders`, `optionsResponse`

---

## Sprint 1: Schema Hardening + Type Safety (3 changes)

### 1.1 — Schema hardening migration
**File:** `supabase/migrations/093_schema_hardening.sql`
- Set `quote_packages.deal_id` to NOT NULL (cleaned orphan rows first)
- Added 4 missing indexes: `quote_packages(created_by)`, `catalog_entries(external_id)`, `needs_assessments(verified_by)`, `quote_signatures(quote_package_id)`
- Added CHECK constraint on `telematics_feeds` (must have equipment_id or subscription_id)
- Added `updated_at` column to `quote_signatures`
- Fixed `get_deposit_tier()` volatility: IMMUTABLE → STABLE
- Replaced 2PM nudge cron with NULL-guarded version (checks `current_setting` before firing)

### 1.2 — Type augmentation for migrations 068-091
**File:** `apps/web/src/lib/database-extensions.types.ts` (NEW)
- Created type definitions for 21 new tables not in generated types
- Tables: needs_assessments, follow_up_cadences, follow_up_touchpoints, deposits, demos, demo_inspections, prospecting_kpis, catalog_entries, quote_packages, quote_signatures, trade_valuations, equipment_intake, rental_returns, traffic_tickets, gl_routing_rules, predictive_visit_lists, telematics_readings, telematics_feeds, deal_scenarios, margin_waterfalls, social_accounts

**File:** `apps/web/src/lib/supabase.ts` (UPDATED)
- Changed `createClient<Database>` to `createClient<ExtendedDatabase>`
- Comment notes to switch back after running `supabase gen types`

### 1.3 — Eliminated all 31 `as any` casts
**Files (16 total):**
- `features/dge/components/PredictiveVisitList.tsx` — 1 cast removed
- `features/crm/components/DemoRequestCard.tsx` — 1 cast removed
- `features/crm/components/CadenceTimeline.tsx` — 1 cast removed
- `features/crm/components/NeedsAssessmentCard.tsx` — 1 cast removed
- `features/crm/components/ProspectingKpiCounter.tsx` — 1 cast removed
- `features/crm/components/PipelineDealCard.tsx` — 3 casts removed (type extended)
- `features/crm/pages/CrmHubPage.tsx` — 2 casts removed
- `features/crm/lib/types.ts` — Added slaDeadlineAt, depositStatus, depositAmount to CrmRepSafeDeal
- `features/dashboards/hooks/useDashboardData.ts` — 4 casts removed
- `features/ops/components/GLRoutingSuggestion.tsx` — 1 cast removed
- `features/ops/pages/RentalReturnsPage.tsx` — 1 cast removed
- `features/ops/pages/IntakeKanbanPage.tsx` — 2 casts removed
- `features/ops/pages/PaymentValidationPage.tsx` — 1 cast fixed (rpc type)
- `features/ops/pages/TrafficTicketsPage.tsx` — 1 cast removed
- `features/quote-builder/lib/quote-api.ts` — 2 casts removed
- `components/AdminPage.tsx` — 5 casts removed
- `components/SalesCommandCenter.tsx` — 1 cast removed
- `components/VoiceHistoryPage.tsx` — 1 cast removed
- `components/ChatPage.tsx` — 1 cast removed

---

## Files Changed Summary

| Category | Files Modified | Files Created |
|----------|---------------|---------------|
| Migrations | 0 | 2 (092, 093) |
| Edge Functions | 6 | 0 |
| Frontend Types | 2 | 1 |
| Frontend Components | 16 | 0 |
| **Total** | **24** | **3** |

## Next Steps

- **Run `supabase gen types`** to regenerate `database.types.ts` from live schema, then delete `database-extensions.types.ts`
- **Apply migrations 092 + 093** to staging, then production
- **Deploy modified edge functions** to staging for verification
- **Manual test:** Verify deal_composite workspace isolation
- **Manual test:** Verify nudge-scheduler creates notifications with correct workspace
- **Continue to Sprint 2:** Technical unblock (component extraction, query consolidation)
