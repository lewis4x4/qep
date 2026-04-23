# Role-Home Feature Audit (Phase 1)

**Date:** 2026-04-23
**Purpose:** Document what the QEP Knowledge Assistant codebase *actually* contains, so the role-home redesign is grounded in real features — not mockup imagination.
**Scope:** `apps/web/src/features/*`, `supabase/migrations/*`, `supabase/functions/*`, `apps/web/src/App.tsx`, `apps/web/src/lib/home-route.ts`.
**Method:** Five parallel read-only audit passes (features, permissions, quick actions, current Floor state, backend domain map). No code changed.

---

## SURPRISES (read this before anything else)

These are the findings that most upend the 2×3 mockup's implicit assumptions. They change what the redesign should do.

### S1. There are **seven** iron roles, not six.
The mockup shows Sales Manager, Sales Rep, Parts Manager, Owner, Deal Desk, Prep/Service. The codebase has a **seventh**: `iron_parts_counter` (Juan/Bobby — counter sales) distinct from `iron_parts_manager` (Norman — inventory planner). They do fundamentally different work. The #1 parts-counter action (paste a serial, get machine+owner+service) belongs to `iron_parts_counter`. The reorder queue / demand forecast work belongs to `iron_parts_manager`. **The mockup's "Parts Manager" screen conflates the two.** The redesign must split them.

### S2. The Floor is already built and already per-role.
`floor_layouts` table exists, `useFloorLayout()` resolves user-override → role-default → empty fallback, the widget registry has ~45 widgets with `allowedRoles`, and every one of the seven roles already has a seeded default layout in [default-layouts.ts](apps/web/src/features/floor/lib/default-layouts.ts). **This isn't a green-field redesign — it's a curation pass on an existing system.**

### S3. SerialFirstWidget is already built to the moonshot spec.
The product brief calls out "one-field serial number input that returns equipment + parts history" as a MUST HAVE for Parts. [SerialFirstWidget.tsx:1](apps/web/src/features/floor/widgets/SerialFirstWidget.tsx:1) already does this — paste-tolerant (strips non-alphanumeric), 200ms debounce, ILIKE fuzzy match against `qrm_equipment.serial_number`, three-panel snapshot (Machine · Owner · Service), opens `/qrm/equipment/{id}` on click. It is already in `iron_parts_counter`'s default layout. **Not a gap.** The redesign should *promote it harder* (wide size, first widget).

### S4. Commission MTD is a placeholder, not a real number.
[floor-widget-registry.tsx:317-324](apps/web/src/features/floor/lib/floor-widget-registry.tsx:317) registers `sales.commission-to-date` with the literal comment *"Closed quote value that will feed commission once QA-R2 defines rules."* There is no commission table, no commission rule engine, no rep-to-dollar attribution. The widget renders closed quote totals as a proxy. **The product brief's instruction to remove Commission MTD from Sales Rep is not a style choice — it's honesty.** Rules don't exist; the number misleads.

### S5. Voice capture is built and production-ready in multiple surfaces.
- `/voice-qrm` — transcript → entity extraction → writes to `qrm_contacts`, `qrm_companies`, `qrm_deals`, `qrm_tasks`, `qrm_ideas`.
- `/voice-quote` — transcript → `qb-ai-scenarios` SSE → pick a scenario → pre-fills `/quote-v2`.
- `ConversationalDealEngine` — in-quote voice panel inside Quote Builder V2.
- `VoiceOpsModal` — press **V** in Parts Companion, creates parts request.
- [VoiceNoteCapture.tsx:6](apps/web/src/features/sales/components/VoiceNoteCapture.tsx:6) — reusable component, already wired into `CaptureSheet.tsx:374`.
**"Voice Note" is NOT a gap for Sales Rep — it's a wiring decision.** The button just needs to route to the right flow.

### S6. The mockup's "Aging Fleet" widget has no real analogue for Sales Rep / Parts Manager.
Aging fleet is an owner / inventory concern. A sales rep does not look at dealer inventory aging multiple times per day — they look at *their* deals. A parts manager cares about parts aging, not equipment aging. The mockup's placement of "Aging Fleet" across both Sales Rep and Parts Manager is the aesthetic-balance trap the brief warns about.

### S7. Cmd+K OmniCommand already gives every user global search and jumps.
[OmniCommand.tsx](apps/web/src/components/OmniCommand.tsx) is universally mounted. It does document semantic search, jump-to-route (role-filtered: Dashboard, Document Center, Pending Review, Ingest Failures, QRM, Parts Companion, Service), and fuzzy customer/company search via [QrmGlobalSearchCommand.tsx](apps/web/src/features/qrm/components/QrmGlobalSearchCommand.tsx). **Customer Search does not need to be a home-screen widget for most roles** — it's one keystroke away everywhere.

### S8. "COMPOSE" in the top bar is the **Floor layout editor**, not a create-quote button.
Admins clicking COMPOSE land in [FloorComposePage.tsx](apps/web/src/features/floor/pages/FloorComposePage.tsx) — the drag-drop widget arranger. It is admin-only. The mockup uses "COMPOSE" ambiguously; the redesign should either rename the header action or make role-home "compose" something different (like a universal new-quote / new-activity picker).

### S9. Parts Companion shell already has great keyboard shortcuts.
[PartsCompanionShell.tsx](apps/web/src/features/parts-companion/components/PartsCompanionShell.tsx): `/` = Lookup, `N` = New Request, `V` = Voice Ops, `A`/`I` = AI panel, `Q` = sidebar toggle, `Esc` = close modals, `Cmd+K` = jump to Lookup. **Parts roles have keyboard-first ergonomics the other roles don't.** The sales/service roles should inherit this pattern.

### S10. `iron_owner`, `iron_parts_counter`, `iron_parts_manager` have **no dedicated legacy Iron dashboard**.
[DashboardRouter.tsx](apps/web/src/features/dashboards/pages/DashboardRouter.tsx) falls through to IronAdvisorDashboard for these three. Their only real home screen is `/floor`. This means `floor_mode=true` is effectively mandatory for Ryan, Juan, Bobby, Norman. The Floor redesign is the only UX that ships for them.

### S11. Approval flow is real but state names are inconsistent.
`quote_approval_cases` (migration 363) uses `submitted → assigned → approved → released | rejected | escalated | expired | cancelled`. `flow_approvals` (migration 195) uses `pending → approved | rejected | expired | escalated`. The Sales Manager "Open Approvals" widget reads from both. **Any new approval-related quick action must be explicit about which state machine it drives.**

### S12. There is no "deals-by-my-rep" filter at the Floor widget level.
Sales Manager's pipeline widget is `iron.pipeline-by-rep` which reads `qrm_deals` filtered by workspace + stage — not narrowed to *this manager's direct reports*. Manager scopes are workspace-wide. Field-level reporting-tree filtering does not exist in the RLS helpers. **If "my team's deals" is the manager's unit of concern, that filter has to come from app-layer logic, not a DB helper.**

### S13. Demos-heavy schema in quote-builder.
`qb_equipment_models`, `qb_equipment_models_audit`, `qb_demo_construction_fleet` seed demo data into production-shaped tables. Not a blocker, but any "my demos today" widget must filter by the demo owner or it will show cross-workspace demo rows in non-demo builds.

---

## A. FEATURE INVENTORY

Dense inventory grouped by feature module. Format per entry: **name** — route(s) — component path — data surfaces — action type — description.

### admin (role: admin/manager/owner only)
- **Base Options** — `/admin/base-options` — [BaseOptionsPage.tsx](apps/web/src/features/admin/pages/BaseOptionsPage.tsx) — `qb_base_options`, `qb_programs` — CREATE/REVIEW/MONITOR — OEM program catalog + incentive matrices.
- **Branches** — `/admin/branches` — `BranchManagementPage.tsx` — `branches`, `gl_routing_rules`, `service_integrations` — CREATE/REVIEW — branch locations + GL routing.
- **Price Sheets** — `/admin/price-sheets` — `PriceSheetsPage.tsx` — `qb_price_sheets`, `qb_price_sheets_audit` — CREATE/REVIEW — pricing tables.
- **Deal Economics** — `/admin/deal-economics` — `DealEconomicsPage.tsx` — `deals_roi_view`, `margin_analytics_view` — MONITOR — ROI rollups and margin trend.
- **Audit Log** — `/admin/audit-log` — `AuditLogPage.tsx` — 7 `qb_*_audit` tables — MONITOR — who changed what / when.
- **AI Request Log** — `/admin/ai-request-log` — `AiRequestLogPage.tsx` — `analytics_action_log` — MONITOR — inference cost / latency.
- **Deal Velocity** — `/admin/deal-velocity` — `DealVelocityPage.tsx` — `crm_deals_weighted`, `deal_timing_alerts`, `decision_room_moves` — MONITOR.
- **Coach Performance** — `/admin/coach-performance` — `CoachPerformancePage.tsx` — `flow_workflow_runs`, `iron_slo_history` — MONITOR.
- **Flow Admin** — `/admin/flow` — `FlowAdminPage.tsx` — `flow_workflow_definitions`, `flow_workflow_runs`, `flow_approvals` — CREATE/REVIEW — approval routing definitions.
- **Flare Reports** — `/admin/flare`, `/admin/flare/:id` — `FlareAdminPage.tsx` — `flare_reports` — REVIEW.
- **Catalog Import** — `CatalogImportPage.tsx` — `parts_catalog`, `parts_import_runs`, `parts_import_conflicts` — CREATE.
- **Data Quality** — `DataQualityPage.tsx` — `admin_data_issues`, `analytics_alerts` — MONITOR.
- **Incentives** — `IncentiveCatalogPage.tsx` — `manufacturer_incentives` — CREATE/REVIEW.
- **Accounts Payable** — `AccountsPayablePage.tsx` — `ap_bills`, `ap_bill_lines`, `ap_aging_view` — REVIEW.
- **QuickBooks GL Sync** — `QuickBooksGlSyncPage.tsx` — edge fn `quickbooks-gl-sync` — MONITOR.
- **Exception Inbox** — `ExceptionInboxPage.tsx` — `exception_queue`, `admin_data_issues` — REVIEW.

### brief (role-aware morning briefings)
- **Brief Dashboard** — `/brief/dashboard` — `BriefDashboardPage.tsx` — `morning_briefings` — REVIEW.
- **Brief Feedback / Decisions / Ask** — `/brief/feedback`, `/brief/decisions`, `/brief/ask` — `hub_feedback`, `hub_decisions` — COMPOSE/REVIEW.
- **Edge fn** `stakeholder-morning-brief` — generates role-specific morning narrative.

### dashboards (legacy Iron dashboards; superseded by /floor when `floor_mode=true`)
- **DashboardRouter** — `/dashboard` — [DashboardRouter.tsx](apps/web/src/features/dashboards/pages/DashboardRouter.tsx) — forks by iron_role: IronManagerDashboard, IronAdvisorDashboard, IronWomanDashboard, IronManDashboard. `iron_owner` / `iron_parts_*` fall through to Advisor.
- **Operating System Hub** — `OperatingSystemHubPage.tsx` — `floor_layouts`, `flow_workflow_runs`, `analytics_kpi_snapshots` — MONITOR.
- **Classic Dashboard** — `/dashboard/classic` — legacy.

### deal-room (customer-facing, unauth)
- **Deal Room** — `/q/:token` — [DealRoomPage.tsx](apps/web/src/features/deal-room/pages/DealRoomPage.tsx) — `quote_reviews`, `deals`, `crm_equipment` — REVIEW/COMPOSE — secure token, no login.

### deal-timing
- **Deal Timing Dashboard** — `/dashboard/deal-timing` — `DealTimingDashboardPage.tsx` — `deal_timing_alerts` — MONITOR — edge fn `deal-timing-scan`.

### dev
- **Primitives Playground** — `/dev/primitives` — internal only.

### dge
- **DGE Cockpit** — `DgeCockpitPage.tsx` — no dedicated route in App.tsx — MONITOR (deprioritized surface).

### documents
- Admin document center, routed via `/admin/documents`. 80+ tables: `documents`, `chunks`, `document_obligations`, `document_plays`, `document_twin`, etc. Edge fns: `document-router`, `document-admin`, `document-onedrive-mirror`, `document-twin`, `document-plays-run`.

### email-drafts
- **Email Draft Inbox** — `EmailDraftInboxPage.tsx` — `email_drafts` — COMPOSE/REVIEW — integrated into QRM.

### equipment
- **Asset 360** — `/qrm/equipment/:equipmentId` — [AssetDetailPage.tsx](apps/web/src/features/equipment/pages/AssetDetailPage.tsx) — `crm_equipment`, `equipment_lifecycle_summary` — REVIEW — history, service, resale value. RPCs: `get_asset_360`, `get_asset_countdowns`, `get_asset_badges`, `get_asset_24h_activity`.

### exec
- **Command Center** — `/executive` — `CommandCenterPage.tsx` — `exec_branch_comparison`, `exec_margin_waterfall_v` — MONITOR.
- **Vision** — `/executive/vision` — `owner_data_miner_*` views.
- **Summary** — `/executive/summary` — `analytics_kpi_snapshots`.
- **Handoffs** — `/executive/handoffs` — `handoff_events`.
- **Owner Briefing** — `/executive/owner-briefing` — `morning_briefings`.

### fleet
- **Fleet Map** — `/logistics` — [FleetMapPage.tsx](apps/web/src/features/fleet/pages/FleetMapPage.tsx) — `customer_fleet`, `crm_equipment`, `location_pins` — MONITOR.

### floor (the subject of this redesign)
- **Floor** — `/floor` — [FloorPage.tsx](apps/web/src/features/floor/pages/FloorPage.tsx) — role-curated home screen; dark mode forced; loads `floor_layouts` + `floor_narratives`.
- **Floor Compose** — `/floor/compose` — admin-only layout editor.
- Widget registry: 45+ widgets in [floor-widget-registry.tsx](apps/web/src/features/floor/lib/floor-widget-registry.tsx).
- Narrative edge fn: [supabase/functions/floor-narrative/](supabase/functions/floor-narrative/) — Claude-generated one-sentence context, 15-min TTL, deterministic per-role fallback.

### oem-portals
- **OEM Portal Dashboard** — `OemPortalDashboardPage.tsx` — no exposed route; vendor-facing.

### ops
- **Intake Kanban** — `IntakeKanbanPage.tsx` — `equipment_intake`, `exception_queue`.
- **PDI Checklist** — `PdiChecklistPage.tsx` — `demos`, `demo_inspections`.
- **Rental Returns** — `RentalReturnsPage.tsx`.
- **Payment Validation** — `PaymentValidationPage.tsx` — `deposits`, `customer_invoices`, `ar_credit_blocks`.
- **Traffic Tickets** — `TrafficTicketsPage.tsx`.
- **SOP Compliance Dashboard** — `SopComplianceDashboardPage.tsx`.

### owner
- **Owner Dashboard** — `/owner` — [OwnerDashboardPage.tsx](apps/web/src/features/owner/pages/OwnerDashboardPage.tsx) — `analytics_kpi_snapshots`, `exec_health_movers` — MONITOR.
- **Data Miner Equivalents** — `/executive/data-miner` — `owner_data_miner_profitability`, `owner_data_miner_credit_exposure`.

### parts (admin/operations, not counter sales)
- **Parts Command Center** — `/parts/command` (redirects to `/qrm/parts-intelligence`).
- **Parts Catalog** — `PartsCatalogPage.tsx` — `parts_catalog`, `parts_cross_references` — LOOKUP.
- **Parts Orders / Purchase Orders / Fulfillment / Forecast / Analytics** — multiple pages, tables: `parts_orders`, `parts_fulfillment_runs`, `parts_demand_forecasts`, `parts_analytics_snapshots`.

### parts-companion (counter and parts-person-facing)
- **Lookup (Intelligent Search)** — `/parts/companion/lookup` — [LookupPage.tsx](apps/web/src/features/parts-companion/pages/LookupPage.tsx) — `parts_catalog`, `counter_inquiries` — LOOKUP/COMPOSE — voice + visual part ID; edge fn `ai-parts-lookup`.
- **Intelligence** — `/parts/companion/intelligence` — `customer_parts_intelligence`, `parts_demand_forecasts`.
- **Machines** / **Machine Profile** — `/parts/companion/machines`, `/parts/companion/machines/:id` — `machine_profiles`.
- **Queue** — `/parts/companion/queue` — `v_parts_queue`, `parts_request_activity` — REVIEW.
- **Replenish** — `/parts/companion/replenish` — `parts_auto_replenish_queue` — CREATE/REVIEW.
- **Supplier Health** — `/parts/companion/supplier-health`.
- **Pricing Rules** — `/parts/companion/pricing`.
- **Post-Sale Plays** / **Predictive Plays** — triggered service plays, demand-predicted outreach.
- **Import** / **Conflicts** — `parts_import_runs`, `parts_import_conflicts`.
- **Arrivals** — `/parts/companion/arrivals` — inbound dock scanning.
- **Shell**: [PartsCompanionShell.tsx](apps/web/src/features/parts-companion/components/PartsCompanionShell.tsx) provides keyboard shortcuts `/`, `N`, `V`, `A`, `I`, `Q`, `Esc`, `Cmd+K`.

### portal (customer-facing)
- 15+ pages — portal login, quotes, deals, fleet, invoices, rentals, parts, documents, service, subscriptions, settings, quote room.

### price-intelligence
- **Price Intelligence** — `/qrm/price-intelligence` — `market_valuations`, `competitor_listings`.

### qrm (largest module, 60+ pages)
- **Pipeline** — `/qrm`, `/qrm/deals` — `crm_deals`, `crm_deal_stages` — REVIEW/COMPOSE.
- **Activities / Templates / Sequences** — `crm_activities`, `crm_activity_templates`, `follow_up_sequences`.
- **Contacts / Contact Detail** — `/qrm/contacts`, `/qrm/contacts/:id`.
- **Deal Detail** — `/qrm/deals/:id` — composite RPC `get_deal_composite`.
- **Deal Room / Autopsy / Coach / Decision Room** — deep deal workspaces with AI.
- **Companies / Company Detail (Account 360)** — `/qrm/companies`, `/qrm/companies/:id` (560-line page).
- **Account Command Center** — `/qrm/accounts/:id/command`.
- **Account Genome / Operating Profile / Fleet Intelligence / Relationship Map / White Space / Rental Conversion / Strategist / Cross-Dealer Mirror / Cashflow Weather / Decision Cycle / Ecosystem / Reputation / Timeline / Fleet Radar / Lifecycle**.
- **Branch Command / Branch Chief / Territory Command**.
- **Time Bank / Inventory Pressure Board / Iron in Motion**.
- **Campaigns / Service-to-Sales / Parts Intelligence (mirror) / Equipment Detail (mirror) / Rep-SKU / Exit Register / Operations Copilot / Replacement Prediction / Competitive Threat Map / Seasonal Opportunity / Learning Layer / Revenue Rescue / Competitive Displacement / Operator Intelligence / Post-Sale Experience / Opportunity Map / Workflow Audit / My Reality / Ideas / Exceptions / Visit Intelligence / Trade Walkaround / Unmapped Territory / Mobile Field Command**.

### quote-builder
- **Quote Builder V2** — `/quote-v2` — [QuoteBuilderV2Page.tsx](apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx) (2600+ lines) — `qb_quotes`, `qb_deals`, `quote_packages`, `qb_price_sheets`, `qb_programs`, `qb_brands`, `qb_attachments` — CREATE/COMPOSE. Edge fns: `quote-builder-v2`, `quote-incentive-resolver`, `recommend-moves`, `tax-calculator`, `service-quote-engine`.
- **Quote List** — `/quotes` — LOOKUP.

### sales (simplified pipeline for rep mode)
- **Pipeline Board** — `/sales/board` — simpler Kanban.
- **Today Feed** — `/sales/today` — `crm_activities`, `crm_deals`, `follow_up_touchpoints` — MONITOR/COMPOSE.
- **Customers** — `/sales/customers` — `v_rep_customers`.
- **Customer Detail** — `/sales/customers/:id`.

### service (role: service / iron_man)
- **Service Command Center** — `/service`, `/service/command` — `service_jobs`, `service_job_status`, `service_technician_assignments` — MONITOR/REVIEW/COMPOSE. Edge fns: `service-job-router`, `service-calendar-slots`, `service-scheduler`.
- **Intake / Inspection+ / Agreements / WIP / Labor Pricing / Technician Mobile / Public Track / Branch Config / Dashboard / Efficiency / Scheduler Health / Shop Invoice / Parts Inventory / Parts Work Queue / Job Code Suggestions / Vendor Pricing Portal / Vendor Profiles**.

### sop
- **SOP Execution** — `/sop/execute` — `flow_workflow_runs`, `flow_workflow_run_steps` — CREATE/COMPOSE.
- **Template Editor / Templates List** — `flow_workflow_definitions`.

### voice-qrm
- **Voice QRM** — `/voice-qrm` — [VoiceQrmPage.tsx](apps/web/src/features/voice-qrm/pages/VoiceQrmPage.tsx) — transcript → contacts/companies/deals/tasks/ideas. Edge fn `voice-qrm`.

### voice-quote
- **Voice Quote** — `/voice-quote` — [VoiceQuotePage.tsx](apps/web/src/features/voice-quote/pages/VoiceQuotePage.tsx) — transcript → 2–4 scenarios → pick → `/quote-v2` pre-filled.

### Cross-feature
- **Chat / Ask Iron** — `/chat` — contextual AI assistant.
- **OmniCommand** — [OmniCommand.tsx](apps/web/src/components/OmniCommand.tsx) — Cmd+K global palette.
- **QRM Global Search** — [QrmGlobalSearchCommand.tsx](apps/web/src/features/qrm/components/QrmGlobalSearchCommand.tsx) — fuzzy contact/company search on QRM surfaces.
- **Voice Capture (global)** — `/voice` — reusable VoiceRecorder + VoiceNoteCapture.
- **Voice History** — `/voice/history`.

---

## B. PERMISSION MODEL

### B1. Role enums

**System role** (enum `public.user_role`, migration 001 + 310):
`rep | admin | manager | owner | client_stakeholder`

Stored in `profiles.role`. TypeScript type at [database.types.ts](apps/web/src/lib/database.types.ts).

**Iron role** (text, CHECK-constrained, migrations 067 + 210 + 374 + 375):
`iron_manager | iron_advisor | iron_woman | iron_man | iron_owner | iron_parts_counter | iron_parts_manager`

Stored in `profiles.iron_role` and in `profile_role_blend` (time-bounded, weighted multi-role). Both constraints synced via [migrations 374/375]. TypeScript type at [iron-roles.ts](apps/web/src/features/qrm/lib/iron-roles.ts).

Display names ([role-display-names.ts](apps/web/src/features/floor/lib/role-display-names.ts)):
| Iron role | Display | Job |
|---|---|---|
| `iron_manager` | Sales Manager | pipeline, approvals, pricing authority |
| `iron_advisor` | Sales Rep | customer relationships, 10 visits/day, lead-response SLA |
| `iron_woman` | Deal Desk | orders, credit apps, deposits, invoicing |
| `iron_man` | Prep / Service | support tech, prep, PDI, service flows |
| `iron_owner` | Owner | strategic approvals, risk signals |
| `iron_parts_counter` | Parts Counter | serial-first lookup, fast quote, draft tracking |
| `iron_parts_manager` | Parts Manager | demand forecast, inventory, replenishment |

### B2. Auto-sync trigger
[Migration 067] adds `sync_iron_role()` trigger — whenever a profile's `role` or `is_support` changes, `iron_role` is derived. [Migration 210] extends it to also close old `profile_role_blend` rows and insert a fresh weight=1.0 row. Users do not directly edit `iron_role`.

Legacy mapping used when `iron_role` is NULL:
- `manager`/`owner` → `iron_manager`
- `admin` → `iron_woman`
- `rep` + `is_support=false` → `iron_advisor`
- `rep` + `is_support=true` → `iron_man`

### B3. Role checks at runtime

**Helpers (migration 005):**
- `public.get_my_role() returns user_role` — SELECTs `profiles.role` for `auth.uid()`.
- `public.get_my_iron_role() returns text` — SELECTs `profiles.iron_role` (rarely used; frontend prefers blend resolution).
- `public.get_my_workspace() returns text` — multi-tenant scoping.

**RLS pattern (migration 365 hardened):**
```sql
using (
  (select public.get_my_workspace()) = workspace_id
  and (select public.get_my_role()) in ('manager', 'owner', 'admin')
)
```
The `(select ...)` wrapper avoids InitPlan re-evaluation per row.

**Frontend resolution** ([useIronRoleBlend.ts](apps/web/src/features/qrm/lib/useIronRoleBlend.ts)):
1. Query `v_profile_active_role_blend` — weighted rows with `effective_to IS NULL`.
2. Pick highest-weight (`getDominantIronRoleFromBlend`).
3. Fall back to `profiles.iron_role` column.
4. Fall back to legacy role map.

### B4. Home route resolution ([home-route.ts](apps/web/src/lib/home-route.ts))
`resolveHomeRoute(userRole, ironRole?, audience?, floorMode?)`:
1. `audience=stakeholder` → `/brief`
2. `floorMode=true` → `/floor`
3. By iron_role: `iron_woman` → `/parts/companion/queue`; `iron_man` → `/service`; `iron_manager` → `/qrm`; `iron_advisor` → `/sales/today`.
4. By system role: `owner` → `/owner`; `admin|manager` → `/qrm`; `parts` → `/parts/companion/queue`; `service` → `/service`; `rep` → `/sales/today`; default `/dashboard`.

`canUseElevatedQrmScopes()` — true if owner/admin/manager OR `iron_manager`.

### B5. Floor mode flag
`profiles.floor_mode boolean default false` (migration 374). Per-user, not per-role. Brian flips per rep as they onboard. When `true`, users land on `/floor` (seven-role curated). When `false`, they land on legacy IronXxxDashboard — **which only exists for 4 of the 7 iron_roles**; `iron_owner`, `iron_parts_counter`, `iron_parts_manager` fall through to IronAdvisorDashboard. For these three, `floor_mode=true` is effectively required.

### B6. Floor layouts RLS ([migration 374])
`floor_layouts` table keyed on `(workspace_id, iron_role, user_id nullable)`.
- `floor_layouts_select` — workspace members can read.
- `floor_layouts_manage` — only admin/manager/owner can INSERT/UPDATE/DELETE.
- Widget `allowedRoles` is **a palette filter, not a hard gate** — nothing stops a crafted layout JSON from including a disallowed widget. Security lives in the composer UI.

### B7. Edge function auth
Edge functions receive JWT; must call `supabase.auth.getUser(token)` explicitly (argless variant 401s silently on Deno — see memory `feedback_supabase_jwt_auth.md`). Cron-invoked functions use `x-internal-service-secret` and must have `verify_jwt=false` in `config.toml`.

### B8. What each role can touch (concrete)

| Role | Landing (floor_mode=true) | Can write | Can admin |
|---|---|---|---|
| `iron_advisor` (Sales Rep) | `/floor` → quotes, follow-ups, voice | deals, activities, quotes drafts | no |
| `iron_manager` (Sales Manager) | `/floor` → approvals, pipeline | everything reps can + approvals | yes (elevated) |
| `iron_woman` (Deal Desk) | `/floor` → orders, deposits | credit apps, deposits, invoices | yes (ops admin) |
| `iron_man` (Prep/Service) | `/floor` → prep queue, PDI | job status, inspections, parts consumption | no |
| `iron_owner` (Owner) | `/floor` → brief, health | approval overrides | yes (full) |
| `iron_parts_counter` (Counter) | `/floor` → serial lookup, drafts | parts quotes, parts requests | no |
| `iron_parts_manager` (Parts Mgr) | `/floor` → forecast, replenish | reorder, inventory adjustments | yes (parts ops) |

---

## C. EXISTING QUICK ACTIONS

### C1. COMPOSE button (top bar)
- **Component:** [FloorTopBar.tsx](apps/web/src/features/floor/components/FloorTopBar.tsx:54)
- **Opens:** [/floor/compose](apps/web/src/features/floor/pages/FloorComposePage.tsx) — drag-drop layout editor
- **Role-gated:** admin/manager/owner only
- **Actions inside:** add/remove/reorder widgets (max 6), add/edit/delete quick actions (max 3), toggle narrative, reset to defaults, view audit history, save (inherits to role default or user override)
- **NOT a create-a-thing button.** The mockup's use of "COMPOSE" in the top bar corner is visually aligned with this action.

### C2. JUMP TO dropdown (top bar, non-admin + admin)
- **Component:** [FloorJumpMenu.tsx](apps/web/src/features/floor/components/FloorJumpMenu.tsx:32)
- **Five targets (same for every role):** QRM → `/qrm`, Sales → `/sales/today`, Parts → `/parts`, Service → `/service`, Rentals → `/rentals`
- Not role-curated. No telemetry for which target is clicked most.

### C3. Quick Action cards (Floor hero, 02 ACTIONS)
Defined in [floor_layouts.layout_config.quickActions[]](supabase/migrations/374_floor_layouts_and_iron_role_expansion.sql) — max 3 per role. Rendered by [FloorHero.tsx](apps/web/src/features/floor/components/FloorHero.tsx). Primary (first) card has orange left rule + orange icon square; secondary cards gain orange affordance on hover.

**Per-role defaults** ([default-layouts.ts](apps/web/src/features/floor/lib/default-layouts.ts)):
| Role | Action 1 (primary) | Action 2 | Action 3 |
|---|---|---|---|
| `iron_owner` | ASK IRON → `/iron` | OPEN PIPELINE → `/qrm` | MONTHLY REPORT → `/admin/deal-economics` |
| `iron_manager` | OPEN APPROVALS → `/qrm/approvals` | NEW QUOTE → `/quote-v2` | SEARCH CUSTOMER → `/qrm/companies` |
| `iron_advisor` | NEW QUOTE → `/quote-v2` | VOICE → `/voice` | LOG VISIT → `/qrm/visits/new` |
| `iron_woman` | CREDIT APP → `/credit/new` | DEPOSIT → `/deposits/new` | SEARCH CUSTOMER → `/qrm/companies` |
| `iron_man` | NEXT JOB → `/service/wip` | PDI CHECKLIST → `/service/inspections` | PARTS PICKUP → `/parts/orders?status=ready` |
| `iron_parts_counter` | NEW PARTS QUOTE → `/parts/orders/new` | LOOKUP SERIAL → `/parts/companion/lookup` | OPEN DRAFTS → `/parts/orders?status=draft` |
| `iron_parts_manager` | REVIEW REPLEN → `/parts/companion/replenish` | INVENTORY → `/parts/inventory` | SUPPLIER STATUS → `/parts/companion/suppliers` |

### C4. Cmd+K command palette
**OmniCommand** ([OmniCommand.tsx](apps/web/src/components/OmniCommand.tsx)) — global, always-mounted.
- Document search (semantic, confidence-scored)
- Jump targets (role-filtered): Dashboard, Document Center, Pending Review, Ingest Failures, QRM, Parts Companion, Service

**QrmGlobalSearchCommand** ([QrmGlobalSearchCommand.tsx](apps/web/src/features/qrm/components/QrmGlobalSearchCommand.tsx)) — QRM surfaces only.
- Fuzzy contact search → `/qrm/contacts/:id`
- Fuzzy company search → `/qrm/accounts/:id`

Both: `⌘K` open, `↑↓` nav, `↵` select, `esc` close.

### C5. Keyboard shortcuts

**Parts Companion** ([PartsCompanionShell.tsx](apps/web/src/features/parts-companion/components/PartsCompanionShell.tsx:50-122)) — richest shortcut set in the app:
| Key | Action |
|---|---|
| `/` | Jump to Lookup |
| `N` | New Request flow |
| `V` | Voice Ops modal |
| `A` or `I` | AI panel toggle |
| `Q` | Sidebar toggle |
| `Cmd+K` | Jump to Lookup (focus search) |
| `Esc` | Close modals (priority: Voice → NewRequest → AIPanel) |

**Quote Builder** — `Cmd+K` inside CustomerPicker focuses input.

**Global** — `Cmd+K` opens OmniCommand everywhere.

### C6. Voice entry points
| Surface | Route / trigger | Edge fn | Writes to |
|---|---|---|---|
| Voice-to-QRM | `/voice-qrm` or `?deal_id=` | `voice-qrm` | `qrm_contacts`, `qrm_companies`, `qrm_deals`, `qrm_tasks`, `qrm_ideas` |
| Voice-to-Quote | `/voice-quote` | `voice-qrm` + `qb-ai-scenarios` SSE | `qb_packages`, `qb_ai_request_log`, sessionStorage handoff |
| Conversational Deal Engine | in `/quote-v2` right panel | `voice-qrm` | updates in-flight quote |
| Parts Voice Ops | `V` in Parts Companion, [VoiceOpsModal.tsx](apps/web/src/features/parts-companion/components/VoiceOpsModal.tsx) | (via parts request) | `parts_requests` |
| Voice Note Capture | [VoiceNoteCapture.tsx](apps/web/src/features/sales/components/VoiceNoteCapture.tsx:6), used in [CaptureSheet.tsx:374](apps/web/src/features/sales/components/CaptureSheet.tsx:374) | `voice-capture` | voice metadata + downstream routing |

### C7. Serial / scan inputs
- **SerialFirstWidget** ([SerialFirstWidget.tsx](apps/web/src/features/floor/widgets/SerialFirstWidget.tsx)) — Floor widget, paste-tolerant, debounced ILIKE against `qrm_equipment.serial_number`, 3-panel snapshot, opens `/qrm/equipment/:id`. **In `iron_parts_counter` default layout.**
- **LookupPage** ([LookupPage.tsx](apps/web/src/features/parts-companion/pages/LookupPage.tsx)) — Parts Companion free-form part-number search with autocomplete; supports voice trigger.
- **QrmEquipmentFormSheet** — form inputs for `serialNumber`, `vinPin`, `assetTag` (manual entry in equipment create/edit).
- **No dedicated barcode scanner UI** — would rely on OS-level scanner input.

### C8. Quick-add flows
- **New Quote** — `/quote` list page "New Quote" button OR `/quote-v2` auto-creates draft on load OR voice → scenario → nav to `/quote-v2`.
- **New Parts Request** — `N` in Parts Companion opens `NewRequestFlow` modal (4 steps: source → machine → parts → review). Writes to `parts_requests`.
- **No single "new activity" or "new work order" quick-add** — both created from context (deal detail, service intake).

---

## D. DATA SURFACES FOR URGENCY SIGNALS

This table answers "where does each 'this needs attention' signal come from" — needed in Phase 2 to ground workflow inference in real data.

| Signal | Table / RPC / view | Refresh cadence |
|---|---|---|
| Deal aging / stage duration | `qrm_deals.stage_changed_at` + `qrm_stage_transitions` | real-time |
| Deal stalled (no touch 7d+) | `qrm_activities.occurred_at` max() + `moves` | 5m (`recommend-moves`) |
| Deal at-risk score | `qrm_predictions` + `qrm-prediction-scorer` cron | daily |
| Approval pending >SLA | `flow_approvals.requested_at`, `quote_approval_cases.submitted_at` | real-time |
| Margin below floor | `quote_approval_case_conditions`, `qb_margin_exceptions` | on submit |
| Service job overdue | `service_jobs` + `service_tat_targets` + `service-tat-monitor` | hourly |
| Parts low stock | `parts_inventory.quantity < parts_replenishment_rules.min_qty` + `parts_auto_replenish_queue` | 6h |
| Parts forecast risk | `parts_demand_forecasts` + `parts_forecast_risk_summary` view | daily |
| Company health score | `compute_customer_health_score()` RPC + `health_score_history` snapshots | daily |
| Payment past due / credit block | `customer_invoices.due_date` + `ar_credit_blocks` | real-time |
| Equipment service due | `get_asset_countdowns()` RPC (engine_hours vs intervals) | real-time |
| Trade-up window | `get_asset_badges()` RPC + `replacement_cost_curves` | real-time |
| Competitor / news mention | `signals` (signal_kind='competitor_mention') + `news-mention-scan` | hourly |
| Commission MTD | **not persisted** — computed on-demand from deals + invoices. Rules undefined. | N/A |

---

## E. AUDIT COMPLETENESS

Five parallel explore passes completed:
1. ✅ Feature inventory (28 feature modules, 100+ routes, 100+ edge fns)
2. ✅ Permission model (7 iron roles + blend + RLS + home routing)
3. ✅ Existing quick actions (Compose, Cmd+K, JUMP TO, 7 role default action sets, Parts keyboard shortcuts, 5 voice surfaces)
4. ✅ Current Floor state (45 widgets, default layouts for all 7 roles, narrative edge fn with fallback, in-flight FloorHero/Narrative changes)
5. ✅ Backend data model (380 migrations; domain-grouped)

**Read-only guarantee:** No files modified in Phase 1.

**Next:** Phase 2 — derive per-role daily workflow from this audit.
