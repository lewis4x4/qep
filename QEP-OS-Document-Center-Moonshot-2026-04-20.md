å# QEP OS Document Center — Master Plan

**Date:** 2026-04-20
**Owner:** QEP OS Platform / Knowledge Base + Integration Hub
**Status:** Planning — awaiting approval
**Supersedes:** No prior document. This plan inaugurates Track 8 and extends the governed-document substrate shipped in migrations 040, 042, 050, 165, 208, 231, 262, and 314–322.
**Production Supabase project:** `iciddijgonywtxoelous`
**Repository:** `lewis4x4/qep` on GitHub, `main` branch

---

## 0. Mission Lock

> "Create a Moonshot Application built around equipment and parts, sales and rental, for the employees, salesmen, corporate operations and management. Your sole function is to identify, design, and pressure-test transformational AI application ideas that are not fully possible today but will be unlocked by superintelligence."

The Document Center is measured against the four mission checks on every slice:

1. **Mission Fit** — advances document-backed operations for field reps, counter staff, service coordinators, rental ops, corporate admin, management, and ownership. Every role reads documents daily. Every role's speed is bottlenecked by how fast they can locate, trust, act on, and share the right paragraph at the right moment.
2. **Transformation** — each phase adds capability materially beyond commodity DMS, SharePoint, Box, Dropbox, or NotebookLM behavior. Commodity tools *retrieve* documents. The Document Center *reasons over* them, *emits plays from* them, and *acts on* them before an operator asks. This is not a file browser with RAG bolted on. It is an obligations-and-knowledge spine that other QEP OS modules plug into.
3. **Pressure Test** — validated against real operational volume: the existing OneDrive corpus, 50 MB per-file uploads, PDF/DOCX/XLSX/TXT/MD/CSV formats, four roles × five audience tiers, zero-blocking integration failure modes, and at least one cross-document inference chain (warranty × service history × rental return).
4. **Operator Utility** — every shipped slice measurably improves decision speed or execution quality for a named role. A rep forwards a signed rental agreement to a customer in one action instead of five. A service coordinator sees every warranty obligation against a serial number on one page instead of three systems. An owner sees every outstanding commitment the dealership has made, expiring in the next 30 days, ranked by exposure, without asking anyone.

No slice ships unless all four checks pass the pressure-test.

---

## 1. The Situation (What We Have)

The document substrate already shipped on `main` is richer than any greenfield vendor would start with. This plan does not reset it. It *compounds* it.

**The `documents` table (migration 040_secure_document_governance.sql)** holds every governed document with an audience enum (`company_wide`, `finance`, `leadership`, `admin_owner`, `owner_only`), a status enum (`draft`, `pending_review`, `published`, `archived`, `ingest_failed`), a review owner, a review-due timestamp, and an approval chain (`approved_by`, `approved_at`, `classification_updated_by`, `classification_updated_at`). It soft-deletes via `deleted_at`. Role-to-audience visibility is enforced in-database via `public.document_role_can_view_audience(p_audience, p_role) → boolean`, which already encodes the operational reality that reps see company-wide content only, finance tier is admin/manager/owner, leadership is manager/owner, admin_owner is admin/owner, and owner_only is a one-person tier.

**The `chunks` table (migration 001, hardened in migration 231)** carries 1536-dimension OpenAI `text-embedding-3-small` embeddings with a persisted `embedding_model` column for dimension resilience. The `public.retrieve_document_evidence(query_embedding, keyword_query, user_role, match_count, semantic_match_threshold)` RPC (migration 042) already performs hybrid semantic + keyword retrieval with role and status gates baked in. It returns `source_type`, `source_id`, `source_title`, `excerpt`, `confidence`, and `access_class`. This is the retrieval spine. It does not need to be rebuilt.

**The `document_audit_events` table (migration 040)** captures every mutation — upload, reindex, approve, publish, archive, reclassify, delete, status_changed, ingest_failed — with an actor user, a title snapshot, and a jsonb metadata bag. Every action the Document Center performs will feed this stream. Compliance and legal-hold are policy choices layered on top, not a separate system.

**Storage** is already provisioned. The `documents` bucket (migration 050_storage_buckets_and_document_originals.sql) accepts 50 MB files in the seven formats the Admin screenshot advertises (`.pdf`, `.docx`, `.xlsx`, `.xls`, `.txt`, `.md`, `.csv`). RLS on bucket objects already restricts delete and select to object-owner-or-elevated-role. A `voice-recordings` bucket sits alongside for field capture.

**Roles and workspace** are handled by `get_my_role()` (migration 005) returning the `user_role` enum (`rep`, `admin`, `manager`, `owner`) and `get_my_workspace()` (migration 204) returning the caller's active workspace id. Every table in this plan enforces RLS through those helpers. No policy bypass shortcuts.

**Predictive and agentic primitives** are the reason this plan is not a commodity file browser. The Prediction Ledger (`qrm_predictions`, migration 208) stores every AI recommendation with `prediction_kind`, `score`, `rationale` jsonb array, input/signal/rationale hashes for change detection, `model_source` (`rules` or `rules+llm`), and a trace chain (`trace_id`, `trace_steps`). The Predictive Parts Plays table (`predicted_parts_plays`, migration 262) has taught the project how plays work as persisted rows — with probability, reason, signal_type, recommended action, lifecycle status (`open`, `actioned`, `dismissed`, `expired`, `fulfilled`), and idempotent re-run uniqueness. The Exception Queue (`exception_queue`, migration 165) already has a `doc_visibility` source type and is the established operator-facing work surface. Iron Orchestrator (`/supabase/functions/iron-orchestrator/index.ts`) dispatches typed flows by surface (`iron_*`) with role allowlists and feature flags, server-side, after LLM classification. These are the rails the Document Center plugs into.

**Ingest precedent.** The `hub-knowledge-sync` function plus migration 314 (`hub_knowledge_source`, `hub_knowledge_chunk`) have already proven out OpenAI-embedded external source mirroring from Google Drive into a chunked vector store with HNSW indexing (`m=16`, `ef_construction=64`, cosine ops). The `sop-ingest` function has proven out structured extraction from document text into typed SOP steps via OpenAI, with confidence scoring and multi-role extraction. The `document-admin` function has proven out governed metadata mutation with audit-event logging and CORS allowlisting. Every ingest pattern the Document Center needs has an existing precedent in the repo.

**Portal precedent.** `equipment_documents` (migration 157_portal_live_status_and_documents.sql) carries the customer-facing file pattern — a `customer_visible` flag, mime + size metadata, document_type enum (`operator_manual`, `service_manual`, `parts_manual`, `warranty_certificate`, `service_record`, `inspection_report`, `invoice`, `receipt`, `photo`, `other`), RLS-gated by fleet/customer binding. The Document Center inherits from this pattern for operator-to-customer delivery.

**CRM Router pattern.** `/supabase/functions/crm-router/index.ts` establishes the routing contract: `resolveCallerContext()` extracts workspace + user from JWT, `mapError(origin, error)` standardizes `UNAUTHORIZED` / `FORBIDDEN` / `SERVICE_WORKSPACE_UNBOUND` / `NOT_FOUND` responses, CORS is enforced from the shared `safe-cors` utility against the three production origins. The `document-router` will mirror this contract exactly.

**What is missing.** Five things. (1) A folder and collection model — documents are flat today, navigated by filter not by place. (2) A Document Twin — we chunk and embed, but we do not extract structured facts (parties, dates, equipment tags, obligations, dollar amounts) into a queryable form. (3) An Obligations Graph — the twin's facts do not yet form edges between documents, entities, and commitments. (4) Document Plays — the Predictive Plays pattern has not yet been applied to document-derived signals. (5) A role-shaped Document Center surface that renders twin-extracted facts and obligation-graph edges as first-class citizens alongside file navigation — the Admin surface shown in the screenshot covers upload and list; it does not cover browse, view, forward, duplicate-as-reference, email-to-customer, attach-to-deal, ask-about-this-doc, or the proactive-feed surface where Document Plays live.

Filling gaps 1–5 in the right order (slices 8.1.1 through 8.1.5 below) makes the Document Center the seam between internal operations and customer understanding that Phase 7 named as the success bar.

---

## 2. The Keystone

One primitive makes everything else fall out.

Before ink goes on folder trees, UI mockups, or operator verbs, we build the **Document Twin** and project it into an **Obligations Graph**. This is the keystone. Without it, everything downstream is a veneer over keyword search and a prettier file tile. With it, Document Plays, role-aware rendering, cross-document reasoning, proactive operator feeds, and OneDrive retirement become inevitable because the substrate supports them natively.

**The Twin.** Every document, at ingest, produces a structured fact record in a new `document_facts` table. Facts include: counter-parties (customer, vendor, supplier, lienholder), effective and expiration dates, renewal windows, equipment tags (serial numbers, VINs, asset IDs that already exist in the fleet graph), parts and SKUs referenced, dollar amounts with category (rental rate, retail price, warranty cap, deposit, late fee), contractual obligations (deliveries promised, inspections required, service intervals committed), signatures (present, absent, by whom, at what date), and document classification (rental agreement, purchase order, work order, warranty, service record, inspection report, parts manual, invoice, proof of delivery, amendment, correspondence). Facts are produced by an OpenAI extraction pass that inherits from the `sop-ingest` parse contract, persists its confidence per-field, and carries the model version and trace id for audit. The twin is the layer that turns a PDF from a rectangle into a reasoned object.

**The Graph.** Facts project into a typed graph in `document_obligations` whose nodes are documents, entities (customers, equipment units, parts, reps, vendors), and commitments, and whose edges carry a type (`promises_delivery`, `guarantees_until`, `expires_on`, `governs_equipment`, `references_po`, `amends`, `supersedes`, `fulfills`, `at_risk_because`) and a temporal stamp. The graph is what makes *"every unfulfilled rental-return commitment expiring within 14 days where the committed equipment has an open service ticket"* a structural query, not a prayer over OCR text. It is also what makes cross-document inference possible: a rental agreement that references equipment #4421, plus a service history that shows recurring Code 127, produces an edge `at_risk_because=recurring_fault_adjacent_to_return_window` — a fact that the rep can see before the customer returns the machine unhappy.

**Why this is the keystone and not a later-phase optimization.** Folder trees can be patched in. UI can be rebuilt. Operator verbs can be added one at a time. But retrieval systems that were built without twins stay dumb forever, because the rewrite cost of adding structured extraction *after* scale is prohibitive. Every commodity document product that has tried to retrofit reasoning has paid this tax and lost. The Document Center pours the concrete in the right order on day one.

---

## 3. Where We're Going (Architecture)

Three layers, each independently useful, each compounding on the one below.

**Layer 1 — Substrate.** Folders + memberships + twin + graph + audit. This is the data plane. It reuses `documents`, `chunks`, `document_audit_events`, storage buckets, role helpers, and the existing retrieval RPC without modification. It adds `document_folders`, `document_folder_memberships`, `document_facts`, `document_obligations`, `document_plays`, and one new source type on `exception_queue` (`doc_center_review`). All additions ride on migration 324 and above in strict canonical sequence.

**Layer 2 — Services.** `document-router` edge function (mirrors `crm-router`), `document-twin` edge function (extraction pass, idempotent by content hash), `document-plays-run` scheduled function (nightly obligations-graph sweep producing play rows), and OneDrive mirror adapter inside `hub-knowledge-sync` extended. All services follow the existing contract: `resolveCallerContext()`, `mapError()`, CORS from `safe-cors`, audit-event writes on every mutation, Prediction Ledger writes on every AI output.

**Layer 3 — Surfaces.** The Document Center UI under `/admin/documents` (expanding the Knowledge Base tab shown in the screenshot into a full operator surface), an Operator Feed extension on the existing Exception Inbox for document-derived plays, Iron Companion flow registration under surface `iron_documents`, and contextual embedding of the Document Center's primitives inside the CRM deal view, the equipment lifecycle page, the rental pipeline, and the owner dashboard. The UI is not one page. It is one *substrate* that renders role-shaped faces in every module that touches paper.

**Zero-blocking by construction.** Per CLAUDE.md §Non-Negotiables, OneDrive credential failure must not break the Document Center. The mirror is pull-only and cached. Uploads land directly in Supabase Storage regardless of OneDrive state. The twin pass runs on Supabase originals. Retrieval and plays run on the local graph. If OneDrive vanishes for a week, nothing downstream notices.

---

## 4. Phase 1 — Foundation (Now)

**Goal.** Ship the keystone and the file-management surface strong enough that a rep never has to open OneDrive to find a document again.

**Slice 8.1.1 — Folders and Memberships (Substrate).** Introduce `document_folders` (id, workspace_id, parent_id, name, path, audience, owner_user_id, is_smart, smart_query_jsonb, created_at, updated_at, deleted_at) and `document_folder_memberships` (document_id, folder_id, pinned, sort_order, added_by, added_at). Folders carry their own audience — a rep never sees the Finance folder exists. Smart folders are saved queries against the obligations graph and twin facts; the row carries the query and the renderer runs it on read. RLS enforces workspace isolation and audience via `get_my_role()` + `document_role_can_view_audience()`. Canonical migration: **324_document_folders.sql**.

**Slice 8.1.2 — Document Twin Table and Extraction Pass (Keystone).** Introduce `document_facts` (id, document_id, fact_type, value_jsonb, confidence, extracted_by_model, extracted_at, trace_id, verified_by, verified_at). Introduce `document_twin_jobs` (id, document_id, status, model_version, input_hash, started_at, completed_at, error_detail) for idempotent re-runs. Ship the `document-twin` edge function following the `sop-ingest` parse contract, with OpenAI structured-output extraction against a typed fact schema, confidence scoring per-field, Prediction Ledger write on each run. Migration: **325_document_twin.sql**.

**Slice 8.1.3 — Obligations Graph (Keystone).** Introduce `document_obligations` (id, workspace_id, edge_type, from_document_id, from_entity_type, from_entity_id, to_document_id, to_entity_type, to_entity_id, valid_from, valid_until, status, source_fact_ids, confidence, last_computed_at). Graph edges are derived from twin facts by a scheduled projection function; they are persisted, not recomputed on read. RLS inherits from the referenced documents' audience. Migration: **326_document_obligations.sql**.

**Slice 8.1.4 — `document-router` Edge Function.** Mirror the `crm-router` pattern. Endpoints: `/list`, `/search`, `/get`, `/ask`, `/folder-create`, `/folder-rename`, `/folder-move`, `/move`, `/duplicate-link` (creates a new folder-membership row, not a file copy), `/download-url` (signed URL, short TTL, audit-logged), `/email-to-customer` (pulls customer from CRM context, renders template, sends via existing communication provider, logs to timeline), `/attach-to-deal`, `/attach-to-equipment`, `/attach-to-work-order`, `/reindex`, `/twin-rerun`. Every endpoint runs through `resolveCallerContext()`, enforces role and audience, writes an audit event, and — for AI endpoints — writes to the Prediction Ledger with a trace id. No action leaks internals on error.

**Slice 8.1.5 — Document Center UI (Foundation).** Replace the minimal Knowledge Base tab at `/admin` (screenshot) with a three-pane operator surface: left-nav (All Files, Folders, Smart Folders, Recents, Pinned, Shared with Me, Trash; for admins: Pending Review, Ingest Failures, Knowledge Gaps), middle hybrid grid-then-list (big folder tiles with counts, files underneath, Dropbox-clean density), right context pane (twin summary, extracted facts, linked entities from the graph, "Ask about this document" box, recent activity). Cmd-K omnibar on every page combining keyword + semantic + structural search, landing on exact page of exact document. Role-shaped rendering: the same page renders differently to rep vs. finance vs. owner without either noticing the other's view exists. Mobile-first with an offline-cached recents slice for reps on trucks, per CLAUDE.md.

**Exit criteria for Phase 1.** Every document in the `documents` table has a twin with confidence per-field. Every twin's facts project into at least one edge in `document_obligations`. The `/admin/documents` page renders in under 800ms at 500 documents per folder with role-correct filtering. A rep can open a rental agreement on a phone, email it to the customer, attach it to the deal, and log the send to the customer timeline in under 15 seconds. `bun run migrations:check` + `bun run build` + role/workspace security tests green.

---

## 5. Phase 2 — Intelligence (Next)

**Goal.** Make the Document Center emit plays that the Exception Inbox surfaces before an operator asks. This is where the Document Center stops being a better browser and starts being an operator.

**Slice 8.2.1 — `document_plays` and the Plays Engine.** Mirror `predicted_parts_plays` (migration 262) column-for-column in spirit: `id`, `workspace_id`, unique business key (document_id + play_kind + window), `play_kind` (expiring_warranty, expiring_rental, undelivered_po_line, unpaid_invoice_aging, unexecuted_amendment, missing_signature, pending_insurance_cert, service_interval_breach, return_flagged_for_preinspection), `projection_window` (7d/14d/30d/60d/90d), `projected_due_date`, `probability`, `reason`, `signal_type`, `recommended_action_jsonb`, `suggested_owner_user_id`, `status` (open/actioned/dismissed/expired/fulfilled), `actioned_by`, `actioned_at`, `action_note`, `computation_batch_id`, `input_signals jsonb`, `trace_id`. Migration: **327_document_plays.sql**. A scheduled function `document-plays-run` sweeps the obligations graph every hour, computes the play set, upserts on the business key, and routes high-severity plays into `exception_queue` with source `doc_center_review`.

**Slice 8.2.2 — Proactive Auto-Draft.** The highest-leverage play types — expiring rental renewal, contract renewal, amendment due for counter-signature — get auto-drafted. The Iron Orchestrator registers a new flow surface `iron_documents` with typed flows (`renewal_draft`, `amendment_draft`, `termination_draft`, `warranty_claim_draft`, `insurance_cert_request`) gated by role allowlist. A rep accepting a renewal play clicks *Draft*; the flow generates a new document pre-populated from prior closed-won precedents scoped to the same customer, same equipment class, same rep, inherits the twin + graph linkages, and lands in *Pending Review* with the original play row marked `actioned`. The round-trip from play-surfaced to draft-in-hand is under 10 seconds.

**Slice 8.2.3 — Ask-About-This-Document Contextual Chat.** The right-pane "Ask" box is wired to `retrieve_document_evidence()` scoped to the selected document and its linked graph neighborhood. Answers cite passages at the chunk level with deep links that scroll the viewer to the highlighted text. Every Ask round-trip writes to the Prediction Ledger with the prompt, the retrieved evidence, the generated answer, and the citation list. Users see a "Why this?" disclosure on every answer. This is the mechanism by which the Document Center's retrieval quality becomes observable and tunable, per the Master Roadmap §12 confidence rule.

**Slice 8.2.4 — OneDrive Mirror (Zero-Blocking).** Extend `hub-knowledge-sync` with a OneDrive adapter. Folder-tree mirror: OneDrive folders project into `document_folders` rows with `source_type='onedrive_mirror'` and a reverse-sync opt-in. Files stream into Supabase Storage, the `documents` row is upserted by `source_id`, the twin runs, the graph updates. The Transformation check for this slice is not "we can mirror OneDrive" — Azure can do that — it is "we can lose OneDrive for a week and keep operating at full fidelity." OneDrive is optional; QEP OS is the system of record. Credential loss pauses the mirror, nothing downstream breaks, uploads keep flowing to Supabase, the twin keeps running, the Document Center keeps answering, plays keep generating. The Integration Hub surfaces mirror health with the same live/demo/manual-safe status output the rest of QEP OS uses, and the Exception Inbox picks up the mirror-health row on source `doc_center_review`.

**Slice 8.2.5 — Knowledge Gaps and SOP Generation.** When a user asks the Document Center something it cannot answer confidently — low retrieval score, thin chunk count, or explicit user thumbs-down — the question lands in a new tab `Knowledge Gaps` (already a tab label in the screenshot) clustered semantically with prior unanswered questions. Admins see the cluster, a proposed SOP or policy doc drafted from adjacent documents, and a one-click *Promote to KB* flow that writes a new `documents` row with `status=pending_review` and routes to the appropriate reviewer. The Document Center teaches itself, audibly, with evidence.

**Exit criteria for Phase 2.** Document Plays are generating daily with measurable accept-rate per type. Iron Orchestrator is dispatching document flows with feature-flagged allowlists. OneDrive mirror is live against at least two production folders with demonstrable credential-loss fallback. Ask-about-this answers at chunk-citation precision on ≥95% of sampled queries. Knowledge Gaps tab has routed at least one new SOP from gap-to-published.

---

## 6. Phase 3 — Moonshot (Deferred, Ethics-Reviewed)

**Goal.** Cross-document reasoning that produces judgments no human would reach in a reasonable timeframe, and proactive action that treats documents as the signal source for the whole dealership.

**Slice 8.3.1 — Multi-Document Inference.** The obligations graph becomes a reasoning substrate. The system infers chains like *"this rental agreement + this service record + this parts back-order = renewal at risk"* or *"this warranty clause + this inspection report + this customer damage claim = coverage dispute likely, pre-draft mitigation stance"*. Inferences are Prediction Ledger rows with trace chains that show every document and edge traversed. Operators see a "Chain of Reasoning" modal on demand. No inference without traceability.

**Slice 8.3.2 — Obligation Exposure Dashboards.** An owner-tier surface rolls the graph up: every commitment the dealership has made (deliveries, guarantees, services), every commitment owed to the dealership (payments, returns, counter-signatures), aged by window, weighted by dollar exposure, ranked by risk. A new page `/owner/obligations` renders alongside the existing Owner Dashboard Moonshot. An owner opens this page Monday morning and sees the whole paper-flow of the dealership in one render. This is the literal answer to the Phase 7 bar.

**Slice 8.3.3 — Document-as-Signal to Every Module.** Parts Intelligence consumes the graph to anticipate stocking based on active rental commitments. Service consumes it to anticipate work orders based on warranty triggers and inspection cadence. CRM consumes it to anticipate renewal conversations. Rentals consumes it to anticipate return-window flags. The Document Center becomes invisible infrastructure — not a page users visit, but a substrate that every other page already reflects.

**Slice 8.3.4 — OneDrive Retirement.** When field usage telemetry shows reps opening the Document Center first for ≥80% of document sessions across four consecutive weeks, the Integration Hub surfaces a retirement plan for OneDrive: export-and-archive, read-only downgrade, final snapshot to cold storage, audit event chain. OneDrive stops being the system of record. QEP OS *is* the system of record.

**Slice 8.3.5 — Field-Level Redaction and Role Lenses.** The twin carries per-field audience tags, not just per-document. The viewer composes a rendered page that redacts fields the caller's role cannot see, using the same `document_role_can_view_audience()` logic extended to fact-level granularity. A rep opens a contract and sees customer-facing terms; a manager opens the same PDF and sees obligations and counter-parties; an owner opens the same PDF and sees margin and liability exposure. One file, three truths, one policy.

Phase 3 slices are deferred until Phase 2 is ship-hardened. Cross-document inference passes through the Hidden Forces ethics gate (Track 7C) before opening publicly.

---

## 7. Success Metrics

The master plan's discipline is that metrics are operator-measurable, not engineer-measurable. These are the bars.

**Phase 1.** Median time for a rep to find-view-email a specific document drops from current OneDrive baseline (measure via pre-rollout stopwatch study on 20 reps × 10 document sessions) to under 30 seconds end-to-end. The `/admin/documents` page opens in under 800ms at the 95th percentile with 500 documents in the active folder. Twin extraction confidence ≥0.80 on party, date, and equipment-tag fields for the top three document classes (rental agreements, POs, warranty certificates) measured on a 100-document golden set.

**Phase 2.** Document Plays produce ≥1 actionable play per rep per workday on average across the first full month. Play accept-rate ≥40% (industry baseline for proactive suggestions is 10–15%). Iron Companion document-flow round-trip from play-surfaced to draft-in-hand under 10 seconds p50. OneDrive mirror sustains 24 hours of credential loss with zero downstream breakage. Knowledge Gaps tab routes ≥1 new SOP to published status in the first month.

**Phase 3 (Moonshot bar, adapted from Phase 7).** *"Can any role inside QEP OS walk into any conversation — customer meeting, legal call, internal escalation, financial review — with better command of the paper trail than the person they are talking to?"* If the answer is yes for reps, service coordinators, ops managers, and owners at separate measurement points, Phase 3 has shipped.

---

## 8. First Slice — What Gets Merged This Sprint

**Track 8.1.1 — Folders + Memberships + Minimal UI.** This is the wedge. It ships the data plane, the `document-router` stub with `/list`, `/get`, `/folder-create`, `/folder-move`, `/move`, `/duplicate-link`, `/download-url`, and the new three-pane layout on `/admin/documents` with real folder tiles, real file rows, real role-filtering, real Cmd-K search against `documents` and `chunks` using the existing `retrieve_document_evidence()` RPC.

**Schema additions (migration 324_document_folders.sql):**

```sql
create table if not exists public.document_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  parent_id uuid references public.document_folders(id) on delete cascade,
  name text not null,
  path text not null,
  audience public.document_audience not null default 'company_wide',
  owner_user_id uuid references public.profiles(id) on delete set null,
  is_smart boolean not null default false,
  smart_query jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, parent_id, name) where deleted_at is null
);

create table if not exists public.document_folder_memberships (
  document_id uuid not null references public.documents(id) on delete cascade,
  folder_id uuid not null references public.document_folders(id) on delete cascade,
  pinned boolean not null default false,
  sort_order integer not null default 0,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (document_id, folder_id)
);

alter table public.document_folders enable row level security;
alter table public.document_folder_memberships enable row level security;

create policy document_folders_select on public.document_folders
  for select to authenticated
  using (
    workspace_id = public.get_my_workspace()
    and public.document_role_can_view_audience(audience, public.get_my_role()::text)
    and deleted_at is null
  );

-- insert/update/delete policies mirror the pattern with owner + elevated-role carveouts
```

**Edge function additions:** `/supabase/functions/document-router/index.ts` follows `crm-router` exactly. Imports `resolveCallerContext` from `_shared/dge-auth.ts`, uses `mapError` with the full `UNAUTHORIZED` / `FORBIDDEN` / `NOT_FOUND` / `SERVICE_WORKSPACE_UNBOUND` taxonomy, CORS allowlist against the three production origins, audit-event write on every mutation, typed JSON response shape.

**UI additions:** `/apps/web/src/routes/admin/documents/` gets `DocumentCenter.tsx`, `FolderGrid.tsx`, `FileList.tsx`, `ContextPane.tsx`, `OmniSearch.tsx`. Shared API adapter at `/apps/web/src/features/documents/router.ts` wraps `document-router` endpoints with typed inputs and outputs. Loading, empty, and error states explicit per CLAUDE.md.

**Build gates for this slice.** `bun run migrations:check` green. `bun run build` green from repo root and `apps/web`. Contract tests against `document-router` for `/list`, `/folder-create`, `/move`, `/duplicate-link`, `/download-url` with role matrix. RLS audit on `document_folders` and `document_folder_memberships` covering all four roles. A rep account, a finance account, an admin account, and an owner account each verify they see a role-shaped view of a seeded fixture. Commit-and-push per CLAUDE.md execution cadence.

**Effort.** 4–6 engineer-days for Slice 8.1.1 end-to-end, including schema, edge function, UI, tests. Twin (8.1.2) and Graph (8.1.3) are the next two slices and run 5–7 engineer-days each. Phase 1 completes in ~3 sprints at current capacity.

### 8.1 — Slice Dependency and Effort Table

| #     | Slice                                          | Depends on        | Estimate  |
|-------|------------------------------------------------|-------------------|-----------|
| 8.1.1 | Folders + Memberships + `document-router` stub | —                 | 4–6 days  |
| 8.1.2 | Document Twin table + `document-twin` edge fn  | 8.1.1             | 5–7 days  |
| 8.1.3 | Obligations Graph + projection scheduler       | 8.1.2             | 5–7 days  |
| 8.1.4 | `document-router` full endpoint set            | 8.1.1             | 3–4 days  |
| 8.1.5 | Document Center UI (three-pane + Cmd-K)        | 8.1.1, 8.1.4      | 5–7 days  |
|       | **Phase 1 ship**                               |                   | ~3 sprints|
| 8.2.1 | `document_plays` + plays engine                | 8.1.3             | 4–5 days  |
| 8.2.2 | Proactive Auto-Draft via Iron Orchestrator     | 8.2.1             | 3–4 days  |
| 8.2.3 | Ask-about-this-document contextual chat        | 8.1.4             | 3–4 days  |
| 8.2.4 | OneDrive Mirror (zero-blocking adapter)        | 8.1.2             | 4–5 days  |
| 8.2.5 | Knowledge Gaps + SOP generation loop           | 8.2.3             | 3–4 days  |
|       | **Phase 2 ship**                               |                   | ~3 sprints|
| 8.3.1 | Multi-document inference w/ trace chain        | 8.2.1, 8.2.3      | 5–7 days  |
| 8.3.2 | Obligation Exposure owner dashboard            | 8.3.1             | 4–5 days  |
| 8.3.3 | Document-as-Signal module integrations         | 8.3.1             | 5–7 days  |
| 8.3.4 | OneDrive Retirement                            | 8.2.4 + telemetry | 2–3 days  |
| 8.3.5 | Field-level redaction + role lenses            | 8.1.2             | 4–5 days  |
|       | **Phase 3 ship**                               | (ethics-gated)    | ~3 sprints|

Slices inside a phase are parallelizable where dependencies allow — 8.2.3 and 8.2.4 have no shared blockers, for example. Phase 3 is sequenced only after Phase 2 is ship-hardened and the Hidden Forces ethics gate (Track 7C) signs off on multi-document inference.

---

## 9. Pressure Test and Failure Modes

**OneDrive credential loss.** Mirror pauses. Uploads keep landing in Supabase Storage. Twin runs on local originals. Retrieval returns results. Plays still generate. Exception Inbox surfaces a `doc_center_review` item tagging the mirror health. Zero user-facing breakage. Validated by explicit test in Phase 2 acceptance.

**Scale.** 100,000 documents across 5,000 folders across 10 workspaces. Folder grid paginates at 50 folders per view with infinite scroll. File list paginates at 100 rows. Cmd-K uses `retrieve_document_evidence()` with `match_count=8`, bounded-cost regardless of corpus size. Twin runs are rate-limited to OpenAI quota budget and write-through to `document_twin_jobs` for idempotent retry.

**Redaction edge cases.** A twin extracts a sensitive fact (SSN, account number) from a customer-uploaded receipt. The fact carries `audience=finance` by default until classified. The field is redacted on render for reps. Admin reclassification is audit-logged. Field-level redaction ships in Phase 3; Phase 1 defaults to per-document audience (safer, less useful) and Phase 2 introduces twin-field audience tagging with conservative defaults.

**Ingest failures.** A malformed PDF fails extraction. The document row enters `status=ingest_failed`. A `document_audit_events` row is written with the error. An `exception_queue` row with source `doc_center_review` surfaces it to admin. The file is retained in storage for re-ingest. The user sees an explicit failure state on the file card, not a silent miss.

**Hostile prompts in Ask-about-this.** Prompt injection in a document tries to override the system prompt. Guardrails: system prompt isolation, document content wrapped in role-tagged separators, output checked against allowed-intent schema, no tool-call execution from within retrieval results. Iron Orchestrator pattern already enforces this at the flow layer; the Ask box inherits.

**Role boundary leaks.** RLS and the `document_role_can_view_audience()` RPC are the single source of truth. The UI never filters; the database does. A rep cannot see an admin_owner folder even if the UI tried to render it. Pen-test by direct Supabase client call with each role's JWT against seeded fixtures covering every audience tier × every role. Ships with Slice 8.1.1.

---

## 10. Runtime Gates and Rollout

Per the Master Roadmap §19 runtime-gate pattern, every slice is behind a feature flag before it defaults on.

**`document_center_foundation`** gates Slice 8.1.1 (folders + UI). Default off. Ops team flips per workspace.

**`document_center_twin`** gates 8.1.2 and 8.1.3. Default off. Flip per workspace only after a 100-document twin-confidence audit passes.

**`document_center_plays`** gates Slice 8.2.1 and 8.2.2. Default off. Flip after Phase 2 metrics prove accept-rate floor.

**`document_center_onedrive`** gates Slice 8.2.4. Default off. Flip per customer who has opted into the mirror.

**`document_center_inference`** gates Slice 8.3.1 and 8.3.2. Default off. Requires Hidden Forces ethics-gate sign-off (Track 7C).

Rollout is workspace-by-workspace. No global flip. Every flag toggle writes a `document_audit_events` row so governance sees when what went live where.

---

## 11. Sources and Lineage

**Mission and contract.**
- `/Users/brianlewis/Projects/qep-knowledge-assistant/CLAUDE.md` — mission lock, build gates, zero-blocking rule, non-negotiables, working rules, execution cadence.
- `/Users/brianlewis/Projects/qep-knowledge-assistant/AGENTS.md` — agent operating contract.

**Existing master plans (voice, phase structure, pressure-test bar).**
- `/Users/brianlewis/Projects/qep-knowledge-assistant/QEP-OS-Master-Roadmap.md` — Playbooks pattern §12, Prediction Ledger P0.3, Exception Inbox Track 5.9, runtime-gate §19.
- `/Users/brianlewis/Projects/qep-knowledge-assistant/QEP-OS-Complete-Roadmap-2026-04-15.md` — Track numbering baseline (Tracks 1–7 taken), SOP Engine Track 4.6, Document Library Track 6.5.
- `/Users/brianlewis/Projects/qep-knowledge-assistant/QEP-Parts-Intelligence-Engine-Master-Plan-2026-04-15.md` — slice template, mission-lock-per-phase format, moonshot voice.
- `/Users/brianlewis/Projects/qep-knowledge-assistant/PHASE-7-SHIP-REPORT-2026-04-11.md` — Iron Companion pattern, "better theory of the deal" success bar.
- `/Users/brianlewis/Projects/qep-knowledge-assistant/PREDICTIVE-PLAYS-SHOWSTOPPER.md` — persisted-row play pattern, lifecycle states.

**Schema anchors (every reference in this plan maps to a shipped migration).**
- `/supabase/migrations/005_fix_profiles_rls_recursion.sql` — `user_role` enum, `get_my_role()`.
- `/supabase/migrations/040_secure_document_governance.sql` — `documents`, `document_audit_events`, `document_audience`, `document_status`, `document_role_can_view_audience()`.
- `/supabase/migrations/042_hybrid_retrieve_document_evidence.sql` — `retrieve_document_evidence()` hybrid RPC.
- `/supabase/migrations/050_storage_buckets_and_document_originals.sql` — storage bucket, mime allowlist, storage RLS.
- `/supabase/migrations/157_portal_live_status_and_documents.sql` — `equipment_documents`, `customer_visible` precedent.
- `/supabase/migrations/165_exception_inbox.sql` — `exception_queue` with `doc_visibility` source.
- `/supabase/migrations/204_workspace_identity_hardening.sql` — `get_my_workspace()`.
- `/supabase/migrations/208_prediction_ledger.sql` — `qrm_predictions`, trace chain.
- `/supabase/migrations/231_kb_tier1_retrieval_upgrade.sql` — chunk embedding model persistence.
- `/supabase/migrations/262_predictive_parts_plays.sql` — play table precedent for Document Plays.
- `/supabase/migrations/314_hub_knowledge_sources.sql` through `317_hub_knowledge_sync_cron.sql` — external source mirror precedent.

**Edge function anchors.**
- `/supabase/functions/crm-router/index.ts` — router contract.
- `/supabase/functions/document-admin/index.ts` — current metadata mutation surface (extend, do not replace).
- `/supabase/functions/sop-ingest/index.ts` — structured extraction precedent for the twin.
- `/supabase/functions/hub-knowledge-sync/index.ts` — external mirror + chunk + embed precedent for OneDrive adapter.
- `/supabase/functions/iron-orchestrator/index.ts` — typed-flow dispatch for Iron Companion document flows.

**Canonical migration sequence next slot:** 324.

**Track number claimed:** 8.1 through 8.3.5. No collision with existing Tracks 1–7.

---

## 12. Document Lineage

This plan is the inaugural Track 8 document. It supersedes no prior plan. It does supersede the looser language in the first-pass chat proposal dated 2026-04-20 that framed the Document Center as a smarter Dropbox — a framing that failed the Mission-Lock §0 Transformation check and was discarded. Track 8 assumes Tracks 1–6 are live, extends the document-governance substrate from Phase 1–3, and builds the knowledge-and-obligations spine that Track 7 (Moonshot Operating Surfaces) will consume as a reasoning substrate rather than as a static file repository. Future changes to Track 8 scope should amend this document in-place with a dated revision block and a diff against the shipped slices.
