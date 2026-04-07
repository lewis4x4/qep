# QEP Knowledge Assistant — Complete System Reference

> **Purpose:** Single-source-of-truth technical reference for the entire QEP application stack — frontend, backend, database, edge functions, integrations, and configuration. This document is engineered to be loaded into Claude (or any LLM with code-search capability) as project history so it can reason about the codebase without re-discovering everything.
> 
> **Reference date:** April 2026
> **Repo:** `/Users/brianlewis/Projects/qep-knowledge-assistant`
> **Migrations head:** 202
> **Edge functions:** ~105
> **Frontend routes:** 80+

---

## 0. Executive snapshot

QEP OS is a **multi-tenant operational platform for an equipment dealership**. It runs sales (QRM), service jobs, parts logistics, rentals, deposits, finance, customer portal, voice capture, knowledge base / chat assistant, executive dashboards, in-app error capture (Flare), an event-driven workflow engine (Flow Engine), and an AI companion layer (Iron). It has been built incrementally across **dozens of named "Waves"** of work (Wave 1 → Wave 7), each adding a domain.

The system is intentionally **API-first, audit-heavy, and composition-friendly**: nearly every domain emits events, every cross-functional concern surfaces in the unified `exception_queue`, and every privileged action writes to `analytics_action_log`. New modules plug into the same primitives without forking.

---

## 1. Tech stack

### Runtime + tooling
| Layer | Choice | Notes |
|---|---|---|
| **Package manager** | **Bun** | Required — never npm/yarn/pnpm. `bun.lock` is the source of truth |
| **Frontend runtime** | Bun (build) → Browser | Browser executes the Vite build output |
| **Edge function runtime** | **Deno 2.1.4** | Supabase Edge Functions; imports via `jsr:` and `https://` |
| **Build tool** | **Vite 6.4.2** | Manual chunk splitting; Sentry source-map upload |
| **Bundler target** | ES2020 | strict TypeScript |
| **Hosting** | **Netlify** (frontend) + **Supabase** (backend) | netlify.toml at repo root; Supabase project id `iciddijgonywtxoelous` |

### Frontend libraries
| Library | Version | Purpose |
|---|---|---|
| React | 18.3.1 | Core |
| React Router DOM | 6.28.0 | SPA routing with `lazy()` code-splitting |
| TypeScript | 5.7.2 | strict mode, jsx: react-jsx |
| Tailwind CSS | 3.4.16 | Dark-mode, HSL color variables, QEP brand tokens |
| @tailwindcss/typography | 0.5.19 | Prose styling |
| Radix UI | 1.x / 2.x | Primitives: Dialog, Dropdown, Tabs, Tooltip, Toast, Avatar, Label, Separator, Slot |
| shadcn/ui pattern | (vendored in `components/ui/`) | Button, Card, Sheet, etc. — built on Radix |
| Lucide React | 1.7.0 | Icon library |
| TanStack React Query | 5.90.2 | Server state, caching, refetch policies |
| Zustand | (via theme-store.ts) | Theme persistence (very minimal use) |
| MapLibre GL | 5.22.0 | WebGL vector maps (~280 KB gzip — split chunk) |
| html2canvas | 1.4.1 | Screenshot capture (Wave 6.11 Flare) |
| pako | 2.1.0 | Gzip compression for DOM snapshot uploads |
| PapaParse | 5.5.3 | CSV parsing |
| react-markdown | 10.1.0 + remark-gfm 4.0.1 | Markdown rendering for chat + admin |
| @dnd-kit/* | 6.3.1 | Drag-and-drop |
| @sentry/react + @sentry/vite-plugin | 10.47.0 | Error tracking + session replay + source maps |
| @supabase/supabase-js | 2.49.1 | DB / auth / realtime / functions / storage client |
| cmdk | 1.1.1 | Command palette |

### Notable absences
- **No Anthropic or OpenAI SDK in `apps/web`** — all LLM calls go through edge functions
- **No vitest / jest / playwright in `apps/web`** — there is no frontend test runner configured
- **No ESLint config** — relies on `tsc --noEmit` for safety
- **No Redux/Recoil/Jotai** — Zustand only for theme; React Query owns server state

---

## 2. Repository layout

```
/Users/brianlewis/Projects/qep-knowledge-assistant/
├── package.json                       # workspace root: { "workspaces": ["apps/*"] }
├── bun.lock
├── deno.json                          # nodeModulesDir: auto
├── netlify.toml                       # build = "bun run build" in apps/web; CSP headers
├── tsconfig.json
├── tailwind.config.js
├── .env.example                       # Documented edge fn secrets
├── apps/
│   └── web/                           # Main SPA (Vite + React + TypeScript)
│       ├── package.json               # @qep/web
│       ├── vite.config.ts             # manual chunks, Sentry plugin, git SHA stamping
│       ├── tsconfig.json              # paths: @/* → ./src/*
│       ├── .env.example
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx               # Sentry init + AppErrorBoundary
│       │   ├── App.tsx                # 1500+ lines, 80+ routes, all role-gated
│       │   ├── index.css              # Tailwind base + QEP color tokens
│       │   ├── instrument.ts          # Sentry init + React Router tracing
│       │   ├── components/
│       │   │   ├── ui/                # shadcn-style Radix wrappers
│       │   │   ├── primitives/        # QEP Wave 6.1 shared dashboard primitives
│       │   │   ├── AppLayout.tsx
│       │   │   ├── ChatPage.tsx       # 280+ lines — entry point for AI assistant
│       │   │   ├── AdminPage.tsx
│       │   │   ├── DashboardPage.tsx
│       │   │   ├── LoginPage.tsx
│       │   │   ├── HubSpotConnectPage.tsx
│       │   │   ├── IntegrationHub.tsx
│       │   │   ├── VoiceCapturePage.tsx
│       │   │   ├── QuoteBuilderPage.tsx
│       │   │   └── NotFoundPage.tsx
│       │   ├── features/              # 21 feature domains (see §5)
│       │   ├── hooks/                 # useAuth, useBranches, useMyWorkspaceId, useTheme, use-toast
│       │   ├── lib/
│       │   │   ├── supabase.ts        # createClient
│       │   │   ├── database.types.ts  # Generated Supabase types (~342 KB)
│       │   │   ├── flare/             # Wave 6.11 in-app error capture
│       │   │   ├── iron/              # Wave 7 AI companion
│       │   │   └── nav-config.ts
│       │   └── pages/                 # legacy; mostly migrated into features/
│       └── dist/                      # Vite build output
├── supabase/
│   ├── config.toml                    # project_id, function configs, auth, db
│   ├── functions/                     # ~105 Deno edge functions
│   │   └── _shared/                   # Reusable Deno modules (auth, CORS, integrations)
│   └── migrations/                    # 202 versioned SQL files
├── scripts/                           # CI scripts, demo seeders, eval harnesses, deno check, kb-eval
├── docs/                              # Architecture, ops, testing, this file
├── plans/                             # Roadmap markdowns
├── .github/workflows/
│   ├── ci.yml                         # PR + main: parts pressure → kb eval → tests → build
│   ├── service-cron.yml               # Cron monitoring
│   └── service-cron-nightly.yml
├── .agents/                           # Stress-test definitions
└── qep/                               # Project assets, sales docs
```

---

## 3. Database — the platform's spine

### 3.1 Migration ledger (001 → 202)

Migrations are executed in monotonic numeric order. Every major capability is tied to a migration. The full ledger:

**001–050: Foundation** — profiles + auth, document/embedding store (pgvector), DGE foundation, integration analytics, **`analytics_events` event store (016)**, **CRM core tables (021)**, weighted pipeline view (025), HubSpot import + audit, voice capture, follow-up reminders, equipment moonshot, archive RPCs, document governance, fuzzy retrieval RPC.

**051–093: Domain build-out** — chat history, CRM embeddings + retrieval, **morning briefings (055)**, voice note intelligence, **anomaly_alerts (057)**, **cron edge function scheduling (059)**, knowledge gaps + summaries, deal scoring, **`get_my_iron_role()` (067)**, needs assessments, follow-up cadences, **deposits + payment_validations (070)**, voice-to-QRM + fuzzy match RPCs (071), pipeline enforcer cron, equipment demo lifecycle, trade valuations, prospecting KPIs, escalation tickets, **traffic_tickets (078)**, **rental_returns (079)**, customer portal, autonomous marketing, equipment-as-a-service, deal composite RPC, **quote builder v2 (087)**, post-sale automation, DGE cockpit, social telematics, security lockdown, schema hardening.

**094–141: Service & Parts engine** — **service_jobs + job_codes + observations (094)**, parts vendor tables, service quotes + TAT feedback, **service cron jobs (097)**, service security, service stage timing, service portal bridge, service branch config, vendor escalation indexes, service invoice link, customer notify cron, TAT inventory planner, parts inventory adjust RPC, scheduling calendar, **customer_invoices + portal pay (113)**, parts fulfillment + workspaces, fulfillment status trigger, dedupe, **`batch_apply_follow_up_touchpoint_ai()` (128)**, parts module schema (reorder_profiles, demand_forecasts, cross_references), **`find_part_substitutes()` (138)**, parts autonomous ops, parts field intelligence, parts network analytics.

**142–169: Branches → Wave 5 closeout** — branches master, branch assets + invoice branch, voice QRM routing + sentiment, portal warranty + trade exposure, deal timing engine, **`compute_deal_timing_alerts()` + `get_timing_dashboard()` (147)**, price intelligence, cross-department health score, **`compute_customer_health_score()` (150)**, tax intelligence, **SOP engine (152)** — sop_templates/steps/executions/step_completions, voice multi-extraction, email_drafts, price intel completion, **AR gate (`enforce_ar_quote_block()`) (156)**, **portal live status RPCs `get_portal_fleet_with_status()` + `get_parts_reorder_history()` (157)**, SOP completion + workspace hardening, **asset 360 RPCs `get_asset_360()`, `get_asset_countdowns()`, `get_asset_badges()`, `get_asset_24h_activity()` (160)**, service dashboard + canonical state, **PostGIS geofences (162)**, **`match_service_knowledge()` + service KB vectors (163)**, data quality audit, **`exception_queue` + `enqueue_exception()` (165)**, exec command center foundation, **`match_quote_incentives()` (167)**, **Wave 5C nervous system — `get_health_score_with_deltas()`, `apply_ar_override()` (168)**, Wave 5D portal Stripe audit.

**170–186: QRM rename → Flare** — **`170` QRM rename (CRITICAL)** — all 26 `crm_*` tables renamed to `qrm_*`; backwards-compat views created (security_invoker) so existing edge fns + frontend code keep working through `crm_*` while writing to the new `qrm_*` tables. Wave 5E SOP false positive protection, Round 3 audit fixes, **`get_account_360()` + `get_fleet_radar()` (173)**, **lifecycle event triggers (174)** — `customer_lifecycle_events` table + `insert_lifecycle_event_once()` + `trg_lifecycle_from_deal()` + backfill helper, QRM idea backlog, **`run_data_quality_audit()` + `find_duplicate_companies()` (176)**, **KB observability (177)** — `retrieval_events`, `kb_job_runs`, `kb_health_snapshot()`, KB anomaly alerts (178), document freshness lifecycle (179), Round 4 audit fixes, data quality audit class completion, **`merge_companies()` + `qrm_undo_company_merge()` (182)**, **KB retrieval foundation (183)** — `normalize_knowledge_gap_question()` + `log_knowledge_gap()`, Round 5 audit fixes, **flare reports (185)** — `flare_dedupe_count()`, `flare_recent_voice_capture()`, `flare_recent_user_activity()`, **flare storage bucket + RLS (186)**.

**187–193: QEP Moonshot Command Center (Wave 6.10/v2, Slices 1–6)**
| Mig | Purpose |
|---|---|
| **187** | Foundation: `analytics_metric_definitions` (KPI registry) + `analytics_kpi_snapshots` (immutable snapshots, owner-only RLS); 8 CEO metrics seeded |
| **188** | Alerts + audit: `analytics_alerts` (full lifecycle), `analytics_action_log`, `enqueue_analytics_alert()` (dual-writes blockers into `exception_queue`) |
| **189** | Materialized views (Slice 2): `mv_exec_revenue_daily`, `mv_exec_pipeline_stage_summary`, `mv_exec_margin_daily`; `refresh_exec_materialized_views()` |
| **190** | CFO finance (Slice 3): `mv_exec_payment_compliance`, `mv_exec_deposits_aging`, `mv_exec_margin_waterfall`; targets `qrm_deals` directly because `crm_deals` compat view doesn't surface new columns |
| **191** | COO operations (Slice 4): `mv_exec_traffic_summary`, `mv_exec_inventory_readiness`, `mv_exec_rental_return_summary`; targets `qrm_equipment` directly |
| **192** | `exec_packet_runs` audit table |
| **193** | Security + atomicity fixes — 9 `security_invoker` MV wrapper views (closes cross-workspace MV leak), `write_kpi_snapshot()` atomic RPC, `analytics_quick_kpi()`, `enqueue_analytics_alert(p_workspace_id, …)` overload, `refresh_exec_materialized_views()` catches `object_not_in_prerequisite_state` |

**194–196: QEP Flow Engine (Wave 6.11/v1, Slices 1–5 + audit)**
| Mig | Purpose |
|---|---|
| **194** | Foundation: extends `analytics_events` with 5 flow columns (`flow_event_type`, `flow_event_version`, `source_module`, `correlation_id`, `parent_event_id`, `consumed_by_runs`); `flow_workflow_definitions` + `flow_workflow_runs` + `flow_workflow_run_steps` + `flow_action_idempotency`; `emit_event()` + `mark_event_consumed()` + `enqueue_workflow_dead_letter()`; triggers on `qrm_deals`, `voice_captures`, `quote_packages` |
| **195** | Approvals + context resolver: `flow_approvals`, `request_flow_approval()`, `decide_flow_approval()`, `flow_resolve_context()` |
| **196** | Audit fixes: `flow_pending_events` view (replaces brittle `.eq("consumed_by_runs", "[]")` filter), `flow_resume_run()` (closes approval-resume gap), `flow_escalate_approvals()`, `flow_cleanup_idempotency()`; fixed broken open-quote query in resolver; added `actor_type` + `actor_id` to `analytics_events` |

**197–202: Iron Wave 7 (parallel track)**
| Mig | Purpose |
|---|---|
| **197** | Iron foundation — extends `flow_workflow_definitions` (`surface`, `iron_metadata`, `undo_handler`, `undo_semantic_rule`, `high_value_threshold_cents`, `roles_allowed[]`); extends `flow_workflow_runs` (`conversation_id`, `undo_deadline`, `undone_at`, `undone_by`, `idempotency_key`); `iron_conversations` table |
| **198** | `iron_upsert_flow_suggestion()` |
| **199** | `iron_compute_slos()` |
| **200** | pg_cron registration for Iron compute jobs |
| **201** | Iron memory: `iron_memory_*` tables (self-associative TTL'd recall); `iron_bump_memory()`, `iron_decay_memory()`, per-entity bump triggers |
| **202** | `iron_slo_history` table + additional cron schedules |

### 3.2 Postgres extensions used

| Extension | Schema | Purpose |
|---|---|---|
| `vector` | extensions | pgvector for semantic search (mig 001). Operator: `<=>` cosine distance. Used by `kb_embeddings` and `crm_embeddings` (1536-dim, OpenAI text-embedding-3-small) |
| `pg_trgm` | public | Trigram fuzzy matching for company/contact search (mig 026, 071). `similarity()`, `%` operator |
| `postgis` | extensions | Geospatial — `geofences` (mig 162), driver routing |
| `pg_cron` | extensions | Cron registration in migrations 059, 072, 097, 200, 202 |
| `pg_net` | extensions | `net.http_post()` from cron jobs to invoke edge functions |

### 3.3 Core tables by domain

**Profiles & Authentication**
- `profiles(id [auth.users FK], full_name, email, role: user_role enum, iron_role, iron_role_display, is_support, workspace_id, created_at, updated_at)`
- `user_role` enum: `'rep' | 'admin' | 'manager' | 'owner'`
- Iron role enum (synthetic): `'iron_advisor' | 'iron_woman' | 'iron_man' | 'iron_manager'`

**CRM / QRM** — core 26 tables, all renamed `crm_*` → `qrm_*` in mig 170 with compat views still available:
- `qrm_companies`, `qrm_contacts`, `qrm_contact_companies`, `qrm_deals`, `qrm_deal_stages`, `qrm_activities`, `qrm_activity_templates`, `qrm_equipment`, `qrm_tags`, `qrm_contact_tags`, `qrm_territories`, `qrm_contact_territories`, `qrm_embeddings` (pgvector), `qrm_auth_audit_events`, `qrm_hubspot_import_runs`, `qrm_hubspot_import_errors`, `qrm_in_app_notifications`, `qrm_duplicate_candidates`, `qrm_deal_equipment`, `qrm_external_id_map`, `qrm_merge_audit_events`, `qrm_quote_audit_events`, `qrm_reminder_instances`, `qrm_idea_backlog` (mig 175), `qrm_custom_field_definitions`, `qrm_custom_field_values`
- Key columns: `workspace_id`, `metadata jsonb`, `created_at/updated_at/deleted_at` on every table
- `qrm_deals.amount`, `qrm_deals.margin_amount`, `qrm_deals.expected_close_on`, `qrm_deals.closed_at`, `qrm_deals.next_follow_up_at`, `qrm_deals.last_activity_at`
- `qrm_deal_stages.is_closed_won`, `qrm_deal_stages.is_closed_lost`, `qrm_deal_stages.probability`

**Service** — `service_jobs` (with status_flags[] array, current_stage, branch, advisor, technician, customer problem summary, AI diagnosis, scheduled/actual times), `service_job_events`, `service_job_blockers`, `job_codes`, `job_code_observations`, `service_quotes` + `service_quote_lines` + `service_quote_approvals`, `service_tat_metrics`, `service_cron_runs`, `technician_profiles`, `technician_job_performance`, `service_completion_feedback`, `service_customer_notifications`

**Parts** — `parts_catalog`, `parts_orders` + `parts_order_lines` + `parts_order_events`, `parts_fulfillment_runs` + `parts_fulfillment_events` + `parts_fulfillment_staging`, `parts_order_notification_sends`, `parts_cross_references`, `parts_demand_forecasts`, `parts_reorder_profiles`, `parts_auto_replenish_queue`, `parts_predictive_kits`, `parts_replenishment_rules`, `parts_transfer_recommendations`, `parts_analytics_snapshots`, `service_parts_requirements`, `service_parts_staging`, `service_parts_actions`

**Quotes (Sales)** — `quote_packages`, `quote_package_line_items`, `quote_signatures`, `portal_quote_reviews`

**Deposits & Finance** — `deposits` (with `deposit_tier`, `verification_cycle_hours` + `refund_initiated_at`/`refund_completed_at` from mig 190), `payment_validations` (with `attempt_outcome` + `exception_reason` + `required_approver_role` from mig 190), `margin_waterfalls`, `customer_invoices`, `ar_credit_blocks`

**Rentals** — `rental_returns` (with `inspection_started_at`, `decision_at`, `aging_bucket` from mig 191), `eaas_subscriptions`, `eaas_usage_records`, `maintenance_schedules`, `customer_fleet`, `fleet_import_history`

**Logistics** — `traffic_tickets` (with `requested_at`, `scheduled_confirmed_at`, `departed_at`, `completed_at`, `promised_delivery_at`, `late_reason`, `proof_of_delivery_complete`, `blocker_reason` from mig 191), `vendor_escalations`, `vendor_escalation_policies`, `vendor_profiles`, `vendor_contacts`

**Voice & Chat** — `voice_captures` (transcription, sentiment, extraction, recording path), `voice_extracted_equipment`, `voice_qrm_results`, `voice_routing_rules`, `chat_conversations`, `chat_messages`

**Knowledge Base** — `documents`, `chunks` (with embeddings), `kb_embeddings`/`crm_embeddings` (pgvector 1536), `knowledge_gaps`, `retrieval_events` (with `evidence_count`, `top_confidence`, `latency_ms`, `feedback`, `embedding_ok`, `tool_rounds_used`), `kb_job_runs`

**Anomaly + Exception** — `anomaly_alerts` (alert_type CHECK includes stalling_deal/overdue_follow_up/pricing_anomaly/utilization_drop/pipeline_risk/activity_gap/embedding_stale/orphan_chunks), **`exception_queue`** (the unified human work queue — `source` CHECK includes: tax_failed, price_unmatched, health_refresh_failed, ar_override_pending, stripe_mismatch, portal_reorder_approval, sop_evidence_mismatch, geofence_conflict, stale_telematics, doc_visibility, data_quality, **analytics_alert** [Wave 6.10], **workflow_dead_letter** [Wave 6.11])

**Command Center (Wave 6.10/v2)** — `analytics_metric_definitions` (KPI registry with `formula_text`, `formula_sql`, `display_category`, `owner_role`, `source_tables[]`, `refresh_cadence`, `drill_contract`, `threshold_config`, `synthetic_weights`), `analytics_kpi_snapshots` (immutable, append-only with `supersedes_id` for recalc), `analytics_alerts` (full lifecycle, `dedupe_key`, `exception_queue_id` FK), `analytics_action_log` (audit trail with action_type CHECK that includes 7 workflow lifecycle values from Flow Engine), `exec_packet_runs`

**Flow Engine (Wave 6.11/v1)** — `flow_workflow_definitions`, `flow_workflow_runs` (status CHECK: pending/running/succeeded/partially_succeeded/awaiting_approval/failed_retrying/dead_lettered/cancelled/undone), `flow_workflow_run_steps`, `flow_action_idempotency`, `flow_approvals`, `flow_pending_events` view; `analytics_events` extended with flow columns

**Iron (Wave 7)** — `iron_conversations`, `iron_messages`, `iron_settings`, `iron_cost_counters`, `iron_paperclip_handoffs`, `iron_red_team_history`, `iron_memory_*` (one table per entity type for self-associative recall), `iron_slo_history`; `flow_workflow_definitions` and `flow_workflow_runs` extended with Iron columns (no parallel duplication)

**Customer Portal** — `portal_customers`, `customer_profiles_extended` (with `annual_budget`, `budget_cycle_month`, `company_health_score`, `fleet_size`, `ar_status`), `portal_warranty_claims`, `portal_payment_intents`, `portal_quote_reviews`

**Follow-Up & Lifecycle** — `follow_up_cadences`, `follow_up_sequences`, `follow_up_steps`, `follow_up_touchpoints`, `scheduled_follow_ups`, **`customer_lifecycle_events`** (mig 174 — append-only with dedupe_key), `morning_briefings`

**Audit** — `analytics_events` (the universal append-only event log; extended in mig 194 with flow columns), `analytics_action_log`, `service_cron_runs`, `data_quality_audit`, `qrm_auth_audit_events`, `integration_status_credential_audit_events`

**SOP Engine** — `sop_templates`, `sop_template_versions`, `sop_steps`, `sop_executions`, `sop_step_completions`, `sop_step_skips`, `sop_suppression_queue`, `sop_ingestion_runs`

**Equipment / Telematics** — `qrm_equipment`, `equipment_status_canonical` (view), `telematics_feeds`, `geofences` (PostGIS), `equipment_intake`, `demos`, `trade_valuations`, `customer_fleet`, `fleet_intelligence`

**Pricing / Tax** — `catalog_entries`, `catalog_price_history`, `manufacturer_incentives`, `tax_exemption_certificates`, `tax_treatments`, `section_179_scenarios`, `financing_rate_matrix`, `price_change_impact`, `pricing_persona_models`, `competitive_mentions`

**Integrations** — `integration_status` (with `credentials_encrypted` AES-256-GCM), `hubspot_connections`, `hubspot_webhook_receipts`, `workspace_hubspot_portal`, `onedrive_sync_state`, `economic_indicators`, `economic_sync_runs`, `sequence_enrollments`, `social_accounts`, `social_media_posts`

### 3.4 Materialized views (9, all `mv_exec_*`)

| View | Purpose | Refresh path |
|---|---|---|
| `mv_exec_revenue_daily` | Daily closed-won revenue + margin per workspace | `refresh_exec_materialized_views()` cron |
| `mv_exec_pipeline_stage_summary` | Open pipeline by stage with weighted dollars + activity recency | same |
| `mv_exec_margin_daily` | Daily margin trend for sparkline | same |
| `mv_exec_payment_compliance` | Payment compliance metrics per branch/department | same |
| `mv_exec_deposits_aging` | Deposit aging analysis | same |
| `mv_exec_margin_waterfall` | Gross → loaded margin decomposition | same |
| `mv_exec_traffic_summary` | Haul volume, dwell time, vendor performance | same |
| `mv_exec_inventory_readiness` | Parts stocking, stockout rate, forecast accuracy | same |
| `mv_exec_rental_return_summary` | Rental return volume, damage rate, condition trends | same |

**CRITICAL:** Materialized views do NOT support RLS. Frontend code must NEVER read MVs directly. Mig 193 added 9 `security_invoker` wrapper views (`exec_*_v`) that filter by `workspace_id = get_my_workspace() and get_my_role() = 'owner'`. Direct MV select is REVOKED from `authenticated`. Refresh strategy: cron every 15 min during business hours; falls back to non-concurrent refresh on `feature_not_supported / invalid_table_definition / object_not_in_prerequisite_state`.

### 3.5 Helper SQL functions / RPCs (the ones that matter)

**Core infrastructure**
- `get_my_workspace() → text` — returns JWT claim or `'default'`. Backbone of every RLS policy.
- `get_my_role() → user_role` — returns the caller's `profiles.role`.
- `get_my_iron_role() → text` — returns `profiles.iron_role`.
- `set_updated_at()` — trigger function applied to ~80% of tables.
- `handle_new_user()` — auto-creates `profiles` row on `auth.users` insert (mig 001).
- `check_rate_limit(p_user_id, p_endpoint, p_limit_per_minute) → boolean` — rate limit guard (mig 007).

**Exception + alert queueing**
- `enqueue_exception(p_source, p_title, p_severity, p_detail, p_payload, p_entity_table, p_entity_id) → uuid` — append to `exception_queue`. Used by every "human triage needed" code path.
- `enqueue_analytics_alert(p_workspace_id, p_alert_type, p_metric_key, p_severity, …) → uuid` — Wave 6.10. Dedupes on `dedupe_key`, dual-writes blockers into `exception_queue`. Mig 193 added the `p_workspace_id` first parameter so service-role callers (alert evaluator) can stamp the correct workspace.
- `log_analytics_action(p_action_type, p_source_widget, p_metric_key, p_alert_id, p_entity_type, p_entity_id, p_before_state, p_after_state, p_metadata) → uuid` — append-only audit row.

**Flow Engine**
- `emit_event(p_event_type, p_source_module, p_entity_type, p_entity_id, p_payload, p_workspace_id, p_correlation_id, p_parent_event_id, p_actor_type, p_actor_id) → uuid` — single entry point for events. Inserts into `analytics_events` with flow columns set, fires `pg_notify('flow_event', event_id)`. Mig 196 added `actor_type`/`actor_id` parameters.
- `mark_event_consumed(p_event_id, p_run_id) → void` — appends run_id to `consumed_by_runs` jsonb.
- `enqueue_workflow_dead_letter(p_run_id, p_workflow_slug, p_reason, p_failed_step, p_payload) → uuid` — wraps `enqueue_exception` with `source='workflow_dead_letter'`.
- `request_flow_approval(p_run_id, p_step_id, p_workflow_slug, p_subject, p_detail, p_assigned_role, p_assigned_to, p_due_in_hours, p_escalate_in_hours, p_context_summary) → uuid` — creates approval row + suspends parent run (`status='awaiting_approval'`).
- `decide_flow_approval(p_approval_id, p_decision, p_reason) → void` — records decision via `auth.uid()`; on approve calls `flow_resume_run`; on reject cancels parent run.
- `flow_resolve_context(p_event_id) → jsonb` — single point of context hydration. Returns `{event, company, deal, health_score, ar_block_status, customer_tier, open_quote_total, recent_runs}`.
- `flow_resume_run(p_run_id) → uuid` — emits a synthetic continuation event (`workflow.resume`) with `parent_event_id` → original. Closes the approval-resume gap.
- `flow_escalate_approvals() → table(expired int, escalated int)` — flips overdue approvals; cron-invoked.
- `flow_cleanup_idempotency() → integer` — TTL-deletes expired idempotency rows.
- `flow_pending_events` (view) — wraps `where flow_event_type is not null and consumed_by_runs = '[]'::jsonb and occurred_at > now() - interval '7 days'`.

**Command Center / Analytics**
- `refresh_exec_materialized_views() → void` — refresh all 9 MVs concurrently with non-concurrent fallback.
- `write_kpi_snapshot(p_workspace_id, p_metric_key, p_metric_value, p_data_quality_score, p_period_start, p_period_end, p_refresh_state, p_metadata) → uuid` — atomic update-prior-then-insert (mig 193 fix). Replaces the runner's brittle two-step pattern that race-condition'd on the unique partial index.
- `analytics_quick_kpi(p_metric_key) → numeric` — server-side aggregation for the 5 fallback metrics (`weighted_pipeline`, `enterprise_risk_count`, `revenue_mtd`, `gross_margin_dollars_mtd`, `gross_margin_pct_mtd`). Replaces the whole-table fetches in `useFallbackKpis`.
- `analytics_latest_snapshots(p_metric_key, p_workspace_id, p_limit) → setof analytics_kpi_snapshots`
- 9 wrapper views: `exec_revenue_daily_v`, `exec_pipeline_stage_summary_v`, `exec_margin_daily_v`, `exec_payment_compliance_v`, `exec_deposits_aging_v`, `exec_margin_waterfall_v`, `exec_traffic_summary_v`, `exec_inventory_readiness_v`, `exec_rental_return_summary_v` — `security_invoker = true` with workspace + role filter.

**CRM / QRM core**
- `crm_company_parent_would_create_cycle(p_company_id, p_parent_id) → boolean`
- `crm_guard_company_hierarchy_cycle()` (trigger)
- `crm_rep_can_access_equipment(p_equipment_id) → boolean` — RLS gate
- `crm_rep_can_access_custom_record(p_table_name, p_record_id) → boolean`
- `crm_company_subtree_rollups(p_company_id) → jsonb`
- `crm_refresh_duplicate_candidates() → void`
- `crm_merge_contacts(p_primary_id, p_secondary_id, p_merge_mode) → uuid`
- `crm_deal_sla_on_stage_change()` (trigger)
- `crm_refresh_deal_last_activity(p_deal_id) → void`
- `crm_sync_deal_last_activity_from_activities()` (trigger)
- `list_crm_contacts_page(p_workspace, p_limit, p_after_id, p_search_term)` — keyset pagination
- `list_crm_companies_page(...)`, `list_crm_contacts_for_company_subtree_page(...)`
- `fuzzy_match_contact(p_query, p_workspace, p_limit)`, `fuzzy_match_company(...)` — pg_trgm fuzzy match
- `archive_crm_contact / company / deal` — soft delete
- `merge_companies(p_primary_id, p_secondary_id) → uuid` (mig 182)
- `qrm_undo_company_merge(p_audit_id) → void`

**Composite / account views**
- `get_account_360(p_company_id) → json` — single round-trip Account 360 payload (mig 173)
- `get_fleet_radar(p_company_id) → json` — five-lens fleet opportunity scan
- `get_asset_360(p_equipment_id) → json` — equipment detail (mig 160)
- `get_asset_countdowns(p_equipment_id)`, `get_asset_badges(p_equipment_id)`, `get_asset_24h_activity(p_equipment_id)`
- `get_portal_fleet_with_status(p_portal_customer_id) → json`
- `get_parts_reorder_history(p_portal_customer_id) → json`
- `get_health_score_with_deltas(p_customer_profile_id) → json` (mig 168)
- `get_deal_composite(p_deal_id) → json` (mig 86)
- `compute_customer_health_score(p_customer_profile_id) → numeric` (mig 150)
- `compute_health_score_rpc(p_company_id) → numeric`

**Deal timing**
- `compute_deal_timing_alerts(p_workspace_id) → void` (mig 147)
- `get_timing_dashboard(p_workspace_id) → json`

**Follow-up & lifecycle**
- `create_sales_cadence(p_name, p_contact_id, p_frequency_days, p_steps_jsonb) → uuid`
- `create_post_sale_cadence(...)`
- `crm_schedule_follow_up_reminder / dismiss / dispatch_due`
- `crm_manager_at_risk_deals(p_limit)`
- `batch_apply_follow_up_touchpoint_ai(p_rows jsonb)` (mig 128)
- `insert_lifecycle_event_once(p_customer_profile_id, p_event_type, p_unique_key, p_metadata) → uuid` (mig 174)
- `trg_lifecycle_from_deal()` (trigger)
- `backfill_customer_lifecycle_events()`

**Parts & logistics**
- `adjust_parts_inventory_delta(p_sku, p_delta, p_reason)` (mig 111)
- `find_part_substitutes(p_sku, p_confidence_threshold)` (mig 138)
- `service_parts_accept_intake_line / apply_fulfillment_action`
- `service_parts_fulfillment_transaction_rpc(p_order_id, p_lines_jsonb)` (mig 121)
- `search_parts_orders_for_link(p_workspace, p_term)` (mig 120)
- `traffic_ticket_auto_lock()` (trigger)

**Service**
- `match_service_knowledge(p_query) → table` — vector search service KB (mig 163)
- `enforce_vendor_escalation_policy_steps()` (trigger)
- `enforce_deposit_gate()` (trigger)
- `calculate_deposit_tier(p_equipment_value)`
- `enforce_margin_check()` (trigger)
- `portal_get_service_job_timeline(p_service_request_id) → json`
- `enforce_ar_quote_block()` (trigger, mig 156)
- `apply_ar_override(p_company_id, p_reason, p_override_amount)` (mig 168)

**Knowledge Base**
- `retrieve_document_evidence(p_query, p_top_k, p_workspace_id)` — hybrid BM25 + pgvector
- `kb_health_snapshot() → jsonb` — KB observability manifest (mig 177)
- `normalize_knowledge_gap_question(p_question)`, `log_knowledge_gap(p_question, p_workspace_id)` (mig 183)
- `sync_document_review_schedule()` — cron

**Data quality**
- `run_data_quality_audit() → jsonb` (mig 176)
- `find_duplicate_companies(p_threshold)` (mig 176)
- `qrm_company_fk_columns()` — introspection helper for `merge_companies`

**Pricing / tax**
- `track_catalog_price_change()` (trigger)
- `qtb_sync_stale_after()` — auto-sync quote expiry (mig 167)
- `match_quote_incentives(p_equipment_make, p_equipment_model, p_quote_total)` (mig 167)
- `calculate_trade_value(p_equipment_id) → numeric`

**Iron**
- `iron_upsert_flow_suggestion(p_conversation_id, p_flow_key, p_confidence, p_metadata) → uuid` (mig 198)
- `iron_compute_slos() → void` (mig 199)
- `iron_bump_memory(p_workspace_id, p_entity_type, p_entity_id) → void` (mig 201)
- `iron_decay_memory() → void` — cron
- `iron_memory_bump_self_qrm_companies / contacts / equipment` — auto-bump triggers
- `iron_slo_breach_trigger()` (trigger, mig 202)

### 3.6 RLS pattern (the canonical shape)

```sql
-- Workspace gate (mandatory on every user-facing table)
using (workspace_id = public.get_my_workspace())
  with check (workspace_id = public.get_my_workspace())

-- Role gate (varies by resource)
using (public.get_my_role() in ('owner', 'admin', 'manager'))

-- Service role bypass (every table that edge fns write to)
to service_role using (true) with check (true)
```

**Security definer pattern** for cross-workspace helpers:
```sql
revoke execute on function public.X(...) from public;
grant execute on function public.X(...) to authenticated, service_role;
```

**Iron role gating** (Wave 7):
```sql
using (public.get_my_iron_role() in ('iron_manager', 'iron_advisor'))
```
Mapping (mig 67): `role='manager'|'owner'` → iron_manager; `role='admin'` → iron_woman; `role='rep' AND is_support=true` → iron_man; `role='rep'` → iron_advisor.

### 3.7 Storage buckets (6)

| Bucket | Public | Path convention | Purpose |
|---|---|---|---|
| `voice-recordings` | false | `{workspace_id}/...` | Voice capture storage; 52 MB cap; audio MIME types |
| `documents` | false | `{workspace_id}/...` | KB document uploads; 52 MB; PDF/DOCX/XLSX/CSV/text |
| `equipment-photos` | false | `{workspace_id}/...` | Equipment asset photos |
| `service-portal-photos` | false | `{workspace_id}/...` | Customer portal service photos |
| `flare-artifacts` | false | `{workspace_id}/{report_id}/...` | Flare error reports (screenshots, DOM snapshots) — workspace-prefix RLS on `storage.objects` |
| `branch-assets` | false | `{workspace_id}/...` | Branch-scoped documents |

### 3.8 Compatibility views (Migration 170)

`crm_*` → `qrm_*` rename. The 26 compat views are auto-updatable `select *` views with `security_invoker = true`. They allow legacy code to keep working while new code targets `qrm_*` directly. **Important:** when adding new columns to renamed tables, you MUST target the underlying `qrm_*` table — the compat view's `select *` is a frozen snapshot at view-creation time and will not surface new columns. Migrations 190 and 191 had to be patched after-the-fact to target `qrm_deals`/`qrm_equipment` directly.

The compat views are temporary scaffolding. A future migration will drop them once all consumers are migrated.

---

## 4. Edge Functions (~105)

All edge functions are Deno-based, deployed via Supabase, located in `supabase/functions/<name>/index.ts`. Auth is one of: JWT (user-facing), service-role secret (cron callers), or open (CORS-protected, e.g. public service status).

### 4.1 Edge function inventory by domain

**Chat / Knowledge**
| Function | Auth | External APIs | Invoked by |
|---|---|---|---|
| `chat` | JWT | OpenAI (GPT), Anthropic (planned) | Frontend, real-time |
| `kb-maintenance` | JWT + Service Secret | OpenAI (embeddings) | Cron `embed-crm-refresh` (*/15) + manual |
| `embed-crm` | JWT + Service Secret | OpenAI (embeddings) | Cron `embed-crm-refresh` (*/15) |
| `draft-email` | JWT | OpenAI | Frontend |
| `ingest` | JWT | OpenAI | Frontend upload |

**CRM / QRM**
| Function | Auth | Invoked by |
|---|---|---|
| `crm-router` | JWT | Frontend + Iron flows |
| `crm-hubspot-import` | Service Secret | Cron |
| `crm-reminder-dispatcher` | Service Secret | Cron `follow-up-engine-hourly` |
| `customer-profile` | JWT | Frontend |
| `customer-dna-update` | JWT | Frontend |
| `voice-capture` | Service Secret | Mobile/voice UI |
| `voice-capture-sync` | Service Secret | Cron periodic |
| `qrm-router` | Service Secret | Internal dispatch |
| `qrm-hubspot-import` | Service Secret | Cron periodic |
| `voice-to-qrm` | Service Secret | Voice submit |
| `voice-to-parts-order` | Service Secret | Voice submit |

**Service (field operations) — ~24 functions**
- `service-intake`, `service-completion-feedback`, `service-knowledge-capture`, `service-scheduler`, `service-tat-monitor` (cron */5), `service-stage-enforcer` (cron */10), `service-parts-manager`, `service-parts-planner`, `service-customer-notify-dispatch`, `service-vendor-escalator`, `service-job-router`, `service-jobcode-learner` (cron nightly), `service-jobcode-suggestion-merge`, `service-vendor-inbound` (webhook from vendors), `service-haul-router`, `service-quote-engine`, `service-public-job-status` (open CORS), `service-upsell-scanner`, `service-notifications`, `service-calendar-slots`, `service-billing-post`, `service-invoice-generator`

**Parts intelligence & fulfillment**
- `parts-identify-photo` (OpenAI vision), `parts-demand-forecast` (cron daily), `parts-predictive-kitter` (cron periodic), `parts-network-optimizer` (cron periodic), `parts-reorder-compute` (cron daily), `parts-auto-replenish` (cron periodic), `parts-order-manager`, `parts-order-customer-notify` (Resend, cron periodic)

**Anomaly / exception**
- `anomaly-scan` (cron 0 */4) — detects stalling deals, overdue follow-ups, pipeline risk, activity gaps, pricing anomalies; writes to `anomaly_alerts`
- `escalation-router` (cron periodic) — routes critical exceptions

**Flare (Wave 6.11)**
- `flare-submit` (JWT, fan-out: Linear + Slack + Paperclip + Resend + analytics_alerts + exception_queue)
- `flare-notify-fixed` (Linear webhook → notify reporter, threaded Slack reply, PATCH Linear/Paperclip to done)

**Deal / quote / revenue**
- `deal-composite`, `deal-timing-scan` (cron periodic), `dge-optimizer` (DGE = Deal Growth Engine), `deposit-calculator`, `follow-up-engine` (cron `follow-up-engine-hourly`, OpenAI), `market-valuation`, `trade-valuation`, `quote-builder-v2`, `quote-incentive-resolver`, `requote-drafts` (cron periodic), `price-file-import`, `revenue-attribution-compute` (cron periodic, Linear)

**Command Center / Analytics (Wave 6.10/v2)**
- `analytics-snapshot-runner` (cron hourly) — refreshes MVs + writes `analytics_kpi_snapshots`
- `analytics-alert-evaluator` (cron periodic) — evaluates threshold rules, dual-writes blockers via `enqueue_analytics_alert` RPC
- `exec-summary-generator` — owner-on-demand AI executive briefing
- `exec-packet-generator` — full role-specific markdown packet (CEO/CFO/COO)
- `prospecting-tracker` (mobile)
- `nudge-scheduler` (cron `prospecting-nudge-2pm`)
- `pipeline-enforcer` (cron `pipeline-enforcer-periodic`)
- `morning-briefing` (cron `morning-briefing-daily`, OpenAI)
- `health-score-refresh` (cron periodic)

**Flow Engine (Wave 6.11/v1)**
- `flow-runner` — polls `flow_pending_events`, matches workflows by `trigger_event_pattern`, executes action chains with retry + idempotency, dead-letters terminal failures via `enqueue_workflow_dead_letter`. Cron + manual.
- `flow-synthesize` — Anthropic-powered English-to-workflow draft generator. Owner JWT only.

**Iron (Wave 7)**
- `iron-orchestrator` — intent classifier + cost ladder. Anthropic claude-sonnet-4-6 (full) or claude-haiku-4-5 (reduced)
- `iron-execute-flow-step`
- `iron-pattern-mining` (cron `iron-pattern-mining-nightly`)
- `iron-redteam-nightly` (cron) — security regression tests
- `iron-transcribe` (OpenAI Whisper)
- `iron-tts` (OpenAI TTS)
- `iron-undo-flow-run`

**HubSpot integration**
- `hubspot-oauth` — OAuth callback; stores credentials encrypted in `integration_status.credentials_encrypted`
- `hubspot-webhook` — HMAC signature verified; routes to `crm-router`
- `hubspot-scheduler` (cron periodic)

**Economic / market data**
- `economic-sync` (cron daily, FRED API stubbed)
- `tax-calculator` — Section 179 + tax treatments

**Equipment / asset intelligence**
- `equipment-vision` (OpenAI vision)
- `telematics-ingest` (webhook)

**Demo / admin**
- `demo-admin` (Resend, secret-gated)
- `demo-manager`
- `admin-users`
- `document-admin`

**Other**
- `integration-availability`, `integration-test-connection`, `onedrive-oauth`, `needs-assessment`, `marketing-engine`, `meta-social` (stub), `portal-api`, `portal-stripe`, `prep-sheet`, `sop-engine`, `sop-ingest`, `sop-suggest`, `revision-sync`, `revision-dispatch`

### 4.2 `_shared/` modules (the building blocks)

**Auth & CORS**
- `dge-auth.ts` — `createAdminClient()`, `resolveCallerContext()` (JWT extraction + role resolution), `isServiceRoleRequest()` (validates `x-internal-service-secret`)
- `safe-cors.ts` — `safeCorsHeaders(origin)` against allowed origins list
- `service-auth.ts` — service-user validation; rejects service-role JWT

**CRM & integration**
- `crm-router-{http,service,data}.ts`
- `crm-auth-audit.ts` (+ test)
- `crm-follow-up-suggestions.ts`, `crm-follow-up-reminders.ts` (+ test)
- `crm-communication-delivery.ts` — fail-open on `missing_credentials`
- `crm-external-id-map.ts`
- `crm-stage-resolver.ts`
- `crm-hubspot-sync.ts`

**HubSpot**
- `hubspot-client.ts` (+ test) — REST client
- `hubspot-crypto.ts` — legacy per-instance key encryption (deprecated)
- `hubspot-runtime-config.ts` — load OAuth creds from env or `integration_status` table
- `hubspot-webhook-event-processor.ts`, `hubspot-webhook-receipts.ts` (+ test)
- `hubspot-rate-limiter.ts` — adaptive backoff (100 req/10 sec)
- `hubspot-sequence-enrollment.ts`

**Integration management**
- `integration-manager.ts`
- `integration-crypto.ts` — AES-256-GCM with HKDF-SHA-256 from `INTEGRATION_ENCRYPTION_KEY`
- `integration-types.ts`

**AI / LLM**
- `openai-embeddings.ts` — text-embedding-3-small via OpenAI; 1536-dim
- `chat-tools.ts` — tool execution for chat (CRM queries, deal lookup, document search)
- `dge-customer-{dna,profile}.ts`
- `dge-market-valuation.ts`
- `dge-rate-limit.ts`
- `dge-http.ts`

**Flow Engine**
- `flow-engine/types.ts` — `FlowWorkflowDefinition`, `FlowAction`, `FlowContext`, `FlowCondition`, `FlowActionDeps`
- `flow-engine/condition-eval.ts` — pure DSL evaluator + `resolveValue` + `resolveParamsForRun` + `computeIdempotencyKey`
- `flow-engine/registry.ts` — 12-action registry
- `flow-engine/iron-actions.ts` — Iron-specific actions
- `flow-workflows/<slug>.ts` — 11 workflow files (10 production + Iron parallel track)

**Iron (Wave 7)**
- `iron/classifier-core.ts` — Anthropic classifier shared across orchestrator + redteam
- `iron/classify-guard.ts` — Zod-style validation + flow allowlist
- `iron/prompt-injection-corpus.json` — jailbreak blocklist
- `iron/undo-handlers.ts` — rollback logic

**Email & comms**
- `resend-email.ts` — fail-open if `RESEND_API_KEY` unset
- `draft-email.ts`
- `vendor-escalation-resend.ts` (+ test)
- `service-customer-recipient.ts`

**Service**
- `service-cron-run.ts` — cron job execution tracking
- `service-engine-smoke.test.ts`
- `service-invoice.ts`
- `service-lifecycle-notify.ts`
- `service-parts-from-job-code.ts`

**Data & utilities**
- `event-tracker.ts` (+ test)
- `redact-pii.ts` — strips emails, phones, SSNs, CCs; used when persisting iron_messages
- `rate-limit-fallback.ts`
- `resilient-fetch.ts` — fetch with retry + timeout
- `timing-safe.ts`
- `parse-json-body.ts`
- `webhook-tenant-routing.ts` (+ test)
- `portal-pm-kit.ts`
- `public-service-status.ts`
- `parts-fulfillment-mirror.ts`
- `voice-capture-crm.ts`
- `voice-note-intelligence.ts`
- `customer-dna-store.ts`
- `customer-dna-logic.ts` (+ test)
- `customer-profile-dto.ts`
- `vendor-escalation-policy.ts`
- `vendor-inbound-contract.ts` (+ test)

**Observability**
- `sentry.ts` — gated on `SENTRY_DSN`; no-op when unset
- `kb-observability.ts` — KB logging

**Adapters**
- `adapters/fred-usda-live.ts` — FRED + USDA API (stubbed; not actively called)

### 4.3 Edge function auth patterns

**1. User-facing JWT** — request includes `Authorization: Bearer <jwt>`. Edge fn calls `admin.auth.getUser(jwt)` to extract user; looks up `profiles.role` for gating. Used by `chat`, `flow-synthesize`, `flare-submit`, `customer-profile`, etc.

**2. Service-role secret** — request includes `x-internal-service-secret: <DGE_INTERNAL_SERVICE_SECRET>`. Edge fn validates via `isServiceRoleRequest()`. Used by every cron-invoked function and the Flow Engine runner.

**3. Webhook signature** — `hubspot-webhook` (HMAC-SHA-256), `portal-stripe` (Stripe signature with timestamp), `service-vendor-inbound` (`VENDOR_INBOUND_WEBHOOK_SECRET` HMAC).

**4. Open (CORS-protected)** — `service-public-job-status` for public field-tech status checks; `hubspot-oauth` and `onedrive-oauth` callbacks (validated by state token).

### 4.4 CORS pattern

`safeCorsHeaders(origin)` from `_shared/safe-cors.ts`. Allowed origins:
- `https://qualityequipmentparts.netlify.app`
- `https://qep.blackrockai.co`
- `http://localhost:5173`

Headers: `authorization, x-client-info, apikey, content-type, x-internal-service-secret`. Methods: `GET, POST, PUT, DELETE, OPTIONS`. The function fails safe and never throws.

---

## 5. Frontend feature areas (21)

Each directory under `apps/web/src/features/` is a feature domain. Feature ownership is loose — features can read each other's data via shared hooks and the Supabase client.

| Feature | Purpose |
|---|---|
| **admin** | Data quality, exception inbox, exec command center, incentive catalog, **`FlowAdminPage`** (Wave 6.11), **`FlareAdminPage`** (Wave 6.11), branch management |
| **dashboards** | DashboardRouter, OperatingSystemHub |
| **deal-timing** | Sales cycle timing analysis (mig 147) |
| **dev** | PrimitivesPlayground — Wave 6.1 component showcase + Flare drawer test entry |
| **dge** | DGE cockpit — demand/growth economics (Wave 4) |
| **email-drafts** | Email draft inbox (mig 154) |
| **equipment** | AssetDetail — equipment 360 view (mig 160 RPCs) |
| **exec** | **CommandCenterPage** (Wave 6.10/v2) — owner-only `/exec` route with CEO/CFO/COO tab switcher, drill drawer, alerts panel, exec packet export |
| **fleet** | FleetMap — MapLibre-powered fleet visualization |
| **nervous-system** | Business health dashboard (Wave 5C) |
| **ops** | IntakeKanban, TrafficTickets, RentalReturns, PaymentValidation, SopCompliance |
| **parts** | Parts command center, catalog, orders, fulfillment, forecast, analytics |
| **portal** | Customer portal routes (mig 082, 085) |
| **price-intelligence** | Pricing analysis dashboard (mig 148) |
| **qrm** | QRM (Quote Relationship Management) — pipeline, contacts, companies, deals, lifecycle, activities, idea backlog, duplicates, fleet radar — the post-rename home of CRM |
| **quote-builder** | QuoteBuilderV2Page (mig 087) |
| **service** | ServiceCommandCenter, ServiceIntake, PartsWorkQueue, Vendors, Efficiency, BranchConfig, Inventory, Scheduler, Invoice, PublicTrack |
| **sop** | SOP templates, editor, execution (mig 152, 158) |
| **voice-qrm** | VoiceQrmPage — speech capture for sales |

### 5.1 Frontend routes (`apps/web/src/App.tsx`)

All routes are lazy-loaded with `React.lazy()` + `Suspense` fallback. Role gates enforced inline at the Route element.

**Public**: `/service/track` (`ServicePublicTrackPage`)

**All authenticated users (any role)**: `/`, `/dashboard`, `/dashboard/classic`, `/chat`

**Rep+ (rep, admin, manager, owner)**: `/voice`, `/voice/history`, `/quote-v2`, `/service`, `/service/intake`, `/service/parts`, `/service/fulfillment/:runId`, `/service/portal-parts`, `/service/vendors`, `/service/efficiency`, `/service/inventory`, `/service/invoice/:id`, `/ops/traffic`, `/deal-timing`, `/voice-qrm`, `/sop/templates`, `/sop/templates/:id`, `/sop/executions/:id`, `/os`, `/email-drafts`, `/dge/cockpit`, `/equipment/:id`, `/service/dashboard`, `/fleet`

**Rep+ + IntelliDealer connected**: `/quote`

**Admin/Manager/Owner**: `/admin`, `/auth/onedrive/callback`, `/service/branches`, `/service/job-code-suggestions`, `/service/scheduler-health`, `/ops/intake`, `/ops/returns`, `/ops/payments`, `/ops/sop-compliance`, `/nervous-system`, `/price-intelligence`, `/admin/quality`, `/admin/exceptions`, `/admin/exec`, `/admin/incentives`, **`/admin/flare`** (Wave 6.11), **`/admin/flow`** (Wave 6.11)

**Admin/Owner only**: `/auth/hubspot/connect`

**Owner only**: `/exec` (Wave 6.10/v2 Command Center)

**QRM**: `/qrm` (redirects to `/qrm/deals`); `/crm` is a legacy redirect to `/qrm`. ~20 sub-routes for the QRM domain.

**Parts**: `/parts/...` (~10 sub-routes)

**Catch-all**: `*` → `NotFoundPage`

### 5.2 Shared frontend primitives (`apps/web/src/components/primitives/`)

Wave 6.1 ships these as the building blocks for every dashboard:

- `StatusChipStack` (with `StatusChip`, `ChipTone` types) — multi-status badge stack
- `FilterBar` (with `FilterDef` type) — filter UI with operators
- `CountdownBar` (with `CountdownTone`) — time-remaining progress
- `AssetCountdownStack` — asset-specific countdown
- `ForwardForecastBar` (with `ForecastCounter`) — KPI counter strip
- `Last24hStrip` — recent activity timeline
- `AssetBadgeRow` — asset attribute badges
- `AskIronAdvisorButton` — universal `<Link to="/chat?context_type=X&context_id=Y">` button (extended for Flare, Command Center metric, Flow Engine run)
- `DashboardPivotToggle` — tab pivot for dashboards (used by exec/CommandCenterPage for CEO/CFO/COO switcher)
- `MapWithSidebar` (with `MapOverlay`) — map + sidebar layout
- `MapLibreCanvas` (with `MapMarker`, `MapPolygon`) — WebGL map rendering

### 5.3 Auth + role model

**Auth**: Supabase Auth — email/password and magic link. JWT in `localStorage` under `sb-*-auth-token`. Auto-refresh enabled. `useAuth()` hook in `apps/web/src/hooks/useAuth.ts` returns `{ user, session, profile, loading, error }`. 8s auth timeout, 2 retries; profile fallback to sessionStorage cache.

**Profile shape** (truncated):
```ts
{
  id: string,                    // auth.users FK
  email: string | null,
  full_name: string | null,
  role: 'rep' | 'admin' | 'manager' | 'owner',
  iron_role: string | null,
  iron_role_display: string | null,
  workspace_id: string | null,
  // ...other fields
}
```

**Auth recovery**: `auth-recovery.ts` + `auth-route-bootstrap.ts` handle session expiry (`SessionExpiredModal`), corrupt token cleanup (force sign-out), and protected-route bootstrap.

---

## 6. External integrations — wired vs stubbed

### 6.1 Production integrations

| Integration | Env vars | Used by | Fallback |
|---|---|---|---|
| **OpenAI** | `OPENAI_API_KEY` | chat, kb-maintenance, embed-crm, ingest, draft-email, dge-optimizer, follow-up-engine, escalation-router, flare-submit, equipment-vision, marketing-engine, parts-identify-photo, service-completion-feedback, service-intake, service-knowledge-capture, prep-sheet, quote-builder-v2, trade-valuation, voice-capture, voice-to-qrm, voice-to-parts-order, iron-transcribe, iron-tts, morning-briefing, sop-ingest, portal-api | Throws |
| **Anthropic** | `ANTHROPIC_API_KEY` | flow-synthesize, iron-orchestrator, iron-redteam-nightly, iron-pattern-mining | Throws |
| **HubSpot** | `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `HUBSPOT_APP_ID`, `HUBSPOT_REDIRECT_URI`, `HUBSPOT_SCOPES`, `HUBSPOT_OAUTH_STATE_SECRET` | OAuth + sync + scheduler + webhook receiver + crm-router | Falls back to `integration_status` table |
| **Linear** | `LINEAR_API_KEY`, `LINEAR_QEP_TEAM_ID`, `LINEAR_DEFAULT_ASSIGNEE_ID` | flare-submit (linear.ts) — creates issues from Flare reports with labels (`flare`, `severity:*`, `route:*`); flare-notify-fixed | `missing_credentials` (fail-open) |
| **Slack** | `SLACK_FLARE_WEBHOOK_URL` | flare-submit (slack.ts) — Block Kit messages with 3 deep-link buttons (QEP/Linear/Paperclip); iron-orchestrator (Iron health) | `missing_credentials` |
| **Resend** | `RESEND_API_KEY`, `RESEND_FROM`, `FLARE_FROM_EMAIL`, `FLARE_BLOCKER_EMAIL_TO` (locked to `brian.lewis@blackrockai.co`) | flare-submit (email.ts), flare-notify-fixed, parts-order-customer-notify, service-customer-notify-dispatch, service-vendor-escalator, portal-api, demo-admin | Silent fail (`skipped: true`) |
| **Paperclip** | `PAPERCLIP_API_KEY`, `PAPERCLIP_BASE_URL` | flare-submit (paperclip.ts) — dispatches flares to CEO agent | `missing_credentials` |
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | portal-stripe (Checkout + signature-verified webhook) | mailto fallback |
| **Sentry** | `SENTRY_DSN` (browser: `VITE_SENTRY_DSN`), `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_AUTH_TOKEN` (CI), `SENTRY_ORG`, `SENTRY_PROJECT` | All edge fns + frontend (browser: 100% replay on error, 10% trace sample in prod) | No-op |
| **OneDrive / Microsoft Graph** | `MSGRAPH_CLIENT_ID`, `MSGRAPH_CLIENT_SECRET`, `MSGRAPH_REDIRECT_URI` (browser: `VITE_MSGRAPH_CLIENT_ID`) | onedrive-oauth, ingest (document sync) | OAuth fails if unset |
| **MapBox / MapLibre** | `VITE_MAPBOX_TOKEN` (frontend only) | apps/web fleet map, asset map | Map renders empty |

### 6.2 Stubbed (env vars defined, no production usage)

- **FRED API** (`FRED_API_KEY`) — adapter exists in `_shared/adapters/fred-usda-live.ts`, never called
- **USDA** — adapter defined, not used
- **Twilio** (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`) — no SMS function exists
- **IntelliDealer** (`VITE_INTELLIDEALER_URL`) — referenced in Quote Builder UI as unlock condition; no actual API calls; `customer_profiles_extended` stores IDs only

### 6.3 Feature-flagged

- `SERVICE_CRON_RUNS_DISABLED` — disable service cron jobs (default: false → enabled)
- `CHAT_FAIL_CLOSED_ON_EMBEDDING` — fail-closed if embedding fails (default: false)
- `ALLOW_VENDOR_INBOUND_OPEN_MATCH` — vendor inbound open-match (default: false)
- `PLANNER_HEURISTIC_MODE` — parts planner heuristic mode (default: false)
- `INTEGRATION_STATUS_COMPAT_FALLBACK` — integration manager compat (default: false)

### 6.4 Webhooks exposed

| Path | Function | Auth | Purpose |
|---|---|---|---|
| `/hubspot-webhook` | `hubspot-webhook` | HMAC signature | Real-time HubSpot event sync |
| `/portal-stripe/webhook` | `portal-stripe` | Stripe signature | Payment confirmation |
| `/service-vendor-inbound` | `service-vendor-inbound` | `VENDOR_INBOUND_WEBHOOK_SECRET` HMAC | Parts inbound notification |
| `/telematics-ingest` | `telematics-ingest` | (open or secret TBD) | Equipment telemetry |
| `/flare-notify-fixed` | `flare-notify-fixed` | webhook origin | Linear issue status change → user notify |

---

## 7. Cron registrations (`pg_cron` + `net.http_post`)

All cron jobs are registered in migrations. They invoke edge functions via `net.http_post()` with `x-internal-service-secret` header. The pattern is established in mig 059, 072, 097, 200, 202.

| Job name | Function | Schedule | Migration |
|---|---|---|---|
| `embed-crm-refresh` | embed-crm | `*/15 * * * *` | 059 |
| `morning-briefing-daily` | morning-briefing | `0 11 * * *` | 059 |
| `anomaly-scan-periodic` | anomaly-scan | `0 */4 * * *` | 059 |
| `follow-up-engine-hourly` | follow-up-engine, crm-reminder-dispatcher | `0 * * * *` | 046 |
| `clean-rate-limits` | rate-limit cleanup | periodic | 011 |
| `pipeline-enforcer-periodic` | pipeline-enforcer | `0 */2 * * *` | 072 |
| `prospecting-nudge-2pm` | nudge-scheduler | `0 14 * * *` | 072 |
| `service-tat-monitor-periodic` | service-tat-monitor | `*/5 * * * *` | 097 |
| `service-stage-enforcer-periodic` | service-stage-enforcer | `*/10 * * * *` | 097 |
| `service-customer-notify-dispatch-periodic` | service-customer-notify-dispatch | periodic | 107 |
| `service-vendor-escalator-periodic` | service-vendor-escalator | periodic | 097 |
| `service-jobcode-learner-nightly` | service-jobcode-learner | `0 2 * * *` | 114 |
| `iron-pattern-mining-nightly` | iron-pattern-mining | `0 3 * * *` | 200 |
| `iron-redteam-nightly` | iron-redteam-nightly | `0 4 * * *` | 200 |
| `iron-slo-snapshot-nightly` | SLO tracking | `0 5 * * *` | 202 |
| `iron-memory-decay-nightly` | iron-decay-memory | `0 1 * * *` | 202 |
| `document-review-due-weekly` | sync_document_review_schedule | `0 9 * * 1` | 179 |

**Not yet registered** (operator action required):
- `flow-runner` — should run every 60s; mig 196 plan
- `flow-escalate-approvals` — should run every 5 min
- `flow-cleanup-idempotency` — should run daily at 03:00 UTC
- `analytics-snapshot-runner` — should run every 15 min
- `analytics-alert-evaluator` — should run after the snapshot runner

---

## 8. Recent waves shipped (April 2026 session)

This codebase has been moving fast. The most recent waves are documented in detail because they're freshest and least likely to be in any prior context window.

### 8.1 Wave 6.11 Flare — In-app context-aware bug capture

**Hotkey**: `⌘+⇧+B` (bug) / `⌘+⇧+I` (idea)

**Scope**: Right-side slide-in drawer captures screenshot, gzipped DOM snapshot, click trail (last 10), network trail (last 10, redacted), console errors (last 50), route history (last 10), perf metrics (LCP/FID/CLS), env metadata. User types one sentence + severity. Single edge function fans out to Supabase + Linear + Paperclip + Slack `#qep-flare` + (blocker-only) email to `brian.lewis@blackrockai.co`.

**Key files**:
- `supabase/migrations/185_flare_reports.sql` — `flare_reports` table + `flare_dedupe_count()` + `flare_recent_voice_capture()` + `flare_recent_user_activity()` RPCs
- `supabase/migrations/186_flare_storage_bucket_and_aha.sql` — flare-artifacts bucket, `aha_moment` 5th severity, dedupe RPC upgrade with `p_first_error` parameter
- `apps/web/src/lib/flare/` — capture layer: types, redactPII (7 regexes + DOM blanker + store walker), ringBuffers (capture-phase listeners + fetch monkey-patch), screenshot (html2canvas + pako gzip), captureContext, flareClient, useFlareHotkey, **FlareDrawer** (with severity chips, screenshot thumb, AI severity hint, hypothesis card, success state with Linear/Paperclip links), **FlareProvider**, **FlareAnnotator** (canvas annotator with arrow/circle/scribble), **submitQueue** (IndexedDB offline queue, max 50, drains on mount), **webVitals** (PerformanceObserver-based)
- `supabase/functions/flare-submit/index.ts` + `linear.ts` + `paperclip.ts` + `slack.ts` + `email.ts` + `intelligence.ts` (reproducer-step generation, hypothesis pattern detection)
- `supabase/functions/flare-notify-fixed/index.ts`
- `apps/web/src/features/admin/pages/FlareAdminPage.tsx` + `components/flare/FlareDetailDrawer.tsx` (renders signed screenshot + sandboxed DOM iframe with `sandbox="allow-same-origin"`)
- `vite.config.ts` — `VITE_GIT_SHA` / `VITE_APP_VERSION` / `VITE_BUILD_TIMESTAMP` build-time stamping
- `supabase/functions/chat/index.ts` — `flareReportId` chat preload branch
- `apps/web/src/components/ChatPage.tsx` — `context_type=flare` URL mapping
- `apps/web/src/lib/flare/types.ts` — 5-severity union: `blocker | bug | annoyance | idea | aha_moment`

**Architectural decisions**:
- Idea-mode flares cross-write to `qrm_idea_backlog` (Lane 7)
- Idempotent: each action's idempotency key includes the voice capture/source id
- 1-hour signed URL for blocker email; 7-day for Slack/Linear/Paperclip
- Sub-action_chain idempotency template (`tag:${params.company_id}:${params.tag}`)
- Storage bucket created declaratively in mig 186 (not on first-run from edge fn)
- Replay = 100% safe via idempotency keys

### 8.2 QEP Moonshot Command Center (Wave 6.10/v2) — `/exec` route

Owner-only executive operating layer with CEO/CFO/COO tabs. 6 slices shipped + audit fixes.

**Slices**:
1. **Foundation** — mig 187 (registry + snapshots + RPC), mig 188 (alerts + audit + dual-write helper); CommandCenterPage shell, CEO view, ExecutiveKpiCard, MetricDefinitionPopover, AlertsInboxPanel, live fallback queries
2. **Snapshot pipeline** — mig 189 (3 MVs + refresh helper); analytics-snapshot-runner (8 CEO computers), analytics-alert-evaluator (threshold rules + dedupe + dual-write + auto-resolve)
3. **CFO** — mig 190 (finance columns + 3 MVs + 8 CFO seeds); CfoCommandCenterView, PolicyEnforcementWall, MarginWaterfallExplorer
4. **COO** — mig 191 (ops columns + 3 MVs + 8 COO seeds); CooCommandCenterView, TodaysExecutionBoard, InventoryReadinessRail, RecoveryQueuePanel
5. **Drill + AI summary + drill-to-chat** — exec-summary-generator edge fn, chat fn `metricKey` preload branch, MetricDrillDrawer, AiExecutiveSummaryStrip, ContextToChatButton
6. **Exec packet** — mig 192 (exec_packet_runs); exec-packet-generator edge fn; CommandCenterExportMenu

**Audit fixes** (mig 193) — 2 P0 + 4 P1:
- 9 `security_invoker` MV wrapper views (closes cross-workspace data leak — frontend can never read MVs directly)
- `refresh_exec_materialized_views` catches `object_not_in_prerequisite_state` (first-run on empty MVs no longer crashes)
- `write_kpi_snapshot` atomic RPC closes the snapshot runner's update+insert race
- `enqueue_analytics_alert(p_workspace_id, …)` overload — single source of truth restored for the alert evaluator
- `analytics_quick_kpi(p_metric_key)` server-side aggregation replaces whole-table fetch in `useFallbackKpis`
- `MetricDrillDrawer` accepts `workspaceId` prop; CommandCenterPage self-fetches it from profiles

**Architectural decisions**:
- Owner-only access (`profile.role === "owner"`); no CFO/COO role split — same user, three lenses
- Immutable append-only `analytics_kpi_snapshots` with `supersedes_id` pointer (recalc → new row, not in-place update)
- MVs feed snapshots; UI ALWAYS reads `analytics_kpi_snapshots` (sub-100ms regardless of scale)
- Synthetic moonshot metrics ship as transparent rule-weighted v1 (`branch_health_score`, `cash_pressure_index`, `trust_velocity`, `friction_index`); weights live in `threshold_config` JSONB
- Alert evaluator dual-writes blockers into `exception_queue` so the existing `/exceptions` page surfaces them

**24 KPIs locked**:
- CEO (8): `revenue_mtd`, `gross_margin_dollars_mtd`, `gross_margin_pct_mtd`, `weighted_pipeline`, `forecast_confidence_score`, `net_contribution_after_load`, `enterprise_risk_count`, `cash_pressure_index`
- CFO (8): `cash_collected_mtd`, `ar_exposure_total`, `unverified_deposit_count`, `refund_exposure_total`, `check_exception_count`, `receipt_compliance_rate`, `hauling_recovery_rate`, `loaded_margin_pct`
- COO (8): `on_time_delivery_rate_today`, `scheduled_moves_at_risk_count`, `units_not_ready_count`, `traffic_cycle_time_avg`, `intake_units_stalled_count`, `rental_returns_aging_count`, `demo_readiness_rate`, `repeat_failure_index`

### 8.3 QEP Flow Engine (Wave 6.11/v1) — `/admin/flow` route

Internal automation + orchestration + event fabric. 5 slices shipped + audit fixes.

**Architectural reuse decisions** (key insight: avoid building parallel infra):
- **Event store**: extends `analytics_events` with 5 flow columns instead of new `flow_events` table
- **Dead-letter queue**: `exception_queue` with `source='workflow_dead_letter'` — zero new UI
- **Audit log**: `analytics_action_log` with 7 new `action_type` values
- **Trigger emit pattern**: clones `customer_lifecycle_events` triggers (mig 174)
- **Async runner**: pg_cron + `net.http_post` (existing pattern from mig 097)

**Workflows-as-code first**: each workflow lives as a typed `FlowWorkflowDefinition` TS file under `_shared/flow-workflows/<slug>.ts`. The runner imports them and on every tick computes a SHA256 hash of `{trigger_event_pattern, conditions, actions}`. If the DB row's `definition_hash` differs, it upserts. Re-deploy = workflow refresh without a migration.

**Sync trigger + async runner hybrid**: triggers synchronously call `emit_event()` which inserts the row AND fires `pg_notify('flow_event', event_id)`. The runner polls every 60s via pg_cron. The notify wakes early when listeners are attached.

**12-action registry** (`_shared/flow-engine/registry.ts`):
1. `create_task` (CRM activity)
2. `create_note`
3. `send_email_draft`
4. `send_in_app_notification`
5. `update_deal_stage`
6. `tag_account`
7. `create_exception` (wraps `enqueue_exception`)
8. `recompute_health_score`
9. `notify_service_recipient`
10. `escalate_parts_vendor`
11. `create_audit_event`
12. `request_approval` (writes `flow_approvals`, suspends parent run)

Each action has an `idempotency_key_template` so replays are provably safe. `dry_run` is honored at the action layer.

**10 flagship workflows-as-code**:
| Slug | Trigger | Approval-gated |
|---|---|---|
| `voice-capture-to-qrm` | `voice.capture.parsed` | no |
| `quote-expiring-soon` | `quote.expiring_soon` | no |
| `parts-received-for-open-job` | `parts.item.received` | no |
| `ar-aged-past-threshold` | `invoice.aged_past_threshold` | no |
| `service-delay-strategic-account` | `service.job.delayed` | yes (manager, 4h SLA / 12h escalation) |
| `ar-override-request` | `ar.block.created` | yes (controller) |
| `price-file-imported-affected-quotes` | `price_file.imported` | no |
| `equipment-hours-crossed-interval` | `equipment.hours_crossed_interval` | no |
| `rental-nearing-end` | `rental.nearing_end` | no |
| `competitor-signal-from-voice` | `voice.capture.parsed` (competitor confidence ≥ 0.7) | no |

**AI workflow synthesis** (Slice 5 differentiator beyond the spec): `flow-synthesize` edge fn turns English briefs into draft workflow JSON via Anthropic. System prompt embeds the action catalog + event taxonomy + condition DSL syntax. Output is strict JSON `{ workflow, missing[] }`. Drafts land disabled + dry-run for review.

**Drill-to-chat on workflow runs** (beyond the spec): chat fn `flowRunId` preload branch loads the run + step trace + originating event + dead-letter detail. Operators click "Ask Iron Advisor" on any failed run and get evidence-grounded answers.

**Pressure test fixture**: `scripts/flow-load-test.mjs` fires 10k synthetic events and asserts zero drops.

**Audit fixes** (mig 196) — 8 P0 + 5 P1:
- **P0-1** Approval resume gap — `flow_resume_run()` emits a synthetic continuation event with `parent_event_id` → original; idempotency keys prevent already-executed actions from re-firing
- **P0-2** Idempotency key params resolution — `computeIdempotencyKey()` now accepts a resolved params namespace
- **P0-3** Brittle PostgREST poll filter — replaced `.eq("consumed_by_runs", "[]")` with `flow_pending_events` view
- **P0-4** Retry policy not enforced — runner now wraps action execution in a retry loop honoring `def.retry_policy`
- **P0-5** Broken open-quote query in `flow_resolve_context` — fixed to join through `crm_deals.company_id`
- **P0-6** `consumed_by_runs` jsonb shape divergence — no-match path now writes a sentinel UUID
- **P0-7** Slug collision in `flow-synthesize` — appends 8 chars from `crypto.randomUUID()`
- **P0-8** Missing `actor_type` / `actor_id` (handoff §9) — added columns + index
- **P1-9** `request_approval` `p_step_id` always null — runner inserts step row first
- **P1-10** No `FlowApprovalsPanel` admin UI — new component wires `decide_flow_approval` RPC
- **P1-11** No replay button on dead letters — wired `flow_resume_run`
- **P1-12** Approval escalation/expiration — `flow_escalate_approvals()` cron helper
- **P1-13** Idempotency cleanup — `flow_cleanup_idempotency()` cron helper

### 8.4 Iron Wave 7 (parallel track)

Conversational + voice AI companion layer ON TOP of the Flow Engine. No parallel table duplication; extends `flow_workflow_definitions` and `flow_workflow_runs` instead. Undo semantics (60s wall-clock + semantic rule).

**Migrations 197–202** + edge functions: `iron-orchestrator`, `iron-execute-flow-step`, `iron-pattern-mining`, `iron-redteam-nightly`, `iron-transcribe`, `iron-tts`, `iron-undo-flow-run`. Models: claude-sonnet-4-6 (full classifier) and claude-haiku-4-5 (reduced cost ladder). System prompts + jailbreak corpus in `_shared/iron/`.

**Iron memory** (mig 201): per-entity tables (`iron_memory_qrm_companies`, `iron_memory_qrm_contacts`, `iron_memory_qrm_equipment`, `iron_memory_service_jobs`, etc.) with TTL'd self-associative recall. Bump triggers fire on entity save; `iron_decay_memory()` cron runs nightly.

**Iron SLO tracking** (mig 199, 202): `iron_compute_slos()` runs every 5 min. `iron_slo_history` table keeps history. Iron health surfaces via Slack alert.

---

## 9. Build, deploy, CI

### 9.1 Build commands

```bash
# Repo root
bun install                                # workspace install (apps/*)
bun run migrations:check                   # validate migration sequence
bun run build                              # delegates to apps/web

# apps/web
bun run build                              # tsc + vite build
bun run dev                                # vite dev server
```

### 9.2 Netlify deploy

**`netlify.toml`** at repo root:
```toml
[build]
  base = "apps/web"
  command = "bun run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  X-Frame-Options = "DENY"
  X-Content-Type-Options = "nosniff"
  Strict-Transport-Security = "max-age=63072000; includeSubDomains"
  Content-Security-Policy = "default-src 'self'; ... connect-src ... https://api.anthropic.com https://api.hubapi.com https://graph.microsoft.com"
  Permissions-Policy = "camera=(), microphone=(), geolocation=()"
```

**Required Netlify env vars**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optionally `VITE_SENTRY_DSN`, `VITE_MSGRAPH_CLIENT_ID`, `VITE_INTELLIDEALER_URL`, `VITE_MAPBOX_TOKEN`.

**Vite build fingerprinting** stamps `VITE_GIT_SHA`, `VITE_BUILD_TIMESTAMP`, `VITE_APP_VERSION` into the bundle for Sentry release tracking.

### 9.3 GitHub Actions CI (`.github/workflows/ci.yml`)

Triggers: `push: [main]`, `pull_request`. Ubuntu, 20-min timeout.

Steps:
1. Checkout + Bun + Deno 2.1.4
2. `bun install --frozen-lockfile`
3. Parts service pressure matrix (static validation)
4. Knowledge retrieval eval (with Supabase + OpenAI secrets)
5. Knowledge base integration tests (Deno)
6. Knowledge workspace isolation tests
7. Full build gate: `bun run build` (migrations check, service cron path guard, deno edge check, service contracts + planner + vendor tests)
8. Sentry source map upload (if `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` set)

### 9.4 Build performance / chunking

`vite.config.ts` manual chunks:
- `vendor-react-query`
- `vendor-supabase`
- `vendor-ui` (Radix + Lucide)
- `vendor-markdown` (react-markdown + remark-gfm)
- `vendor-maplibre` (~280 KB gzip — split out for cache)

Current bundle sizes (post-Wave 7):
- `index.js`: ~756 KB raw / ~219 KB gzip
- `vendor-maplibre`: ~1050 KB raw / ~282 KB gzip
- `vendor-ui`: ~327 KB raw / ~96 KB gzip
- `vendor-supabase`: ~194 KB raw / ~51 KB gzip

---

## 10. Environment variables — master catalog

### Required (production blocking)

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | All edge fns | Server-side |
| `SUPABASE_ANON_KEY` | All edge fns | Server-side |
| `SUPABASE_SERVICE_ROLE_KEY` | All edge fns | Server-side, bypasses RLS |
| `VITE_SUPABASE_URL` | Frontend | Browser-side mirror |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Browser-side mirror |
| `OPENAI_API_KEY` | chat, kb-*, embed-crm, voice, etc. | Throws on missing |
| `ANTHROPIC_API_KEY` | flow-synthesize, iron-* | Throws on missing |
| `HUBSPOT_CLIENT_ID` | hubspot-oauth, crm-* | Falls back to `integration_status` table |
| `HUBSPOT_CLIENT_SECRET` | hubspot-oauth, crm-* | same |
| `HUBSPOT_APP_ID` | hubspot-oauth | same |
| `HUBSPOT_OAUTH_STATE_SECRET` | hubspot-oauth | CSRF protection |
| `INTEGRATION_ENCRYPTION_KEY` | integration-crypto.ts | 64-char hex (32 bytes); throws if missing |
| `DGE_INTERNAL_SERVICE_SECRET` | dge-auth | Cron caller secret |
| `INTERNAL_SERVICE_SECRET` | service-auth, flow-runner, analytics-* | Cron caller secret |

### Optional (graceful degradation)

| Variable | Used by | Fallback |
|---|---|---|
| `RESEND_API_KEY` + `RESEND_FROM` | email functions | Silent fail (`skipped: true`) |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | portal-stripe | mailto fallback |
| `LINEAR_API_KEY` + `LINEAR_QEP_TEAM_ID` + `LINEAR_DEFAULT_ASSIGNEE_ID` | flare-submit | `missing_credentials` |
| `SLACK_FLARE_WEBHOOK_URL` | flare-submit, iron-orchestrator | `missing_credentials` |
| `PAPERCLIP_API_KEY` + `PAPERCLIP_BASE_URL` | flare-submit | `missing_credentials` |
| `FLARE_FROM_EMAIL` + `FLARE_BLOCKER_EMAIL_TO` | flare-submit | locked to `brian.lewis@blackrockai.co` |
| `SENTRY_DSN` (+ `VITE_SENTRY_DSN`) | All edge fns + frontend | No-op |
| `MSGRAPH_CLIENT_ID` + `MSGRAPH_CLIENT_SECRET` + `MSGRAPH_REDIRECT_URI` | onedrive-oauth, ingest | OAuth fails |
| `VITE_MSGRAPH_CLIENT_ID` | apps/web | OneDrive document sync |
| `FRED_API_KEY` | economic-sync | Stubbed (no production usage) |
| `VITE_INTELLIDEALER_URL` | apps/web | Quote Builder gate |
| `VITE_MAPBOX_TOKEN` | apps/web | Map renders empty |
| `APP_URL` | flare-submit, portal-api | `https://qep.blackrockai.co` |
| `DEFAULT_WORKSPACE_ID` | various | `'default'` |
| `VENDOR_INBOUND_WEBHOOK_SECRET` | service-vendor-inbound | Webhook fails |
| `DEMO_ADMIN_SECRET` | demo-admin | Auth fails |

### Feature flags

| Variable | Default |
|---|---|
| `SERVICE_CRON_RUNS_DISABLED` | false |
| `CHAT_FAIL_CLOSED_ON_EMBEDDING` | false |
| `ALLOW_VENDOR_INBOUND_OPEN_MATCH` | false |
| `PLANNER_HEURISTIC_MODE` | false |
| `INTEGRATION_STATUS_COMPAT_FALLBACK` | false |

---

## 11. Architectural patterns to know

### 11.1 The "extended event store" pattern

`analytics_events` is the universal append-only event log. The Flow Engine extends it (mig 194) instead of building a parallel `flow_events` table. Same for the Iron undo system (mig 197) which extends `flow_workflow_runs` instead of duplicating. **Lesson**: when adding a new domain, prefer extending the universal stores via additive nullable columns + new check-constraint values over creating parallel tables.

### 11.2 The "dual-write to exception_queue" pattern

`enqueue_analytics_alert` (Wave 6.10) and `enqueue_workflow_dead_letter` (Wave 6.11) both dual-write blocker/critical severity rows into `exception_queue` so the existing `/exceptions` page surfaces them. **Lesson**: the unified inbox is the single human work surface. Don't build parallel UIs; just add a new `source` value to the CHECK constraint.

### 11.3 The "compat view rename" pattern (mig 170)

When renaming `crm_*` → `qrm_*`, all 26 tables got `security_invoker = true` views at the old name. Auto-updatable `select *` views Just Work for INSERT/UPDATE/DELETE. **Caveat**: the `select *` is frozen at view-creation time. New columns added to the underlying table are NOT visible through the compat view. Mig 190 and 191 had to be patched after-the-fact to target `qrm_deals` / `qrm_equipment` directly. Always reference the underlying `qrm_*` table when adding columns.

### 11.4 The "workflows-as-code" pattern (Flow Engine)

Workflow logic lives in TS files (`_shared/flow-workflows/<slug>.ts`) typed as `FlowWorkflowDefinition`. The DB row in `flow_workflow_definitions` holds runtime state only (`enabled`, `dry_run`, `version`, `definition_hash`). Auto-sync on every runner tick via SHA256 hash comparison. **Lesson**: source-of-truth in version control + auto-registration via deploy = no migration needed for workflow updates.

### 11.5 The "idempotency by contract" pattern

Every Flow Engine action declares an `idempotency_key_template` (e.g., `tag:${params.company_id}:${params.tag}`). The runner resolves params first, then computes the key, then checks `flow_action_idempotency` before executing. Replay is provably safe. **Lesson**: bake idempotency into the contract, not the implementation.

### 11.6 The "context resolver = single deterministic RPC" pattern

`flow_resolve_context(p_event_id)` returns a JSONB blob. Called once per run; result frozen into `flow_workflow_runs.resolved_context`. Historical drill-downs see the exact data the workflow saw. Same pattern: `get_account_360`, `get_fleet_radar`, `get_asset_360`, `get_health_score_with_deltas`, `get_deal_composite`. **Lesson**: composite read RPCs eliminate N+1 round-trips and freeze the moment for historical accuracy.

### 11.7 The "drill-to-chat" pattern (Wave 6.11)

Chat fn `ChatContextPayload` accepts entity-specific context types: `equipmentId`, `serviceJobId`, `partsOrderId`, `voiceCaptureId`, `flareReportId` (Flare), `metricKey` (Command Center), `flowRunId` (Flow Engine). Each branch does a `callerClient` RLS probe → `adminClient` fetch → injects as `### X context (preloaded by Y)` markdown block in the system prompt. URL-param mapping in `ChatPage.tsx`. **Lesson**: every new domain that has an admin drill should add its own preload branch — operators get free Q&A on any entity.

### 11.8 The "fail-open zero-blocking" pattern

CLAUDE.md mandates this: missing external credentials must NOT crash workflows. Every dispatch helper (Resend, Linear, Slack, Paperclip) catches missing env vars and returns `{ status: 'skipped', reason: 'missing_credentials' }` instead of throwing. The action runner records the skip and continues. **Lesson**: integrations are optional surface area; the core path always succeeds.

### 11.9 The "security_invoker MV wrapper" pattern (Wave 6.10 audit fix)

Materialized views do NOT support RLS. Frontend code that reads MVs directly leaks across workspaces. Mig 193 created 9 `security_invoker` wrapper views with `where workspace_id = get_my_workspace() and get_my_role() = 'owner'`, then revoked direct MV select from `authenticated`. **Lesson**: never expose an MV to the frontend; always wrap in a security_invoker view.

---

## 12. Known gaps + technical debt

### 12.1 Stuff that's stubbed or unwired

- **Twilio SMS** — env vars defined, no function exists
- **FRED + USDA** — adapter exists, never called
- **IntelliDealer** — UI gate only; no actual API calls
- **Telematics ingest** — function exists, no upstream data source
- **OneDrive sync** — OAuth wired, no active sync observed
- **Meta social posting** — function is a framework only
- **`workflow_versions` table** — Flow Engine has a `version` field but no archive table or version-bump-on-edit logic
- **`workflow_metrics_daily` rollup** — admin UI computes live; no rollup table
- **`workflow_module_registry`** — TS file convention sufficient for MVP, formal table deferred
- **Dry-run UI panel for Flow Engine** — runner respects `dry_run`, but no admin surface to test workflows against historical events
- **Vitest in `apps/web`** — no test runner configured
- **Cron registrations for flow-runner / analytics-snapshot-runner / analytics-alert-evaluator / flow-escalate-approvals / flow-cleanup-idempotency** — operator must register these

### 12.2 Compat issues / legacy

- **`crm_*` compat views** — temporary scaffolding from mig 170; will be dropped in a future migration
- **`OPENAI_KEY` env var** — legacy name; `OPENAI_API_KEY` is canonical
- **`HUBSPOT_ENCRYPTION_KEY`** — legacy per-instance encryption; deprecated in favor of `integration-crypto.ts`
- **`service_requests`** — superseded by `service_jobs`; legacy

### 12.3 Event taxonomy coverage

Of the ~42 event types declared in the Flow Engine handoff §10 taxonomy, only 7 are emitted by triggers today: `deal.created`, `deal.stage.changed`, `voice.capture.created`, `voice.capture.parsed`, `quote.created`, `quote.sent`, `quote.expired`. The remaining 35 (`service.*`, `parts.*`, `rental.*`, `invoice.*`, `equipment.*`, `portal.*`, `sop.*`) require additional source-table triggers — a future migration slice.

---

## 13. Quick navigation reference

### Important file paths

| What | Where |
|---|---|
| Main router with all routes | `apps/web/src/App.tsx` |
| Generated DB types | `apps/web/src/lib/database.types.ts` (~342 KB) |
| Supabase client | `apps/web/src/lib/supabase.ts` |
| Auth hook | `apps/web/src/hooks/useAuth.ts` |
| Frontend primitives | `apps/web/src/components/primitives/index.ts` |
| Chat fn (multi-context preload) | `supabase/functions/chat/index.ts` |
| Flow Engine runner | `supabase/functions/flow-runner/index.ts` |
| Flow Engine action registry | `supabase/functions/_shared/flow-engine/registry.ts` |
| Flow Engine workflows | `supabase/functions/_shared/flow-workflows/*.ts` |
| Command Center page | `apps/web/src/features/exec/pages/CommandCenterPage.tsx` |
| Flow Engine admin page | `apps/web/src/features/admin/pages/FlowAdminPage.tsx` |
| Flare admin page | `apps/web/src/features/admin/pages/FlareAdminPage.tsx` |
| Existing Implementation Reference doc (Flow Engine) | `docs/QEP-FLOW-ENGINE-IMPLEMENTATION.md` |
| Stabilization tracker | `docs/STABILIZATION.md` |
| Project instructions | `CLAUDE.md` |

### Key migrations to read for context

| Mig | What it does |
|---|---|
| 016 | `analytics_events` event store baseline |
| 021 | CRM core tables (later renamed to qrm_*) |
| 025 | Weighted pipeline view |
| 070 | Deposits + payment validations |
| 094 | Service core tables |
| 113 | Customer invoices + portal pay |
| 132 | Parts module schema |
| 152 | SOP engine |
| 165 | Exception inbox |
| 170 | **QRM rename** — read this before touching crm_* / qrm_* |
| 173 | Account 360 + Fleet Radar RPCs |
| 174 | Lifecycle event triggers (the pattern Flow Engine clones) |
| 187–193 | **Command Center** (read 193 for security audit fixes) |
| 194–196 | **Flow Engine** (read 196 for audit fixes) |
| 197–202 | Iron Wave 7 |

### Key edge functions to read for patterns

| Function | Pattern |
|---|---|
| `chat/index.ts` | Multi-context preload (entity → JSONB block in system prompt) |
| `flow-runner/index.ts` | Action registry execution + retry + idempotency + dead-letter |
| `flare-submit/index.ts` | Multi-lane fan-out (Linear + Slack + Paperclip + Resend) with fail-open |
| `analytics-snapshot-runner/index.ts` | MV refresh + KPI computation + cron audit |
| `anomaly-scan/index.ts` | Periodic scan → batch alert creation |
| `follow-up-engine/index.ts` | Batch RPC orchestration (closest to Flow Engine runner pattern) |

---

## 14. Mental model

If you forget everything else, remember this:

1. **One workspace = one tenant.** `workspace_id` is on every table. RLS enforces it via `get_my_workspace()`. Cross-workspace leakage is the #1 thing to audit.

2. **Three role tiers.** `rep` (field), `admin/manager` (operations), `owner` (executive + billing visibility). Iron roles are a synthetic overlay (mig 67) for AI companion theming, not for RLS.

3. **The CRM is now QRM** (mig 170). All 26 `crm_*` tables are compat views over `qrm_*`. New columns must target `qrm_*` directly.

4. **Anything that needs human triage goes to `exception_queue`.** Wave 6.9 added the `/exceptions` page. Wave 6.10 dual-writes analytics blockers there. Wave 6.11 dual-writes workflow dead letters. Don't build a parallel inbox.

5. **Anything privileged writes to `analytics_action_log`.** It's the universal audit trail. Add new `action_type` values via CHECK constraint mutation when extending.

6. **Events flow through `analytics_events`.** Mig 194 extended it with flow columns. Triggers on source tables (mig 174 + Flow Engine triggers) call `emit_event()`. The Flow Engine runner polls and dispatches.

7. **Workflows are TS files first, DB rows second.** Never edit `flow_workflow_definitions` directly — edit the file under `_shared/flow-workflows/` and let the runner auto-sync via hash comparison.

8. **Idempotency is by contract.** Every Flow Engine action declares an `idempotency_key_template`. Replay is provably safe. The same principle applies to Flare's submit queue.

9. **The Command Center is owner-only.** No CFO/COO role split — same user, three lenses via `DashboardPivotToggle`.

10. **The chat fn is the universal drill-to-Q&A surface.** Every domain that has an admin drill should add a preload branch. Existing branches: `equipmentId`, `serviceJobId`, `partsOrderId`, `voiceCaptureId`, `flareReportId`, `metricKey`, `flowRunId`. Add `<AskIronAdvisorButton contextType="X" contextId={id} />` and a chat-fn branch.

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **QRM** | Quote Relationship Management — the post-rename CRM (mig 170) |
| **Wave** | A named delivery slice. Waves 1–7 to date. Each Wave has multiple Slices |
| **Slice** | A single shippable commit within a Wave |
| **Iron** | The Wave 7 AI companion layer. Iron Advisor / Iron Manager / Iron Woman / Iron Man are role-flavored personas |
| **Flare** | The Wave 6.11 in-app bug capture system (Cmd+Shift+B) |
| **Flow Engine** | The Wave 6.11/v1 internal automation fabric |
| **Command Center** | The Wave 6.10/v2 owner-only `/exec` executive operating layer |
| **DGE** | Demand Growth Engine — the Wave 4 finance scenario modeling system |
| **SOP** | Standard Operating Procedure engine (mig 152) |
| **Paperclip** | An external CEO agent that triages flares + drafts auto-fix PRs |
| **Linear** | Issue tracker — flares fan out to it |
| **HubSpot** | Source-of-truth CRM that QEP imports from + syncs to |
| **IntelliDealer** | External quote/inventory system — referenced as a UI gate but not actively called |
| **Workspace** | The multi-tenancy scope. Every table has `workspace_id`. RLS enforces it |
| **Compat view** | A `security_invoker = true` view created during the mig 170 rename for backwards compatibility |
| **Drill-to-chat** | The pattern of preloading entity context into the chat fn so operators can ask free-form questions about a specific row |
| **MV wrapper view** | A `security_invoker` view over a materialized view that filters by workspace/role (mig 193) |
| **Dead letter** | A failed Flow Engine run that exhausted retries; written to `exception_queue` with `source='workflow_dead_letter'` |
| **Idempotency key** | A deterministic string computed before action execution; collisions short-circuit the action so replay is safe |
| **Resolved context** | The frozen JSONB blob from `flow_resolve_context` that the workflow saw at execution time |

---

**End of QEP Complete System Reference. Last updated April 2026. Migration head: 202.**
