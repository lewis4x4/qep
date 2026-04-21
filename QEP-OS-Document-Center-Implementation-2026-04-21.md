# QEP OS Document Center — Implementation Reference

**Built:** 2026-04-21
**Branch:** `claude/admiring-khorana-68a3db`
**Supabase project:** `iciddijgonywtxoelous`
**Previous ceiling:** Migration 335 (folders + memberships + list/move RPCs)
**New ceiling:** Migration 343 + document-router v12 + four new edge functions

This document is the operator's + engineer's reference for the Document Center after the Slice 0–XII body of work. It explains **what exists now**, **how every piece is used**, **what the UI surfaces do**, and **how to operate / extend the system**.

**Companion docs:**
- `QEP-OS-Document-Center-Handoff-World-Class-2026-04-21.md` — the strategic plan this implements.
- `/Users/brianlewis/.claude/plans/users-brianlewis-projects-qep-knowledge-logical-storm.md` — the slice-by-slice execution contract.

---

## 1. Top-level mental model

The Document Center is no longer a folder browser. It is **four layers stacked into one page**:

1. **The Store** — `documents`, `chunks`, `document_folders`, `document_folder_memberships`. These are the raw bytes + text + folder tree. Untouched from migration 335.
2. **The Twin** — `document_facts`, `document_twin_jobs`. Every published document runs through the `document-twin` edge function, which uses OpenAI structured-output to extract typed facts (parties, dates, equipment, money, obligations, signatures) and pins each fact to a source `chunk_id` with a confidence score.
3. **The Graph** — `document_obligations`. Facts project into typed edges (`expires_on`, `governs_equipment`, `amends`, `supersedes`, …). The Plays engine reads this graph.
4. **The Plays** — `document_plays`. Predicted, actionable cards (expiring rental, undelivered PO, missing signature, …). An admin or rep clicks Draft and a pre-populated `pending_review` document lands in seconds, generated from the source doc's facts via OpenAI.

A **Cmd-K omnibar** searches across all four, a **Context Pane** renders Twin + Graph + Ask + Audit for any selected doc, and a **Viewer** deep-links `?chunk=<id>` to highlight the cited paragraph. The **Exception Inbox** picks up high-severity plays automatically. Low-confidence Ask answers auto-capture as **Knowledge Gaps** for admin review.

---

## 2. Routes + surfaces the user sees

| Route | Component | Who can see it | What it does |
|---|---|---|---|
| `/admin/documents` | `DocumentCenterPage` | rep, admin, manager, owner | Three-pane layout: sidebar (Views + Folders) · main (FolderGrid + FileList with drag-drop) · right (Context Pane). |
| `/admin/documents/:id` | `DocumentViewerPage` | same | Full-page chunked view. Accepts `?chunk=<chunk_id>` → scrolls to that chunk + highlights it amber. |
| **Global ⌘K** | `OmniCommand` | all logged-in roles | Dialog palette mounted in `AppLayout`. Three result groups: Documents (via `/search`), Folders, Jumps. |

Every edit / admin action in the UI is gated on `isElevated = role ∈ {admin, manager, owner}` and RLS on the tables behind the curtain — the UI narrowing is for signal-to-noise, not security.

---

## 3. Edge functions — what they do and when

Every edge function runs on the Supabase functions gateway with `verify_jwt=false` (project uses ES256; in-function auth via `resolveCallerContext` → GoTrue `/auth/v1/user`).

### 3.1 `document-router` (v12)

The primary router every UI call goes through. 19 endpoints:

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/list` | rep+ | Paginated docs for a view (all/recent/pinned/unfiled/folder/pending_review/ingest_failed). Driven by `document_center_list_documents` RPC. |
| GET | `/get` | rep+ | One document + memberships + audit events + **facts**. Facts are the Twin's output. |
| POST | `/folder-create` | admin+ | Create folder with audience. |
| POST | `/folder-move` | admin+ | Reparent folder, cycle-detection in the RPC. |
| POST | `/move` | admin+ | Move a document between folders. |
| POST | `/duplicate-link` | admin+ | Add a second folder membership (no file copy). |
| POST | `/download-url` | rep+ | Signed Supabase storage URL; short TTL. |
| POST | `/reindex` | rep+ (admin+ per RLS in practice) | **Slice X.** Resets `status='ingest_failed' → 'pending_review'`, writes audit event. |
| POST | `/search` | rep+ | **Slice V.** Semantic + keyword search (wraps `retrieve_document_evidence`); normalizes results; fire-and-forget ledger write. |
| POST | `/twin-rerun` | admin+ | **Slice II.** Proxies to `document-twin` with service secret + `force` flag. |
| GET | `/neighbors` | rep+ | **Slice III.** Returns outbound + inbound edges for a document. |
| POST | `/ask` | rep+ | **Slice IV.** LLM answer with citations scoped to the document's chunks. Auto-captures Knowledge Gap on low confidence. |
| GET | `/plays` | rep+ | **Slice VI.** List plays. Filters: `status`, `owner` (supports `me`), `document_id`, `limit`. |
| POST | `/plays/action` | rep+ | Mark play `actioned | dismissed | fulfilled`. Writes matching audit event. |
| POST | `/plays/run` | admin+ | On-demand batch run of `document-plays-run` for the workspace. |
| POST | `/plays/draft` | role-gated per flow | **Slice VII.** `renewal_draft` = rep+; `termination_draft` = manager+. Generates an OpenAI draft, lands it as `status='pending_review'` with full provenance metadata. |
| GET | `/knowledge-gaps` | admin+ | **Slice IX.** List captured gaps. Filters by `document_id`, `limit`. |

### 3.2 `document-twin` (v3)

**Inputs:** `{ documentId, force? }`. Admin+ or service-role.

**Flow:**
1. Load document + all chunks where `chunk_kind = 'paragraph'`.
2. Normalize + SHA-256 every chunk's content → `input_hash`.
3. If a prior `document_twin_jobs` row exists with `(document_id, input_hash, model_version)` at `status='succeeded'` and `force ≠ true`, skip.
4. Upsert `document_twin_jobs` to `running`.
5. Call OpenAI chat completion with a **strict JSON schema** bound to the `document_fact_type` enum. Content is wrapped in `<document_content>` with a system-prompt instruction that it is untrusted.
6. Insert every fact as a `document_facts` row with the originating `chunk_id` and the shared `trace_id`.
7. Write a `qrm_predictions` row (`subject_type='document'`, `prediction_kind='document_twin_extract'`) with `trace_steps` describing the facts.
8. **Slice III chain:** call `project_document_obligations(document_id)` to refresh the graph.
9. **Slice VI chain:** POST to `document-plays-run` with this `documentId` so new expiration facts immediately surface plays.
10. Flip `document_twin_jobs` → `succeeded`; emit `twin_extracted` (or `twin_reextracted` if forced) audit event.

**On failure:** flip to `failed`, emit `twin_failed` audit, push `exception_queue` row on `source='doc_center_review'`.

**Model + version:** `gpt-4o-mini` at `TWIN_MODEL_VERSION = "2026-04-21.1"` (in `supabase/functions/document-twin/service.ts`). Bump when the schema or prompt changes.

### 3.3 `document-plays-run` (v1)

**Inputs:** `{ documentId? }` or `{ workspaceId? }`. Admin+ or service-role.

**Flow:**
1. Query `document_obligations` for `edge_type='expires_on'` rows in `status ∈ (active, at_risk)` with `valid_until ∈ [now, now+60d]`, scoped to the documentId (when called from twin) or workspace (when called from cron).
2. For each obligation:
   - Compute `projection_window` + `probability` from days-until.
   - Build `business_key = "<doc_id>:expiring_rental:<window>"`.
   - Upsert into `document_plays` on `(workspace_id, business_key)`.
   - If `probability ≥ 0.75` or due within 7 days → insert an `exception_queue` row with severity `critical`/`high`, full payload referencing `document_plays.id`.
   - Write a `play_generated` audit event on the source document.
3. Lifecycle sweep in the same pass: overdue open plays → `expired`.
4. Return `{ batchId, plays, expiredCount, fulfilledCount, exceptionsPushed }`.

**Called from:**
- `document-twin` after every successful extraction (per-document run).
- `document-router POST /plays/run` on demand.
- Future pg_cron (not yet scheduled; documented in migration 341 comment).

### 3.4 `document-onedrive-mirror` (v1)

**Slice VIII substrate.** Zero-blocking by design — when this function returns "manual-safe" or "unconfigured", native uploads + twin + retrieval keep working unchanged.

| Method | Path | Returns |
|---|---|---|
| GET | `/health` or `/` | `{ workspaceId, tier, reason, tokenConfigured, mirrorConfigured, lastSyncAt, checkedAt }` where `tier ∈ {'live','demo','manual-safe','unconfigured'}` |
| POST | `/sync` | **501 NOT_IMPLEMENTED** (intentional). Full OneDrive Graph API walk lands in a follow-up slice. |

Health probe reads `hub_knowledge_source` for rows with `drive_file_id NOT NULL`; recency of `synced_at` infers token validity.

### 3.5 `document-admin` (unchanged from earlier work)

Metadata mutations (audience / status / review ownership). Not touched by these slices — listed here so engineers know it exists.

---

## 4. Database schema — what lives where

### 4.1 Tables added in this body of work

| Table | Migration | Purpose | RLS read | RLS write |
|---|---|---|---|---|
| `document_facts` | 339 | Typed fact records from the Twin | Inherits from parent document | service-role only |
| `document_twin_jobs` | 339 | Idempotent twin run ledger | admin+ in workspace | service-role only |
| `document_obligations` | 340 | Typed edges between docs/entities | caller workspace | service-role only |
| `document_plays` | 341 | Predicted actionable cards | caller workspace | rep+ UPDATE; service-role for writes |
| `document_knowledge_gaps` | 342 | Low-confidence Ask attempts | admin+ in workspace | service-role only |

### 4.2 Columns added to existing tables

| Table | Column | Migration | Purpose |
|---|---|---|---|
| `document_folders` | `source_type text DEFAULT 'native'` CHECK `in ('native','onedrive_mirror')` | 343 | Marks externally-mirrored folders as read-only |
| `documents` | `external_source_id text` + partial unique index on `(workspace_id, external_source_id)` | 343 | Dedupe key for external mirrors |

### 4.3 Enums added / extended

| Enum | Migration | Changes |
|---|---|---|
| `document_fact_type` | 339 | **NEW**. 18 values covering parties, dates, equipment, money, obligations, signatures, lineage. |
| `document_obligation_edge_type` | 340 | **NEW**. 10 values (`promises_delivery`, `guarantees_until`, `expires_on`, `governs_equipment`, `references_po`, `amends`, `supersedes`, `fulfills`, `at_risk_because`, `settled_by`). |
| `document_obligation_status` | 340 | **NEW**. `active | fulfilled | expired | at_risk | voided` |
| `document_play_kind` | 341 | **NEW**. 9 values (expiring_rental, expiring_warranty, unexecuted_amendment, …). |
| `document_play_status` | 341 | **NEW**. `open | actioned | dismissed | expired | fulfilled` |
| `document_audit_event_type` | 337, 339, 341 | Added: `document_reindex_requested`, `twin_extracted`, `twin_failed`, `twin_reextracted`, `fact_verified`, `fact_superseded`, `play_generated`, `play_actioned`, `play_dismissed`, `play_expired`, `play_fulfilled`. |

### 4.4 Constraint change on existing table

`qrm_predictions_subject_type_check` (migration 338) widened to accept `document | document_chunk | document_search`. This enables the Ask, Twin, and Search ledger writes without fracturing the ledger shape per surface.

### 4.5 RPC changes

| RPC | Migration | Change |
|---|---|---|
| `document_center_list_documents(text, uuid, int, ...)` | 337 | View whitelist widened to include `'pending_review'` and `'ingest_failed'`. Both branches filter by `documents.status`. |
| `project_document_obligations(p_document_id uuid) → integer` | 340 | **NEW.** Voids prior active/at_risk edges for the doc, inserts fresh `expires_on` edges (one per `expiration_date` fact) + `governs_equipment` edges (one per `equipment_tag` fact). |
| `mark_at_risk_obligations() → integer` | 340 | **NEW.** Sweep that promotes `active` expires_on edges within 14 days to `at_risk` when no `fulfills` edge exists. |

---

## 5. Frontend components — how they're composed

### 5.1 File map

```
apps/web/src/
├── components/
│   ├── OmniCommand.tsx          ← Cmd-K palette, mounted in AppLayout
│   └── ui/
│       ├── command.tsx           ← shadcn/cmdk wrapper (NEW)
│       └── select.tsx            ← shadcn/@radix-ui/react-select wrapper (NEW)
├── features/documents/
│   └── router.ts                 ← typed client for all document-router endpoints
└── routes/admin/documents/
    ├── DocumentCenter.tsx        ← three-pane page shell; state machine for views, search, DnD, dialogs
    ├── DocumentViewer.tsx        ← /admin/documents/:id full viewer with chunk anchors (NEW)
    ├── FolderCreateDialog.tsx    ← replaces window.prompt() folder creation (NEW)
    ├── FolderPickerDialog.tsx    ← tree-select for move / link operations (NEW)
    ├── FolderGrid.tsx            ← folder tiles; each is a @dnd-kit droppable
    ├── FileList.tsx              ← file rows; each is @dnd-kit draggable + right-click DropdownMenu
    ├── ContextPane.tsx           ← right-pane v2 orchestrator (facts → neighbors → ask → collapsibles)
    ├── ContextPaneFacts.tsx      ← fact grouping + confidence color-coding (NEW)
    ├── ContextPaneNeighbors.tsx  ← graph edges with at-risk highlight + days-remaining (NEW)
    ├── AskBox.tsx                ← question → LLM answer with linked citations (NEW)
    └── OmniSearch.tsx            ← in-page title search (unchanged)
```

### 5.2 State machine (DocumentCenter.tsx)

```
view ∈ {all, recent, pinned, unfiled, folder, pending_review, ingest_failed}
folderId ∈ string | null
searchValue ∈ string
selectedDocumentId ∈ string | null
```

Every state change triggers `loadList()`. Selecting a document triggers `loadDetail()`. The new `loadDetail` is extracted into a `useCallback` so `ContextPane.onReloadDetail` can rerun it after a twin re-run.

### 5.3 Drag-drop behavior

File row drag handles (`<GripVertical>`) register as @dnd-kit draggables with `data: { kind: 'document', documentId }`. Folder tiles AND sidebar folder rows register as droppables with `data: { kind: 'folder', folderId }`. `handleDragEnd` fires `moveDocumentViaRouter()` when both sides match. A small floating "Drop on a folder to move" hint appears during drag.

### 5.4 Right-click menu

Every file row has a `<DropdownMenu>` trigger (`<MoreHorizontal>`): Open context · Move to folder · Link to another folder · Copy signed download URL · Retry ingest (only visible when `status='ingest_failed'`).

### 5.5 Context Pane v2 render order

1. **Header** — title, audience badge, status badge, updated_at.
2. **Action buttons** — Download · Run/Re-run twin (admin+ only).
3. **Facts** — grouped into Parties / Dates / Equipment / Parts / Money / Obligations / Signatures / Lineage. Confidence dot is emerald ≥0.8, amber ≥0.5, rose <0.5. Verified facts get a green check.
4. **Obligations** — graph edges, at_risk highlighted amber, days-remaining on imminent `expires_on` rows.
5. **Ask box** — textarea + Ask button. Response renders inline with citation cards that link to `/admin/documents/:id?chunk=:chunk_id`.
6. **Memberships** — collapsible.
7. **Recent Activity** — collapsible.

### 5.6 OmniCommand (Cmd-K)

Global `keydown` listener on `(Cmd|Ctrl)+K` mounted in `AppLayout`. 250ms debounce on query input. Results:
- **Documents** (from `/search`) — top 10, each shows title · section_title · excerpt · confidence %. Select → `/admin/documents/:documentId?chunk=:chunkId`.
- **Jump to** — role-filtered static routes (Dashboard, Document Center, Pending Review, Ingest Failures, QRM, Parts, Service).

### 5.7 Role-shaping (Slice XII)

```
callerRole = profile.role ?? 'rep'
isElevated = role ∈ {admin, manager, owner}

New folder button       → isElevated
Review sidebar section  → isElevated    (Pending Review + Ingest Failures)
ContextPane twin button → canRunTwin    (passed from isElevated)
```

RLS on `documents`, `document_folders`, `document_facts`, `document_plays`, `document_knowledge_gaps` enforces audience/role at the row level — the UI gate is for noise reduction, not security.

---

## 6. How to operate the system

### 6.1 A rep's daily flow

1. Open `/admin/documents`. Sidebar shows All Files / Recents / Pinned / Unfiled + the workspace folder tree.
2. Click a document → Context Pane on the right loads facts + obligations in parallel.
3. Ask a question: "what does section 7 require on return?" → cited answer within seconds. Click a citation → viewer scrolls + highlights the paragraph.
4. Hit ⌘K from anywhere → search a title or content snippet → land on the document.

### 6.2 An admin's daily flow

Everything above, plus:

1. **Review section in sidebar** — Pending Review + Ingest Failures. Retry button on ingest-failed rows re-queues to `pending_review`.
2. **Run / Re-run twin** from Context Pane header for any doc.
3. **Plays queue** — `GET /plays?status=open&owner=me` from a Plays UI (not yet shipped as a dedicated page; the data is available). High-severity plays auto-land in the Exception Inbox too.
4. **Knowledge Gaps** — `GET /knowledge-gaps` shows where the KB is thin. Admins review and decide whether to promote to an SOP (promotion flow ships in a follow-up).

### 6.3 Direct API calls (for integration / scripting)

Every `document-router` endpoint is authenticated via the normal Supabase JWT. From a service-role script:

```typescript
const res = await fetch(`${SUPABASE_URL}/functions/v1/document-router/search`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${userAccessToken}`,   // normal user JWT
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: 'warranty expiring', matchCount: 10 }),
});
```

### 6.4 Triggering a twin run manually

```
POST /functions/v1/document-router/twin-rerun
{ "documentId": "...", "force": true }
```

Response: `{ documentId, jobId, status: 'succeeded'|'skipped'|'failed', factCount, traceId }`.

### 6.5 Running the plays engine against the whole workspace

```
POST /functions/v1/document-router/plays/run
{}  // empty body runs workspace-wide
```

### 6.6 Drafting from a play

```
POST /functions/v1/document-router/plays/draft
{ "playId": "...", "flow": "renewal_draft" }
```

Response: `{ draftDocumentId, draftTitle, flow, playId, elapsedMs }`. The draft lands with `status='pending_review'` in the Pending Review view.

---

## 7. Prediction ledger — what gets written where

Every AI-backed endpoint writes to `qrm_predictions` with a `trace_id` so outcomes can be graded.

| Surface | subject_type | prediction_kind | When written |
|---|---|---|---|
| `/search` | `document_search` | `document_search` | Fire-and-forget per search |
| `/ask` | `document` | `document_ask` | Fire-and-forget per answer |
| `document-twin` | `document` | `document_twin_extract` | Per successful twin extraction |

Downstream click-through correlation is keyed by `trace_id`.

---

## 8. Exception inbox contract

`document-plays-run` inserts into `exception_queue` with `source = 'doc_center_review'` for high-severity plays. Payload shape:

```json
{
  "slice": "plays",
  "play_id": "<uuid>",
  "document_id": "<uuid>",
  "projection_window": "7d",
  "probability": 0.88
}
```

`entity_table='document_plays'` + `entity_id=<play.id>` lets the Inbox link directly back to the play.

`document-twin` pushes `exception_queue` rows on twin extraction failures with `payload.slice = 'twin'`.

---

## 9. Feature flags + config

No feature-flag table exists yet in this repo — gating is role-based and env-based.

| Gate | Lives in | Notes |
|---|---|---|
| UI visibility | `profile.role` check inside components | RequireAdmin wrapper widens to rep+ |
| Endpoint auth | `resolveCallerContext` + `requireDocumentCenterAccess` | admin+ for mutations; rep+ for reads |
| OpenAI availability | `OPENAI_API_KEY` env var | Missing → 503 for /ask and /twin-rerun; draft falls back to stub template |
| OneDrive mirror | Presence of `hub_knowledge_source` rows with `drive_file_id` | `/health` surfaces the tier honestly |
| Internal service calls | `DGE_INTERNAL_SERVICE_SECRET` header | twin → plays-run chain relies on this |

Per handoff plan, these will be migrated to a `feature_flags` table (`document_center_twin`, `document_center_plays`, `document_center_onedrive`) in a follow-up.

---

## 10. Testing story

- `supabase/functions/document-router/handler.test.ts` — 15 Deno tests covering param mapping, access gate, error mapping, and every new endpoint shape.
- No Playwright tests landed yet for the new UI components. The handoff lists Playwright smoke + axe-core a11y as a release gate (`bun run build` gate is green; Playwright gate is TODO).
- No golden-set test for twin extraction yet. The handoff specifies a 10-docs-per-class golden set with a 0.80 confidence floor on party/date/equipment_tag. The infrastructure to run it exists (document-twin is idempotent on `input_hash` so re-running the same fixtures is cheap); the fixture corpus + assertion harness is a follow-up.

---

## 11. Known deferrals (documented debt)

1. **pg_cron scheduling** for `document-plays-run` (workspace-wide hourly sweep) — the function handles the cron-shape input today; just needs `cron.schedule` plumbing.
2. **pg_cron scheduling** for `mark_at_risk_obligations()` (hourly).
3. **OneDrive sync** (`POST /sync` returns 501 by design). Full Graph API walk + delta-query plumbing lands when OAuth integration is scoped.
4. **Knowledge Gaps clustering** + **promote-to-SOP** flow — capture is live; clustering cron + `iron_documents.sop_draft` flow is the next slice.
5. **Full PDF.js / DOCX viewer** — the current viewer uses the chunked paragraphs from ingest (which is enough for the citation-anchor property). `pdf.js` + `docx-preview` integration adds ~1MB to the bundle; deferred until there's a concrete need for page images.
6. **Service worker / offline recents** for mobile reps — CLAUDE.md Non-Negotiable but scoped to a follow-up PWA slice (the app's SW infra isn't present yet).
7. **Feature-flag table** (`document_center_twin`, `document_center_plays`, `document_center_onedrive`) per workspace — today's gates are role-based.

---

## 12. How to extend

### 12.1 Add a new fact type

1. `ALTER TYPE public.document_fact_type ADD VALUE 'new_fact_type';` (outside a transaction).
2. Update the `FACT_TYPES` array in `supabase/functions/document-twin/service.ts`.
3. Update the OpenAI `json_schema` `enum` list inside `callOpenAi()`.
4. Optionally: add grouping in `ContextPaneFacts.tsx` `FACT_GROUPS`.

### 12.2 Add a new obligation edge type

1. `ALTER TYPE public.document_obligation_edge_type ADD VALUE 'new_edge';`.
2. Extend `project_document_obligations()` (migration 340) with the derivation rule.
3. Optionally: rename / style in `ContextPaneNeighbors.tsx` via `edgeLabel()`.

### 12.3 Add a new play kind

1. `ALTER TYPE public.document_play_kind ADD VALUE 'new_kind';`.
2. Extend `document-plays-run` service to derive that play from appropriate obligations.
3. Extend `DRAFT_FLOW_ROLE_MIN` + `inferFlowFromPlayKind` in `document-router/service.ts` to map the new play to a draft flow.

### 12.4 Add a new document-router endpoint

Pattern: declare types in `service.ts` → write the handler function → register in `DocumentRouterService` interface + `defaultService()` → wire the route in `handler.ts` → add a test in `handler.test.ts`. See `/reindex` as the smallest reference implementation.

---

## 13. Source anchors

- **Migrations:** `supabase/migrations/337_document_center_review_views.sql` through `343_document_external_source_mirror.sql`.
- **Edge functions:** `supabase/functions/document-router/`, `document-twin/`, `document-plays-run/`, `document-onedrive-mirror/`.
- **Frontend:** `apps/web/src/routes/admin/documents/*.tsx`, `apps/web/src/components/OmniCommand.tsx`, `apps/web/src/features/documents/router.ts`.
- **Tests:** `supabase/functions/document-router/handler.test.ts` (15 passing).

---

## 14. Deployment state (as of 2026-04-21)

| Layer | State |
|---|---|
| Migrations 337–343 | Applied to `iciddijgonywtxoelous` |
| `document-router` | **v12** ACTIVE |
| `document-twin` | **v3** ACTIVE |
| `document-plays-run` | **v1** ACTIVE |
| `document-onedrive-mirror` | **v1** ACTIVE |
| Branch `claude/admiring-khorana-68a3db` | 13 commits ahead of `origin/main` — **not pushed, not merged** |

### 14.1 Migration ledger drift

Migrations 337–343 were applied via the Supabase MCP `apply_migration` tool, which writes timestamped version ids (e.g. `20260421044056`) into `supabase_migrations.schema_migrations`. The corresponding canonical-name files exist on disk (`NNN_name.sql`). Before merging the branch to main, re-stamp the migration ledger with the canonical versions or use the repo's `bun run db:push --stamp` mode to align local + remote tracking.

### 14.2 Open questions inherited from the handoff

1. Twin PII storage audience — currently defaults to document audience; handoff asks whether PII-bearing fact types should auto-tag `finance`.
2. Iron draft ownership — currently `uploaded_by = caller.user_id`; handoff asks whether drafts stay system-owned until claimed.
3. OneDrive bidirectional sync — pull-only today; revisit after 90 days of pilot data.
4. Knowledge Gaps privacy — today the question text is admin-visible verbatim; handoff asks whether to redact below a threshold.
5. DOCX viewer library choice — `docx-preview` vs `mammoth`, pending Slice XI follow-up.
