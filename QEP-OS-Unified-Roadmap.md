# QEP OS — Unified Execution Roadmap

**Date:** April 4, 2026
**Repository:** `lewis4x4/qep` on GitHub, `main` branch
**Current State:** 90 migrations, 43 edge functions, 538 TypeScript files, tsc clean
**Source Documents:** Build Roadmap, Build Session Handoff, Builder Punch List, Code Audit Report
**Next Migration:** 091

---

## How This Roadmap Works

This is the single execution contract. It merges three inputs into one prioritized sequence:

1. **Audit fixes** — security vulnerabilities and code quality issues from the April 4 code audit
2. **Punch list** — the 9-item prioritized feature gap list from the roadmap review
3. **Next-level enhancements** — architectural and UX improvements that elevate QEP OS from "well-built backend" to "transformational dealership operating system"

Every sprint is designed to leave the system in a shippable state. No sprint depends on a future sprint to be usable.

**Execution rule:** Complete each sprint top to bottom. Do not skip sprints. Every sprint ends with the build gates passing.

---

## Sprint 0: Security Lockdown

**Duration:** 1 day
**Goal:** Fix every security vulnerability found in the code audit before any feature work
**Why first:** A single cross-workspace data leak is worse than any missing feature

### 0.1 — Fix deal_composite workspace leak (CRITICAL)

**File:** `supabase/migrations/091_security_lockdown.sql`

The `get_deal_composite()` SECURITY DEFINER function in migration 086 retrieves deal + contact + company + activities + DGE scenarios by `p_deal_id` only — without verifying the deal belongs to the caller's workspace. Any authenticated user can read any deal by guessing UUIDs.

```sql
-- Migration 091: Security lockdown

-- Fix 1: Add workspace check to deal composite RPC
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
  v_workspace := public.get_my_workspace();

  -- CRITICAL: Verify deal belongs to caller's workspace
  if not exists (
    select 1 from public.crm_deals
    where id = p_deal_id
      and workspace_id = v_workspace
      and deleted_at is null
  ) then
    return jsonb_build_object('error', 'Deal not found');
  end if;

  -- ... rebuild rest of function with v_workspace filter on all subqueries
end;
$$;
```

### 0.2 — Fix service key exposure in meta-social and telematics-ingest

Both functions unconditionally create a `supabaseAdmin` client with the service role key, even on user-token requests.

**Files:**
- `supabase/functions/meta-social/index.ts` line 32-35
- `supabase/functions/telematics-ingest/index.ts` line 34

**Fix:** Move admin client creation inside the `if (isServiceRole)` block.

### 0.3 — Fix nudge-scheduler workspace hardcoding

**File:** `supabase/functions/nudge-scheduler/index.ts` line 70

Hardcodes `workspace_id: "default"`. Derive from the advisor's profile instead.

### 0.4 — Fix dge-optimizer workspace bypass

**File:** `supabase/functions/dge-optimizer/index.ts` line 248

Updates `crm_deals.dge_score` using admin client without workspace check. Use the user-scoped client so RLS enforces workspace.

### 0.5 — Fix voice-to-qrm JSON.parse crash

**File:** `supabase/functions/voice-to-qrm/index.ts` line 233

Wrap `JSON.parse(rawJson)` in try-catch. Return 422 with partial context on parse failure.

### 0.6 — Fix portal-api IP spoofing

**File:** `supabase/functions/portal-api/index.ts` line 204

Replace `x-forwarded-for` with `cf-connecting-ip` (Cloudflare) or `x-real-ip` with fallback chain for e-signature IP capture.

### 0.7 — Fix error message leaking

**Files:**
- `supabase/functions/quote-builder-v2/index.ts` line 257
- `supabase/functions/voice-to-qrm/index.ts` line 552

Replace `err.message` in client responses with generic error messages. Log full error server-side.

### 0.8 — Standardize CORS

**File:** `supabase/functions/morning-briefing/index.ts` lines 13-24

Replace custom CORS headers with shared `safe-cors.ts` utility.

### Sprint 0 Build Gates

- [ ] Migration 091 applied
- [ ] All modified edge functions pass `deno check`
- [ ] `tsc --noEmit` passes in `apps/web`
- [ ] Manual test: authenticated user cannot read deal from another workspace via deal-composite RPC
- [ ] Manual test: nudge-scheduler creates notifications with correct workspace_id

---

## Sprint 1: Schema Hardening + Type Regeneration

**Duration:** 1 day
**Goal:** Fix all database integrity issues and eliminate every `as any` cast in the frontend
**Why second:** The 32 `as any` casts are the root cause of most type safety issues, and they all stem from one problem — types weren't regenerated after migrations 086-090

### 1.1 — Database fixes (migration 092)

```sql
-- Migration 092: Schema hardening

-- Fix nullable deal_id on quote_packages
alter table public.quote_packages
  alter column deal_id set not null;

-- Add missing indexes
create index if not exists idx_packages_created_by
  on public.quote_packages(created_by) where created_by is not null;
create index if not exists idx_catalog_external_id
  on public.catalog_entries(external_id) where external_id is not null;
create index if not exists idx_needs_assessments_verified_by
  on public.needs_assessments(verified_by) where verified_by is not null;

-- Fix deposit tier function volatility (IMMUTABLE → STABLE)
-- Recreate function with STABLE to prevent stale cached results
-- (copy existing function body from migration 070, change IMMUTABLE to STABLE)

-- Add CHECK constraint on telematics_feeds
alter table public.telematics_feeds
  add constraint telematics_feeds_has_target
  check ((equipment_id is not null or subscription_id is not null));

-- Add updated_at to quote_signatures
alter table public.quote_signatures
  add column if not exists updated_at timestamptz not null default now();

-- Add cron NULL guards for post-sale-automation (migration 088 pattern)
-- Wrap cron.schedule calls in DO block with setting existence checks
```

### 1.2 — Fix cron configuration guards

**File:** `supabase/migrations/088_post_sale_automation.sql` pattern

The `cron.schedule()` calls use `current_setting()` without NULL checks. If settings are unset, the 2 PM prospecting nudge and post-sale automation silently fail. Add DO block with NULL guards matching migration 059/072 pattern.

### 1.3 — Regenerate TypeScript types

```bash
supabase gen types typescript --project-id xbfzymdhlfhfhaqhawzs --schema public > apps/web/src/lib/database.types.ts
```

This single command eliminates the root cause of all 32 `as any` casts. After regeneration:

### 1.4 — Replace all `as any` casts with typed queries

**32 instances across 15 files.** After type regeneration, systematically replace:

| File | Casts | Fix |
|------|-------|-----|
| `features/dashboards/hooks/useDashboardData.ts` | 4x `supabase as any` | Use typed `supabase` directly (tables now in types) |
| `features/crm/pages/CrmHubPage.tsx` | 2x `supabase as any` | Same |
| `components/SalesCommandCenter.tsx` | 1x `supabase as any` | Same |
| `features/crm/components/DemoRequestCard.tsx` | 1x `supabase as any` | Same |
| `features/crm/components/CadenceTimeline.tsx` | 1x `supabase as any` | Same |
| `features/crm/components/NeedsAssessmentCard.tsx` | 1x `supabase as any` | Same |
| `features/crm/components/ProspectingKpiCounter.tsx` | 1x `supabase as any` | Same |
| `features/crm/components/PipelineDealCard.tsx` | 3x `effectiveDeal as any` | Type the deal interface with SLA/deposit fields |
| `features/dge/components/PredictiveVisitList.tsx` | 2x | Same |
| `features/portal/pages/*` | 4x `any` on mapped arrays | Type the portal API response interfaces |
| `features/dashboards/pages/*` | 3x `any` on mapped data | Type from regenerated types |
| `features/ops/components/*` | 3x | Same |
| `supabase/functions/dge-optimizer/index.ts` | 2x `supabaseAdmin as any` | Create typed admin client |
| `supabase/functions/pipeline-enforcer/index.ts` | 2x `deal as any` | Type the joined query result |
| `supabase/functions/follow-up-engine/index.ts` | 1x `unknown as` | Type the touchpoint interface |

### 1.5 — Remove stale qep/ directory

```bash
rm -rf qep/
```

The `qep/` directory at repo root is a stale partial copy from April 2. Removing it eliminates 269 duplicate files that could cause confusion.

### 1.6 — Clean up console.log statements

10 `console.log` calls remain in production code. Remove or replace with structured logging.

### Sprint 1 Build Gates

- [ ] Migration 092 applied
- [ ] `supabase gen types typescript` run successfully
- [ ] Zero `as any` casts remaining (verify: `grep -rn "as any" apps/ supabase/ | grep -v node_modules | grep -v database.types | wc -l` returns 0)
- [ ] `tsc --noEmit` passes
- [ ] `bun run build` passes
- [ ] `qep/` directory removed

---

## Sprint 2: Technical Unblock

**Duration:** 2-3 days
**Goal:** Decompose the monolithic components and optimize queries so subsequent feature sprints don't fight the codebase
**Why third:** Every feature sprint after this touches the pipeline page, deal detail page, or dashboard hooks. These must be clean first.

### 2.1 — Extract CrmPipelinePage components

**Current:** `apps/web/src/features/crm/pages/CrmPipelinePage.tsx` — referenced at 980 lines in the `qep/` copy, likely larger in main

**Extract into:**

| New File | Contents | Est. Lines |
|----------|----------|------------|
| `components/PipelineDealCard.tsx` | Already exists — verify it's fully extracted with `React.memo` |
| `components/PipelineStageColumn.tsx` | `DroppableStageColumn` with stage header, deal count, SLA summary |
| `components/PipelineSwimLanes.tsx` | Pre-Sale / Close / Post-Sale lane logic |
| `hooks/usePipelineStages.ts` | Stage filtering, grouping, deal-to-stage mapping |
| `hooks/useDealDragDrop.ts` | DndContext setup, optimistic update, error rollback, gate validation |
| `CrmPipelinePage.tsx` | Thin orchestrator importing above | < 150 lines |

### 2.2 — Consolidate deal detail queries

**Current:** Deal detail page fires 8 separate queries
**Target:** Single `deal-composite` edge function call (already exists — migration 086 + `supabase/functions/deal-composite/index.ts`)

After Sprint 0 fixes the workspace check, wire the frontend deal detail page to use this composite endpoint instead of 8 individual queries.

### 2.3 — Fix follow-up engine N+1

**Current:** `supabase/functions/follow-up-engine/index.ts` makes ~250 queries per hourly cron run
**Target:** < 10 queries regardless of touchpoint count

Batch-fetch all pending touchpoints with JOINs to deals, contacts, and assessments. Pre-fetch workspace Iron Managers once (pipeline-enforcer already does this — port the pattern).

### 2.4 — Lazy-load react-markdown

**Current:** `react-markdown` (153KB) bundled in main chunk, only used in ChatPage
**Fix:**

```typescript
const ChatPage = React.lazy(() => import('./ChatPage'));

// In router
<Suspense fallback={<LoadingSpinner />}>
  <ChatPage />
</Suspense>
```

### 2.5 — Extract constants

Create `apps/web/src/lib/constants.ts`:

```typescript
export const CACHE_TIMING = {
  REALTIME: 15_000,
  ACTIVE: 30_000,
  STANDARD: 60_000,
  STABLE: 120_000,
} as const;

export const TIME_MS = {
  HOUR: 3_600_000,
  DAY: 86_400_000,
  WEEK: 7 * 86_400_000,
} as const;
```

Replace all hardcoded millisecond values across the codebase.

### Sprint 2 Build Gates

- [ ] `CrmPipelinePage.tsx` < 200 lines
- [ ] Deal detail page makes 1-2 requests (down from 8)
- [ ] `follow-up-engine` makes < 10 DB queries per cron run
- [ ] Main bundle reduced by ~150KB (react-markdown lazy-loaded)
- [ ] Zero hardcoded millisecond values outside `constants.ts`
- [ ] `bun run build` passes
- [ ] Existing pipeline drag-and-drop, SLA countdown, deposit badges all still work

---

## Sprint 3: Quote Builder V2 — Flagship Workflow

**Duration:** 5-7 days
**Goal:** Make Quote Builder the first feature owners can demo, use, and tie to revenue
**Punch List Item:** #1

### 3.1 — Zero-blocking manual catalog

The `catalog_entries` table and `quote-builder-v2` edge function already exist (migration 087). What's needed:

- CSV bulk-import admin UI for manual inventory
- Catalog query adapter that checks IntelliDealer first, falls back to `catalog_entries`
- Clear live/manual status indicator in the UI

### 3.2 — Three entry modes

| Mode | Implementation |
|------|---------------|
| Voice | Reuse `voice-to-qrm` transcription pipeline → extract equipment, pricing, trade-in, financing prefs → auto-populate quote fields |
| AI Chat | Text input → same extraction schema → auto-populate |
| Traditional Form | Manual field entry — the existing form, cleaned up and decomposed from the 1,555-line `QuoteBuilderPage.tsx` |

**QuoteBuilderPage.tsx decomposition:**

| New File | Contents |
|----------|----------|
| `QuoteEntryMode.tsx` | Voice/Chat/Form mode selector |
| `QuoteCustomerStep.tsx` | Customer selection + contact lookup |
| `QuoteMachineStep.tsx` | Catalog search + AI recommendation + attachment suggestions |
| `QuoteFinancingPreview.tsx` | 3-scenario financing panel from `financing_rate_matrix` |
| `QuoteTradeIn.tsx` | Pull-through from `trade_valuations` system |
| `QuoteReviewStep.tsx` | Summary + margin check + approval routing |
| `QuoteBuilderPage.tsx` | Thin step router |

### 3.3 — Financing preview

Query `financing_rate_matrix` table (already exists) and display 3 scenarios side by side:
- Cash price
- 60-month finance (monthly payment, total cost, APR)
- 48-month lease (monthly payment, residual, buyout)

### 3.4 — Trade-in pull-through

When a deal has a `trade_valuations` record, pre-populate the trade-in section of the quote with: make, model, year, hours, preliminary value, conditional language.

### 3.5 — Margin check UI

The `enforce_margin_check` trigger already fires at stage 13. Build:
- Margin waterfall mini-visualization in the quote review step
- Clear "Requires Iron Manager Approval" state when margin < 10%
- Approval routing notification to Iron Managers

### 3.6 — Proposal PDF generation

4-page branded proposal:
1. Cover page (QEP branding, customer name, date, advisor)
2. Equipment details (photos, specs, attachments)
3. Pricing (base, trade-in, financing options, total)
4. Terms (conditional language, deposit requirements, next steps)

Use `@react-pdf/renderer` in the `quote-builder-v2` edge function or a dedicated `quote-pdf` function.

### 3.7 — Quote package auto-send

Per SOP: quote + photos + brochure + credit application + video link. Build a "Send Package" button that assembles and delivers via email.

### 3.8 — E-signature at step 13

The `quote_signatures` table exists (migration 087). Build:
- Signature capture UI (HTML5 Canvas or typed name)
- Signer name, IP (from trusted header), timestamp auto-captured
- State machine: draft → sent → viewed → signed
- Signed quote blocks further modification

### Sprint 3 Acceptance Criteria

- [ ] Quote Builder works without IntelliDealer (manual catalog mode)
- [ ] Voice entry populates all quote fields from audio
- [ ] AI chat entry populates all quote fields from text
- [ ] Traditional form entry works as manual fallback
- [ ] Financing preview shows 3 scenarios from `financing_rate_matrix`
- [ ] Trade-in valuation pulls through from Phase 2 system
- [ ] 4-page branded proposal PDF generated
- [ ] Margin check surfaces at review step, routes < 10% to Iron Manager
- [ ] E-signature captures signer name, IP, timestamp
- [ ] `QuoteBuilderPage.tsx` decomposed to < 200 lines

---

## Sprint 4: Role Command Centers

**Duration:** 5-7 days
**Goal:** Every Iron role logs in and sees THEIR system, not a generic CRM
**Punch List Item:** #3

### 4.1 — Iron Manager Dashboard

| Component | Data Source |
|-----------|------------|
| Pipeline health (all reps) | `crm_deals` grouped by `assigned_to` + stage distribution |
| Team KPI scoreboard | `prospecting_kpis` for all reps in workspace |
| Approval queue | `demos` (requested) + `trade_valuations` (manager_review) + `crm_deals` (margin flagged) |
| Inventory aging alerts | `crm_equipment` with age > 90 days |
| Revenue forecast | `dge_score × deal_value` aggregated 30/60/90 day |

### 4.2 — Iron Advisor Dashboard

| Component | Data Source |
|-----------|------------|
| Personal 21-step pipeline | Existing pipeline board filtered to `assigned_to = auth.uid()` |
| Daily task queue | Merged: pending touchpoints + overdue follow-ups + prospecting needed |
| Follow-up countdown queue | `follow_up_touchpoints` where pending + due within 3 days |
| Prospecting counter | Existing `ProspectingKpiCounter` component |
| Morning briefing | `predictive_visit_lists` for today (foundation for Sprint 7 DGE cockpit) |

### 4.3 — Iron Woman Dashboard

| Component | Data Source |
|-----------|------------|
| Order processing queue | Deals in stages 13-16 |
| Deposit tracker | `deposits` grouped by status |
| Equipment intake Kanban | `equipment_intake` by `current_stage` (8 stages) |
| Credit app tracker | Deals in stage 14 |
| Invoice status | Deals in stage 20 / `customer_invoices` |

### 4.4 — Iron Man Dashboard

| Component | Data Source |
|-----------|------------|
| Equipment prep queue | `equipment_intake` stages 2-4 |
| PDI checklists | `equipment_intake` where `pdi_completed = false` |
| Demo schedule | `demos` where approved/scheduled, with prep tasks |
| Rental return inspections | `rental_returns` where `inspection_pending` |

### 4.5 — Dashboard routing

On login, check `get_my_iron_role()` and route to the appropriate dashboard. Add a role switcher for users who need to see other views (Iron Manager should be able to view any role's dashboard).

### 4.6 — Next-level enhancement: Real-time dashboard updates

Add Supabase Realtime subscriptions to each dashboard, filtered by workspace:

```typescript
supabase.channel('manager-deals')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'crm_deals',
    filter: `workspace_id=eq.${workspaceId}`
  }, handleDealChange)
  .subscribe();
```

This makes dashboards feel alive — new leads appear instantly, stage transitions animate in real-time, KPI counters tick up without refresh.

### Sprint 4 Acceptance Criteria

- [ ] Iron Manager sees pipeline health, KPI scoreboard, approval queue, aging alerts
- [ ] Iron Advisor sees personal pipeline, task queue, follow-up countdowns, prospecting counter
- [ ] Iron Woman sees order processing, deposits, intake Kanban, credit apps
- [ ] Iron Man sees prep queue, PDI checklists, demo schedule, rental inspections
- [ ] Login routes to correct dashboard based on Iron role
- [ ] Dashboards update in real-time via Supabase Realtime

---

## Sprint 5: Post-Sale Automation Wiring

**Duration:** 2-3 days
**Goal:** Complete the voice→escalation pipeline and the 2 PM prospecting nudge
**Punch List Item:** #4

### 5.1 — Voice → escalation pipeline

Extend `voice-to-qrm` extraction schema to detect escalation intent (keywords: "problem", "issue", "complaint", department references). When detected:

1. Complete the relevant touchpoint
2. Create escalation ticket via `escalation-router`
3. Generate email draft (add `email_draft_subject` + `email_draft_body` columns to `escalation_tickets` if not already in migration 088)
4. Create follow-up task for the advisor

### 5.2 — 2 PM prospecting nudge

The `nudge-scheduler` edge function exists. Wire it to:
- Run daily at 2 PM local time
- Check `prospecting_kpis` for each Iron Advisor
- If `positive_visits < 5` (50% of daily target), create notification
- Iron Manager gets summary of all advisors under target

### 5.3 — Pre-generate follow-up content

Currently `follow-up-engine` calls OpenAI on every cron run for every pending touchpoint.

**Change to:**
- When cadence is created, pre-generate `suggested_message` for first 4 touchpoints
- When a touchpoint enters 48-hour window, regenerate with fresh deal context
- Cron run only processes touchpoints that already have content

### 5.4 — Next-level enhancement: Escalation intelligence

When an escalation ticket is created from voice, use the deal context + customer history to:
- Auto-identify the department manager (from `profiles` + department mapping)
- Score escalation severity based on customer LTV and issue frequency
- Suggest resolution approach based on similar past escalations

### Sprint 5 Acceptance Criteria

- [ ] Voice command with escalation intent creates: email draft + task + ticket
- [ ] 2 PM nudge fires for advisors under 50% of daily target
- [ ] Iron Manager receives summary of under-target advisors
- [ ] Follow-up content pre-generated at cadence creation
- [ ] Follow-up engine cron run < 5 seconds for 100 touchpoints

---

## Sprint 6: Mobile Field Operations

**Duration:** 5-7 days
**Goal:** Equipment intake, traffic, driver workflows, rental returns — all mobile-first
**Punch List Item:** #5

### 6.1 — Equipment intake Kanban

8-stage board using `@dnd-kit` (already installed):
- Each card: stock number, equipment name, stage checklist progress, photo count
- Drag-and-drop progression triggers `track_intake_stage_change()`
- Mobile: horizontal scroll with snap-to-column
- Photo requirements enforced per stage

### 6.2 — PDI tap-through checklist

Mobile-optimized checklist from `pdi_checklist` jsonb:
- Each item: tap to complete, camera icon for photo evidence
- Photo upload to Supabase Storage
- Progress bar showing completion percentage
- Blocks stage progression until `pdi_completed = true`

### 6.3 — Traffic ticket + driver workflow

- Traffic ticket list with color-coded status (gray → yellow → orange → red)
- Auto-creation confirmed working at stage 18 (trigger exists)
- **Driver mobile view:**
  - Step-by-step checklist from `driver_checklist` jsonb
  - GPS via browser Geolocation API → `delivery_lat`/`delivery_lng`
  - Signature: HTML5 Canvas pad → Supabase Storage → `delivery_signature_url`
  - Photo upload: delivery photos + hour meter
  - `traffic_ticket_auto_lock()` renders read-only for requestors after submission

### 6.4 — Rental return branching workflow

Wizard-style mobile UI:
1. Inspection (Iron Man): checklist + photos
2. Decision (Rental Asset Manager): clean or damaged?
3a. Clean: credit invoice, deposit refund processing
3b. Damaged: work order → charge calculation → deposit comparison → balance/refund
- Refund method must match `original_payment_method`

### 6.5 — Payment validation

Hook into invoice/payment creation:
- Call `validate_payment()` before processing
- Show pass/fail with rule explanation
- Override option for A/R role with documented reason

### 6.6 — GL auto-suggestion

Query `gl_routing_rules` based on context:
- Show suggested GL code with explanation
- SALEW001: prominent warning + ownership approval gate

### 6.7 — Next-level enhancement: Offline-first field ops

Field workers lose cell signal. Build offline capability:
- Service Worker caches checklist data and photos locally
- Completed checklists and photos sync when connection returns
- Visual indicator: "3 items pending sync"
- Conflict resolution: server wins, but local changes shown for review

### Sprint 6 Acceptance Criteria

- [ ] Equipment intake Kanban with 8 stages, drag-and-drop, photos
- [ ] PDI tap-through checklist with photo evidence on mobile
- [ ] Traffic ticket auto-created at stage 18 with pre-filled data
- [ ] Driver workflow: checklist, GPS, signature, photos — all from phone
- [ ] Rental return branching: clean vs damaged paths
- [ ] Payment validation enforced with SOP rules
- [ ] GL auto-suggestion with SALEW001 ownership gate

---

## Sprint 7: DGE Intelligence Cockpit

**Duration:** 5-7 days
**Goal:** Make the Deal Genome Engine visible — every deal shows its optimization scenarios
**Punch List Item:** #6

### 7.1 — DGE panel on deal detail

Three scenario cards side by side on the deal detail page (now loading fast via composite endpoint from Sprint 2):

| Conservative | Balanced | Aggressive |
|-------------|----------|------------|
| Max margin | Best expected value | Max close probability |
| Lower close prob | Optimized 14 variables | Min acceptable margin |

Each card: equipment price, trade allowance, attachments, financing terms, service contract, total margin.

### 7.2 — Margin waterfall visualization

Cascade chart showing: Base Price → Trade Allowance → Attachments → Financing Impact → Incentives → Service Contract → Net Margin

Color-coded: green for margin-positive, red for margin-negative. Target margin band overlay (10% min, 20-25% ideal).

Use `recharts` (already installed as dependency).

### 7.3 — "Why this scenario" explanations

Expandable section under each scenario card showing which of the 14 variables most influenced the recommendation, with natural-language explanation.

### 7.4 — Predictive visit list

Iron Advisor morning briefing (from Sprint 4 dashboard):
- Query `predictive_visit_lists` for today
- 10 customers ranked by: overdue follow-ups, fleet replacement, seasonal demand, competitive displacement, geographic clustering, inventory matching, incentive windows, lifecycle signals
- Map view with route optimization (Google Maps embed or Mapbox)

### 7.5 — Ownership intelligence dashboard

Extends Iron Manager dashboard (Sprint 4):
- Margin analytics: avg margin by rep, by equipment category, by month
- Pipeline intelligence: weighted pipeline value, velocity by stage
- Revenue forecast: 30/60/90-day projections with accuracy tracking
- Manufacturer incentive alerts within 24 hours of availability

### 7.6 — Next-level enhancement: DGE learning loop

Track which scenario the advisor actually uses and whether the deal closed:
- Store advisor selection in `deal_feedback` table (exists)
- After deal closes (or is lost), score DGE accuracy
- Feed accuracy data back to improve scenario generation
- Show DGE confidence level: "This model has been 78% accurate on similar deals"

### Sprint 7 Acceptance Criteria

- [ ] 3 scenario cards visible on every deal detail page
- [ ] Margin waterfall visualization per deal
- [ ] "Why this scenario" explanations tied to 14 variables
- [ ] Predictive visit list with map for Iron Advisors
- [ ] Ownership dashboard: margin analytics, forecasting, KPI scoreboard
- [ ] Manufacturer incentive alerts within 24 hours

---

## Sprint 8: Customer Portal Frontend

**Duration:** 5-7 days
**Goal:** Convert the full portal backend into a customer-facing experience
**Punch List Item:** #7

### 8.1 — Portal auth flow

Separate login for portal customers using `portal_customers` + Supabase Auth. Portal-specific layout with QEP branding.

### 8.2 — Fleet dashboard

Customer's equipment with warranty status, service history, maintenance schedules.

### 8.3 — Service request submission

Form with photo upload, department routing, urgency levels. Uses `portal-api` /service-requests endpoint.

### 8.4 — Parts ordering

Browse consumables, AI-suggested PM kits based on equipment and maintenance schedule. Shopping cart → order submission.

### 8.5 — Invoice/payment view

Outstanding invoices with balance due, payment history, statement download.

### 8.6 — Quote review + e-signature

View proposal, accept/reject with e-signature. State machine: sent → viewed → accepted.

### 8.7 — Next-level enhancement: Customer notifications

Push notifications (or email) when:
- Service request status changes
- Parts order ships
- New quote is available for review
- Maintenance is due on their equipment
- New equipment matching their fleet profile arrives in inventory

### Sprint 8 Acceptance Criteria

- [ ] Customers log in via separate portal auth
- [ ] Fleet dashboard shows equipment + warranty + service history
- [ ] Service requests submit with photos
- [ ] Parts ordering with AI PM kit suggestions
- [ ] Invoice view with payment capability
- [ ] Quote review with e-signature
- [ ] Customer sees only their own data (dual RLS verified)

---

## Sprint 9: Pipeline Board Polish

**Duration:** 2-3 days
**Goal:** Complete the Kanban experience
**Punch List Item:** #8

### 9.1 — Card reordering within columns

Using `@dnd-kit/sortable` (already installed). Add `sort_position` column to `crm_deals`:

```sql
-- Migration 093
alter table public.crm_deals
  add column if not exists sort_position integer default 0;
```

### 9.2 — Multi-select drag

Maintain `Set<dealId>` state. Selected cards drag together. Visual highlight on selected cards.

### 9.3 — Gate validation in drag UI

When dragging to a gated stage (17+ without deposit, 13 without margin check):
- Visual rejection animation
- Toast with specific missing requirement
- Rollback to original position

### 9.4 — Next-level enhancement: Pipeline analytics overlay

Toggle-able overlay on the pipeline board showing:
- Average time in each stage (color-coded: green < SLA, red > SLA)
- Conversion rate between stages
- Bottleneck identification (stages where deals pile up)
- Pipeline velocity trend (improving/declining)

### Sprint 9 Acceptance Criteria

- [ ] Cards reorder within columns (sort position persisted)
- [ ] Multiple cards selected and dragged together
- [ ] Gated stages show visual rejection with explanation
- [ ] No jank with 50+ visible deal cards

---

## Sprint 10: Social / Telematics / Deeper Autonomy

**Duration:** 3-5 days
**Goal:** Wire remaining integrations and close autonomy gaps
**Punch List Item:** #9

### 10.1 — Meta API integration

The `meta-social` function and `social_media_posts` table exist. Wire actual Facebook Marketplace posting via Meta Graph API. Start with manual-triggered posts, then automate via inventory event triggers.

### 10.2 — Telematics integration

`eaas_usage_records` and `telematics_feeds` tables exist. Build adapter pattern with provider-specific connectors. Start with manual hour entry, add device sync as credentials become available.

### 10.3 — Needs assessment accuracy tracking

Add verification workflow:
- After voice-to-QRM creates assessment, Iron Advisor reviews and corrects
- Track `fields_corrected / total_fields` per capture
- Aggregate accuracy against 90% target
- Dashboard showing accuracy trend over time

### 10.4 — Next-level enhancement: Autonomous inventory intelligence

When new equipment arrives:
1. Auto-match to customers with expressed interest (from needs assessments)
2. Auto-generate personalized outreach content
3. Auto-create campaign targeting matched customers
4. Auto-suggest pricing based on market comps and inventory age
5. Alert Iron Manager when equipment hits aging threshold with suggested action (discount, auction, dealer transfer)

### Sprint 10 Acceptance Criteria

- [ ] Facebook Marketplace posting works (manual trigger)
- [ ] Telematics manual hour entry functional
- [ ] Needs assessment accuracy tracking operational
- [ ] Inventory event triggers → campaign auto-creation

---

## Sprint 11: Component Splitting + Error Handling Cleanup

**Duration:** 3-5 days
**Goal:** Split remaining monolithic components and add consistent error handling
**Why last:** These are code quality improvements that don't add features but make everything more maintainable

### 11.1 — Split oversized components

| Component | Lines | Split Into |
|-----------|-------|------------|
| IntegrationPanel.tsx | 2,651 | CredentialForm + HubSpotReconciliation + SyncScope + AuditPanel + wrapper |
| VoiceCapturePage.tsx | 2,028 | AudioRecorder + TranscriptDisplay + DealLookup + wrapper |
| CrmActivitiesPage.tsx | 1,966 | ActivityList + Filters + ApprovalWorkflow + wrapper |
| SalesCommandCenter.tsx | 1,308 | Extract section components |
| AdminPage.tsx | 1,255 | Extract tab panels |

### 11.2 — Add error handling everywhere

| Component | Fix |
|-----------|-----|
| SalesCommandCenter | Add error UI + toast for query failures |
| VoiceCapturePage | Replace `console.error` with user-facing toasts |
| QuoteBuilderPage | Remove empty `.catch(() => {})`, add retry UI |
| AdminPage | Add error boundary + retry logic |
| All query components | Standardize: `isError` → toast + retry button |

### 11.3 — Add memoization

| Component | Fix |
|-----------|-----|
| VoiceCapturePage | `useCallback` on `startRecording`, `stopRecording`, `resetCapture` |
| IntegrationPanel | `useMemo` on form handlers and computed values |
| AdminPage | `useMemo` on filtered lists, `useCallback` on handlers |

### 11.4 — Add error boundaries

Wrap each major route in an error boundary:
```typescript
<ErrorBoundary fallback={<ErrorFallback />}>
  <Route path="/pipeline" element={<CrmPipelinePage />} />
</ErrorBoundary>
```

### Sprint 11 Acceptance Criteria

- [ ] No component over 500 lines (except CrmActivitiesPage at ~400 if well-structured)
- [ ] Every query-dependent component shows loading + error + empty states
- [ ] Error boundaries at every route
- [ ] Zero empty `.catch()` blocks
- [ ] `bun run build` passes

---

## Appendix A: Migration Sequence

| # | Sprint | Purpose |
|---|--------|---------|
| 091 | 0 | Security lockdown (deal composite workspace check) |
| 092 | 1 | Schema hardening (NOT NULL, indexes, constraints, volatility) |
| 093 | 9 | Pipeline sort_position column |

Additional migrations may be needed within sprints — follow `NNN_snake_case_name.sql` convention.

## Appendix B: Build Gates (Every Sprint)

1. `bun run migrations:check`
2. `bun run build` from repo root
3. `bun run build` in `apps/web`
4. `deno check` on all touched edge functions
5. `tsc --noEmit` in `apps/web`
6. RLS verification on new/modified tables
7. Role/workspace security checks on modified flows
8. Mobile-first UX verified on operator-facing surfaces

## Appendix C: Mission Gate (Every Sprint)

Every feature must pass ALL four gates from the roadmap:

1. **Mission Fit** — Advances equipment/parts sales+rental operations
2. **Transformation** — Creates capability beyond commodity CRM behavior
3. **Pressure Test** — Validated under realistic usage and edge cases
4. **Operator Utility** — Improves decision speed or execution quality for a real role
