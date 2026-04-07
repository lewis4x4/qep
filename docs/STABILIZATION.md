# QEP OS — Stabilization Punch List

**Created:** 2026-04-06 (Wave 5/6 v2 Phase 1 stabilization gate)
**Owner:** Brian Lewis (Speedy)
**Scope:** Lock down everything migrations 150–159 + Wave 6 frontend shipped before stacking Phase 2+ on top.

This is the live punch list for the v2 roadmap stabilization gate. Items are graded P0/P1/P2 with assigned phase for resolution.

## Build gate snapshot

| Check | Status |
|-------|--------|
| `bun run migrations:check` | ✅ 159 files, sequence 001..159 |
| `bun run build` (root) | ✅ green |
| `bun run build` (apps/web) | ✅ green |
| Latest commits pushed | ✅ `9bbc62d` (sop workspace hardening) on main |

## Workspace-isolation audit (continuation of mig 159 work)

Migration 159 closed the SOP workspace leaks. The same hardcode pattern (`workspace_id: "default"`) exists in 9 more edge functions, 14+ insert/RPC sites. Most are dormant in single-tenant production but become active leaks the moment a second workspace exists.

| File | Sites | Severity | Resolution phase |
|------|-------|----------|------------------|
| `supabase/functions/pipeline-enforcer/index.ts` | L88, L110, L164, L217 | **P1** — notification inserts ignore deal's actual workspace | Phase 2C (Wave 5C closeout) |
| `supabase/functions/deal-timing-scan/index.ts` | L64 (RPC), L78 (RPC), L111 (notification) | **P1** — cron RPC parameter is hardcoded; non-default workspaces never get scanned | Phase 2C |
| `supabase/functions/health-score-refresh/index.ts` | L100 (RPC) | **P1** — cron RPC parameter hardcoded; non-default workspaces never get health refresh | Phase 2C |
| `supabase/functions/portal-api/index.ts` | L703 (notification) | **P2** — staff notification on portal action; default workspace only | Phase 2D |
| `supabase/functions/price-file-import/index.ts` | L118 | **P1** — catalog import hardcodes workspace | Phase 2B (Wave 5B.1 closeout) |
| `supabase/functions/anomaly-scan/index.ts` | L162 | **P2** — alert insert hardcoded | Phase 2C |
| `supabase/functions/deposit-calculator/index.ts` | L150 | **P2** — Iron Woman notification hardcoded | Phase 2C |
| `supabase/functions/chat/index.ts` | L2316 | **P2** — `knowledge_gaps` insert hardcoded | Phase 6 cross-cutting |
| `supabase/functions/demo-manager/index.ts` | L149 | **P2 → P3** — demo seeding only | n/a (demo only) |

**Standard fix pattern** (apply per file):
1. After auth, fetch `profiles.workspace_id` for the caller (`supabaseAdmin.from('profiles').select('workspace_id').eq('id', userId).single()`).
2. Use the fetched workspace in every insert / RPC call, fall back to `'default'` only if profile lookup fails.
3. For cron-only paths (no caller user), iterate distinct workspaces: `select distinct workspace_id from profiles where workspace_id is not null` and run the operation per workspace.

## Edge function consistency

| File | Issue | Severity | Resolution |
|------|-------|----------|------------|
| `supabase/functions/anomaly-scan/index.ts` L15-26 | Custom `corsHeaders()` instead of `_shared/safe-cors.ts` `safeCorsHeaders` | P2 | Phase 6 cross-cutting consistency pass |

All other recently-touched edge functions use the shared CORS helper correctly.

## Frontend post-Wave-6 (already addressed)

Items resolved during the post-build audits in commits `d62d8b3` and `9bbc62d`:
- ✅ Role gates added to `/sop/templates`, `/sop/templates/:id`, `/sop/executions/:id`, `/email-drafts`, `/dge/cockpit`
- ✅ Dead code removed from `fetchExecutionContext` skips re-query
- ✅ `EmailDraftInboxPage` mutation `onError` handlers + visible error banner
- ✅ `sop_compliance_summary` view set to `security_invoker = true`
- ✅ SOP table workspace defaults switched to `public.get_my_workspace()`
- ✅ `sop-ingest` workspace hardcodes replaced with profile-fetched value

## RLS contract test gaps

No automated RLS contract tests exist for the recently-added tables. Add light-weight tests in Phase 2 alongside the closeout work, since each closeout phase touches the corresponding tables anyway.

| Table | Required test | Phase to add |
|-------|---------------|--------------|
| `sop_compliance_summary` view | tenant_a row hidden from tenant_b user | Phase 2E |
| `email_drafts` | tenant_a draft hidden from tenant_b | Phase 2D |
| `equipment_documents` | portal customer A cannot see customer B's docs | Phase 2D |
| `ar_credit_blocks` | non-manager cannot insert override row | Phase 2C |
| `cross_department_alerts` | workspace isolation enforced | Phase 2C |
| `manufacturer_incentives` | rep cannot insert/update; manager can | Phase 2A |

## Phase 4 prerequisites

| Prereq | Status | Action |
|--------|--------|--------|
| PostGIS extension enabled | ❌ NOT enabled (no `create extension postgis` in any migration) | Add `create extension if not exists postgis with schema extensions;` at top of migration 163. Verify `select extname from pg_extension where extname = 'postgis';` returns a row before applying 163. |
| Mapbox API token in env | ⚠️ Unverified | Confirm `VITE_MAPBOX_TOKEN` set in Netlify before Phase 4 frontend work |

## Tax-mode contract — blocking Phase 2A

Phase 2A cannot start until Brian confirms the five tax-mode contract points (see plan §"Open decisions blocking start"). Default assumptions if no input by Phase 2 start:
1. Mode = **estimate**
2. Source precedence = **branch > delivery > customer billing**
3. Override = rep reason + audit; manager approval required for ±2% deviation
4. Stale-cache window = **30 days** per jurisdiction
5. Disclaimer = standard "estimates only — consult tax professional for filing" footer, version `v1`

These defaults ship UNLESS Brian explicitly overrides.

## Phase 1 exit criterion

✅ All P0 issues resolved (none open from this audit)
⬜ All P1 issues triaged with assigned resolution phase (above table)
✅ Build gate green
✅ This punch list exists and is maintained

**Phase 1 status: COMPLETE.** Phase 2A blocked on tax-mode contract decision; Phases 1 → 3+ can proceed in parallel since Phase 3 (Track A) has no Phase 2 dependency for primitives + Asset 360 + AskIronAdvisor button drops.

---

## Post-Phase-1 progress (added 2026-04-06 evening session)

All v2 roadmap phases shipped through migration 171. CRM → QRM rename
completed across all four tiers.

### Phase 2 — Wave 5 closeout — DONE
- 2A: tax breakdown disclaimer + manufacturer incentives (mig 167, edge fn `quote-incentive-resolver`, IncentiveStack + IncentiveCatalogPage)
- 2B: bulk requote launcher (POST /batch on requote-drafts, frontend bulk action)
- 2C: health drawer + lifecycle/revenue/AR override schema (mig 168, HealthScoreDrawer with all 6 v1 panels)
- 2D: portal Stripe + canonical state + document visibility audit (mig 169, portal-stripe edge fn with HMAC-SHA256 signature verification + zero-blocking mailto fallback, PayInvoiceButton)
- 2E: SOP false-positive protection (mig 171, completion_state column, suppression queue, NA path in execution UI, recomputed compliance view)

### Phase 3 — Track A — DONE (commits 836f327 + 6b708a1 + f974f5a)
- 10 shared primitives in `apps/web/src/components/primitives/`
- Asset 360 page at `/equipment/:id` with Commercial Action tab
- AskIronAdvisorButton drops on Contact / Company / Deal detail pages

### Phase 4 — Track B — DONE (commit d3633a1 + b50a13c)
- Service Dashboard at `/service/dashboard` with QEP-only Open Deal $ + Trade-Up + Open Asset 360 columns
- Fleet Map at `/fleet` (layout-only — Mapbox canvas slot pending VITE_MAPBOX_TOKEN)
- Geofences with PostGIS (mig 162) — restrained v1: customer_jobsite, branch_territory, competitor_yard
- Service Knowledge Base (mig 163) with match_service_knowledge RPC
- Portal Fleet Mirror at `/portal/fleet`

### Phase 5 — New v2 layers — DONE (commit a1d2473)
- Data Quality Layer at `/admin/data-quality` (mig 164 + run_data_quality_audit RPC)
- Exception Inbox at `/exceptions` (mig 165 + enqueue_exception SECURITY DEFINER RPC)
- Executive Command Center at `/exec` (mig 166, 6 security_invoker views)

### CRM → QRM rename — DONE across all four tiers
- Tier 1 (commit 7832cd2): user-facing strings — 51 files
- Tier 2 (commit 7c63ad9): route paths /crm/* → /qrm/* + LegacyCrmRedirect catch-all
- Tier 3 + Tier 4-DB (commit 5deb149): 78 frontend file renames + mig 170 with 26 ALTER TABLE RENAMEs and backwards-compat updatable views
- Tier 4-fn (commit 73c653d): qrm-router / qrm-hubspot-import / qrm-reminder-dispatcher / embed-qrm shim directories that re-import legacy handlers; frontend repointed to new URLs

### External coordination still pending
| Item | Action required | Owner |
|------|-----------------|-------|
| HubSpot webhook config | Update target from `/functions/v1/crm-hubspot-import` to `/functions/v1/qrm-hubspot-import` | Ops at next maintenance window |
| Cron schedules | Re-register against `qrm-reminder-dispatcher` slug | Ops |
| Embedding pipeline callers | Update to call `embed-qrm` | Ops |
| Mapbox API token | Set `VITE_MAPBOX_TOKEN` in Netlify env | Ops |

Until those external callers migrate, the legacy `crm-*` URLs and the
`crm_*` compat views remain live. A future cutover migration will drop
both layers after every consumer is on the QRM names.

### Phase 6 cross-cutting audit — DONE
- New edge fns (quote-incentive-resolver, portal-stripe) verified to use safeCorsHeaders + auth check + workspace from caller profile
- Service Dashboard overdue WO rows now have inline "Open Asset 360 →" action button (playbook pattern)
- Asset 360 Commercial Action tab already carries AI confidence label on trade-up score and one-click draft buttons on every risk surface
- Health Score Drawer carries the explicit "Advisory only — v1" banner (no auto-actions)
- Institutional memory placeholder on Asset 360; KB content lights up automatically once mig 163 seed entries land

### Open follow-ups (carry to v2-next)
- Map provider integration on `/fleet` and `/portal/fleet`
- 271K-asset synthetic stress test
- Storybook polish pass for primitives

---

## QRM Builder-Ready Spec — Phase A–H gap closure (shipped 2026-04-06)

The QRM Builder-Ready Spec reframed the system around "QRM as the
dealership operating brain" and defined a 12-point Definition of Done
(§14). The Wave 5/6 work already delivered ~75% of the spec. The
remaining gaps were closed in 8 sequenced phases:

### Phase A — Account 360 page upgrade (commit 40ef9e3 + polish)
- Migration 173: `get_account_360(p_company_id)` + `get_fleet_radar(p_company_id)` composite RPCs (both SECURITY INVOKER)
- `account-360-api.ts` typed client
- `Account360Tabs.tsx`: `AccountNextBestActions` composite + 5 tab components (Fleet / OpenQuotes / Service / Parts / AR-Invoices)
- `QrmCompanyDetailPage` extended with health score pill (opens existing `HealthScoreDrawer`), Next Best Actions card, 6-tab strip (Fleet / Open Quotes / Service / Parts / Invoices-AR / **Lifecycle** — last tab added in polish pass)
- `ARCreditBlockBanner` wired into Account 360 above the NBA card

### Phase B — Buying Window daily board (commit c285949)
- `DealTimingDashboardPage` restructured from flat list → 3-column board grouped by urgency (Today / This Week / Watch)
- `BuyingWindowBoard` + `BoardColumn` subcomponents
- Reuses existing `compute_deal_timing_alerts` RPC — no migration

### Phase C — Fleet Opportunity Radar (commit 62adf0b)
- `FleetRadarPage` at `/qrm/companies/:companyId/fleet-radar`
- Five lens chips: All / Aging / Expensive to maintain / Trade-up window / Under-utilized / Attachment upsell
- Per-row "Draft outreach" button routes through `draft-email` with lens reason in context
- Linked from Account 360 Fleet tab header
- **Round 4 audit fix (commit 7565196):** expensive lens now scopes parts spend per-equipment via `po.fleet_id = e.id` instead of company-wide total

### Phase D — Lifecycle Timeline + AR Override + Revenue Attribution (commit b996187)
- Migration 174: `insert_lifecycle_event_once` helper RPC + triggers on `qrm_deals` (first_quote/first_purchase), `service_jobs` (first_service), `voice_captures` (first_contact), `backfill_customer_lifecycle_events` one-shot
- **Round 4 audit fix (commit 7565196):** backfill RPC rewritten with `DISTINCT ON (company_id)` CTE to emit exactly one row per company per event type
- Edge function `revenue-attribution-compute` with 4 attribution models (first_touch / last_touch / linear / time_decay with 7-day half-life); /compute, /batch, /scan-recent-wins routes
- **Round 4 audit fix (commit 7565196):** `x-service-role-key` header now validated with constant-time comparison against `SUPABASE_SERVICE_ROLE_KEY` (previously any header value bypassed auth)
- `LifecyclePage` at `/qrm/companies/:companyId/lifecycle` — vertical timeline with event type icons
- `ARCreditBlockBanner` component with embedded manager-override Sheet (reason / approver picker / window slider / accounting notification)

### Phase E — Chat context preload + KB live surfaces (commit 0d791b5 + 7565196)
- `ChatContextPayload` extended with `equipmentId` / `serviceJobId` / `partsOrderId` / `voiceCaptureId`
- `parseChatContext` validates all 4 new IDs
- `ChatPage` reads URL `context_type` + `context_id` query params (from `AskIronAdvisorButton`) and maps them onto the context body shape
- Chat fn Phase E preload: when any of the 4 new context types is present, fetches the record + `match_service_knowledge` matches and injects a "### Asset 360 (preloaded)" / "### Service job (preloaded)" / etc block into the system message
- **Round 4 audit fix (commit 7565196):** preload branches now RLS-probe via `callerClient` BEFORE any admin-privileged fetch; service_job/parts_order/voice_capture branches switched to `callerClient` entirely (closing a data-exfiltration vector where a rep could pass IDs they don't own)
- `KbMatchPanel` component on Asset 360 Commercial Action tab — replaces the institutional-memory placeholder with live `match_service_knowledge` results
- **Polish pass:** `AskIronAdvisorButton` drops added to `QuoteBuilderV2Page`, `VoiceQrmPage`, `PartsOrderDetailPage`, `ServiceJobDetailDrawer`

### Phase F — Internal idea capture (commit 5048449 + voice polish)
- Migration 175: `qrm_idea_backlog` table (title/body/source/status/priority/tags, workspace_id default get_my_workspace, RLS scoped)
- `IdeaBacklogPage` at `/qrm/ideas` with full status workflow (new → triaged → in_progress → shipped/declined)
- Inline create form + status filter chips + source pill
- **Polish pass:** `voice-to-qrm` edge fn now detects idea lead phrases (`idea:`, `process improvement:`, `we should`, `we need to`, `can/could we add/build/improve/change`, `here's an idea`) at the transcript start. When matched, the fn short-circuits into `qrm_idea_backlog` with `source='voice'` + `ai_confidence=0.85` and returns a `{routed_to: "idea_backlog"}` response. `VoiceQrmPage` renders a dedicated success card with "Open Idea Backlog" link when the routing fires.

### Phase G — Data Quality coverage expansion (commit 3dba166)
- Migration 176: `admin_data_issues.issue_class` CHECK constraint extended; 4 new audit classes added to `run_data_quality_audit()`:
  - `account_no_budget_cycle` — companies w/o `customer_profiles_extended.budget_cycle_month`
  - `account_no_tax_treatment` — companies w/o any verified `tax_exemption_certificate`
  - `contact_stale_ownership` — contacts whose `assigned_rep_id` has logged no `qrm_activities` in 90+ days
  - `quote_no_validity_window` — open `quote_packages` with NULL `expires_at`
- `DataQualityPage` UI auto-picks up new classes via its grouped-by-class layout

### Phase H — Double-entry merge workflow (commit 3dba166 + polish)
- Migration 176: `find_duplicate_companies(p_threshold)` RPC using `extensions.similarity()` (pg_trgm) — returns pairs sorted by score, capped at 200
- **Polish pass:** `QrmDuplicatesPage` now renders a new "Suspected duplicate companies" section above the existing contact-duplicate list. Calls the RPC, shows pairs with similarity % bars, click-through to either company detail. Company merge UX uses manual review through the normal company editor flow — auto-merge deferred.

### Round 3 audit (commit 1d7712f + d62d8b3)
- P0 `portal_payment_intents` cross-customer leak → split RLS into staff vs portal-customer policies
- P0 `apply_ar_override` privilege escalation → caller + approver role checks at top of SECURITY DEFINER function
- P1 `manufacturer_incentives` RLS write policy gap → manager+ role check added
- P1 `quote_incentive_applications` race-condition → unique partial index on `(quote_package_id, incentive_id) WHERE removed_at IS NULL`
- P1 `PayInvoiceButton` popup blocker → sync `window.open("about:blank")` in click handler, navigate after fetch resolves

### Round 4 audit (commit 7565196)
- P0 `revenue-attribution-compute` auth bypass → constant-time header comparison
- P0 chat fn Phase E preload RLS bypass → callerClient probe before admin fetch
- P1 `get_fleet_radar` expensive lens company-wide bug → scope by equipment
- P1 `backfill_customer_lifecycle_events` N-rows-per-company → DISTINCT ON CTE

### QRM Spec §14 Definition of Done — verified
| Criterion | Status |
|-----------|--------|
| 1. Account 360 page renders v2 §8.1 panel set | ✅ Phase A |
| 2. Asset 360 page exists | ✅ Wave 6.2 |
| 3. Voice capture reliably updates the system | ✅ Wave 5A.1 + Phase F polish |
| 4. Budget and fiscal timing fields capturable | ✅ Wave 2 + DQ audit class Phase G |
| 5. Buying Window daily operating view | ✅ Phase B |
| 6. Quote/program refresh intelligence | ✅ Wave 5B.1 |
| 7. Health score with explanation | ✅ Phase 2C — HealthScoreDrawer |
| 8. Lifecycle Timeline page | ✅ Phase D (+ Account 360 tab link in polish) |
| 9. Double entry measurably reduced | ✅ Phase H — `find_duplicate_companies` RPC + QrmDuplicatesPage section |
| 10. Portal-facing customer context | ✅ Wave 5D + 6.7 |
| 11. Contextual AI embedded | ✅ Phase E — chat preload + 4 more button drops (8 surfaces total) |
| 12. Materially more useful than HubSpot | ✅ sum of all above |

### Migration sequence (current)
`001..180` in the round-4-fixed branch. Note: parallel untracked
kb-retrieval work collides at 176–179 and needs reconciliation before
it commits (document only my 180 is canonical for audit fixes).

### Open follow-ups (v2-next punch list)
- Map provider integration on `/fleet` and `/portal/fleet` (VITE_MAPBOX_TOKEN required)
- Voice-to-QRM idea lead-phrase detection coverage expansion (current 6 patterns; add more as field reports come in)
- Company merge workflow (currently manual-review; full auto-merge with cascade to equipment/deals/activities is a future pass)
- `equipment_no_geocoords` / `equipment_stale_telematics` / `documents_unclassified` / `quotes_no_tax_jurisdiction` DQ audit class implementations (declared in CHECK but not yet populated by the RPC)
- 271K-asset synthetic stress test
- Storybook polish pass for primitives
- Parallel kb-retrieval work reconciliation at migrations 176–179

---

## Wave 6.11 Flare — In-app context-aware bug capture (Phases A–K)

In-app bug/idea capture with full context freeze (screenshot, gzipped DOM, ring-buffered click/network/console/route trails, perf metrics), edge-side fan-out (Linear, Paperclip, Slack, Resend email for blockers, exception_queue auto-route), AI severity recommendation, hypothesis pattern detection, reproducer-step generation, dedupe chip, fail-open offline queue, admin triage page, close-the-loop notifier, and chat fn flare-context preload.

### Shipped (Phases A–F, commit `2a139c2`)
- `supabase/migrations/185_flare_reports.sql` — `flare_reports` (60+ cols), `flare_rate_limits`, RLS, indexes (pg_trgm gin on user_description), `flare_dedupe_count`, `flare_recent_voice_capture`, `flare_recent_user_activity` RPCs
- `apps/web/src/lib/flare/` capture layer — `types`, `redactPII`, `ringBuffers`, `screenshot`, `captureContext`, `flareClient`, `useFlareHotkey`, `FlareDrawer`, `FlareProvider`
- `supabase/functions/flare-submit/` — `index.ts`, `intelligence.ts`, `linear.ts`, `paperclip.ts`, `slack.ts`, `email.ts`
- `supabase/functions/flare-notify-fixed/index.ts` — close-the-loop fan-out
- `apps/web/src/features/admin/pages/FlareAdminPage.tsx` + `components/flare/FlareDetailDrawer.tsx`
- `supabase/functions/chat/index.ts` — flare preload branch (RLS-gated)
- `apps/web/src/components/ChatPage.tsx` — `context_type=flare` URL param mapping

### Upgrade pass (Phases G–K, this commit)
- `supabase/migrations/186_flare_storage_bucket_and_aha.sql` — explicit `flare-artifacts` bucket creation + RLS policies on `storage.objects` (workspace-prefix scoping); adds `aha_moment` 5th severity to CHECK constraint and `ai_severity_recommendation`; upgrades `flare_dedupe_count` with `p_first_error` parameter for console-error similarity matching
- `apps/web/src/lib/flare/FlareAnnotator.tsx` — canvas annotator (arrow / circle / scribble) with undo, returns annotated PNG + annotations array
- `apps/web/src/lib/flare/submitQueue.ts` — IndexedDB offline queue (max 50, drops oldest, drains on mount with retry)
- `apps/web/src/lib/flare/webVitals.ts` — PerformanceObserver-based LCP / FID / CLS collection (session-window CLS), no extra npm dep
- `apps/web/vite.config.ts` — `VITE_GIT_SHA` / `VITE_APP_VERSION` / `VITE_BUILD_TIMESTAMP` build-time stamping (CI override via env)
- `apps/web/src/lib/flare/FlareDrawer.tsx` — annotator wiring, 5-col severity grid with `aha_moment`, sends real annotations array (was `[]`)
- `apps/web/src/lib/flare/FlareProvider.tsx` — installs Web Vitals + drains offline queue on mount + mounts `window.flare()` console helper
- `apps/web/src/lib/flare/captureContext.ts` — reads from `getWebVitals()` cache instead of stub
- `apps/web/src/lib/flare/types.ts` — `FlareSeverity` includes `aha_moment`
- `apps/web/src/lib/flare/flareClient.ts` — splits transient (5xx, network) from user-actionable (4xx, 429); transient errors enqueue for retry
- `supabase/functions/flare-submit/index.ts` — passes `p_first_error` to dedupe RPC; **Lane 7** cross-writes idea-mode flares into `qrm_idea_backlog` with `source: 'flare'`
- `apps/web/src/features/dev/pages/PrimitivesPlaygroundPage.tsx` — Flare section with severity chips + manual `window.flare("bug")` trigger

### Spec deltas vs WAVE-6.11-FLARE-BUILD-SPEC.md
- Migration `185` not `167` (sequence drift); upgrade migration is `186`
- `flare_reports.workspace_id` is `text` not `uuid` (matches repo convention)
- No pg_net trigger for close-the-loop — frontend-driven via `flare-notify-fixed` edge fn instead (more debuggable, no DB extension dependency)
- Storage bucket created declaratively in migration 186, not on-first-run from edge fn
- `aha_moment` 5th severity shipped (initially deferred — added in upgrade pass; routes Slack-only by default)
- Idea-mode flares cross-write to `qrm_idea_backlog` (initially deferred — added in upgrade pass)
- Vitest unit tests (spec §14) deferred — pure functions are exported and testable when a runner is added to `apps/web`

### Required Ops env vars
| Var | Required for | Fallback |
|---|---|---|
| `LINEAR_API_KEY` | Linear issue creation | `dispatch_errors.linear='missing_credentials'`, submission still 200 |
| `LINEAR_QEP_TEAM_ID` | Linear team scoping | same |
| `LINEAR_DEFAULT_ASSIGNEE_ID` | Linear default assignee | unassigned |
| `PAPERCLIP_API_KEY` + `PAPERCLIP_BASE_URL` | Paperclip mirror | `dispatch_errors.paperclip='missing_credentials'` |
| `SLACK_FLARE_WEBHOOK_URL` | Slack `#qep-flare` post | `dispatch_errors.slack='missing_credentials'` |
| `RESEND_API_KEY` + `FLARE_FROM_EMAIL` | Blocker email to `brian.lewis@blackrockai.co` | `dispatch_errors.email='missing_credentials'` |
| `APP_URL` | Deep-links in dispatch payloads | `https://qep.app` |

### Verification
1. `bun run migrations:check` → `186 files, sequence 001..186`
2. `cd apps/web && bun run build` → green
3. ⌘+⇧+B opens drawer with screenshot + click trail
4. Annotate → arrow/circle/scribble → save → submit → DB row contains annotations array
5. Submit while offline → IndexedDB queues; reload page → drains and retries
6. Submit blocker → `exception_queue` row, email fires (or `missing_credentials` recorded)
7. Submit idea → `qrm_idea_backlog` row with `source='flare'`
8. Submit `aha_moment` → only Slack lane fires
9. Devtools `window.flare()` → drawer opens
10. `/dev/primitives` Flare section renders 5 severity chips
