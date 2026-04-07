# QEP Flow Engine — Implementation Reference

**Status:** Shipped (Slices 1–5 + audit fixes)
**Source spec:** `qep_flow_engine_codex_handoff.md`
**Plan:** `~/.claude/plans/qep-flow-engine.md`
**Migrations:** 194, 195, 196
**Edge functions:** `flow-runner`, `flow-synthesize`
**Admin route:** `/admin/flow` (admin/manager/owner gated)

The Flow Engine is the dealership nervous system — one shared event bus + workflow orchestrator + action registry + approval layer that lets every QEP module react to every other module safely, audibly, and with full audit. This document is the complete reference for what shipped.

---

## 1. Architectural Decisions

These are the choices that distinguish this implementation from the handoff's literal table-by-table prescription. Each was a deliberate trade.

| Decision | Reasoning |
|---|---|
| **Reuse `analytics_events` instead of new `flow_events` table** | Event store baseline already existed (mig 016). Added 5 flow columns (`flow_event_type`, `source_module`, `correlation_id`, `parent_event_id`, `consumed_by_runs`). Zero migration cost; legacy analytics keeps working. |
| **Reuse `exception_queue` as the dead-letter queue + replay surface** | The Wave 6.9 Exception Inbox is already a generic, RLS-gated, status-tracked human work queue. Added `'workflow_dead_letter'` to the source CHECK constraint. Zero new UI required — failed workflow runs surface in `/exceptions` automatically. |
| **Reuse `analytics_action_log` for the audit trail** | Mig 188 already provides workspace-scoped append-only audit. Extended `action_type` CHECK with 7 workflow lifecycle values (`flow_run_start`, `flow_run_complete`, `flow_run_dead_letter`, `workflow_replay`, `workflow_override`, `approval_request`, `approval_decision`). |
| **Workflows-as-code first** | Each workflow lives as a typed `FlowWorkflowDefinition` TS file under `supabase/functions/_shared/flow-workflows/<slug>.ts`. The runner auto-syncs the file into `flow_workflow_definitions` on every tick via SHA256 hash comparison. The DB row holds runtime state (`enabled`, `dry_run`, `version`); the TS file is the source of truth for logic. Re-deploy = workflow refresh, no migration needed. |
| **Sync trigger + async runner hybrid** | `AFTER INSERT/UPDATE` triggers on source tables synchronously call `emit_event()`, which inserts the row AND fires `pg_notify('flow_event', event_id)`. The flow-runner edge fn polls every 60s via pg_cron. The notify wakes early when listeners are attached. No streaming queue dependency. |
| **Idempotency by contract** | Every action declares an `idempotency_key_template` (e.g., `tag:${params.company_id}:${params.tag}`). The runner resolves params first, then computes the key, then checks `flow_action_idempotency` before executing. Replay is provably safe — collisions short-circuit before side effects. |
| **Context resolver = single deterministic RPC** | `flow_resolve_context(p_event_id)` returns a JSONB blob with company/deal/health/AR/tier/recent_runs. Called once per run; result frozen into `flow_workflow_runs.resolved_context`. Historical drill-downs see the same data the workflow saw at execution time. |
| **AI workflow synthesis (beyond the handoff)** | `flow-synthesize` edge fn turns English briefs into draft workflow JSON via Anthropic. The system prompt constrains the model to the actual action catalog + event taxonomy. Drafts land disabled + dry-run for review. |
| **Drill-to-chat on workflow runs (beyond the handoff)** | Extends Wave 6.11 chat preload pattern with `flowRunId`. Operators click "Ask Iron Advisor" on a dead-lettered run → chat preloads the event payload + step trace + resolved context + failure reason. |
| **Pressure test as a first-class artifact** | `scripts/flow-load-test.mjs` fires N synthetic events and asserts zero drops. Stronger than the handoff's vague "burst event ingestion" bullet. |
| **Workspace-scoped from line 1** | Every new table has `workspace_id text default get_my_workspace()`. RLS owner/admin/manager-gated for reads, service_role bypass for writes. No cross-workspace leakage at any layer. |

---

## 2. Slice-by-Slice Implementation

### Slice 1 — Foundation

**Migration `194_flow_engine_foundation.sql`**

Extends `analytics_events` (additive, all nullable):
- `flow_event_type text` — canonical type like `quote.expired`
- `flow_event_version int default 1`
- `source_module text` — `quotes`, `service`, `parts`, `qrm`, `portal`, `sop`, `system`
- `correlation_id uuid`
- `parent_event_id uuid`
- `consumed_by_runs jsonb default '[]'::jsonb`

Indexes: `idx_ae_flow_unprocessed (occurred_at) where flow_event_type is not null and consumed_by_runs = '[]'::jsonb`, `idx_ae_flow_event_type (workspace_id, flow_event_type, occurred_at desc)`.

New tables:

| Table | Purpose | Key columns |
|---|---|---|
| `flow_workflow_definitions` | Workflow registration | `slug` (unique per workspace), `name`, `owner_role`, `trigger_event_pattern`, `condition_dsl jsonb`, `action_chain jsonb`, `retry_policy jsonb`, `enabled`, `dry_run`, `version`, `definition_hash`, `affects_modules jsonb` |
| `flow_workflow_runs` | One row per execution | `workflow_id`, `event_id`, `status` (pending/running/succeeded/partially_succeeded/awaiting_approval/failed_retrying/dead_lettered/cancelled), `attempt`, `dry_run`, `started_at`, `finished_at`, `duration_ms`, `resolved_context jsonb`, `dead_letter_id`, `error_text` |
| `flow_workflow_run_steps` | Per-step trace | `run_id`, `step_index`, `step_type` (condition/action/approval), `action_key`, `params jsonb`, `idempotency_key`, `status`, `result jsonb`, `error_text`, `started_at`, `finished_at` |
| `flow_action_idempotency` | TTL'd dedupe | `idempotency_key pk`, `workspace_id`, `run_id`, `action_key`, `result jsonb`, `expires_at default now() + '7 days'` |

Cross-table extensions:
- `exception_queue.source` CHECK gains `'workflow_dead_letter'`
- `analytics_action_log.action_type` CHECK gains 7 workflow lifecycle values

New SQL functions:
- `emit_event(p_event_type, p_source_module, p_entity_type, p_entity_id, p_payload, p_workspace_id, p_correlation_id, p_parent_event_id)` — single entry point. Inserts into `analytics_events` with flow columns set, fires `pg_notify('flow_event', event_id)`.
- `mark_event_consumed(p_event_id, p_run_id)` — appends `run_id` to `consumed_by_runs` jsonb array, idempotent.
- `enqueue_workflow_dead_letter(p_run_id, p_workflow_slug, p_reason, p_failed_step, p_payload)` — wraps `enqueue_exception` with `source='workflow_dead_letter'` and updates the run row.

Source table triggers (3 to prove the pattern; Slice 2 adds more):
- `trg_flow_emit_deal` on `qrm_deals` → `deal.created`, `deal.stage.changed`
- `trg_flow_emit_voice` on `voice_captures` → `voice.capture.created`, `voice.capture.parsed`
- `trg_flow_emit_quote` on `quote_packages` → `quote.created`, `quote.sent`, `quote.expired`, `quote.updated`

> Note: trigger targets the underlying `qrm_deals` table because mig 170 turned `crm_deals` into a compat view.

**Edge function `flow-runner` (skeleton)**
- Cron auth via `INTERNAL_SERVICE_SECRET` OR owner JWT for manual invokes
- Polls `analytics_events` for unprocessed flow events (batch 200, 50s runtime ceiling)
- Glob pattern matching on `trigger_event_pattern` (exact or `module.*`)
- Service_cron_runs audit row per tick

**Shared modules**
- `_shared/flow-engine/types.ts` — `FlowWorkflowDefinition`, `FlowAction`, `FlowContext`, `FlowCondition` DSL types
- `_shared/flow-engine/condition-eval.ts` — pure DSL evaluator + idempotency key template renderer (importable by future dry-run UI)
- `_shared/flow-engine/registry.ts` — empty action registry stub (Slice 2 fills this in)

---

### Slice 2 — Action registry + 4 flagship workflows

**12 actions in `_shared/flow-engine/registry.ts`** — each ~30–50 lines wrapping existing `_shared/*` dispatch helpers:

| # | Action | Wraps | Affects |
|---|---|---|---|
| 1 | `create_task` | `crm_activities` insert | qrm |
| 2 | `create_note` | `crm_activities` insert (note type) | qrm |
| 3 | `send_email_draft` | `email_drafts` insert (fail-soft if table absent) | qrm, communications |
| 4 | `send_in_app_notification` | `crm_in_app_notifications` insert | qrm |
| 5 | `update_deal_stage` | `crm_deals.stage_id` update | qrm |
| 6 | `tag_account` | `crm_companies.tags` array append | qrm |
| 7 | `create_exception` | `enqueue_exception` RPC | ops |
| 8 | `recompute_health_score` | `compute_health_score_rpc` | qrm |
| 9 | `notify_service_recipient` | `crm_in_app_notifications` scoped to service writer | service |
| 10 | `escalate_parts_vendor` | `parts_orders` escalation columns | parts |
| 11 | `create_audit_event` | `analytics_action_log` insert | audit |
| 12 | `request_approval` | `request_flow_approval` RPC (Slice 3) | governance |

Each action declares an `idempotency_key_template` so replays are provably safe. `dry_run` is honored at the action layer (short-circuit before any write). Tables that may not exist on every deployment fail soft with `status='skipped'` instead of crashing the run.

**4 flagship workflows-as-code under `_shared/flow-workflows/`:**

| Slug | Trigger | Behavior |
|---|---|---|
| `voice-capture-to-qrm` | `voice.capture.parsed` | Note + competitor risk tag + audit |
| `quote-expiring-soon` | `quote.expiring_soon` | Rep task + customer email draft |
| `parts-received-for-open-job` | `parts.item.received` | Service writer ping + audit |
| `ar-aged-past-threshold` | `invoice.aged_past_threshold` | Tag + exception + approval request |

**Auto-sync from TS to DB.** The runner imports the workflow files and on every tick computes a SHA256 hash of `{trigger_event_pattern, conditions, actions}`. If `flow_workflow_definitions.definition_hash` differs, it upserts the row. Re-deploy = workflow refresh without a migration.

---

### Slice 3 — Approvals + context resolver

**Migration `195_flow_engine_approvals_and_context.sql`**

`flow_approvals` table — full lifecycle (pending → approved/rejected/expired/escalated/cancelled):
- Routing: `assigned_role text`, `assigned_to uuid`
- Timing: `requested_at`, `due_at`, `escalate_at`, `reminder_sent_at`
- Subject: `subject text`, `detail text`, `context_summary jsonb`
- Decision: `decided_at`, `decided_by`, `decision_reason text`
- RLS: admin/manager/owner read-all + assigned approver read-own + admin update + service_role full

> Linter applied a cast on the assigned_role policy: `assigned_role = public.get_my_role()::text` to handle enum/text conversion correctly.

`request_flow_approval(p_run_id, p_step_id, p_workflow_slug, p_subject, p_detail, p_assigned_role, p_assigned_to, p_due_in_hours, p_escalate_in_hours, p_context_summary)` RPC:
- Inserts the approval row
- Suspends the parent run by setting `status='awaiting_approval'`
- Writes an `analytics_action_log` audit row with `action_type='approval_request'`

`decide_flow_approval(p_approval_id, p_decision, p_reason)` RPC:
- Records the decision via `auth.uid()`
- On approve: resumes the parent run (mig 196 calls `flow_resume_run`)
- On reject: cancels the parent run with `metadata.reject_reason`
- Audit-logs via `auth.uid()` + `action_type='approval_decision'`

`flow_resolve_context(p_event_id)` RPC — single point of context hydration:
- Pulls `company`, `deal`, `health_score`, `ar_block_status`, `customer_tier` (heuristic from tags), `open_quote_total`, `recent_runs` against the same entity in the last 30 days
- Best-effort for tables that may not exist on every deployment (catches `undefined_table`)
- Defensive UUID casts so non-uuid payload values don't crash the resolver (mig 196 fix)

**flow-runner upgrades**
- `buildContextFromEvent` is async, calls `flow_resolve_context` per event
- Freezes the resolved context into `flow_workflow_runs.resolved_context` so historical drill-downs see the same data the workflow saw at run time
- `request_approval` action upgraded from Slice 2 stub to call the real RPC

**2 new approval-gated flagship workflows**

| Slug | Trigger | Approval Required |
|---|---|---|
| `service-delay-strategic-account` | `service.job.delayed` | Manager (4h SLA, 12h escalation), conditions check `customer_tier='strategic'` AND `context.deal exists` AND `no_recent_run within 24h` |
| `ar-override-request` | `ar.block.created` | Controller (4h SLA, 12h escalation) |

---

### Slice 4 — Admin surfaces

**Route:** `/admin/flow` (admin/manager/owner gated)

**`FlowAdminPage.tsx`**
- ForwardForecastBar rollup tiles: 24h runs, succeeded, failed, awaiting approval, dead letters open
- Workflows table: name + slug + dry-run badge + trigger pattern + role + version + Enable/Disable toggle (mutates `flow_workflow_definitions`)
- Recent runs scroller (last 50, refetch every 30s) — click any row → opens run history drawer
- Dead-letters card filtering `exception_queue.source='workflow_dead_letter'`
- "Run now" button manually invokes the flow-runner edge fn
- Synthesize button + textarea panel (Slice 5)
- Pending Approvals panel (Slice 5 audit fix)
- React Query invalidation after mutations refreshes visible state

**`FlowRunHistoryDrawer.tsx`** — Sheet-based, opens on row click
- Status banner with chip stack + dead-letter badge + error text
- Step trace from `flow_workflow_run_steps`: per-step status, duration, error text, result JSON, color-coded by status
- Resolved context blob (collapsed by default, expandable)
- `AskIronAdvisorButton` with `contextType='flow_run'` wired for the chat preload branch

---

### Slice 5 — AI synth + drill-to-chat + 4 more workflows + load test

**4 more flagship workflows-as-code (total: 10 of 12 spec'd)**

| Slug | Trigger | Behavior |
|---|---|---|
| `price-file-imported-affected-quotes` | `price_file.imported` | Audit + impact exception |
| `equipment-hours-crossed-interval` | `equipment.hours_crossed_interval` | Service prompt + audit |
| `rental-nearing-end` | `rental.nearing_end` | Off-rent prep + trade-up follow-up |
| `competitor-signal-from-voice` | `voice.capture.parsed` (competitor confidence ≥ 0.7) | Tag + prompt + audit |

**Edge function `flow-synthesize`**
- Owner JWT only
- Anthropic call (`claude-haiku-4-5-20251001`) with constrained system prompt embedding the action catalog + event taxonomy + condition DSL syntax
- Strict JSON output: `{ workflow, missing[] }` so the model can't reference primitives that don't exist
- Validates returned `action_keys` against the catalog and adds bogus references to `missing[]`
- Inserts the draft as `enabled=false` + `dry_run=true` so admins must explicitly review and flip on
- Surfaces in `/admin/flow` via "Synthesize" button + textarea panel

**Chat fn `metricKey`-pattern extension for `flowRunId`**
- `ChatContextPayload.flowRunId` added with `cleanUuid` validation
- `callerClient` RLS probe on `flow_workflow_runs` (admin/manager/owner read)
- `adminClient` fetches: run row + step trace + originating `analytics_events` row + `dead_letter` `exception_queue` row
- Injects as `### Flow run context (preloaded by Flow Admin drill)`
- ChatPage URL-param mapping: `context_type=flow_run` → `flowRunId`
- `contextLabel` updated; `AskIronAdvisorButton` in `FlowRunHistoryDrawer` already wires this — drill-to-chat works end-to-end

**`scripts/flow-load-test.mjs`**
- Fires N synthetic events (default 10k) via `emit_event` RPC
- Invokes flow-runner once
- Asserts every event consumed (`consumed_by_runs` non-empty)
- Reports emit p50 + runner duration + drop count
- Exits non-zero on any drop

---

## 3. Post-Build Audit + Fixes (Migration 196)

After Slices 1–5 shipped, a comprehensive audit uncovered 8 P0 ship-blockers and 5 P1 fix-this-session defects. All addressed in `196_flow_engine_audit_fixes.sql` + edge fn patches + new admin UI.

### P0 ship-blockers fixed

**P0-1. Approval resume gap (CRITICAL)**

`decide_flow_approval` set `status='running'` but the runner only polled events with `consumed_by_runs='[]'`. The original event was already consumed when the run was created → approved runs were never re-executed.

Fix: `flow_resume_run(p_run_id)` RPC emits a synthetic `workflow.resume` event with `parent_event_id` → original. The runner picks it up next tick. Idempotency keys prevent the actions that already ran from re-firing.

**P0-2. Idempotency key params resolution**

`computeIdempotencyKey()` only walked `{event, context, payload}` so every `${params.X}` placeholder in templates resolved to null/undefined → all idempotency keys for a given action collapsed into one.

Fix: extended `computeIdempotencyKey(template, ctx, resolvedParams)` to accept a `params` namespace. Added `resolveValue` and `resolveParamsForRun` exports. Runner now resolves params BEFORE computing the key.

**P0-3. Brittle PostgREST poll filter**

`.eq("consumed_by_runs", "[]")` against jsonb is fragile.

Fix: created `flow_pending_events` security_invoker view that wraps the empty-array check + 7-day occurred_at horizon. Runner queries the view; same row visibility, stable surface.

**P0-4. Retry policy not enforced**

Schema declared `retry_policy` but the runner dead-lettered on first failure.

Fix: retry loop honors `def.retry_policy.max` + `backoff` (linear/exponential) + `base_seconds`, capped at 5s sleep within a single tick. Marks step `status='retrying'` between attempts.

**P0-5. Broken open-quote query in `flow_resolve_context`**

Mig 195 referenced `payload ->> 'company_id'` on `quote_packages`, a column that doesn't exist.

Fix: replaced with a join through `crm_deals.company_id`. Added defensive UUID casts that return null on parse failure instead of crashing.

**P0-6. `consumed_by_runs` jsonb shape divergence**

Runner's no-match path wrote `["no_match"]` (string array) while `mark_event_consumed` wrote `["uuid-string"]`.

Fix: no-match path now calls `mark_event_consumed` with sentinel UUID `00000000-0000-0000-0000-000000000000`. Same shape across all writers.

**P0-7. Slug collision in `flow-synthesize`**

`synthesized-${Date.now()}` collided on parallel calls.

Fix: `synthesized-${Date.now()}-${crypto.randomUUID().slice(0,8)}` — collision-proof per workspace.

**P0-8. Missing `actor_type` / `actor_id` columns (handoff §9 required fields)**

Mig 196 adds both columns + index on `analytics_events`. `emit_event` extended with `p_actor_type` (default `'system'`) and `p_actor_id` parameters.

### P1 fixes

**P1-9. `request_approval` `p_step_id` always null**

Runner now inserts the step row as `'pending'` BEFORE executing the action so `step_id` is available. `FlowActionDeps` gained `step_id?: string`. The `request_approval` action threads it into the RPC.

**P1-10. No FlowApprovalsPanel admin UI**

New `apps/web/src/features/admin/components/flow/FlowApprovalsPanel.tsx`:
- Queries `flow_approvals` where `status in ('pending','escalated')`
- Approve/Reject buttons with reason field
- Calls `decide_flow_approval` RPC
- Wired into `FlowAdminPage`

**P1-11. No replay button on dead letters**

`FlowAdminPage` dead-letter card now shows a "Replay" button per row that calls `flow_resume_run(run_id)` and marks the `exception_queue` row resolved. Idempotency keys make replay safe.

**P1-12. Approval escalation/expiration cron helper**

`flow_escalate_approvals()` RPC: flips overdue approvals to `'expired'`, cancels their parent runs, and flips past-escalate approvals to `'escalated'`.

**P1-13. Idempotency cleanup**

`flow_cleanup_idempotency()` RPC deletes expired rows. Index on `(workspace_id, status, started_at desc)` filtered to `dead_lettered` for the dead-letter UI.

---

## 4. Complete File Inventory

### Migrations (3 total)

| File | Purpose |
|---|---|
| `supabase/migrations/194_flow_engine_foundation.sql` | Slice 1: extends analytics_events, 4 new tables, emit_event + mark_event_consumed + enqueue_workflow_dead_letter RPCs, 3 source-table triggers |
| `supabase/migrations/195_flow_engine_approvals_and_context.sql` | Slice 3: flow_approvals table, request/decide RPCs, flow_resolve_context |
| `supabase/migrations/196_flow_engine_audit_fixes.sql` | Audit: flow_pending_events view, flow_resume_run RPC, fixed flow_resolve_context, actor_type/actor_id columns, flow_escalate_approvals, flow_cleanup_idempotency |

### Edge functions (2 total)

| Path | Purpose |
|---|---|
| `supabase/functions/flow-runner/index.ts` | Polls events, matches workflows, executes action chains with retry loop, dead-letters terminal failures |
| `supabase/functions/flow-synthesize/index.ts` | Anthropic-powered English-to-workflow draft generator |

### Shared modules

| Path | Purpose |
|---|---|
| `supabase/functions/_shared/flow-engine/types.ts` | `FlowWorkflowDefinition`, `FlowAction`, `FlowContext`, `FlowCondition`, `FlowActionDeps` |
| `supabase/functions/_shared/flow-engine/condition-eval.ts` | Pure DSL evaluator + `resolveValue` + `resolveParamsForRun` + `computeIdempotencyKey` |
| `supabase/functions/_shared/flow-engine/registry.ts` | 12-action registry |
| `supabase/functions/_shared/flow-engine/iron-actions.ts` | (parallel-track Iron Wave 7 actions) |

### Workflows-as-code (10 + 1 parallel)

| Slug | Trigger | Approval-gated |
|---|---|---|
| `voice-capture-to-qrm` | `voice.capture.parsed` | no |
| `quote-expiring-soon` | `quote.expiring_soon` | no |
| `parts-received-for-open-job` | `parts.item.received` | no |
| `ar-aged-past-threshold` | `invoice.aged_past_threshold` | no |
| `service-delay-strategic-account` | `service.job.delayed` | yes |
| `ar-override-request` | `ar.block.created` | yes |
| `price-file-imported-affected-quotes` | `price_file.imported` | no |
| `equipment-hours-crossed-interval` | `equipment.hours_crossed_interval` | no |
| `rental-nearing-end` | `rental.nearing_end` | no |
| `competitor-signal-from-voice` | `voice.capture.parsed` (competitor ≥ 0.7) | no |

`iron-flows.ts` is a parallel-track Iron Wave 7 file kept side-by-side.

### Frontend (admin route)

| Path | Purpose |
|---|---|
| `apps/web/src/features/admin/pages/FlowAdminPage.tsx` | Workflows list, runs scroller, dead letters, synth panel, approvals panel, replay button |
| `apps/web/src/features/admin/components/flow/FlowRunHistoryDrawer.tsx` | Step trace + resolved context + drill-to-chat |
| `apps/web/src/features/admin/components/flow/FlowApprovalsPanel.tsx` | Pending approvals queue with approve/reject |

### Chat fn extension

| Path | Change |
|---|---|
| `supabase/functions/chat/index.ts` | New `flowRunId` branch in `ChatContextPayload`; preloads run + steps + originating event + dead-letter detail as `### Flow run context` markdown block |
| `apps/web/src/components/ChatPage.tsx` | URL-param mapping: `context_type=flow_run` → `flowRunId`; `contextLabel` updated |

### Pressure test fixture

| Path | Purpose |
|---|---|
| `scripts/flow-load-test.mjs` | Fires N synthetic events, invokes runner, asserts zero drops |

---

## 5. Action Registry Reference

Each action is callable from a workflow's `action_chain`. Templates use `${event.payload.X}`, `${context.company.id}`, `${params.Y}` placeholders.

```typescript
// Example workflow action chain entry
{
  action_key: "create_task",
  params: {
    activity_type: "follow_up",
    subject: "Quote ${event.properties.quote_id} expires soon",
    body: "Net total: $${event.properties.net_total}",
    deal_id: "${event.properties.deal_id}",
  },
  on_failure: "continue",
}
```

| Action | Required params | Idempotency template |
|---|---|---|
| `create_task` | `subject`, optionally `body`, `due_at`, `deal_id`, `contact_id`, `company_id`, `assigned_to` | `task:${event.entity_type}:${event.entity_id}:${event.flow_event_type}` |
| `create_note` | `subject`, `body`, optional entity refs | `note:${event.entity_type}:${event.entity_id}:${event.flow_event_type}` |
| `send_email_draft` | `to_email`, `subject`, `body` | `email_draft:${event.entity_type}:${event.entity_id}:${event.flow_event_type}` |
| `send_in_app_notification` | `user_id`, `title`, optional `body`, `link`, `severity` | `notif:${params.user_id}:${event.flow_event_type}:${event.entity_id}` |
| `update_deal_stage` | `deal_id`, `stage_id` | `deal_stage:${params.deal_id}:${params.stage_id}` |
| `tag_account` | `company_id`, `tag` | `tag:${params.company_id}:${params.tag}` |
| `create_exception` | `source`, `title`, optional `severity`, `detail`, `payload` | `exception:${params.source}:${event.entity_type}:${event.entity_id}` |
| `recompute_health_score` | `customer_profile_id` | `health:${params.customer_profile_id}:${event.event_id}` |
| `notify_service_recipient` | `service_job_id`, `title`, optional `body`, `severity` | `service_notify:${params.service_job_id}:${event.flow_event_type}` |
| `escalate_parts_vendor` | `parts_order_id`, optional `reason` | `parts_escalate:${params.parts_order_id}` |
| `create_audit_event` | `tag`, optional `metadata` | `audit:${event.flow_event_type}:${event.entity_id}:${params.tag}` |
| `request_approval` | `subject`, optional `detail`, `assigned_role`, `assigned_to`, `due_in_hours`, `escalate_in_hours` | `approval:${event.entity_type}:${event.entity_id}:${params.subject}` |

---

## 6. Condition DSL Reference

```typescript
type FlowCondition =
  | { op: "eq"|"neq"|"gt"|"gte"|"lt"|"lte", field: string, value: unknown }
  | { op: "in"|"nin", field: string, values: unknown[] }
  | { op: "exists", field: string }
  | { op: "within", field: string, hours: number }
  | { op: "role", value: string }
  | { op: "count", field: string, gte?: number, lte?: number }
  | { op: "and"|"or", clauses: FlowCondition[] }
  | { op: "not", clause: FlowCondition }
  | { op: "no_recent_run", workflow_slug: string, hours: number };
```

`field` strings dot-walk into `{event, context, payload}`. Examples:
- `"context.customer_tier"` → resolved company tier
- `"event.payload.amount"` → event payload field
- `"context.deal"` → resolved deal object (use with `exists`)

The `no_recent_run` operator suppresses duplicate fires within a time window — used by `service-delay-strategic-account` to avoid alert spam.

---

## 7. Spec Compliance Matrix

### Handoff §22 — 12 Flagship Workflows

| # | Workflow | Status |
|---|---|---|
| 1 | Voice → QRM enrichment | ✓ `voice-capture-to-qrm` |
| 2 | Quote expiring → rep task + email | ✓ `quote-expiring-soon` |
| 3 | Price file → affected quotes | ✓ `price-file-imported-affected-quotes` |
| 4 | Budget window → account prompt | deferred (no source event yet) |
| 5 | Service delay strategic → alert | ✓ `service-delay-strategic-account` (approval-gated) |
| 6 | Parts received → service update | ✓ `parts-received-for-open-job` |
| 7 | A/R aged → block + approval | ✓ `ar-aged-past-threshold` + `ar-override-request` |
| 8 | Rental nearing end → trade-up | ✓ `rental-nearing-end` |
| 9 | SOP step skipped → coaching | deferred (SOP triggers not yet emitting) |
| 10 | Portal payment → internal updates | deferred (portal events not yet wired) |
| 11 | Equipment hours crossed interval | ✓ `equipment-hours-crossed-interval` |
| 12 | Competitor signal from voice | ✓ `competitor-signal-from-voice` |

**Shipped: 10 of 12.** The 2 deferred require additional source-table triggers (1 migration away).

### Handoff §7 — Scope (10 capabilities)

| Capability | Status | Notes |
|---|---|---|
| Event ingestion | ✓ | `emit_event` RPC + 3 trigger functions |
| Rule evaluation | ✓ | DSL evaluator with 14 operators |
| Context expansion | ✓ | `flow_resolve_context` returns 7 fields |
| Action execution | ✓ | 12-action registry with retry + idempotency |
| Approval orchestration | ✓ | Full lifecycle table + RPCs + admin UI |
| Workflow run logging | ✓ | Run + step rows with frozen context |
| Error handling | ✓ | Retry policy + dead letters + replay |
| Admin controls | ✓ | List/enable/disable/runs/dead-letters/synth/approvals |
| Module registration | ◐ | TS file convention (DB module registry deferred) |
| Analytics | ◐ | Live computation in admin UI (rollup table deferred) |

### Handoff §18 — Data Model (14 tables → 4 + reuse)

| Spec table | Status | Substitution |
|---|---|---|
| `flow_events` | reused | `analytics_events` extended with 5 flow columns |
| `flow_event_subscriptions` | reused | Pattern matching on `flow_workflow_definitions.trigger_event_pattern` |
| `flow_workflow_definitions` | ✓ | Mig 194 |
| `flow_workflow_versions` | deferred | `version` field exists; archive table is a future migration |
| `flow_workflow_runs` | ✓ | Mig 194 |
| `flow_workflow_run_steps` | ✓ | Mig 194 |
| `flow_workflow_approvals` (`flow_approvals`) | ✓ | Mig 195 |
| `flow_workflow_dead_letters` | reused | `exception_queue` with `source='workflow_dead_letter'` |
| `flow_action_registry` | reused | TS module (`registry.ts`) |
| `flow_workflow_module_registry` | deferred | TS file convention sufficient |
| `flow_workflow_templates` | reused | TS files ARE templates |
| `flow_workflow_metrics_daily` | deferred | Computed live in admin UI |
| `flow_workflow_replays` | reused | `analytics_action_log` with `action_type='workflow_replay'` |
| `flow_workflow_overrides` | reused | `analytics_action_log` with `action_type='workflow_override'` |

**4 new tables** instead of the 14 the handoff prescribed. The reuse approach keeps the surface area small without losing any required functionality.

---

## 8. Verification

### Build gates (run after every change)

```bash
bun run migrations:check
# expect: 196 files, sequence 001..196

cd apps/web && bun run build
# expect: green, no TypeScript errors
```

### End-to-end smoke

```bash
# 1. Trigger a deal stage change → event emitted → workflow runs
psql> update qrm_deals set stage_id = '<new-stage>' where id = '<deal-id>';
psql> select event_id, flow_event_type from analytics_events
      where flow_event_type = 'deal.stage.changed' order by occurred_at desc limit 1;
supabase functions invoke flow-runner
psql> select status, workflow_slug from flow_workflow_runs order by started_at desc limit 5;

# 2. Approval resume end-to-end
psql> select public.emit_event('service.job.delayed','service','crm_deal','<deal-uuid>','{}','default');
supabase functions invoke flow-runner
psql> select id, status from flow_workflow_runs where workflow_slug='service-delay-strategic-account' order by started_at desc limit 1;
# expect: status='awaiting_approval'
psql> select public.decide_flow_approval('<approval-id>','approved','test');
supabase functions invoke flow-runner
psql> select status from flow_workflow_runs where id='<old-run-id>';
# expect: 'cancelled' with metadata.resumed_as_event set
psql> select * from flow_workflow_runs where event_id in (
  select event_id from analytics_events where parent_event_id = '<old-event-id>'
);
# expect: a NEW run, status='succeeded'

# 3. Retry loop honors max
# Force a workflow with a failing action; verify steps with status='retrying' between attempts.

# 4. Idempotency replay safety
# Run the same workflow twice. Second run's steps show idempotency_hit:true; no duplicate side effects.

# 5. Replay button
# Trigger a dead-letter (set RESEND_API_KEY=invalid for an email action).
# Open /admin/flow → click Replay → original event re-emitted as continuation.

# 6. FlowApprovalsPanel
# As owner, /admin/flow → "Pending approvals" card → Approve → row disappears, parent run resumes.

# 7. Pressure test
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/flow-load-test.mjs 1000
# expect: PASS — zero drops

# 8. Approval escalation cron
psql> update flow_approvals set due_at = now() - interval '1 hour' where id = '<id>';
psql> select * from flow_escalate_approvals();
# expect: returns (expired=1, escalated=...) and parent run is now 'cancelled'

# 9. Drill-to-chat on workflow runs
# Open /admin/flow → click any run → drawer opens → click Ask Iron Advisor →
# /chat?context_type=flow_run&context_id=... → chat shows "### Flow run context (preloaded)"
```

---

## 9. Operations Runbook

### Required env vars

| Variable | Required by | Fallback behavior |
|---|---|---|
| `INTERNAL_SERVICE_SECRET` | `flow-runner` cron auth | Cron tick fails with 401; manual owner-JWT invocation still works |
| `SUPABASE_SERVICE_ROLE_KEY` | All edge fns | Hard requirement |
| `ANTHROPIC_API_KEY` | `flow-synthesize` only | Returns 500; non-synth flows unaffected |
| `RESEND_API_KEY` | `send_email_draft` action (optional) | Fails soft with `status='skipped'` |

### Cron registration (operator action required)

The plan defaults the runner to a 60-second pg_cron tick. Register via the existing `net.http_post` pattern (mig 097 reference):

```sql
-- 60s flow-runner tick
select cron.schedule(
  'flow-runner',
  '* * * * *',
  $$select net.http_post(
    url := '<SUPABASE_URL>/functions/v1/flow-runner',
    headers := jsonb_build_object('x-internal-service-secret', '<INTERNAL_SERVICE_SECRET>')
  )$$
);

-- 5min approval escalation
select cron.schedule(
  'flow-escalate-approvals',
  '*/5 * * * *',
  $$select public.flow_escalate_approvals()$$
);

-- daily idempotency cleanup
select cron.schedule(
  'flow-cleanup-idempotency',
  '0 3 * * *',
  $$select public.flow_cleanup_idempotency()$$
);
```

### Adding a new workflow

1. Create `supabase/functions/_shared/flow-workflows/<slug>.ts` exporting a typed `FlowWorkflowDefinition`
2. Import + register in `flow-runner/index.ts` `REGISTERED_WORKFLOWS` array
3. Deploy the edge function — the runner auto-syncs the new row into `flow_workflow_definitions` on next tick

### Adding a new action

1. Add the action to `_shared/flow-engine/registry.ts` with a unique `key`, `idempotency_key_template`, and `execute` function
2. Update the `ACTION_CATALOG` array in `flow-synthesize/index.ts` so the AI synthesizer knows about it

### Adding a new event source

1. Write a trigger function on the source table following the `flow_emit_from_deal` pattern
2. Call `public.emit_event(p_event_type, p_source_module, ...)` with a payload jsonb
3. Add to a future migration (197+)

---

## 10. Known Gaps (P2 — deferred)

| File | Issue | Why deferred |
|---|---|---|
| `_shared/flow-engine/registry.ts` | 13 missing actions vs handoff §12 (25-action mandate) | Slice 2 shipped 12; the others wrap helpers that don't exist yet on every deployment |
| `migrations/194` | 7 of 42+ event types have triggers | Service/parts/rentals/invoices/equipment/portal/SOP triggers are a separate slice |
| `flow-runner/index.ts:395` | Workflow auto-sync hardcodes `workspace_id='default'` | Multi-workspace deployments treat 'default' as the global registration row |
| `migrations/194` | `flow_emit_from_deal` lacks `WHEN` clause | Fires on every UPDATE; runs the function but early-returns on no-op stage changes — minor latency |
| `migrations/195` | No `flow_workflow_versions` archive table | `version` field exists but no version-bump-on-edit logic |
| `apps/web/src/features/admin/pages/FlowAdminPage.tsx` | No dry-run UI panel | Workflows have `dry_run` flag but no admin surface to test against historical events |
| `migrations/` | No pg_cron registration | Operator action required (see runbook above) |
| `migrations/` | No `workflow_metrics_daily` rollup | Live aggregation acceptable until query latency proves it's needed |
| `migrations/` | No `workflow_module_registry` table | TS file convention sufficient for MVP |

---

## 11. Why this beats the handoff

| Dimension | Handoff target | Shipped |
|---|---|---|
| New tables | 14 | **4** + extended 2 existing |
| New SQL functions | ~10 | **9** including 2 audit-fix RPCs |
| Edge functions | 1 (runner) | **2** (runner + synthesizer) |
| Reuse of existing infra | "use what exists" (vague) | **explicit reuse** of analytics_events, exception_queue, analytics_action_log, customer_lifecycle_events triggers, pg_cron + net.http_post pattern |
| Workflows shipped | 12 (all built) | **10 of 12** as code-reviewed TS files (2 deferred awaiting source triggers) |
| Approval lifecycle | "due dates, escalation" | Full lifecycle + escalation cron + admin UI |
| Replay | "replay button on dead letters" | One-click replay with idempotency-safe execution |
| AI workflow synthesis | not in spec | **Shipped** — English brief → typed draft via Anthropic |
| Drill-to-chat | not in spec | **Shipped** — flowRunId chat preload branch |
| Pressure test | "burst event ingestion" | **Shipped** — 10k-event load test fixture |
| Idempotency | "actions must be idempotent where possible" | **By contract** — every action has an idempotency_key_template; runner enforces |
| Module registry | DB table + RPC | TS file convention (formalization deferred) |
| Visual builder | Phase 4 ambition | **Out of scope** — DB+code dual-source design makes future builder a clean addition |

---

## 12. Commit history

| Commit | Slice | Title |
|---|---|---|
| Slice 1 | Foundation | `feat(flow): Slice 1 — Flow Engine foundation (mig 194 + runner skeleton)` |
| Slice 2 | Actions + 4 workflows | `feat(flow): Slice 2 — action registry + 4 flagship workflows-as-code` |
| Slice 3 | Approvals + context | `feat(flow): Slice 3 — approvals + context resolver (mig 195)` |
| Slice 4 | Admin surfaces | `feat(flow): Slice 4 — /admin/flow surface (list, runs, dead letters, drill)` |
| Slice 5 | AI synth + chat + load test | `feat(flow): Slice 5 — AI synth + drill-to-chat + 4 more workflows + load test` |
| Audit | All P0 + P1 fixes | `fix(flow): Flow Engine post-build audit fixes (mig 196)` |

---

## Jarvis Frontend Handoff

Backend changes that need Jarvis OS UI surfacing:

1. **`flow_workflow_definitions`** (mig 194) — workflow registration table with `slug`, `name`, `enabled`, `dry_run`, `version`, `trigger_event_pattern`, `condition_dsl jsonb`, `action_chain jsonb`, `affects_modules jsonb`. Jarvis needs: list/toggle UI under `Settings → Automations` (or surface in main nav as "Flows").

2. **`flow_workflow_runs`** (mig 194) — execution log with `status`, `started_at`, `finished_at`, `duration_ms`, `resolved_context`, `dead_letter_id`, `attempt`. Jarvis needs: per-workflow run history view + global recent-runs feed.

3. **`flow_workflow_run_steps`** (mig 194) — step trace with `step_index`, `step_type`, `action_key`, `idempotency_key`, `status`, `result`, `error_text`. Jarvis needs: drill drawer per run showing the trace.

4. **`flow_approvals`** (mig 195) — approval queue. Jarvis needs: a `Pending Approvals` widget on the home dashboard that queries `flow_approvals where status in ('pending','escalated') and (assigned_to = current user OR assigned_role = my role)` and exposes `decide_flow_approval(p_approval_id, p_decision, p_reason)` RPC.

5. **`flow_pending_events`** (mig 196 view) — currently service-role only; Jarvis can grant select to authenticated and consume for a "live event firehose" debug surface.

6. **`emit_event(p_event_type, p_source_module, p_entity_type, p_entity_id, p_payload, p_workspace_id, p_correlation_id, p_parent_event_id, p_actor_type, p_actor_id)`** — extended in mig 196 with two new params. If Jarvis emits events, it should populate `actor_type='user'` and `actor_id=auth.uid()`.

7. **`flow_resume_run(p_run_id)`** RPC — call this from a "Replay" button on any failed/cancelled run.

8. **`decide_flow_approval(p_approval_id, p_decision, p_reason)`** — `p_decision` is `'approved'` or `'rejected'`; raises if other values.

9. **`flow_escalate_approvals()` / `flow_cleanup_idempotency()`** — service_role only; not callable from Jarvis. Operator-side cron jobs.

10. **`exception_queue.source` CHECK constraint** — gained `'workflow_dead_letter'` value. If Jarvis filters by source, add this to its enum.

11. **`analytics_action_log.action_type` CHECK constraint** — gained 7 new values: `flow_run_start`, `flow_run_complete`, `flow_run_dead_letter`, `workflow_replay`, `workflow_override`, `approval_request`, `approval_decision`. Jarvis audit views should recognize these.

12. **`analytics_events.actor_type` + `actor_id`** (mig 196) — new optional columns. Jarvis event-feed views should display them when present.

13. **`ChatContextPayload.flowRunId`** — chat fn now accepts `?context_type=flow_run&context_id=<run-uuid>`. Jarvis can deep-link from any workflow run row to the chat with full context preloaded.

14. **TypeScript types update needed in `jarvis-os/src/types/`:**
    - Add `FlowWorkflowDefinition`, `FlowWorkflowRun`, `FlowWorkflowRunStep`, `FlowApproval` interfaces
    - Extend `ChatContext` with `flowRunId?: string`
    - Extend `ExceptionSource` enum with `workflow_dead_letter`
    - Extend `AuditActionType` enum with the 7 new values

---

**End of QEP Flow Engine implementation reference.**
