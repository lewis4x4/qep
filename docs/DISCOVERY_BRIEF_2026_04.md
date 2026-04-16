# QEP OS — Discovery Brief
Generated: 2026-04-16
By: Claude Code, Slice 00 — Quote Builder Moonshot

This brief is the authoritative input for Slices 01–08. Every downstream slice must read this first. Where this brief contradicts a slice spec, the brief wins — the spec was written before the repo was inspected.

---

## 1. Repo Layout

```
/
├── apps/
│   └── web/                    # React 18 + TypeScript + Vite + Tailwind
│       ├── src/
│       │   ├── App.tsx         # Root router (React Router v6.28, ~86KB — large)
│       │   ├── features/       # 25+ feature modules, colocated components/pages/lib/hooks
│       │   │   ├── quote-builder/   # Existing QB stub (see §5)
│       │   │   ├── qrm/             # QRM (HubSpot replacement)
│       │   │   ├── dashboards/      # Dashboard views
│       │   │   ├── voice-qrm/       # Voice capture UI
│       │   │   ├── portal/          # Customer portal
│       │   │   ├── parts-*/         # Parts modules
│       │   │   └── service*/        # Service modules
│       │   ├── components/     # Shared UI primitives (shadcn/ui wrappers)
│       │   ├── hooks/          # Shared React hooks
│       │   └── lib/
│       │       ├── database.types.ts   # Supabase auto-gen types (680KB — regenerate after every migration)
│       │       ├── supabase.ts         # Supabase client singleton
│       │       ├── nav-config.ts       # Navigation registry (see §7)
│       │       └── iron/               # Iron CRM layer
│       └── package.json        # See §1a for key deps
├── supabase/
│   ├── migrations/             # 282 migrations. Next: 283_
│   └── functions/              # ~144 Edge Functions (Deno/TypeScript)
│       └── _shared/            # Shared utilities — use these, don't reinvent
├── docs/                       # This file lives here. Other runbooks and signoffs.
├── qep/plans/                  # Strategy docs and moonshot slice files
└── shared/                     # Shared TS contracts (qep-moonshot-contracts)
    └── qep-moonshot-contracts  # Imported by QB frontend; defines QuoteWorkspaceDraft etc.
```

### 1a. Key Frontend Dependencies

| Package | Version | Relevance |
|---|---|---|
| `react` | 18.3.1 | — |
| `react-router-dom` | 6.28 | v6 loaders/actions not used; plain `<Route>` components |
| `@supabase/supabase-js` | 2.49.1 | Auth + DB client |
| `@tanstack/react-query` | 5.90.2 | All async data — use `useQuery`/`useMutation` everywhere |
| `@react-pdf/renderer` | 4.4.0 | PDF generation — already in use in QB stub |
| `tailwindcss` | 3.4.16 | — |
| `shadcn/ui` (via Radix) | — | Component primitives in `src/components/ui/` |
| `framer-motion` | 12.38 | Animation — use sparingly |
| `recharts` | 3.8.1 | Charts — for Slice 08 margin/commission dashboards |
| `lucide-react` | 1.7 | Icons — use these only |
| `papaparse` | 5.5.3 | CSV parsing — relevant for Slice 04 price sheet ingestion |
| `@dnd-kit/*` | — | Drag-and-drop — relevant for Slice 04 review UI |

---

## 2. Existing Supabase Schema

### 2a. Auth & Identity Tables

**`public.profiles`** — extends `auth.users`
```
id uuid PK (= auth.users.id)
full_name text
email text
role public.user_role NOT NULL DEFAULT 'rep'
is_active boolean NOT NULL DEFAULT true
active_workspace_id text  -- ← authoritative workspace for this user
created_at timestamptz
updated_at timestamptz
```

**`public.user_role` enum** — exactly 4 values, no more:
```sql
'rep', 'admin', 'manager', 'owner'
```
> **Slice 01 correction:** The spec uses `'sales_rep'`, `'sales_admin'`, `'finance_admin'`, `'service_writer'`, `'parts_counter'`. None of these exist. All new RLS policies must use the enum above. `'sales_rep'` → `'rep'` everywhere.

**`public.profile_workspaces`** — many-to-many user↔workspace
```
profile_id uuid FK profiles(id)
workspace_id text  ← TEXT, not UUID. No FK to any workspaces table.
created_at timestamptz
PK (profile_id, workspace_id)
```

### 2b. workspace_id — Critical Pattern Correction

> **This corrects decision #3 from the pre-discovery conversation.**

The user specified `workspace_id uuid not null references workspaces(id)`. That is **not the actual pattern**. The real pattern:

```sql
workspace_id text not null default 'default'
```

- It is a **plain text tag**, not a UUID FK.
- There is **no `workspaces` table** with a UUID PK.
- `get_my_workspace()` reads `profiles.active_workspace_id` (a text column).
- All 282 existing migrations use this pattern without exception.

**Every new moonshot table must follow the existing pattern:**
```sql
workspace_id text not null default 'default'
```
Add `create index idx_<table>_workspace on <table>(workspace_id);` on every new table.

### 2c. Existing Quote-Builder Tables (the stub — keep as-is)

**`public.catalog_entries`** — manual equipment catalog
- UUID PK, workspace_id text, source: `'intellidealer'|'manual'|'csv_import'`
- Money as `numeric` (list_price, dealer_cost, msrp) — **do not modify this table's money columns**
- Already has inventory-first ordering via `is_yard_stock boolean`
- Status: keep as zero-blocking fallback; moonshot creates its own `equipment_models` table alongside it

**`public.quote_packages`** — existing JSONB quote blobs
- UUID PK, workspace_id text, deal_id FK to `crm_deals`
- Money as `numeric` (equipment_total, subtotal, net_total, etc.) — do not touch
- Status enum: `'draft'|'ready'|'sent'|'viewed'|'accepted'|'rejected'|'expired'`
- Moonshot creates a new `qb_quotes` table (see §10 on naming) — these coexist

**`public.quote_signatures`** — e-signature records
- UUID PK, workspace_id text
- Has document_hash (SHA-256), signer_ip, signer_user_agent
- **Slice 06 can reuse this table as-is** for the approval/signature step

### 2d. CRM Tables (extend, don't duplicate)

**`public.crm_companies`** — the company record; extend this for moonshot
```
id uuid PK
workspace_id text
name text
parent_company_id uuid (self-ref)
assigned_rep_id uuid FK profiles(id)
hubspot_company_id text
address_line_1/2, city, state, postal_code, country
metadata jsonb
created_at, updated_at, deleted_at
```
**Missing columns Slice 01 must ADD (additive migration only):**
- `classification text check (classification in ('standard','gmu','forestry','construction','land_clearing','rental','logging','other'))`
- `territory_code text` — `'STORE_01'` (Lake City) or `'STORE_02'` (Ocala)
- `county text` — for territory assignment by county
- `status text default 'active' check (status in ('active','inactive','prospect','archived'))`
- `notes text`

> `assigned_rep_id` already exists as `assigned_rep_id` — do not rename it.
> `legal_name`, `dba`, `phone`, `website` — add these too if missing; check before adding.

**`public.crm_contacts`** — the contact record
- UUID PK, workspace_id text
- Has: first_name, last_name, email, phone, assigned_rep_id
- Moonshot references `crm_contacts.id` as `contact_id` in `qb_quotes`

### 2e. QRM Tables (related, don't break)

The `qrm_*` namespace has: `qrm_companies`, `qrm_deals`, `qrm_deal_stages`, `qrm_activities`
- `owner-ask-anything` queries these directly
- Moonshot `qb_deals` is a separate table — do not collide with `qrm_deals`

### 2f. Existing Program/Financing Tables (moonshot supersedes these)

**`public.manufacturer_incentives`** — existing, different schema from moonshot
- Has: `oem_name`, `name`/`incentive_name`, `discount_type` (string), `discount_value` (numeric), `stacking_rules` jsonb, `start_date`, `end_date`, `is_active`
- **Do not remove** — `quote-builder-v2` still reads it. Moonshot creates `qb_programs` alongside it.

**`public.financing_rate_matrix`** — existing
- Has: `term_months`, `apr`, `lender_name`, `loan_type`, `is_active`
- **Do not remove** — still used by existing QB. Moonshot encodes financing inside `qb_programs.details` jsonb.

**`public.trade_valuations`** — existing, referenced by `quote_packages.trade_in_valuation_id`
- Keep. Moonshot `qb_trade_ins` references deals, not this table.

**`public.competitor_listings`** — existing
- Keep. Slice 07 competitive intelligence reads from it.

### 2g. Soft Delete Convention

Every soft-deletable table uses:
```sql
deleted_at timestamptz  -- NULL = active, non-null = soft-deleted
```
Not `soft_deleted_at`. Not `is_deleted`. Always `deleted_at`.

### 2h. Primary Key Convention

**UUIDs everywhere**, without exception:
```sql
id uuid primary key default gen_random_uuid()
```
The Slice 01 spec mentions `BIGSERIAL` as a possibility — confirmed: **do not use bigserial**. Use UUID.

---

## 3. Existing Edge Functions

144 functions total. Key ones for moonshot reference:

| Function | Purpose | Pattern Used |
|---|---|---|
| `quote-builder-v2` | Existing QB: recommend, calculate, save, sign | Old auth (argless getUser) |
| `quote-incentive-resolver` | Program eligibility (early, simple) | — |
| `requote-drafts` | Portal quote revision flow | — |
| `owner-ask-anything` | Anthropic Claude + tool use | New auth (requireServiceUser) |
| `voice-capture` | Audio → Whisper → OpenAI extract → CRM | Old auth |
| `voice-to-qrm` | Voice → QRM structured data | — |
| `iron-transcribe` | OpenAI Whisper transcription | — |
| `tax-calculator` | FL county tax lookup | — |
| `trade-valuation` | Trade-in valuation | — |
| `ingest` | Document ingestion for RAG | service_role writes chunks |
| `chat` | RAG chat (Knowledge Base) | — |
| `morning-briefing` | Daily brief generation | — |
| `price-file-import` | Existing price file import | — |

**Shared utilities in `_shared/` — always use these:**

| File | What it provides |
|---|---|
| `service-auth.ts` | `requireServiceUser()` — canonical JWT auth for new functions |
| `safe-cors.ts` | `optionsResponse()`, `safeJsonOk()`, `safeJsonError()`, `safeCorsHeaders()` |
| `sentry.ts` | `captureEdgeException()` — always call in catch blocks |
| `resend-email.ts` | `sendResendEmail()` — email delivery |
| `openai-embeddings.ts` | `embedText()`, `formatVectorLiteral()` — for vector search |
| `voice-capture-crm.ts` | `VoiceCaptureExtractedDealData` type + CRM write helpers |

---

## 4. Authentication & Roles

### How auth works

1. User signs in via Supabase email/password auth
2. JWT issued, stored in Supabase session (localStorage key `sb-*-auth-token` — this is Supabase's own session, not application state)
3. Every request sends `Authorization: Bearer <jwt>`
4. Edge Functions validate JWT and look up `profiles.role`

### User role enum (exhaustive)

```typescript
type UserRole = 'rep' | 'admin' | 'manager' | 'owner'
```

### How role is read in RLS

```sql
-- The canonical helper — always use this in new RLS policies
public.get_my_role() returns public.user_role
-- SECURITY DEFINER, reads from public.profiles where id = auth.uid()
-- Revoke from public, grant to authenticated
```

### How workspace is read in RLS

```sql
-- The canonical helper — always use this in new RLS policies
public.get_my_workspace() returns text
-- SECURITY DEFINER, reads profiles.active_workspace_id
-- Falls back to JWT claim 'workspace_id' if profile not found
```

### RLS policy template for new moonshot tables

```sql
-- Read: workspace-scoped, all authenticated roles can read
create policy "qb_<table>_select" on public.<table> for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

-- Write: workspace-scoped, rep can write own rows, elevated can write all
create policy "qb_<table>_insert" on public.<table> for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "qb_<table>_update" on public.<table> for update
  using (
    workspace_id = public.get_my_workspace()
    and (
      public.get_my_role() in ('admin', 'manager', 'owner')
      or (public.get_my_role() = 'rep' and created_by = auth.uid())
    )
  );

create policy "qb_<table>_delete" on public.<table> for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

-- Service role bypass — required for edge functions that use service_role key
create policy "qb_<table>_service" on public.<table> for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
```

> **Key Rylee rule:** Reps see full cost data. No RLS filtering on cost columns — the `select` policy above grants full row access without column restrictions. Don't add column-level security.

### Edge Function auth — canonical pattern for all new functions

```typescript
// ✅ USE THIS — from _shared/service-auth.ts
import { requireServiceUser } from "../_shared/service-auth.ts";

const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
if (!auth.ok) return auth.response;
// auth.userId, auth.role, auth.supabase now available

// ❌ DO NOT USE THIS — old pattern, argless getUser() silently 401s on Deno JSR build
const { data: { user } } = await supabase.auth.getUser(); // broken in JSR Deno
```

---

## 5. Quote Builder Stub — Current State

### What exists and is wired

**Frontend** (`apps/web/src/features/quote-builder/`):
- `QuoteListPage.tsx` — list view at `/quote`, searches by status/customer name
- `QuoteBuilderV2Page.tsx` — 4-step wizard: entry → equipment → financing → review
- `EquipmentSelector.tsx` — searches `catalog_entries` via inventory-first API
- `FinancingCalculator.tsx` — calls `/calculate` endpoint, shows 3 scenarios
- `IncentiveStack.tsx` — shows `manufacturer_incentives` (old schema)
- `MarginCheckBanner.tsx` — flags when `margin_pct < 10`
- `TradeInSection.tsx` + `TradeInInputCard.tsx` — trade-in capture
- `TaxBreakdown.tsx` — county-level FL tax via `tax-calculator` function
- `QuotePDFDocument.tsx` — `@react-pdf/renderer` PDF template (wired, generates PDFs)
- `SendQuoteSection.tsx` — email delivery via Resend
- `AiRecommendationCard.tsx` — surfaces OpenAI GPT-4o-mini recommendations
- `CompetitiveBattleCard.tsx` — shows `competitor_listings`
- `IntelligencePanel.tsx` — wrapper for AI insight cards
- `useQuotePDF.ts` — hook that drives PDF generation and upload to Supabase Storage

**Backend** (Edge Functions):
- `quote-builder-v2` — recommend, calculate, save, sign, send-package, portal-revision flow
- `quote-incentive-resolver` — early-version eligibility check
- `requote-drafts` — portal revision draft management
- `service-quote-engine` — service-side quoting (separate flow)

### What's placeholder / incomplete

- **Pricing math** is ad-hoc in the UI — no deterministic engine. `FinancingCalculator.tsx` does simple amortization but there's no dealer-discount / PDI / good-faith / tariff / markup chain.
- **Program stacking** — `IncentiveStack.tsx` shows incentives from old `manufacturer_incentives` table but does not enforce XOR/AND stacking rules.
- **Approval workflow** — `MarginCheckBanner.tsx` shows a warning at <10% but does not block or route to manager.
- **Commission calculation** — not present anywhere.
- **Rebate filing deadline** — not present anywhere.
- **Natural language entry** — not present (Slice 05 builds this from scratch).
- **Audit trail** — `quote_packages` has no audit companion.

### Shared contracts

The QB frontend imports from `../../../../../../shared/qep-moonshot-contracts`:
```typescript
QuoteWorkspaceDraft, QuoteLineItemDraft, QuoteFinanceScenario,
QuoteFinancingPreview, QuoteEntryMode, QuoteListItem,
QuoteRecommendation, PortalQuoteRevisionDraft, ...
```
This `shared/` directory is at the repo root. New moonshot types should extend or coexist with these — do not break existing imports.

---

## 6. AI Integration Pattern

### Anthropic (Claude) — use for all moonshot AI features

```typescript
const CLAUDE_MODEL = "claude-sonnet-4-6"; // confirmed current model
const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY"); // lives in Supabase function secrets

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": anthropicKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: CLAUDE_MODEL,
    max_tokens: 1536,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    tools: TOOLS,    // optional — for tool-use pattern (see owner-ask-anything)
    messages,
  }),
  signal: AbortSignal.timeout(35_000),
});
if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
const data = await res.json();
```

The tool-use agentic loop is fully implemented in `owner-ask-anything/index.ts` — copy that pattern for Slice 05 (natural language builder) and Slice 04 (price sheet extraction).

### OpenAI — transcription and embeddings only

```typescript
// Transcription (voice-capture): OpenAI Whisper
// Key: Deno.env.get("OPENAI_API_KEY")
// See: supabase/functions/iron-transcribe/index.ts

// Embeddings (RAG search): text-embedding-ada-002, 1536 dimensions
// See: supabase/functions/_shared/openai-embeddings.ts
import { embedText, formatVectorLiteral } from "../_shared/openai-embeddings.ts";
```

> **Decision:** Moonshot AI features (Slices 04, 05, 08) use **Anthropic Claude**. Voice transcription (Slice 05 if audio input is added) uses **OpenAI Whisper** because that's what the existing voice pipeline uses. Don't mix these up.

### pgvector

Enabled in migration 001. Schema: `extensions.vector(1536)`. Use for similarity search in Slice 08 (similar past deals). The `search_chunks` RPC pattern in migration 001 is the template.

### RAG (Knowledge Base) pattern

- Documents → `chunks` table with `embedding extensions.vector(1536)`
- Search via `search_chunks()` RPC (cosine similarity, HNSW index)
- Chat via `supabase/functions/chat/` — uses pgvector similarity + Claude for answer synthesis
- For Slice 08 (similar past deals): same pattern but over `qb_quotes` embeddings, not document chunks

---

## 7. Dashboard & Navigation Patterns

### Adding a new module to the nav

Edit `apps/web/src/lib/nav-config.ts`:

```typescript
// 1. Add to NAV_ITEMS array
{
  label: "Quote Builder",      // what rep sees
  href: "/quote",              // already exists — QB is already in nav
  icon: FileText,
  roles: ["rep", "admin", "manager", "owner"],
  primaryHeaderId: "sales",   // which top-level tab it lives under
  sectionLabel: "Execution",  // which sidebar section
},

// 2. Add href to resolveActivePrimaryHeader() if needed for highlighting
// 3. Add <Route> in App.tsx pointing to your page component
```

**Quote Builder is already in the nav at `/quote` under Sales → Execution.** No nav changes needed for Slice 01–02. Slice 05 may add a natural language entry shortcut. Slices 06–07 may add a `/deals` route under QRM.

### Bottom tab bar (mobile)

```typescript
export const BOTTOM_TAB_HREFS = ["/qrm", "/service", "/chat", "/voice", "/quote"];
```
`/quote` is already in the bottom tab bar. Mobile-first requirement is already met by existing QB routing.

### Dashboard widget pattern

Dashboard uses a sectioned card layout. Each module can add a card to the morning brief / owner dashboard by posting to the `owner_briefs_cache` table (see migrations 273–274). Slice 08 AI insight alerts will plug in here.

---

## 8. Deployment

### Build

```toml
# netlify.toml
[build]
  base = "apps/web"
  command = "bun run build"
  publish = "dist"
```

SPA redirect: `/* → /index.html` (React Router handles routing client-side).

### Environment variables

Set in Netlify UI (not committed):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Set in Supabase Function Secrets (not committed):
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `RESEND_API_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (auto-injected)

CSP in `netlify.toml` already includes `https://api.anthropic.com` — no CSP change needed when calling Claude from frontend (though Edge Function proxy is the correct pattern; never put `ANTHROPIC_API_KEY` in frontend code).

### Supabase Edge Functions

Deployed via `supabase functions deploy <name>`. No CI/CD automation observed — manual deploy per function. New QB functions go in `supabase/functions/qb-*/`.

---

## 9. Red Flags

### 🔴 RED — Fix before or during the relevant slice

1. **`quote-builder-v2` uses argless `auth.getUser()`** — the old pattern that silently 401s on Deno JSR builds (documented in MEMORY.md). New QB edge functions must use `requireServiceUser()`. The existing function works in production only because it initializes the client with `{global: {headers: {Authorization}}}` which happens to pass the header through. New functions: don't rely on this — use the explicit `getUser(token)` pattern.

2. **`quote-builder-v2` uses OpenAI GPT-4o-mini for AI recommendations** — moonshot spec uses Anthropic Claude. New NL builder (Slice 05) must call Anthropic. The existing `/recommend` endpoint stays for backward compat; the new NL endpoint is separate.

3. **No pricing engine exists** — existing `FinancingCalculator.tsx` does payment amortization but has no concept of dealer discount, PDI, good-faith %, freight, tariff, or markup chain. This is the entire Slice 02 gap.

4. **No approval routing** — `MarginCheckBanner.tsx` shows a banner but doesn't block submission or notify a manager. Slice 06 builds this.

5. **No commission or rebate tracking** — zero code exists for these. Slices 01 (schema) and 07 (lifecycle) build them from scratch.

### 🟡 YELLOW — Note, don't block

6. **localStorage usage** in `useAuth.ts`, `App.tsx`, `auth-recovery.ts`, `auth-route-bootstrap.ts` — these touch Supabase's own session keys (`sb-*-auth-token`), not application state. This is acceptable Supabase SDK behavior, not a violation of the "no localStorage for app state" rule. The QB moonshot features must still not use localStorage for quote state.

7. **`manufacturer_incentives` schema is incompatible with moonshot `qb_programs`** — different column structure (string types vs jsonb). They coexist. `quote-builder-v2` reads `manufacturer_incentives`; new QB reads `qb_programs`. Don't merge them.

8. **`quote_packages.status` enum is different from moonshot `qb_quotes.status`** — `quote_packages` has `'ready'`; moonshot has `'pending_approval'`. These are separate tables; no conflict, just note it.

9. **`App.tsx` is 86KB** — very large. Slices should add routes by adding a `<Route>` referencing a lazy-loaded page component. Don't add inline JSX to App.tsx.

10. **No string similarity library** — Slice 05 (natural language builder) needs fuzzy model matching. No `fuse.js` or similar is in `package.json`. Either add it or implement matching in the Edge Function using `pg_trgm` (which is available — see migration 278).

---

## 10. Recommendations for Downstream Slices

These are mandatory corrections to the slice specs based on what the repo actually contains.

### Global corrections (apply to all slices)

| Spec assumption | Actual repo | Correction |
|---|---|---|
| `BIGSERIAL` primary keys | `uuid default gen_random_uuid()` | Use UUID on all new tables |
| `workspace_id uuid references workspaces(id)` | `workspace_id text not null default 'default'` | Use TEXT, no FK |
| `auth_role()` helper | `public.get_my_role()` | Use existing helper |
| `'sales_rep'` role | `'rep'` | Use `'rep'` everywhere |
| `'sales_admin'`, `'finance_admin'` roles | Don't exist | Use `'admin'` |
| `auth.getUser()` (no args) | Silently 401s on Deno JSR | Use `requireServiceUser()` |
| `001_core_entities.sql` migration names | Next migration is `283_` | Name as `283_qb_*.sql` |
| Create `companies` table | `crm_companies` exists | Extend `crm_companies` additively |
| Create `contacts` table | `crm_contacts` exists | Reference `crm_contacts` in `qb_quotes` |

### Slice 01 — Schema Foundation

1. **Migration naming:** `283_qb_core_extensions.sql`, `284_qb_brands_catalog.sql`, `285_qb_programs.sql`, `286_qb_quotes_deals.sql`, `287_qb_price_sheets.sql`, `288_qb_audit.sql`, `289_qb_rls.sql`

2. **Don't create `companies` or `contacts`** — extend `crm_companies` and reference `crm_contacts`.

3. **Add to `crm_companies`** (additive only, never drop existing columns):
   ```sql
   alter table public.crm_companies
     add column if not exists classification text check (classification in ('standard','gmu','forestry','construction','land_clearing','rental','logging','other')),
     add column if not exists territory_code text,
     add column if not exists county text,
     add column if not exists status text default 'active' check (status in ('active','inactive','prospect','archived')),
     add column if not exists notes text;
   -- assigned_rep_id already exists — do NOT add it again
   -- legal_name, dba, phone, website — check if present before adding
   ```

4. **New table prefix:** Use `qb_` prefix on all new moonshot tables to avoid colliding with `crm_`, `qrm_`, or unprefixed legacy tables. Example: `qb_brands`, `qb_equipment_models`, `qb_programs`, `qb_quotes`, `qb_deals`, `qb_commissions`, `qb_trade_ins`, `qb_price_sheets`.

5. **Quote number sequence:** The spec's `generate_quote_number()` function is fine. Name the sequence `qb_quote_number_seq`.

6. **`qb_quotes.salesman_id`** — references `auth.users(id)`, not `profiles(id)`. Profiles uses the same UUID as auth.users but the FK target should be `auth.users(id)` for consistency with existing CRM tables.

7. **`qb_deals.status`** — don't use `'open'`; existing `qrm_deals` uses stage-based status. Use `'active'` instead to avoid confusion.

8. **Service role policy** — add to every new table:
   ```sql
   create policy "qb_<table>_service" on public.qb_<table> for all
     using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
   ```

9. **`set_updated_at()` trigger** — already exists (`migration 001`). Attach it to every new table:
   ```sql
   create trigger set_qb_brands_updated_at before update on public.qb_brands
     for each row execute function public.set_updated_at();
   ```
   Do not create a new version of this function.

10. **`log_audit()` trigger** — the spec defines this in the migration. The generic `execute format('insert into %I (%s_id, ...)` approach works but test carefully — if the `_audit` table name doesn't match `tg_table_name || '_audit'`, it will error silently. Run the test suite (insert → update → delete → verify 3 audit rows) before shipping.

11. **TypeScript types** — after all migrations run: `supabase gen types typescript --project-id <id> > apps/web/src/lib/database.types.ts`. Commit the result. The file is 680KB currently — it will grow.

### Slice 02 — Pricing Engine Core

1. **Module location:** `apps/web/src/lib/pricing/` — new directory. Main files: `calculator.ts`, `types.ts`, `__tests__/calculator.test.ts`.

2. **All monetary inputs and outputs in cents (bigint/number)** — never floats in the engine. `list_price_cents: number` not `list_price: number`. Use `Math.round()` at every division boundary.

3. **Edge Function:** New function `supabase/functions/qb-calculate/index.ts` — use `requireServiceUser()` for auth, return typed JSON.

4. **`pg_trgm`** is available (migration 278 moved it to extensions schema) — use for model fuzzy matching in the Edge Function if needed.

### Slice 03 — Program Engine

1. The `qb_programs` table (created in Slice 01) is the source of truth. Do not read from `manufacturer_incentives` for new quote logic.
2. The stacking rules are in `qb_program_stacking_rules`. The engine should be a pure TypeScript function that takes a list of applied program IDs and returns `{ valid: boolean, conflicts: string[] }`.
3. Rebate deadline: `warranty_registration_date + 45 days` — store on `qb_deals.rebate_filing_due_date` and alert Angela via the existing notification pattern (morning-briefing function or owner_briefs_cache).

### Slice 04 — Price Sheet Ingestion

1. Use Anthropic Claude for PDF/Excel extraction (not OpenAI). Prompt pattern: provide raw extracted text + schema definition → ask Claude to return structured JSON matching the `qb_price_sheet_items` schema.
2. `@dnd-kit/sortable` is already in deps — use for the review UI drag-to-reorder.
3. `papaparse` is already in deps — use for CSV parsing fallback.
4. File storage: Supabase Storage. Bucket name TBD — check existing buckets before creating a new one.

### Slice 05 — Natural Language Quote Builder

1. NL entry calls a new Edge Function `qb-parse-request` that uses Anthropic Claude with tool use to resolve make/model → `qb_equipment_models.id`, then calls `qb-calculate` for pricing.
2. Model fuzzy matching: use `pg_trgm` trigram similarity against `qb_equipment_models.name_display` — `select *, similarity(name_display, $1) as score from qb_equipment_models order by score desc limit 5`. No need to add a JS library.
3. Voice input: wire `VoiceRecorder` (already in `voice-qrm/components/VoiceRecorder.tsx`) → `iron-transcribe` Edge Function (OpenAI Whisper) → text → NL parser. The VoiceRecorder component is already imported in `QuoteBuilderV2Page.tsx`.

### Slice 06 — PDF + Approval

1. `@react-pdf/renderer` is already installed and `QuotePDFDocument.tsx` exists — extend this rather than rebuilding it. Check the existing component for what data shape it expects.
2. Approval notification: use `sendResendEmail()` from `_shared/resend-email.ts`. Send to the user whose `profiles.role = 'manager'` or `'owner'` in the same workspace.
3. Quote versioning: `qb_quotes.version int` + `qb_quotes.parent_quote_id uuid` — the pattern is already in the spec and is correct.

### Slice 07 — Deal Lifecycle + Commission

1. `qb_deals` is a new table (not `qrm_deals`). The QRM deal pipeline is a separate system — don't merge them.
2. Commission: `gross_margin_cents * 0.15` — store on `qb_deals.commission_cents`. Calculated at deal close, not before.
3. `trade_valuations` table already exists for trade-in valuation history. `qb_trade_ins` records the trade-in as applied to a specific deal.

### Slice 08 — AI Insight Layer

1. Similar past deals: embed `qb_quotes` content at save time using `embedText()` from `_shared/openai-embeddings.ts`. Store in a `qb_quote_embeddings` table with `embedding extensions.vector(1536)`. Query with cosine similarity, same pattern as `search_chunks()`.
2. Morning brief: post insight cards to `owner_briefs_cache` table (see migration 274) — this is how the existing morning brief system ingests new signal types.
3. Rebate deadline alerts: query `qb_deals where rebate_filing_due_date <= now() + interval '7 days' and rebate_filed_at is null` — surface in morning brief + dedicated alerts table.

---

## 11. Open Questions (Resolve Before Slice 01 Starts)

1. **Supabase project ID** — needed for `supabase gen types typescript --project-id <id>` in Slice 01 step 8. Find it in the Supabase dashboard or from `supabase/config.toml`.

2. **Existing `crm_companies` columns** — before adding columns in Slice 01, run `select column_name from information_schema.columns where table_name = 'crm_companies'` against staging to confirm which columns already exist. `legal_name`, `dba`, `phone`, `website` may already be there.

3. **ASV/Yanmar freight zones beyond FL** — Slice 01 seeds only the FL freight zone. Get the full freight table from Rylee or Angela before running Slice 02 (otherwise pricing will be incomplete for non-FL customers).

4. **Barko/Prinoth/forestry brand dealer discounts** — seeded as `0.0000` in the spec because Rylee didn't provide the numbers. Angela or Rylee must fill these in via the admin UI (Slice 04) before forestry quotes are accurate.

5. **Supabase Storage bucket name** for price sheet uploads — confirm existing bucket names before Slice 04 creates one. `select name from storage.buckets` against staging.

---

*Brief complete. All downstream slices should read §10 before writing any code. When in doubt, grep the repo — reality beats the spec.*
