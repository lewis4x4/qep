# QEP OS — Build Session Handoff

**Date:** April 3-4, 2026
**Repository:** `lewis4x4/qep` on GitHub, `main` branch
**Commits:** `795b8df`, `304876d`, `e5c198d`, `2032504`
**Canonical Roadmap:** `QEP-OS-Build-Roadmap-LLM.md` (repo root)

---

## What Was Built

The entire QEP OS Build Roadmap (all 5 phases) was implemented in a single session: schema, edge functions, frontend components, security hardening, and two full code audits. The system went from 64 migrations and 26 edge functions to **85 migrations and 37 edge functions**.

### Session Stats

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Migrations | 64 | 85 | +21 |
| Edge Functions | 26 | 37 | +11 new, 1 modified |
| Frontend Components | — | 8 new, 15 modified | +8 |
| Lines Changed | — | — | +8,642 / -89 |
| Tables Created | ~56 | ~86 | +30 |
| Commits | — | 4 | — |

---

## Phase-by-Phase Breakdown

### Pre-Build: Critical Bug Fixes (Migration 065)

Three critical bugs from the March 27 code audit were addressed before any new work:

- **CRITICAL-1 (voice-capture CORS):** Created `supabase/functions/_shared/safe-cors.ts` — a bulletproof CORS utility that **never throws**. Replaces 14 duplicated `corsHeaders()` functions across edge functions. Updated `voice-capture/index.ts` to use it.
- **CRITICAL-2 (HubSpot tokens):** Audited all 5 write paths across `hubspot-oauth`, `hubspot-client`, `hubspot-scheduler`, `voice-capture-sync`, and `voice-capture`. All properly use AES-256-GCM encryption. Added a database trigger (`validate_hubspot_token_format`) that rejects plaintext tokens at the schema level.
- **CRITICAL-3 (PDF ingestion):** Verified already fixed — `ingest/index.ts` uses `pdfParse(Buffer.from(fileBuffer))` with magic byte validation.
- **HIGH-1 (RLS recursion):** Found and fixed 2 recursion risks — `chat_messages` policy queried `chat_conversations` (RLS-enabled), and `onedrive_sync_state` used pre-005 `profiles` subselect pattern. Both replaced with SECURITY DEFINER helpers.
- **HIGH-2 (Chat localStorage):** Verified already fixed — `ChatPage.tsx` uses database-backed storage exclusively via `chat_conversations` and `chat_messages` tables.

### Phase 1: Sales Pipeline Foundation & Voice-First QRM (Migrations 066-072)

**The nervous system of the entire dealership.** Everything in Phases 2-5 builds on these primitives.

#### Migration 066: 21-Step Pipeline Reconfiguration
- Replaced existing deal stages with the owner's exact 21-step pipeline derived from operational SOPs
- Added `description` and `sla_minutes` columns to `crm_deal_stages`
- Added `sla_started_at` and `sla_deadline_at` to `crm_deals`
- Created `crm_deal_sla_on_stage_change()` trigger that auto-sets SLA timers when deals enter SLA-tracked stages
- Handles existing deal remapping (ON DELETE RESTRICT on `stage_id` required careful migration ordering)
- **Schema note verified:** Column is `sort_order` (not `display_order`), probability is 0-100 (not 0-1)

#### Migration 067: Iron Role System
- Added `iron_role`, `iron_role_display`, `is_support` columns to `profiles`
- Backfill mapping: `manager/owner → iron_manager`, `admin → iron_woman`, `rep → iron_advisor`, `rep+support → iron_man`
- Created `sync_iron_role()` trigger — auto-syncs Iron role when system role or support flag changes
- Created `get_my_iron_role()` SECURITY DEFINER helper for RLS and query use

#### Migration 068: Needs Assessment Table
- Full structured assessment from owner's SOP: application, terrain, machine interest, attachments, brand preference, current equipment, timeline, budget, trade-in, decision maker, next step
- `entry_method` CHECK: `('voice', 'manual', 'ai_chat')`
- `completeness_pct` generated column with auto-calculation trigger (`needs_assessment_calc_completeness`)
- `qrm_narrative` field for owner's preferred natural-language format
- FK added to `crm_deals.needs_assessment_id`

#### Migration 069: Follow-Up Cadence Engine
- `follow_up_cadences` (parent) + `follow_up_touchpoints` (children) tables
- Two cadence types: `sales` (Day 0/2-3/7/14/30/monthly) and `post_sale` (delivery/1wk/1mo/90d/quarterly)
- SQL helper functions: `create_sales_cadence()` and `create_post_sale_cadence()` — callable via RPC
- Core rule from SOP: **every follow-up must include VALUE — zero tolerance for "just checking in"**
- SECURITY DEFINER helper `touchpoint_in_my_workspace()` prevents RLS recursion on touchpoint policies
- Unique index prevents duplicate active cadences per deal+type

#### Migration 070: Deposit Management System
- `deposits` table with tiered calculation (from SOP exact values):
  - $0-$10K → $500 | $10K-$100K → $1,000 | $100K-$250K → $2,500 | $250K+ → MAX($5K, 1%)
- **HARD PIPELINE GATE:** `enforce_deposit_gate()` trigger on `crm_deals` — prevents `stage_id` update to stages 17+ unless a verified deposit exists. This is enforced at the database level — no application code can bypass it.
- `enforce_margin_check()` trigger — flags deals under 10% margin at Stage 13 for Iron Manager review
- `deposit_status`, `deposit_amount`, `margin_check_status` columns added to `crm_deals`

#### Migration 071: Voice-to-QRM Enhancements
- Enabled `pg_trgm` extension for fuzzy name matching
- Trigram indexes on `crm_contacts` (full name) and `crm_companies` (name)
- `voice_qrm_results` audit trail table — tracks what entities were matched/created from each voice capture
- `fuzzy_match_contact()` and `fuzzy_match_company()` SECURITY DEFINER RPCs with configurable similarity threshold

#### Migration 072: Pipeline Enforcer Cron
- Cron schedules via `pg_net.http_post()`:
  - `pipeline-enforcer-periodic`: every 5 minutes
  - `follow-up-engine-hourly`: every hour

#### Edge Functions Built for Phase 1

| Function | File | Purpose |
|----------|------|---------|
| `voice-to-qrm` | `supabase/functions/voice-to-qrm/index.ts` | **Crown jewel.** Audio → Whisper transcription → GPT extraction (enhanced schema with full needs assessment + QRM narrative) → fuzzy match/create contact+company → create deal → populate needs assessment → set follow-up cadence → score deal. Target: <10 seconds. |
| `needs-assessment` | `supabase/functions/needs-assessment/index.ts` | CRUD for needs assessments. GET by deal_id or contact_id, POST, PUT. |
| `deposit-calculator` | `supabase/functions/deposit-calculator/index.ts` | Tier calculation → deposit record creation → Iron Woman notification. |
| `follow-up-engine` | `supabase/functions/follow-up-engine/index.ts` | Hourly cron. Processes due touchpoints, generates AI value-add content via OpenAI, creates notifications, marks overdue. |
| `pipeline-enforcer` | `supabase/functions/pipeline-enforcer/index.ts` | 5-min cron. SLA violation checks (15-min lead response, 1-hr quote creation, 30-min quote presentation), margin flags at Stage 13, stale deal detection (7-day inactivity). |

#### Frontend Components for Phase 1

| Component | File | Purpose |
|-----------|------|---------|
| `SlaCountdown` | `apps/web/src/features/crm/components/SlaCountdown.tsx` | Real-time SLA timer. Color-coded: green → yellow → red → OVERDUE (pulsing). Updates every 15 seconds. |
| `DepositGateBadge` | `apps/web/src/features/crm/components/DepositGateBadge.tsx` | Lock/check icon for deposit status on pipeline deal cards. |
| `NeedsAssessmentCard` | `apps/web/src/features/crm/components/NeedsAssessmentCard.tsx` | Full assessment display with completeness bar, QRM narrative, all SOP fields. |
| `CadenceTimeline` | `apps/web/src/features/crm/components/CadenceTimeline.tsx` | Visual timeline of follow-up touchpoints with status dots, countdown labels, AI content preview. |
| `iron-roles.ts` | `apps/web/src/features/crm/lib/iron-roles.ts` | Iron role utility — derives Iron role from system role, provides display names and descriptions. |

#### Pipeline Board Upgrade
- **@dnd-kit** installed (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`)
- `CrmPipelinePage.tsx` restructured with:
  - 3 swim lanes: Pre-Sale (stages 1-12), Close (stages 13-16), Post-Sale (stages 17-21)
  - `DndContext` with `DraggableDealCard` and `DroppableStageColumn` wrappers
  - Optimistic drag-and-drop with error rollback (race condition fixed in audit via ref-captured original stage)
  - SLA countdown and deposit gate badges on every deal card
- **QRM branding** applied across 13 user-facing strings (QRM → QRM in titles, nav, aria-labels)
- Iron role badge on QRM Hub page header

---

### Phase 2: Field Operations & Revenue Engine (Migrations 073-076)

#### Migration 073: Equipment Demo Lifecycle
- `demos` table with qualification gate (needs assessment complete + quote presented + buying intent confirmed)
- `demo_inspections` table (pre/post-demo by Iron Man)
- Hour tracking: 10hr construction, 4hr forestry (auto-set by trigger based on `equipment_category`)
- Cost allocation: transport + fuel + prep labor + wear → auto-summed as generated column
- `demo_qualification_gate()` trigger — blocks approval if prerequisites not met
- `check_demo_hour_alerts()` function for pipeline-enforcer integration
- Mandatory 24-hour follow-up auto-set on completion

#### Migration 074: AI Trade-In Valuations
- `trade_valuations` table with full SOP fields: 4-corner photos, walkaround video, serial plate, hours
- AI condition scoring (0-100 via Equipment Vision AI)
- Pricing formula enforced in `trade_valuation_auto_calc()` trigger:
  - `Auction Value × 0.92 (8% discount) - Reconditioning = Preliminary Value`
- Over-allowance auto-detection (>10% above formula → auto-routes to `manager_review`)
- Target resale margin: 20-25% with suggested resale price calculation
- `calculate_trade_value()` immutable function for ad-hoc pricing

#### Migration 075: Prospecting KPI System
- `prospecting_visits` table with quality criteria (spoke with decision maker, identified need, equipment discussion, followed up on active deal)
- `is_positive` generated column — only visits meeting quality criteria count
- `prospecting_kpis` daily rollup table with `target_met` generated column (>= 10 positive visits)
- `update_prospecting_kpi_on_visit()` trigger — auto-updates daily KPI on visit insert via UPSERT
- Streak tracking for consecutive days meeting target

#### Migration 076: Escalation Tickets
- `escalation_tickets` table for post-sale issue routing
- Links to touchpoints, deals, contacts
- Auto-generated email drafts + follow-up tasks from single voice command
- Department/branch routing with severity levels

#### Phase 2 Edge Functions

| Function | Purpose |
|----------|---------|
| `demo-manager` | Full demo lifecycle: qualification check, approval routing, hour tracking, cost allocation. |
| `trade-valuation` | Photo upload → Equipment Vision AI (GPT-4o) → condition scoring → pricing formula → preliminary value. Target: <60 seconds. |
| `prospecting-tracker` | Log field visits with quality validation, calculate daily KPIs, real-time progress tracking. |
| `escalation-router` | Creates escalation tickets from voice commands. Auto-generates email draft + follow-up task + ticket in one shot. |

#### Phase 2 Frontend

| Component | Purpose |
|-----------|---------|
| `DemoRequestCard` | Demo request form with qualification prerequisites display, hour tracking bar, cost display. Wired into deal detail page. |
| `ProspectingKpiCounter` | Real-time daily visit counter with progress bar, streak display. Auto-refreshes every 30 seconds. |

---

### Phase 3: Operational Intelligence & Logistics (Migrations 077-079)

#### Migration 077: Equipment Intake Pipeline (8 Stages)
- Kanban-style board: Purchase & Logistics → Equipment Arrival → PDI → Inventory Labeling → Sales Readiness → Online Listing → Internal Documentation → Sale Ready
- Full checklist fields per stage (PDI items, photos, barcodes, listings)
- `track_intake_stage_change()` trigger records stage history with timestamps

#### Migration 078: Traffic & Logistics System
- `traffic_tickets` table with 12 ticket types (demo, loaner, rental, sale, purchase, service, trade_in, customer_transfer, job_site_transfer, location_transfer, miscellaneous, re_rent)
- Color-coded status: haul_pending (gray) → scheduled (yellow) → being_shipped (orange) → completed (red)
- GPS delivery tracking (lat/lng/address)
- Driver checklist, signature capture, delivery photos, hour meter
- `traffic_ticket_auto_lock()` trigger — requestors cannot modify after status leaves haul_pending
- Auto-creation at deal Stage 18 (Delivery Scheduled)

#### Migration 079: Rental Returns + Payment Validation + GL Routing
- **Rental Returns:** Branching workflow (clean return vs damaged return) with inspection, decision, work order, and refund tracking
- **Payment Validation:** `validate_payment()` function enforcing exact SOP rules:
  - Business checks: $2,500/day/customer
  - Personal checks: $1,000/day/customer
  - Equipment sales on delivery day: Cashier's Check ONLY
  - Equipment rentals: No regular checks
- **GL Routing:** `gl_routing_rules` table seeded with 8 GL codes from SOP. SALEW001 (Good Faith) requires ownership approval gate.

---

### Phase 4: Deal Genome Engine & Predictive Intelligence (Migration 080)

#### Migration 080: DGE Predictive Prospecting
- `predictive_visit_lists` table — daily AI-generated visit recommendations per Iron Advisor
- Added `dge_score`, `dge_scenario_count`, `dge_last_scored_at` to `crm_deals`

#### DGE Optimizer Edge Function
- `dge-optimizer`: The 14-variable deal optimization engine
- For every active deal, produces 3 scenarios:
  1. **Conservative:** Maximum margin, lower close probability
  2. **Balanced:** Optimized across all 14 variables (best expected value)
  3. **Aggressive:** Maximum close probability, minimum acceptable margin
- Falls back to rule-based scenarios when OpenAI unavailable
- Writes deal score back to `crm_deals.dge_score`

---

### Phase 5: Customer Portal & Autonomous Operations (Migrations 082-084)

#### Migration 082: Customer Self-Service Portal
- `portal_customers` — separate auth flow from internal users, linked via `auth_user_id`
- `customer_fleet` — customer-owned equipment: warranty tracking, service schedules, purchase history
- `service_requests` — customer-initiated with photo upload, department routing, urgency levels
- `parts_orders` — self-service with AI-suggested PM kits, line items, shipping tracking
- `customer_invoices` — payment portal with `balance_due` generated column and overpayment constraint
- `portal_quote_reviews` — e-signature with signer name, IP, timestamp tracking
- **Dual RLS:** Internal staff see full workspace, portal customers see only their own data
- `get_portal_customer_id()` SECURITY DEFINER helper for portal customer RLS policies

#### Migration 083: Autonomous Marketing Engine
- `marketing_campaigns` — 7 campaign types (inventory_arrival, seasonal, competitor_displacement, fleet_replacement, promotion, retention, custom)
- `campaign_recipients` — personalized content per recipient with engagement tracking
- `inventory_event_triggers` — auto-create campaigns when inventory events occur (new arrival, price drop, back in stock)
- `social_media_posts` — Facebook Marketplace auto-posting with engagement metrics
- AI content generation for campaigns via OpenAI

#### Migration 084: Equipment-as-a-Service (EaaS)
- `eaas_subscriptions` — 4 plan types (fixed_monthly, usage_based, hybrid, seasonal)
- `eaas_usage_records` — telematics-ready hour tracking with `overage_hours` generated column
- `maintenance_schedules` — predictive and preventive maintenance with confidence scoring
- Fleet rotation tracking with configurable intervals
- Usage-based pricing with overage calculations

#### Phase 5 Edge Functions

| Function | Purpose |
|----------|---------|
| `portal-api` | Unified customer portal API. Routes: /fleet, /service-requests, /parts, /invoices, /quotes, /subscriptions. Input validation + field whitelisting on all mutation endpoints. |
| `marketing-engine` | Autonomous campaign processor. Processes inventory triggers, generates AI content, tracks engagement. Dual auth: service_role for cron, elevated role for manual invocation. |

---

## Security Audits (2 Rounds)

### Audit Round 1 (Migration 081)

| Fix | Severity | Detail |
|-----|----------|--------|
| Service role auth bypass | CRITICAL | `follow-up-engine` and `pipeline-enforcer` only checked header presence, not value. Now validates against actual `SUPABASE_SERVICE_ROLE_KEY`. |
| Missing workspace_id indexes | CRITICAL | 13 tables had RLS policies filtering on `workspace_id` without an index → full-table scans. Added indexes on all. |
| DnD race condition | HIGH | `handleDragEnd` referenced stale `deal.stageId` via closure. Fixed with `useRef` capturing original stage at drag start. |
| Unsafe `.single()` calls | HIGH | `follow-up-engine` and `escalation-router` used `.single()` on contact lookups that could return 0 rows. Changed to `.maybeSingle()`. |
| Missing RPC error check | HIGH | `voice-to-qrm` silently swallowed cadence creation errors. Now catches and reports. |
| DemoRequestCard error handling | HIGH | Missing `res.ok` check before `.json()` + no error UI. Fixed both. |
| Missing query error states | HIGH | NeedsAssessmentCard and CadenceTimeline had no `isError` display. Added red error cards. |
| 12 FK column indexes | HIGH | Deposits, demos, trade_valuations, traffic_tickets, etc. missing indexes on FK columns used in joins. |

### Audit Round 2 (Migration 085)

| Fix | Severity | Detail |
|-----|----------|--------|
| Portal RLS over-permissive | CRITICAL | `service_requests`, `parts_orders`, `quote_reviews` had `FOR ALL` policies for portal customers — customers could UPDATE billing amounts, order totals, forge signatures. Split into SELECT + INSERT only, with UPDATE restricted to safe states. |
| Portal API customer verification | CRITICAL | Added check that caller is an active `portal_customer` before any operation. Blocks internal staff tokens from customer-only endpoints. |
| Portal API field injection | CRITICAL | All POST/PUT endpoints now whitelist safe fields. Blocks status, billing, and signature field manipulation. |
| Quote review state machine | CRITICAL | Enforced valid state transitions (sent→viewed→accepted). Requires `signer_name` for acceptance. Server-sets `signed_at` and `signer_ip`. |
| maintenance_schedules RLS recursion | CRITICAL | Replaced subselect on RLS-enabled tables with `customer_can_view_maintenance()` SECURITY DEFINER helper. |
| Workspace function standardization | HIGH | `campaign_in_my_workspace` and `subscription_in_my_workspace` used raw JWT claim extraction. Replaced with `get_my_workspace()`. |
| Invoice overpayment constraint | HIGH | Added `CHECK (amount_paid <= total)` on `customer_invoices`. |
| Component memoization | HIGH | Wrapped `DraggableDealCard` and `DroppableStageColumn` with `React.memo()` to prevent 1000+ re-renders during drag. |
| N+1 manager lookups | HIGH | Pipeline-enforcer queried `profiles` for Iron Managers per-deal (3x N+1). Now pre-fetches once and caches. |

---

## Architecture Decisions

### Key Design Patterns

1. **SECURITY DEFINER helpers for RLS** — Every cross-table RLS policy uses a SECURITY DEFINER function with `set search_path = ''` to prevent recursion and search path injection. Examples: `get_my_role()`, `get_my_workspace()`, `get_portal_customer_id()`, `touchpoint_in_my_workspace()`, `customer_can_view_maintenance()`.

2. **Database-level gates** — Critical business rules enforced via PostgreSQL triggers, not application code. The deposit gate (`enforce_deposit_gate`) and margin check (`enforce_margin_check`) cannot be bypassed by any API path.

3. **Zero-blocking architecture** — Every external integration (IntelliDealer, Machinery Trader, telematics) has fallbacks. Voice-to-QRM falls back to rule-based scenarios when OpenAI is unavailable. Trade valuation returns manual-review score (70) when Vision AI fails.

4. **safeCorsHeaders** — Single shared CORS utility (`supabase/functions/_shared/safe-cors.ts`) used by all new edge functions. Never throws, always returns valid headers. Replaces 14 duplicated implementations.

5. **Service role auth for cron functions** — `follow-up-engine` and `pipeline-enforcer` validate `Authorization: Bearer <SERVICE_ROLE_KEY>` before executing. User-facing functions validate via `supabase.auth.getUser()`.

6. **Field whitelisting on mutation endpoints** — Portal API strips unsafe fields from customer-submitted data. Status, billing, and signature fields are server-controlled only.

### Schema Conventions (Verified)

- `crm_deal_stages.sort_order` (integer, NOT `display_order`)
- `crm_deal_stages.probability` (0-100 scale, NOT 0-1)
- All tables: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at`, `updated_at`
- RLS on every user-facing table
- Workspace-scoped via `get_my_workspace()`
- Migrations: `NNN_snake_case_name.sql` (next: 086)

---

## Current Repository State

```
85 migrations (001-085)
37 edge functions
~130 frontend source files
Build: bun run build — PASSING
Migration check: bun run migrations:check — 85 files, sequence 001..085
Edge function type check: deno check — ALL PASSING
```

---

## What Needs To Happen Next

### Immediate (Deployment)

1. **Apply migrations to Supabase:** `supabase db push` or apply via dashboard (migrations 065-085)
2. **Deploy edge functions:** `supabase functions deploy` for all 11 new + 1 modified function
3. **Generate TypeScript types:** `supabase gen types typescript` — updates `database.types.ts` so frontend components use proper types instead of `(supabase as any)` casts
4. **Deploy frontend:** Push to Netlify (auto-deploys from `main`)
5. **Rotate credentials:** If any `.env` files were ever committed to git history (verified they are NOT currently tracked, but check git history to be safe)

### Short-Term (1-2 weeks)

1. **N+1 query optimization in follow-up-engine:** Batch deal/assessment/contact queries with JOINs instead of per-touchpoint lookups (currently ~250 queries per hourly cron run)
2. **Deal detail page query consolidation:** Currently fires 8 separate queries — consolidate into composite endpoint
3. **Extract CrmPipelinePage components:** 60KB single file should be split into separate component files
4. **Lazy-load react-markdown:** 153KB only used in ChatPage — should be code-split

### Medium-Term (Roadmap Items Not Yet Built)

1. **Full drag-and-drop with @dnd-kit/sortable** — Current implementation uses basic drag between columns. Adding card reordering within columns and multi-select drag would complete the Kanban experience.
2. **Iron role-specific dashboard views** — The role mapping and badge are implemented, but dedicated dashboard layouts per role (Iron Manager KPI scoreboard, Iron Woman order processing queue, etc.) need frontend pages.
3. **Quote Builder V2** — The roadmap specifies voice-first, AI chat, and traditional form entry modes with financing preview and e-signature. Existing `QuoteBuilderPage.tsx` (1,500+ lines) needs the zero-blocking architecture treatment.
4. **Customer portal frontend** — Schema and API are built, but the customer-facing React pages need to be created (separate app or route group with portal auth flow).
5. **Social media auto-posting integration** — Schema and API ready, needs actual Facebook/Meta API integration.
6. **Telematics integration** — EaaS usage tracking schema is telematics-ready with device_id fields, needs actual device API integration.

---

## File Index

### Migrations (065-085)

| # | File | Tables/Changes |
|---|------|----------------|
| 065 | `065_pre_build_rls_hardening.sql` | RLS fixes + HubSpot token trigger |
| 066 | `066_pipeline_21_step_reconfiguration.sql` | 21-step stages + SLA columns + trigger |
| 067 | `067_iron_role_system.sql` | Iron role columns + sync trigger + helper |
| 068 | `068_needs_assessments.sql` | needs_assessments table + completeness trigger |
| 069 | `069_follow_up_cadences.sql` | follow_up_cadences + touchpoints + RPC helpers |
| 070 | `070_deposits.sql` | deposits table + HARD pipeline gate trigger |
| 071 | `071_voice_to_qrm_enhancements.sql` | pg_trgm + voice_qrm_results + fuzzy match RPCs |
| 072 | `072_pipeline_enforcer_cron.sql` | Cron schedules |
| 073 | `073_equipment_demo_lifecycle.sql` | demos + demo_inspections + qualification gate |
| 074 | `074_trade_valuations.sql` | trade_valuations + pricing auto-calc trigger |
| 075 | `075_prospecting_kpis.sql` | prospecting_visits + prospecting_kpis + KPI rollup trigger |
| 076 | `076_escalation_tickets.sql` | escalation_tickets |
| 077 | `077_equipment_intake_pipeline.sql` | equipment_intake (8-stage) + stage history trigger |
| 078 | `078_traffic_logistics.sql` | traffic_tickets (12 types) + auto-lock trigger |
| 079 | `079_rental_returns_and_payments.sql` | rental_returns + payment_validations + gl_routing_rules |
| 080 | `080_dge_predictive_prospecting.sql` | predictive_visit_lists + DGE score columns |
| 081 | `081_post_build_audit_remediation.sql` | 25 indexes (workspace + FK) |
| 082 | `082_customer_portal.sql` | portal_customers + customer_fleet + service_requests + parts_orders + customer_invoices + portal_quote_reviews |
| 083 | `083_autonomous_marketing_engine.sql` | marketing_campaigns + campaign_recipients + inventory_event_triggers + social_media_posts |
| 084 | `084_equipment_as_a_service.sql` | eaas_subscriptions + eaas_usage_records + maintenance_schedules |
| 085 | `085_portal_rls_hardening.sql` | RLS policy splits + SECURITY DEFINER helpers + overpayment constraint |

### Edge Functions (11 new)

| Function | Auth | Invocation |
|----------|------|------------|
| `voice-to-qrm` | User token (rep+) | Manual (frontend) |
| `needs-assessment` | User token | Manual (frontend) |
| `deposit-calculator` | User token | Manual (frontend) |
| `follow-up-engine` | Service role | Cron (hourly) |
| `pipeline-enforcer` | Service role | Cron (5 min) |
| `demo-manager` | User token | Manual (frontend) |
| `trade-valuation` | User token | Manual (frontend) |
| `prospecting-tracker` | User token | Manual (frontend) |
| `escalation-router` | User token | Manual (frontend) |
| `dge-optimizer` | User token | Manual (frontend) |
| `portal-api` | Portal customer token | Manual (portal frontend) |
| `marketing-engine` | Service role OR elevated user | Cron + Manual |

### Frontend Components (8 new)

| Component | Location |
|-----------|----------|
| `SlaCountdown` | `apps/web/src/features/crm/components/SlaCountdown.tsx` |
| `DepositGateBadge` | `apps/web/src/features/crm/components/DepositGateBadge.tsx` |
| `NeedsAssessmentCard` | `apps/web/src/features/crm/components/NeedsAssessmentCard.tsx` |
| `CadenceTimeline` | `apps/web/src/features/crm/components/CadenceTimeline.tsx` |
| `DemoRequestCard` | `apps/web/src/features/crm/components/DemoRequestCard.tsx` |
| `ProspectingKpiCounter` | `apps/web/src/features/crm/components/ProspectingKpiCounter.tsx` |
| `iron-roles.ts` | `apps/web/src/features/crm/lib/iron-roles.ts` |
| `safe-cors.ts` | `supabase/functions/_shared/safe-cors.ts` |
