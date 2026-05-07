## Final Prompt
<taskname="QRM Moonshot Uplift"/>
<task>Orchestrate an end-to-end hardening and moonshot-quality uplift for the QRM Companies and Contacts experiences (matching the qualityequipmentparts.netlify.app screenshots), ensuring both pages are fully wired across frontend + router + backend contracts, preserve role-gated behavior, and feel world-class for Quality Equipment Parts operators.</task>

<architecture>
- `App.tsx` (selected slices) defines lazy-loading, `WithGraphExplorer` wrapper usage, role gates, and canonical routing for `/qrm/contacts`, `/qrm/companies`, and `/admin/duplicates`.
- Surface switching is controlled by `shell_v2`:
  - `withGraphExplorer.tsx` swaps legacy list pages with `GraphExplorer`.
  - `QrmSubNav.tsx` swaps legacy subnav with `QrmShellV2` when flag is enabled.
  - `shellMap.ts` defines surface/lens mapping contract.
- Core pages:
  - `QrmCompaniesPage.tsx` (infinite list, extended IntelliDealer search toggle, health chips, CSV export, create-company sheet).
  - `QrmContactsPage.tsx` (infinite list, duplicate-candidate banner, scoped treeRoot filter, health chips, CSV export, create-contact sheet).
  - `QrmDuplicatesPage.tsx` (contact duplicate review + company duplicate scan + merge dialogs).
- Shared UI system:
  - `QrmPageHeader.tsx`, `command-deck.tsx`, `QrmShellV2.tsx`, `GraphExplorer.tsx` define the operator-deck visual language.
- Data layer:
  - `qrm-api.ts` (Supabase RPC/table reads for contacts/companies and list cursors).
  - `qrm-router-api.ts` (edge-function writes/search/duplicates/merges).
  - `types.ts`, `qrm-supabase.ts` define contracts.
- Backend edge routing:
  - `supabase/functions/qrm-router/index.ts` aliases to `crm-router/index.ts`.
  - `crm-router/index.ts` handles `/qrm/search`, `/qrm/contacts`, `/qrm/companies`, `/qrm/duplicates`, `/qrm/merges`, with role/validation/error mapping.
  - `_shared/crm-router-service.ts`, `_shared/crm-router-http.ts`, `_shared/dge-auth.ts` provide auth/context and service logic.
</architecture>

<selected_context>
apps/web/src/App.tsx (slices 460-760, 1980-2739): QRM lazy imports, route wiring, role gating, `WithGraphExplorer` composition for contacts/companies/deals, duplicates redirects.
apps/web/src/features/qrm/pages/QrmCompaniesPage.tsx: Primary Companies list UX, extended search toggle, health score joins, export/new actions.
apps/web/src/features/qrm/pages/QrmContactsPage.tsx: Primary Contacts list UX, duplicate candidate signal + CTA, treeRoot scoping, health score joins.
apps/web/src/features/qrm/pages/QrmDuplicatesPage.tsx: Contact merge workflow and duplicate-company merge flow.
apps/web/src/features/qrm/components/GraphExplorer.tsx: Shell-v2 graph search UI and navigation behavior.
apps/web/src/features/qrm/shell/withGraphExplorer.tsx: Feature-flag swap between graph surface and legacy fallback pages.
apps/web/src/features/qrm/components/QrmPageHeader.tsx: Header/metric/briefing/data-source badge composition used by both pages.
apps/web/src/features/qrm/components/command-deck.tsx: Shared deck primitives (StatusDot, SignalChip, MetricStrip, IronBar, DeckSurface).
apps/web/src/features/qrm/components/QrmCompanyEditorSheet.tsx: Company create/edit/archive flow and query invalidations.
apps/web/src/features/qrm/components/QrmContactEditorSheet.tsx: Contact create/edit/archive flow and company picker dependencies.
apps/web/src/features/qrm/components/CompanyMergeDialog.tsx: Company merge/undo UI and RPC usage.
apps/web/src/features/qrm/lib/qrm-api.ts: Contact/company list RPC integration and normalization.
apps/web/src/features/qrm/lib/qrm-router-api.ts: Router HTTP client for search, company/contact CRUD, duplicates and merges.
apps/web/src/features/qrm/lib/types.ts: Shared contracts for companies, contacts, duplicates, search entities.
supabase/functions/crm-router/index.ts: Backend route dispatch + validation/error behavior for companies/contacts/duplicates/merges/search.
supabase/functions/_shared/crm-router-service.ts: Service-level CRM operations referenced by router.
</selected_context>

<relationships>
- `/qrm/contacts` route -> `WithGraphExplorer(defaultLens="contact", fallback=<QrmContactsPage/>)`.
- `/qrm/companies` route -> `WithGraphExplorer(defaultLens="company", fallback=<QrmCompaniesPage/>)`.
- `QrmContactsPage` -> `listCrmContacts` (`qrm-api.ts`) + `listDuplicateCandidates` (`qrm-router-api.ts`) + `QrmContactEditorSheet`.
- `QrmCompaniesPage` -> `listCrmCompanies` (`qrm-api.ts`) + `QrmCompanyEditorSheet` + `buildAccountCommandHref`.
- `QrmDuplicatesPage` -> `listDuplicateCandidates` / `dismissDuplicateCandidate` / `mergeDuplicateContacts` + `CompanyMergeDialog`.
- `qrm-router-api.ts` -> edge function endpoint `/functions/v1/qrm-router/...`.
- `qrm-router/index.ts` -> imports `crm-router/index.ts` (single backend source of truth).
- `crm-router/index.ts` -> `_shared` auth/context/service utilities; enforces elevated roles for merge/dismiss pathways.
</relationships>

<ambiguities>
- `shell_v2` default behavior is effectively ON in multiple call sites (`isFeatureEnabled(FLAGS.SHELL_V2, true)` in `QrmSubNav`), while `withGraphExplorer` checks flag without explicit default. Confirm intended default rollout behavior before changing fallback experiences.
- Contacts duplicate signaling appears on the Contacts page, but merge execution is routed through `/admin/duplicates` and role-gated there; clarify whether Contacts should expose in-place merge actions or remain redirect-only.
- Company merge depends on RPCs (`find_duplicate_companies`, `merge_companies`, `qrm_undo_company_merge`) not included in this selection as SQL migration files; backend DB-level behavior may require additional migration context if merge semantics are changed.
</ambiguities>

<work_items>
1. Route and runtime-path hardening: verify both shell-v2 and fallback modes for Contacts/Companies are production-correct (entry routes, redirects, role gates, duplicates path).
2. End-to-end data-flow hardening: validate/strengthen loading, empty/error, pagination, duplicate, and create/edit/archive flows from page UI through `qrm-api`/`qrm-router-api` into edge routes.
3. Moonshot UI uplift pass: raise visual hierarchy, density/scannability, and interaction polish for both pages using existing command-deck primitives without breaking current contracts.
4. Verification and quality gates: extend/adjust tests around key contracts (route behavior, API normalizers, duplicates/merge pathways, account-link and graph-route invariants).
</work_items>

<parallelization>
- Parallelizable:
  - Work item 1 (route/runtime hardening)
  - Work item 2 (data-flow hardening)
  - Work item 4 (tests/verification scaffolding)
- Sequential dependency:
  - Work item 3 (moonshot UI uplift) should finalize after route/data decisions from items 1-2 to avoid rework.
</parallelization>

## Selection
- Files: 45 total (34 full, 1 slice, 10 codemap)
- Total tokens: 102341 (Auto view)
- Token breakdown: full 84498, slice 10079, codemap 7764

### Files
### Selected Files
/Users/brianlewis/Projects/qep-knowledge-assistant/
├── apps/
│   └── web/
│       └── src/
│           ├── features/
│           │   ├── nervous-system/
│           │   │   └── components/
│           │   │       └── HealthScoreDrawer.tsx — 3,489 tokens (full)
│           │   └── qrm/
│           │       ├── components/
│           │       │   ├── CompanyMergeDialog.tsx — 3,235 tokens (full)
│           │       │   ├── GraphExplorer.tsx — 3,386 tokens (full)
│           │       │   ├── QrmCompanyEditorSheet.tsx — 5,565 tokens (full)
│           │       │   ├── QrmContactEditorSheet.tsx — 3,833 tokens (full)
│           │       │   ├── QrmPageHeader.tsx — 1,600 tokens (full)
│           │       │   ├── QrmSubNav.tsx — 1,166 tokens (full)
│           │       │   ├── askIronHandoff.ts — 569 tokens (full)
│           │       │   ├── command-deck.tsx — 3,109 tokens (full)
│           │       │   ├── graphExplorerHelpers.ts — 1,684 tokens (full)
│           │       │   └── graphExplorerRoutes.ts — 247 tokens (full)
│           │       ├── lib/
│           │       │   ├── account-command.ts — 476 tokens (full)
│           │       │   ├── account-links.test.ts — 390 tokens (full)
│           │       │   ├── account-links.ts — 517 tokens (full)
│           │       │   ├── qrm-api.test.ts — 1,344 tokens (full)
│           │       │   ├── qrm-api.ts — 7,155 tokens (full)
│           │       │   ├── qrm-router-api.test.ts — 526 tokens (full)
│           │       │   ├── qrm-router-api.ts — 6,538 tokens (full)
│           │       │   ├── qrm-supabase.ts — 2,040 tokens (full)
│           │       │   └── types.ts — 3,997 tokens (full)
│           │       ├── pages/
│           │       │   ├── QrmCompaniesPage.tsx — 3,794 tokens (full)
│           │       │   ├── QrmContactsPage.tsx — 4,619 tokens (full)
│           │       │   └── QrmDuplicatesPage.tsx — 3,263 tokens (full)
│           │       └── shell/
│           │           ├── QrmShellV2.tsx — 2,186 tokens (full)
│           │           ├── shellMap.ts — 2,190 tokens (full)
│           │           └── withGraphExplorer.tsx — 286 tokens (full)
│           ├── lib/
│           │   ├── csv-export.ts — 1,090 tokens (full)
│           │   ├── feature-flags.ts — 671 tokens (full)
│           │   └── uuid.ts — 75 tokens (full)
│           └── App.tsx — 10,079 tokens (lines 460-760 (QRM-related lazy imports and wrapper wiring (WithGraphExplorer, page lazy loads), plus LegacyCompanyCommandRedirect helper.), 1980-2739 (QRM route declarations with role gating and fallback behavior for /qrm/contacts, /qrm/companies, /qrm/deals, and /admin/duplicates wiring.))
└── supabase/
    └── functions/
        ├── _shared/
        │   ├── crm-router-http.ts — 597 tokens (full)
        │   ├── crm-router-service.ts — 4,114 tokens (full)
        │   └── dge-auth.ts — 2,550 tokens (full)
        ├── crm-router/
        │   └── index.ts — 8,001 tokens (full)
        └── qrm-router/
            └── index.ts — 196 tokens (full)

### Codemaps
/Users/brianlewis/Projects/qep-knowledge-assistant/
├── apps/
│   └── web/
│       └── src/
│           ├── components/
│           │   ├── AppLayout.tsx — 212 tokens (auto)
│           │   └── DataSourceBadge.tsx — 131 tokens (auto)
│           ├── features/
│           │   ├── nervous-system/
│           │   │   └── lib/
│           │   │       └── nervous-system-normalizers.ts — 1,492 tokens (auto)
│           │   ├── qrm/
│           │   │   └── lib/
│           │   │       ├── moves-types.ts — 290 tokens (auto)
│           │   │       └── signals-types.ts — 217 tokens (auto)
│           │   └── quote-builder/
│           │       └── lib/
│           │           └── __tests__/
│           │               └── outcomes-api.test.ts — 8 tokens (auto)
│           └── lib/
│               └── hubspot-admin-supabase.ts — 85 tokens (auto)
└── supabase/
    └── functions/
        ├── _shared/
        │   └── crm-router-data.ts — 4,614 tokens (auto)
        ├── crm-hubspot-import/
        │   └── run-state.ts — 194 tokens (auto)
        └── ingest/
            └── index.ts — 521 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `qrm-moonshot-uplift-1D2DB0` | **Mode**: plan

### Response
## 1. **Summary**

Harden and uplift QRM Companies and Contacts with a targeted end-to-end change: keep the dedicated Companies/Contacts pages as the primary operator experiences, move their list reads behind explicit QRM router contracts, preserve existing role gates, route merges through the router instead of direct page RPCs, and polish both pages using the existing command-deck visual system. This avoids a broad shell refactor while fixing the main blockers: inconsistent `shell_v2` route behavior, split direct-Supabase vs router contracts, duplicate-review links exposed to unauthorized users, and list UI/data gaps that prevent the pages from feeling production-grade.

---

## 2. **Current-state analysis**

### Routing and shell ownership

- `App.tsx` currently routes:
  - `/qrm/contacts` → `WithGraphExplorer(defaultLens="contact", fallback=<QrmContactsPage />)`
  - `/qrm/companies` → `WithGraphExplorer(defaultLens="company", fallback=<QrmCompaniesPage />)`
- `WithGraphExplorer` uses `isFeatureEnabled(FLAGS.SHELL_V2)` with default `false`.
- `QrmSubNav` uses `isFeatureEnabled(FLAGS.SHELL_V2, true)` with default `true`.
- Result: default runtime likely renders the dedicated pages with `QrmShellV2`, but explicit `shell_v2=1` replaces the dedicated pages with generic `GraphExplorer`. That blocks meaningful uplift of the Companies/Contacts pages for shell-v2 users.

### Frontend data flow today

#### Contacts

`QrmContactsPage`:

1. Reads URL search param `treeRoot`.
2. Validates it with `isUuid`.
3. Debounces search input.
4. Calls `listCrmContacts` from `qrm-api.ts`.
5. `qrm-api.ts` directly calls Supabase RPCs:
   - `list_crm_contacts_page`
   - `list_crm_contacts_for_company_subtree_page`
6. Page separately fetches health scores from `customer_profiles_extended`.
7. Page calls `listDuplicateCandidates` via `qrm-router-api.ts`.
8. Create/edit/archive flows use `QrmContactEditorSheet`, which writes through qrm-router:
   - `createCrmContactViaRouter`
   - `patchCrmContactViaRouter`

Blocking issues:
- Reads bypass router while writes use router.
- Duplicate banner can lead reps to `/qrm/duplicates` → `/admin/duplicates`, then role-gated redirect.
- List rows lack company name/reach richness despite available IDs.
- Duplicate query errors are swallowed but not role-aware.

#### Companies

`QrmCompaniesPage`:

1. Debounces search.
2. Calls `listCrmCompanies` from `qrm-api.ts`.
3. `qrm-api.ts` directly calls Supabase RPC `list_crm_companies_page`.
4. Page separately fetches health scores from `customer_profiles_extended`.
5. Create/edit/archive flows use `QrmCompanyEditorSheet`, which writes through qrm-router:
   - `createCrmCompanyViaRouter`
   - `patchCrmCompanyViaRouter`
6. Row click uses `buildAccountCommandHref(company.id)`.
7. `onSaved` still navigates to legacy `/crm/companies/:id`.

Blocking issues:
- Reads bypass router while writes use router.
- New company save route relies on legacy `/crm/*` redirect.
- Extended search toggle is functional but visually under-integrated.
- Error/loading states are serviceable but not screenshot-quality.

### Duplicate and merge flow today

- Contact duplicate review:
  - `QrmDuplicatesPage` uses qrm-router for list/dismiss/merge.
  - Backend enforces `requireElevated` for dismiss/merge.
- Company duplicate review:
  - `DuplicateCompaniesSection` directly calls `crmSupabase.rpc("find_duplicate_companies")`.
  - `CompanyMergeDialog` directly calls:
    - `merge_companies`
    - `qrm_undo_company_merge`
  - Role gate is currently only the page-level `/admin/duplicates` gate.

Blocking issue:
- Company merge is not fully wired through qrm-router/backend HTTP contracts.

### Backend router/auth flow

- `/functions/v1/qrm-router/...` imports `crm-router/index.ts`.
- `crm-router/index.ts` normalizes both `/crm` and `/qrm` route prefixes.
- Auth:
  - `resolveCallerContext` validates user tokens via GoTrue `/auth/v1/user`.
  - `requireCaller` allows `rep | admin | manager | owner`.
  - `requireElevated` allows `admin | manager | owner` plus bound service-role.
- Existing relevant router routes:
  - `GET /qrm/search`
  - `POST/PATCH /qrm/contacts`
  - `POST/PATCH /qrm/companies`
  - `GET/POST /qrm/duplicates/...`
  - `POST /qrm/merges`

Reusable extension points:
- Add router read endpoints in `crm-router/index.ts`.
- Add service/data helpers in `_shared/crm-router-data.ts` or `_shared/crm-router-service.ts`.
- Reuse existing RPCs for paginated list behavior instead of rewriting pagination SQL.
- Reuse `QrmPageHeader`, `IronBar`, `MetricStrip`, `SignalChip`, `DeckSurface`, and `QrmShellV2`.

---

## 3. **Design**

### A. Routing and shell behavior

#### Decision

Render `QrmContactsPage` and `QrmCompaniesPage` directly for their canonical routes, regardless of `shell_v2`.

Why: these pages are the dedicated Graph-lens experiences. `QrmShellV2` already renders inside them through `QrmSubNav`, so shell-v2 visual navigation is preserved without replacing the pages with generic search.

#### Changes

In `App.tsx`:

- `/qrm/contacts` should render `QrmContactsPage` directly.
- `/qrm/companies` should render `QrmCompaniesPage` directly.
- Keep `WithGraphExplorer` for routes not covered by this uplift, such as `/qrm/deals`, unless separately changed later.
- Keep role gates unchanged:
  - contacts/companies: `rep | admin | manager | owner`
  - duplicates: `admin | manager | owner`

Behavior after change:

| Route | Authorized roles | Rendered page |
|---|---:|---|
| `/qrm/contacts` | rep/admin/manager/owner | `QrmContactsPage` |
| `/qrm/companies` | rep/admin/manager/owner | `QrmCompaniesPage` |
| `/qrm/duplicates` | any initially | redirect to `/admin/duplicates` |
| `/admin/duplicates` | admin/manager/owner | `QrmDuplicatesPage` |

No persistence or schema changes.

---

### B. Router-backed list contracts for Contacts and Companies

#### Decision

Keep public frontend function names `listCrmContacts` and `listCrmCompanies`, but make them call qrm-router list endpoints internally. This preserves page call sites while establishing frontend → router → backend contracts.

#### New backend endpoints

Add to `crm-router/index.ts`:

```ts
GET /qrm/contacts
GET /qrm/companies
```

#### Contacts query contract

Request query params:

```ts
{
  search?: string;
  cursor?: string;
  tree_root_company_id?: string;
}
```

Response:

```ts
{
  items: QrmContactSummary[];
  nextCursor: string | null;
}
```

Contact list behavior:

- Requires `requireCaller(ctx)`.
- If `tree_root_company_id` is present:
  - Validate non-empty text.
  - Use existing subtree contact RPC path or existing subtree helper.
- Preserve existing cursor format:
  - Base64-encoded JSON.
  - Contact cursor shape:
    ```ts
    {
      lastName: string;
      firstName: string;
      id: string;
    }
    ```
- Malformed cursor returns:
  - status `400`
  - code `VALIDATION_ERROR`
  - message `"Invalid list cursor."`

Implementation approach:

- Reuse existing Supabase RPCs:
  - `list_crm_contacts_page`
  - `list_crm_contacts_for_company_subtree_page`
- Fetch `CONTACTS_PAGE_SIZE + 1`.
- Slice to visible page.
- Compute `nextCursor` from last visible row when an extra row exists.
- Hydrate optional display fields for the visible contact IDs:
  - `cell`
  - `direct_phone`
  - `sms_opt_in`
  - `primary_company_id`
  - `metadata`
- Batch fetch primary company names for visible `primary_company_id`s.
- Preserve ordering from the RPC result.

Add optional frontend type field:

```ts
interface QrmContactSummary {
  primaryCompanyName?: string | null;
}
```

#### Companies query contract

Request query params:

```ts
{
  search?: string;
  cursor?: string;
  include_extended_fields?: "1" | "0";
}
```

Response:

```ts
{
  items: QrmCompanySummary[];
  nextCursor: string | null;
}
```

Company list behavior:

- Requires `requireCaller(ctx)`.
- Uses existing RPC:
  - `list_crm_companies_page`
- Preserve existing cursor shape:
  ```ts
  {
    name: string;
    id: string;
  }
  ```
- `include_extended_fields` defaults to `false`.
- Malformed cursor returns `400 VALIDATION_ERROR`.

#### Frontend API changes

In `qrm-router-api.ts`, add:

```ts
listCrmContactsViaRouter(params): Promise<QrmPageResult<QrmContactSummary>>
listCrmCompaniesViaRouter(params): Promise<QrmPageResult<QrmCompanySummary>>
```

In `qrm-api.ts`:

- Keep existing exported names:
  - `listCrmContacts(search, cursor, options)`
  - `listCrmCompanies(search, cursor, options)`
- Delegate those functions to the router API.
- Keep existing row normalizers for:
  - direct detail reads
  - tests
  - fallback normalization
  - non-list functions

#### Concurrency

- Add optional `AbortSignal` support to router request options.
- Pass React Query’s `signal` from `useInfiniteQuery` query functions.
- If request aborts, let `fetch` reject naturally; React Query will ignore aborted stale work.
- Duplicate/out-of-order page results are handled by React Query query keys:
  - contacts key includes search and `treeRootCompanyId`
  - companies key includes search and `includeExtendedFields`

---

### C. Contacts page uplift

#### Data flow

`QrmContactsPage` after change:

```txt
search input/treeRoot
  → debounce
  → useInfiniteQuery
  → listCrmContacts(...)
  → qrm-router-api
  → GET /qrm/contacts
  → backend RPC + hydration
  → QrmPageResult<QrmContactSummary>
  → rows + metrics + CSV
```

#### Role-gated duplicate signaling

Add role awareness via `useAuth` or pass role from `App.tsx`.

Decision: only elevated roles should see duplicate-review banners and trigger duplicate queries.

```ts
canReviewDuplicates = role in ["admin", "manager", "owner"]
```

Behavior:

- Elevated users:
  - `duplicatesQuery.enabled = true`
  - show duplicate banner when count > 0
  - CTA points directly to `/admin/duplicates`
- Reps:
  - `duplicatesQuery.enabled = false`
  - no duplicate banner
  - no forbidden CTA

#### Tree-root scoped state

Enhance the existing treeRoot banner:

- If `treeRootCompanyId` is present:
  - Fetch company hierarchy via existing `fetchCompanyHierarchy(companyId)`.
  - Display company name when available.
  - CTA:
    - “Open account command” → `accountCommandUrl(treeRootCompanyId)`
    - “Clear filter” → `/qrm/contacts`

Failure behavior:

- If hierarchy fetch fails, keep current generic scoped banner.
- Do not block contact list rendering.

#### UI uplift details

Use existing primitives only.

- Header metrics:
  - `Loaded`
  - `Reachable` = contacts with email or phone/cell/direct phone
  - `Missing reach`
  - `Hot (≥80)`
  - `Cool (<40)`
  - `Duplicates` only for elevated users
- Iron briefing:
  - Elevated duplicate case: “N duplicate candidates detected…”
  - Tree scoped case: “Viewing contacts under {companyName}…”
  - Normal case: hot/new/reachability summary.
- Search rail:
  - Keep focused desktop behavior.
  - Add compact status text:
    - current search term
    - scoped company state
    - loaded count
  - Add retry button on error.
- Rows:
  - Show contact name, role/title, reach channel, optional company name, age, health.
  - If `smsOptIn` is true, show a small `SignalChip` label `SMS`.
  - Health chip button gets `aria-label="Open health score for {contact name}"`.
- CSV export:
  - Include `Company`, `Cell`, `Direct Phone`, and source IDs when present.

Edge cases:

- Empty tree scope: show “No contacts linked to this company tree…”
- Search with no results: show search-specific empty copy.
- Health fetch failure: render health as `—`; do not fail page.
- Duplicate query failure for elevated users: do not fail page; optionally show a muted “Duplicate scan unavailable” chip only in header.

---

### D. Companies page uplift

#### Data flow

```txt
search input/includeExtendedFields
  → debounce
  → useInfiniteQuery
  → listCrmCompanies(...)
  → qrm-router-api
  → GET /qrm/companies
  → backend RPC
  → QrmPageResult<QrmCompanySummary>
  → health profile query
  → rows + metrics + CSV
```

#### Navigation hardening

- Keep row click target as `buildAccountCommandHref(company.id)`.
- Change create-company `onSaved` navigation from legacy `/crm/companies/:id` to `buildAccountCommandHref(company.id)`.

#### UI uplift details

- Header metrics:
  - `Loaded`
  - `States`
  - `Tracked`
  - `Hot (≥80)`
  - `Watch (40–59)`
  - `Cool (<40)`
- Iron briefing:
  - If hot accounts exist, mention hot/cool counts and state spread.
  - If extended search is enabled, mention IntelliDealer-expanded search mode.
- Search/controls:
  - Integrate extended IntelliDealer toggle into a command-deck toolbar.
  - Show active-mode helper copy inside the toolbar instead of a loose paragraph.
  - Add retry button on list error.
- Rows:
  - Preserve dense list.
  - Add visible legacy customer badge when present.
  - Show terms/territory/pricing if available.
  - Health chip gets `aria-label="Open health score for {company.name}"`.
  - Add an explicit right-side “Command” affordance on wide screens while preserving whole-row link.
- CSV export:
  - Include:
    - `Search 1`
    - `Search 2`
    - `Status`
    - `Territory`
    - `Payment Terms`
    - `Pricing Level`
    - `Do Not Contact`
    - `Opt Out Sale PI`

Edge cases:

- Extended search on + empty result: explain that legacy fields were included.
- Health query error: render health as `—`.
- New company creation failure: keep sheet open and display router error.

---

### E. Editor sheet hardening

#### `QrmCompanyEditorSheet`

Add frontend validation before mutation:

- `name.trim()` must be non-empty.
- `pricingLevel`, if present, must be finite.
- EIN behavior stays unchanged:
  - only submit if `einCanBeSubmitted`.

Payload normalization:

- Send `name: name.trim()`.
- Keep existing null normalization.

Invalidate after save/archive:

- Existing:
  - `["crm", "companies"]`
  - `["crm", "company", savedCompany.id]`
  - `["account-360", savedCompany.id]`
  - `["account-command", savedCompany.id]`
- Add:
  - `["qrm", "graph-explorer"]`
  - `["crm", "companies", "health-profiles"]` if health linkage can change later

#### `QrmContactEditorSheet`

Add frontend validation:

- `firstName.trim()` and `lastName.trim()` must be non-empty.
- Email remains browser-validated by `type="email"`.

Payload normalization:

- Send trimmed names.
- Preserve existing optional fields.

Invalidate after save/archive:

- Existing:
  - `["crm", "contacts"]`
  - `["crm", "contact", savedContact.id]`
  - `["crm", "activities"]`
- Add:
  - `["qrm", "graph-explorer"]`
  - `["crm", "duplicates"]` because contact changes can affect duplicate candidates
  - selected company query when `primaryCompanyId` exists

---

### F. Duplicate and merge router hardening

#### Decision

Move company duplicate scan, merge, dry-run, and undo behind qrm-router API functions. Keep the existing DB RPCs as implementation details.

#### New frontend types

Add to `types.ts`:

```ts
interface QrmCompanyDuplicatePair {
  groupKey: string;
  companyAId: string;
  companyAName: string;
  companyBId: string;
  companyBName: string;
  similarityScore: number;
}

interface QrmCompanyMergeResult {
  ok: boolean;
  auditId: string;
  dryRun: boolean;
  totalRowsAffected: number;
  tableRowCounts: Record<string, number>;
  keptCompanyId: string;
  discardedCompanyId: string;
}
```

#### New `qrm-router-api.ts` functions

```ts
listDuplicateCompaniesViaRouter(threshold?: number): Promise<QrmCompanyDuplicatePair[]>

mergeCompaniesViaRouter(input: {
  keepId: string;
  discardId: string;
  dryRun: boolean;
  notes?: string | null;
}): Promise<QrmCompanyMergeResult>

undoCompanyMergeViaRouter(auditId: string): Promise<void>
```

#### Backend endpoints

Add to `crm-router/index.ts`:

```txt
GET  /qrm/company-duplicates?threshold=0.6
POST /qrm/company-merges
POST /qrm/company-merges/:auditId/undo
```

Auth:

- All require `requireCaller(ctx)` and `requireElevated(ctx)`.

Backend implementation:

- `GET /qrm/company-duplicates`
  - Clamp threshold to safe range, default `0.6`.
  - Calls `find_duplicate_companies`.
  - Normalizes snake_case DB rows to camelCase response.
- `POST /qrm/company-merges`
  - Body:
    ```ts
    {
      keepId: string;
      discardId: string;
      dryRun: boolean;
      notes?: string | null;
    }
    ```
  - Reject same IDs with `400 VALIDATION_ERROR`.
  - Calls existing `merge_companies`.
- `POST /qrm/company-merges/:auditId/undo`
  - Calls `qrm_undo_company_merge`.

`CompanyMergeDialog` then uses router functions only. `QrmDuplicatesPage` removes direct `crmSupabase` dependency for duplicate companies.

Failure behavior:

- Dry-run failure: keep dialog open, show destructive card.
- Real merge failure: keep dry-run preview and confirmation state.
- Undo failure: keep success state and show undo error.
- Query invalidations after merge/undo:
  - `["duplicate-companies"]`
  - `["crm", "companies"]`
  - `["account-360"]`
  - `["account-command"]`
  - `["qrm", "graph-explorer"]`

---

## 4. **File-by-file impact**

### `apps/web/src/App.tsx`

- Change `/qrm/contacts` to render `QrmContactsPage` directly.
- Change `/qrm/companies` to render `QrmCompaniesPage` directly.
- Keep role gates unchanged.
- Keep `/qrm/duplicates` redirect and `/admin/duplicates` role gate.
- Dependency: page components must continue rendering `QrmSubNav`.

### `apps/web/src/features/qrm/shell/withGraphExplorer.tsx`

- Update comments to clarify it is no longer the canonical wrapper for dedicated Contacts/Companies pages.
- No behavior change required unless keeping docs aligned.

### `apps/web/src/features/qrm/pages/QrmContactsPage.tsx`

- Add role-aware duplicate query enablement.
- Point duplicate CTA to `/admin/duplicates`.
- Pass React Query `signal` into list API if supported.
- Use optional `primaryCompanyName`, `cell`, `directPhone`, `smsOptIn` in rows and CSV.
- Improve header metrics, Iron briefing, empty/error states, and scoped treeRoot banner.
- Dependency: router-backed `listCrmContacts`.

### `apps/web/src/features/qrm/pages/QrmCompaniesPage.tsx`

- Pass React Query `signal` into list API if supported.
- Change `onSaved` navigation to `buildAccountCommandHref(company.id)`.
- Improve header metrics, search toolbar, extended search state, rows, CSV fields, error retry.
- Dependency: router-backed `listCrmCompanies`.

### `apps/web/src/features/qrm/pages/QrmDuplicatesPage.tsx`

- Remove direct `crmSupabase.rpc("find_duplicate_companies")`.
- Use `listDuplicateCompaniesViaRouter`.
- Keep page-level role gate in `App.tsx`.
- Dependency: new company duplicate router API.

### `apps/web/src/features/qrm/components/CompanyMergeDialog.tsx`

- Replace direct `crmSupabase.rpc("merge_companies")` and `qrm_undo_company_merge` calls with router API functions.
- Use shared `QrmCompanyMergeResult` type.
- Keep existing dry-run/confirm/undo UX.
- Dependency: new company merge router API.

### `apps/web/src/features/qrm/components/QrmCompanyEditorSheet.tsx`

- Trim/validate company name.
- Expand invalidations after save/archive.
- Keep EIN permissions behavior unchanged.

### `apps/web/src/features/qrm/components/QrmContactEditorSheet.tsx`

- Trim/validate first/last name.
- Expand invalidations after save/archive.
- Keep company picker behavior unchanged.

### `apps/web/src/features/qrm/lib/qrm-api.ts`

- Keep exported list function names.
- Delegate `listCrmContacts` and `listCrmCompanies` to qrm-router API list functions.
- Keep normalizers for direct detail reads/tests.
- Add optional normalization for `primaryCompanyName` if payload includes it.

### `apps/web/src/features/qrm/lib/qrm-router-api.ts`

- Add optional `signal` support to router request options.
- Add list functions for contacts/companies.
- Add company duplicate/merge/undo functions.
- Add response shape validation for new payloads.

### `apps/web/src/features/qrm/lib/types.ts`

- Add optional `primaryCompanyName?: string | null` to `QrmContactSummary`.
- Add company duplicate and company merge result interfaces.

### `apps/web/src/lib/csv-export.ts`

- Extend contact export input with optional company/cell/direct/source fields.
- Extend company export input with optional operational fields.
- Preserve existing filenames.

### `supabase/functions/crm-router/index.ts`

- Add dispatch for:
  - `GET /qrm/contacts`
  - `GET /qrm/companies`
  - `GET /qrm/company-duplicates`
  - `POST /qrm/company-merges`
  - `POST /qrm/company-merges/:auditId/undo`
- Add validation/error mapping for:
  - invalid cursor
  - invalid merge IDs
  - invalid threshold

### `supabase/functions/_shared/crm-router-service.ts` or `_shared/crm-router-data.ts`

- Add service/data helpers for:
  - paginated contact listing via existing RPCs
  - paginated company listing via existing RPC
  - company duplicate scan
  - company merge dry-run/commit
  - company merge undo
- Prefer `_shared/crm-router-data.ts` if it already owns table/RPC operations; otherwise use `_shared/crm-router-service.ts`.

### Tests

Update/add tests in:

- `apps/web/src/features/qrm/lib/qrm-router-api.test.ts`
  - validate new router payload parsing.
- `apps/web/src/features/qrm/lib/qrm-api.test.ts`
  - keep normalizer coverage.
  - add optional `primaryCompanyName` case if normalized there.
- Add `apps/web/src/features/qrm/shell/shellMap.test.ts`
  - `/qrm/contacts` resolves graph/contact.
  - `/qrm/companies` resolves graph/companies.
  - `/admin/duplicates` is not incorrectly treated as QRM shell route.
- Add component tests if existing test setup supports React Testing Library:
  - reps do not see duplicate banner.
  - elevated users see duplicate banner and CTA points to `/admin/duplicates`.

---

## 5. **Risks and migration**

- **Frontend now depends on new qrm-router list endpoints.** Deploy backend/router changes before or atomically with frontend changes.
- **Company duplicate merge moves from direct RPC to edge route.** DB RPC semantics remain unchanged, so rollback is clean: frontend can revert to direct RPC if needed.
- **Contacts/Companies no longer get replaced by generic `GraphExplorer` when `shell_v2=1`.** This is intentional; the dedicated pages become the world-class Graph-lens experiences while still rendering `QrmShellV2`.
- **No persistence schema migration is required** unless implementation discovers the existing list RPCs do not return enough fields and cannot be hydrated through table reads.

Unknown to validate during implementation:

- Whether `_shared/crm-router-data.ts` already contains reusable company/contact normalizers.
- Whether existing DB RPC return types include all fields needed for cursor generation.
- Whether tests run with Bun only or also Deno for Supabase functions.

---

## 6. **Implementation order**

1. **Backend list contracts**
   - Add contact/company list helpers.
   - Add `GET /qrm/contacts` and `GET /qrm/companies`.
   - Verify auth and malformed cursor behavior.

2. **Frontend router API list functions**
   - Add `listCrmContactsViaRouter` and `listCrmCompaniesViaRouter`.
   - Add optional abort signal support.
   - Delegate existing `qrm-api.ts` list functions to router-backed functions.

3. **Route hardening**
   - Update `App.tsx` so `/qrm/contacts` and `/qrm/companies` render dedicated pages directly.
   - Confirm `QrmSubNav` still controls shell-v2 vs legacy nav.

4. **Contacts page uplift**
   - Add role-aware duplicate query.
   - Improve metrics, scoped banner, rows, CSV, error/empty states.

5. **Companies page uplift**
   - Fix create navigation.
   - Improve metrics, toolbar, rows, CSV, error/empty states.

6. **Company duplicate router migration**
   - Add backend company duplicate/merge/undo endpoints.
   - Add frontend qrm-router API functions.
   - Update `QrmDuplicatesPage` and `CompanyMergeDialog`.

7. **Editor sheet hardening**
   - Add trim validation.
   - Expand query invalidations.

8. **Tests and verification**
   - Run unit tests for qrm API/router API helpers.
   - Add route/shell tests.
   - Add role-gated duplicate banner tests if component test harness exists.
   - Manually verify:
     - `/qrm/contacts` as rep and manager.
     - `/qrm/companies` as rep and manager.
     - `/admin/duplicates` as manager.
     - create contact/company.
     - archive validation.
     - CSV export.
     - health drawer open/close.
     - shell_v2 on/off behavior.


---

## Orchestrator Progress — 2026-05-07 16:35 ET

- [x] Design audit complete: `docs/designs/qrm-companies-contacts-moonshot-audit-2026-05-07.md`.
- [x] Wiring hardening agent complete: routes, router-backed list contracts, company duplicate/merge router migration, editor validation/invalidation, and focused tests reported passing.
- [x] UI moonshot implementation pass complete: applied design audit to Companies/Contacts pages and shared command-deck primitives; Oracle review fixes applied.

Additional verification by orchestrator:
- `bun test apps/web/src/features/qrm/lib/qrm-router-api.test.ts apps/web/src/features/qrm/lib/qrm-api.test.ts apps/web/src/features/qrm/pages/__tests__/qrm-route-contracts.test.ts` — passed (10)
- `deno test supabase/functions/_shared/crm-router-data.test.ts` — passed (10)
- `bun run --filter @qep/web typecheck && deno check supabase/functions/crm-router/index.ts` — exited 0
- `.omx/state/qrm-moonshot/ralph-progress.json` records reasoned visual verdict score 91/pass; screenshot capture still unavailable.

Verification reported by wiring agent:
- `bun test apps/web/src/features/qrm/lib/qrm-router-api.test.ts apps/web/src/features/qrm/lib/qrm-api.test.ts apps/web/src/features/qrm/pages/__tests__/qrm-route-contracts.test.ts` — passed (10)
- `bun run --filter @qep/web typecheck` — passed
- `deno check supabase/functions/crm-router/index.ts` — passed
- `deno test supabase/functions/_shared/crm-router-data.test.ts supabase/functions/_shared/crm-router-http.test.ts` — passed (13)

> 💡 Continue this plan conversation with ask_oracle(chat_id: "qrm-moonshot-uplift-1D2DB0", new_chat: false)