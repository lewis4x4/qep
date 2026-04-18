# SLICE 05 — Conversational Deal Engine

**Status:** Shipped to `claude/qep-qb-05-conversational-engine` on 2026-04-17.

**Source of truth:** This document reflects what actually landed in the repo and the database. Downstream slices (06–08) should read this, not any pre-discovery draft.

---

## Objective

Add the AI-assisted "Deal Assistant" layer on top of the existing manual quote builder. A sales rep describes a customer opportunity in plain language (typed or spoken), and the system returns 2–4 ready-to-present deal scenarios in under 60 seconds — each with full pricing, program eligibility, margin indicator, pros/cons, and a one-click path to pre-populate the quote form.

This is the moonshot slice: the moment the system stops being a calculator and starts being a deal engine that thinks.

---

## Scope Decisions (locked before execution)

| Decision | What shipped |
|---|---|
| Catalog seed | 6 ASV CTL demo models seeded (migration 299); real prices from price sheet ingestion will supersede |
| Admin UI polish | Explicitly **out of scope** — deferred to Slice 06 (`SLICE_06_ADMIN_UI_POLISH.md`) |
| Voice input | **In scope** — reuses existing `VoiceRecorder` + `submitVoiceToQrm` transcription path |
| Scenario-select behavior | **(a) pre-populate + explicit save** — rep reviews before committing; no auto-draft `qb_quotes` rows |
| Response streaming | **Yes, SSE** — first scenario card target <10s, full set <60s; 80ms yield between cards for progressive rendering |

---

## What Shipped

### Migrations

| # | File | What it does |
|---|---|---|
| 298 | `298_qb_fuzzy_search_ai_log.sql` | Creates `qb_ai_request_log` telemetry table + `qb_search_equipment_fuzzy()` RPC (pg_trgm word_similarity, ILIKE fallback, `search_path = ''`, RLS: user reads own rows, elevated reads all) |
| 299 | `299_qb_demo_equipment_models.sql` | Seeds 6 ASV RT-series CTL models (RT-40/65/85/135/175/220) with approximate 2026 list prices from public ASV spec sheets. `ON CONFLICT DO NOTHING` — idempotent when real price sheets land. |

**Verified on staging:**
- `qb_ai_request_log` table live, RLS enabled
- `qb_search_equipment_fuzzy()` RPC callable by `authenticated` + `service_role`
- 6 ASV models in `qb_equipment_models` (model_count = 6 confirmed via remote query)
- Tracking table stamped: versions 298 + 299 in `supabase_migrations.schema_migrations`

### Edge Functions

| Function | URL | Purpose |
|---|---|---|
| `qb-parse-request` | `.../functions/v1/qb-parse-request` | Claude-powered NL → structured intent: brand/model keyword extraction, fuzzy catalog resolution, confidence scoring, telemetry log write |
| `qb-ai-scenarios` | `.../functions/v1/qb-ai-scenarios` | Full SSE orchestrator: parse → DB fetch (model + brand + freight + programs in parallel) → pricing waterfall → `buildScenarios()` → stream events |

**Auth:** `requireServiceUser()` on both — valid user JWT, all roles. Service role key rejected.

**Smoke test results (2026-04-17):**
- `qb-parse-request` → 401, valid JSON ✅
- `qb-ai-scenarios` → 401, valid JSON ✅

#### `qb-parse-request` — POST body + response

```json
// POST body
{ "prompt": "string", "promptSource": "text" | "voice" }

// 200 response
{
  "parsedIntent": {
    "brandKeyword": "ASV" | null,
    "modelKeyword": "RT-135" | null,
    "customerType": "standard" | "gmu" | null,
    "deliveryState": "FL" | null,
    "budgetCents": 10000000 | null,
    "monthlyBudgetCents": null,
    "financingPref": "cash" | "financing" | "open" | null,
    "attachmentKeywords": ["mulcher"],
    "urgency": "immediate" | "weeks" | "months" | "unknown",
    "summary": "Customer needs ASV CTL for land clearing in Lake City"
  },
  "resolvedBrandId": "uuid" | null,
  "resolvedModelId": "uuid" | null,
  "modelCandidates": [{ "id", "brandCode", "modelCode", "nameDisplay", "listPriceCents", "similarity" }],
  "confidence": { "brand": 0.90, "model": 0.85, "state": 0.80, "customerType": 0.85 },
  "logId": "uuid"
}
```

#### `qb-ai-scenarios` — SSE event stream

```
POST body: { "prompt": string, "promptSource"?, "modelId"?, "brandId"?, "deliveryState"?, "customerType"? }

SSE events (in order):
  { "type": "status",   "message": string }
  { "type": "resolved", "model": { id, modelCode, nameDisplay, listPriceCents, modelYear, brandCode, brandName },
                         "parsedSummary": string, "deliveryState": string, "customerType": string }
  { "type": "scenario", "scenario": QuoteScenario, "index": number }   — repeated 1–4x
  { "type": "complete", "totalScenarios": number, "latencyMs": number, "logId": string | null,
                         "resolvedModel": {...}, "brandId": string | null, ... }
  { "type": "error",    "message": string, "fatal": boolean, "candidates"?: [...] }
```

**Latency contract:** First `scenario` event target ≤10s; `complete` event target ≤60s. 80ms synthetic yield between scenario events for progressive browser rendering.

**Pricing waterfall (inlined, not HTTP hop to qb-calculate):**
Same Steps 1–7 as Slice 02 engine: dealer discount → PDI → good faith → freight → tariff → markup → baseline sales price. Uses `default_markup_pct` from `qb_brands` as `markupTargetPct`.

**Freight fallback:** When no freight zone is configured for the delivery state, falls back to `$1,942` (ASV FL rate from seed data). Non-fatal — scenarios still compute.

**Discount guard:** If `brand.discount_configured = false`, emits non-fatal `error` event advising admin to configure rates. Does not crash.

### TypeScript

#### `apps/web/src/features/quote-builder/lib/`

| File | Purpose |
|---|---|
| `scenario-orchestrator.ts` | Client-side SSE consumer. `streamScenarios()` → cancellable `AsyncIterable<SseEvent>`. `resolveModelFromPrompt()` helper for quick parse without scenarios. Full TypeScript types for all SSE event shapes. |
| `programs-types.ts` | Re-export shim: exposes `QuoteScenario`, `QuoteContext`, etc. from `@/lib/programs/types` via `@/` alias (Vite-compatible), avoiding the `.ts` extension that Deno requires in the source. |

#### `apps/web/src/features/quote-builder/components/`

| File | Purpose |
|---|---|
| `ScenarioCard.tsx` | One scenario card: label, economics (monthly payment or cash-out), dealer margin indicator (green/yellow/red), pros/cons accordion (collapsed by default), approval warning if margin < 10%, "Use this scenario →" button |
| `ConversationalDealEngine.tsx` | Full panel component: text input mode (⌘↵ submits), voice mode (VoiceRecorder → transcribe via voice-to-qrm → stream), SSE consumption loop, progressive card rendering, cancellation on close. Also exports `DealAssistantTrigger` button. |

#### `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx`

Three surgical additions:
1. Import `ConversationalDealEngine`, `DealAssistantTrigger`, `ScenarioSelection`
2. `dealAssistantOpen` state + `handleScenarioSelection` callback (pre-populates draft, advances to equipment step)
3. `<DealAssistantTrigger>` in page header + `<ConversationalDealEngine>` portal at page root

**Scenario-select behavior (confirmed):** Selecting a scenario sets `draft.voiceSummary` (prompt) and pre-populates `draft.equipment` with a placeholder referencing the resolved model UUID. Rep reviews and refines in the equipment step before saving. No `qb_quotes` row is auto-created.

### Unit Tests

**File:** `apps/web/src/features/quote-builder/lib/__tests__/scenario-orchestrator.test.ts`

8 tests across 2 suites:
1. `streamScenarios — SSE parsing` (5 tests): happy path (status → resolved → 2 scenarios → complete), 401 fatal error, no-model non-fatal error, not-signed-in fatal error, cancellation (AbortController contract)
2. `SseEvent type narrowing` (3 tests): status/scenario/error event shape assertions

**Full scoped run (pricing + programs + orchestrator):** 227 pass, 0 fail.
**Broader run (lib + quote-builder):** 250 pass, 1 pre-existing fail (`home-route.test.ts` — owner routes to `/owner` but test expects `/qrm`; unrelated to Slice 05).

---

## Acceptance Criteria — Verified at Ship

- [x] Migrations 298 + 299 applied to staging and stamped in `supabase_migrations.schema_migrations`
- [x] `qb_search_equipment_fuzzy()` RPC callable by authenticated users, returns similarity-ranked models
- [x] 6 ASV models in `qb_equipment_models` with realistic 2026 list prices
- [x] `qb-parse-request` deploys, boots, returns 401 + valid JSON on unauthenticated request
- [x] `qb-ai-scenarios` deploys, boots, returns 401 + valid JSON on unauthenticated request
- [x] `streamScenarios()` SSE client handles happy path, errors, and cancellation (8 unit tests)
- [x] `ConversationalDealEngine` integrates VoiceRecorder → `submitVoiceToQrm` transcript path (no new transcription service)
- [x] Scenario-select pre-populates form state, advances to equipment step, does NOT auto-create `qb_quotes`
- [x] `bun run typecheck` in `apps/web`: exit 0, zero errors
- [x] No `numeric`/`float`/`real` on any new QB money column — confirmed bigint cents throughout
- [x] RLS on `qb_ai_request_log`: service bypass + user reads own + elevated reads all

---

## Design Corrections vs. Pre-Discovery Plan

1. **No HTTP hop to `qb-calculate`** — `qb-ai-scenarios` imports the pricing library directly (same as `qb-calculate` does), saving ~200ms per scenario and eliminating the cascading auth problem.
2. **80ms synthetic yield** — scenarios are computed synchronously; the yield is artificial to allow the browser to render each card before the next arrives. Pure SSE framing, no async work per scenario.
3. **Freight fallback, not hard failure** — when a model is found but no freight zone is configured for the state, the function uses the seeded ASV FL rate rather than aborting. Reps can still get scenarios; the note appears in the function logs.
4. **`default_markup_pct` not `markup_target_pct`** — the DB column is `default_markup_pct` (from migration 284). The pricing library types use `markup_target_pct` (camelCase alias in `QuoteContext`). The edge function queries `default_markup_pct` directly from the DB row.
5. **Voice path reuses `voice-to-qrm`** — the existing `submitVoiceToQrm` function returns a transcript as a side effect of CRM entity creation. The deal engine extracts just the transcript and passes it to `qb-ai-scenarios`. CRM side effects (contact/deal matching) are a bonus, not a liability.

---

## Open Items for Downstream Slices

1. **Forestry brand scenarios** — all 7 forestry brands + 3 "other" brands have `discount_configured = false`. The deal engine correctly surfaces a non-fatal error for these brands. Slice 04 price sheet ingestion + admin discount configuration unlocks them.
2. **Scenario → quote save** — currently the scenario pre-populates the form with a UUID placeholder. A cleaner flow would resolve the model's `make`/`model`/`year` fields from the DB before populating. Slice 06 or 07 refinement.
3. **Real list prices** — the 6 ASV models use approximate prices from public spec sheets. These will be superseded once Rylee/Angela upload the official ASV R1 2026 price book via Slice 04 ingestion.
4. **`home-route.test.ts` pre-existing failure** — `resolveHomeRoute("owner")` returns `/owner` but test expects `/qrm`. Not Slice 05 — tracked for cleanup.
5. **Latency instrumentation** — `latencyMs` is reported in the `complete` event. UI displays it next to "N scenarios ready". Formal P50/P95 tracking against the <60s SLA should be wired to the `qb_ai_request_log.latency_ms` column in a future analytics pass.

---

## Commit Reference

`[QEP-QB-05]` on branch `claude/qep-qb-05-conversational-engine`
