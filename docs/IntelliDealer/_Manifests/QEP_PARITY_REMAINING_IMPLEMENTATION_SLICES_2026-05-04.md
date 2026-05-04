# QEP Parity Remaining Implementation Slices

Date: 2026-05-04  
Source artifact: `docs/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx`  
Desktop source copy: `/Users/brianlewis/Desktop/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx`  
Rules manifest: `docs/IntelliDealer/_Manifests/QEP_PARITY_WORKSHEET_CLOSEOUT_RULES_2026-05-04.md`

## Extraction Basis

This roadmap is generated from the workbook's current `PARTIAL` and `GAP` rows only. It does not re-audit completed rows and does not promote any row without source-controlled implementation, provider, manual, or decommission evidence.

Domain review agents validated the initial extraction on 2026-05-04. Result: every workbook `PARTIAL` / `GAP` row from `Field Parity Matrix`, `Action & Button Parity`, `Gap Register`, and `Tab Structure Parity` was represented with no extras.

Slice 0 was then applied: VitalEdge/IntelliDealer and HubSpot were moved from `PARTIAL` to `N_A` / replaced based on existing source-controlled decommission evidence. Slice 7 was then implemented and verified: Quick Add On Order Unit moved from `GAP` to `BUILT`. Current open implementation/manual residuals are now 15 rows.

Current extracted residuals:

| Workbook sheet | GAP | PARTIAL |
| --- | ---: | ---: |
| Field Parity Matrix | 1 | 3 |
| Action & Button Parity | 4 | 5 |
| Gap Register | 0 | 2 |
| Tab Structure Parity | 0 | 0 |

## Source Rows Still Open

### Field Parity Matrix

| Status | Phase | Screen | Field | Current evidence note |
| --- | --- | --- | --- | --- |
| GAP | Phase-1_CRM | Prospect Board | JDQuote is selected in this | Prospect Board exists, but JD Quote II upload remains deferred/missing pending JD scope, credentials, payload contract, and owner. |
| PARTIAL | Phase-2_Sales-Intelligence | Equipment Invoicing (Sales Support Portal) | VESign | Native signing/schema compatibility exists, but VitalEdge/VESign provider adapter, webhook, poller, and live status integration are deferred. |
| PARTIAL | Phase-2_Sales-Intelligence | Equipment Quoting | VESign | Native signing/schema compatibility exists, but VitalEdge/VESign provider adapter, webhook, poller, and live status integration are deferred. |
| PARTIAL | Phase-6_Rental | Rental Counter | Stock Number / reverse-highlight VESign status | Native signing/schema compatibility exists, but VitalEdge/VESign provider adapter, webhook, poller, and live status integration are deferred. |

### Action & Button Parity

| Status | Phase | Screen | Action / Button | Current evidence note |
| --- | --- | --- | --- | --- |
| GAP | Phase-1_CRM | Prospect Board | John Deere Quote Upload | JD Quote II/JD PO workflows are deferred pending JD-affiliated scope, credentials, payload contract, and owner. |
| PARTIAL | Phase-2_Sales-Intelligence | Base & Options | Bobcat Base and Options Import | Schema/foundation exists, but OEM-specific parser/UI/credential path is deferred. |
| PARTIAL | Phase-2_Sales-Intelligence | Base & Options | Vermeer Base and Options Import | Schema/foundation exists, but OEM-specific parser/UI/credential path is deferred. |
| GAP | Phase-2_Sales-Intelligence | Equipment Invoicing (Sales Support Portal) | Access JD POs | JD Quote II/JD PO workflows are deferred pending JD-affiliated scope, credentials, payload contract, and owner. |
| GAP | Phase-2_Sales-Intelligence | Equipment Invoicing (Sales Support Portal) | JD Proactive Jobs | JD Quote II/JD PO workflows are deferred pending JD-affiliated scope, credentials, payload contract, and owner. |
| GAP | Phase-2_Sales-Intelligence | Equipment Invoicing (Sales Support Portal) | Reverse the sales of a stock number | No specific evidence found for reversing an equipment sale by stock number. GL/rental reversal support does not prove this action. |
| PARTIAL | Phase-2_Sales-Intelligence | Equipment Invoicing (Sales Support Portal) | Tethr It Now | Generic telematics storage/ingest exists, but Tethr credentials, adapter/webhook, mapping workflow, and UI action are not live. |
| PARTIAL | Phase-3_Parts | Parts Invoicing | Tethr It Now | Generic telematics storage/ingest exists, but Tethr credentials, adapter/webhook, mapping workflow, and UI action are not live. |
| PARTIAL | Phase-9_Advanced-Intelligence | Customer Portal | Tethr It Now | Generic telematics storage/ingest exists, but Tethr credentials, adapter/webhook, mapping workflow, and UI action are not live. |

### Gap Register

| Status | Priority | Phase | Gap | Current evidence note |
| --- | --- | --- | --- | --- |
| PARTIAL | P1-HIGH | Phase-4_Service | Service Mobile Web UI not production-validated for technicians | Mobile technician UI shipped at `/m/service` with tests, but in-field technician UAT remains manual acceptance and cannot be proven from repo alone. |
| PARTIAL | P3-LOW | Phase-5_Deal-Genome | IronGuides vendor contract pending | IronGuides remains an external contract/data-feed dependency; QEP can operate without it, but live market-intelligence feed is not proven. |

## Implementation / Closure Slices

### Slice 0 — Workbook Status Closeout for Already-Decommissioned Dependencies

Status: complete 2026-05-04.

Goal: close workbook rows that already have source-controlled replacement/decommission evidence, without marking them `BUILT`.

Workbook rows covered:

- Gap Register: VitalEdge/IntelliDealer API access not granted
- Gap Register: HubSpot API key not provided

Correct status target:

- `N_A` / replaced, not `BUILT`

Evidence to cite:

- `docs/IntelliDealer/_Manifests/QEP-Decommissioned-Integrations-Decision-20260422.md`
- `docs/IntelliDealer/_Manifests/PARITY_BUILD_LOG.md`
- `docs/IntelliDealer/_Manifests/QEP-Blocked-Backlog-Readiness-Audit-20260422.md`
- Runtime/migration evidence that `integration_status` marks `hubspot` and `intellidealer` as `demo_mode`, `lifecycle = replaced`, and `external_dependency_required = false`

Done:

- Workbook `Gap Register` rows for VitalEdge/IntelliDealer and HubSpot moved from `PARTIAL` to `N_A` / replaced with explicit evidence notes.
- Desktop and repo workbook copies were synchronized after the update.
- Workbook verification is recorded in the implementation session.

### Slice 1 — JD Provider Readiness and Scope Decision

Status: decision packet queued 2026-05-04; workbook rows remain `GAP` until live JD proof or replacement/de-scope evidence exists.

Decision packet:

- `docs/IntelliDealer/_Manifests/QEP_JD_PROVIDER_DECISION_PACKET_2026-05-04.md`

Goal: decide whether JD Quote II / JD PO / JD Proactive Jobs are live integration requirements for this QEP deployment before adding schema or adapters.

Workbook rows governed:

- Field Parity Matrix: Prospect Board / `JDQuote is selected in this`
- Action & Button Parity: John Deere Quote Upload
- Action & Button Parity: Access JD POs
- Action & Button Parity: JD Proactive Jobs

Decisions required:

- Confirm JD-affiliated dealer scope.
- Confirm JD Quote II license/API/SSO/XML/PDF contract.
- Confirm authorization-switch equivalent for `Access JD POs`.
- Decide whether JD Proactive Jobs is live integration, deep link, credential-vault launch, or non-requirement.

Done when:

- Each JD row has either implementation prerequisites and owner recorded or a formal source-controlled non-requirement/replacement decision.
- No row is promoted from `GAP` using generic purchase orders, IntegrationHub registry, or mock evidence.

Primary blockers:

- JD license/scope
- JD Quote II payload/API/SSO contract
- Sandbox fixtures
- Authorization model for JD Quote II links
- Business decision on JD Proactive Jobs

### Slice 2 — JD Quote II Prospect Upload

Goal: implement the Prospect Board `John Deere Quote Upload` workflow if Slice 1 confirms it is required.

Likely repo areas:

- New `supabase/migrations/*_prospect_jdquote_upload_runs.sql`
- New `supabase/functions/jd-quote-ii/*` or shared OEM adapter
- New `apps/web/src/features/qrm/lib/jd-quote-ii-api.ts`
- Prospect/QRM UI action component for `John Deere Quote Upload`
- `supabase/migrations/400_qrm_prospects.sql`

Done when:

- Upload run ledger exists with workspace/user/RLS boundaries.
- UI action can create/upload/track a JD Quote II quote package.
- Status, error, retry, and response payload fields are persisted.
- Fixture-backed tests prove parser/adapter behavior.
- Workbook rows remain `GAP` until this proof exists or Slice 1 de-scopes the workflow.

### Slice 3 — JD Accepted Quotes / Access JD POs

Goal: implement `Access JD POs` as accepted JD Quote II quote/PO intake, not generic vendor purchase orders.

Likely repo areas:

- New accepted-quote/PO intake schema, e.g. `jd_quote_ii_acceptances`
- Equipment Invoicing / Sales Support Portal equivalent UI surface
- Links to prospect, quote, equipment invoice, deal, or stock number as appropriate
- JD adapter/readiness shared with Slice 2

Done when:

- Accepted JD Quote II POs can be listed/opened from Equipment Invoicing.
- Records are auditable and can reconcile to equipment invoice/deal/stock number.
- Authorization/license gating controls visibility.
- Tests prove that generic parts/vendor POs are not being used as false evidence.

### Slice 4 — JD Proactive Jobs

Goal: implement or formally de-scope the separate `JD Proactive Jobs` action.

Likely repo areas:

- `apps/web/src/components/IntegrationHub.tsx`
- OEM credential/config vault or integration status surfaces
- Equipment Invoicing / service-equipment action area
- New launch/deep-link/API adapter if live

Done when:

- JD Proactive Jobs has its own no-config/configured/error/launched states and audit trail, or a formal source-controlled non-requirement decision exists.
- It is not collapsed into JD Quote II upload evidence.

### Slice 5 — OEM Base & Options Imports

Status: decision packet queued 2026-05-04; workbook rows remain `PARTIAL` until OEM fixture/API-backed import proof or replacement/de-scope evidence exists.

Decision packet:

- `docs/IntelliDealer/_Manifests/QEP_OEM_BASE_OPTIONS_IMPORT_DECISION_PACKET_2026-05-04.md`

Goal: finish Bobcat and Vermeer Base & Options imports on top of canonical IntelliDealer base/options tables.

Workbook rows covered:

- Action & Button Parity: Bobcat Base and Options Import
- Action & Button Parity: Vermeer Base and Options Import

Important correction:

- Current `BaseOptionsPage` is an admin surface but currently reads/writes quote-builder catalog tables (`qb_equipment_models` / `qb_attachments`), not the canonical IntelliDealer tables `equipment_base_codes`, `equipment_options`, and `equipment_base_codes_import_runs`. Implementation must reconcile this.

Likely repo areas:

- `apps/web/src/features/admin/pages/BaseOptionsPage.tsx`
- New `apps/web/src/features/admin/lib/oem-base-options-import-api.ts`
- New `apps/web/src/features/admin/lib/oem-base-options-parsers.ts`
- Parser tests with Bobcat and Vermeer fixtures
- `supabase/migrations/405_equipment_base_codes.sql`
- `supabase/migrations/406_equipment_options.sql`
- `supabase/migrations/407_equipment_selected_options.sql`
- `supabase/migrations/474_qrm_equipment_wave2_columns.sql`
- `supabase/migrations/527_intellidealer_sales_base_options_non_must.sql`
- `apps/web/src/features/oem-portals` and/or storage upload path if import is file-based

Done when:

- Bobcat and Vermeer fixture-backed parsers or provider adapters exist.
- Import runs write inserted/updated/skipped/error counts.
- Admin UI exposes import action/history/status.
- Imports write canonical base/options tables or an explicit bridge exists from quote-builder catalog to canonical tables.
- Re-runs are idempotent and test-covered.

Primary blockers:

- Bobcat and Vermeer source file/API formats
- Sample price books or contract fixtures
- File upload vs API pull decision
- Canonical table vs quote-builder catalog reconciliation decision

### Slice 6 — Equipment Sale / Rental Invoice Reversal by Stock Number

Status: foundation started and finance-policy packet queued 2026-05-04; workbook row remains GAP until the atomic reversal RPC/edge/UI flow is implemented and verified.

Decision packet:

- `docs/IntelliDealer/_Manifests/QEP_EQUIPMENT_REVERSAL_FINANCE_POLICY_PACKET_2026-05-04.md`

Foundation landed:

- Migration `536_equipment_invoice_reversal_foundation.sql` adds direct `customer_invoices.qrm_equipment_id` linkage, customer invoice reversal-chain columns, `reversed` status support, equipment invoice view stock-number evidence, and a read-only `find_equipment_invoice_reversal_candidate(stock_number)` guard.
- Migration `537_equipment_invoice_reversal_candidate_partial_guard.sql` tightens the guard so `partial` invoice status is blocked until partially paid reversal policy is approved.
- `apps/web/src/lib/database.types.ts` includes the Slice 6 invoice/view/RPC type contract so future typed Supabase access does not rely on stale schema evidence.
- QRM router exposes the read-only guard at `GET /qrm/equipment/reversal-candidate?stock_number=...` for elevated callers, with a frontend wrapper `fetchEquipmentInvoiceReversalCandidate`.
- The candidate guard blocks missing direct invoice linkage, partial/paid/void/reversed invoice status, QuickBooks-posted invoices, missing/hard-closed GL periods, and equipment not marked sold.

Goal: implement the finance-sensitive reversal workflow without assuming existing GL/rental scaffolding proves this IntelliDealer action.

Workbook row covered:

- Action & Button Parity: Reverse the sales of a stock number

Important corrections:

- The OCR action can reverse the sale of a stock number or reverse a rental invoice.
- `equipment_invoices` is currently a view over `customer_invoices`; its `equipment_id` is a placeholder in current evidence, so direct stock-number to invoice linkage must be defined before implementation.
- `customer_invoices` has `status = void` but lacks a clear reversal-chain equivalent. Rental invoice foundations have more reversal fields.

Likely repo areas:

- `supabase/migrations/471_equipment_invoice_view.sql`
- `supabase/migrations/082_customer_portal.sql`
- `supabase/migrations/442_gl_journal_entries.sql`
- `supabase/migrations/522_rental_intellidealer_financial_foundation.sql`
- `supabase/functions/crm-router/index.ts`
- `supabase/functions/_shared/crm-router-data.ts`
- `apps/web/src/features/qrm/lib/qrm-router-api.ts`
- New privileged RPC/edge function for atomic reversal

Done when:

- Stock number resolves auditable path: stock number → equipment → sale invoice or rental invoice.
- Reversal chain/credit memo linkage exists; implementation does not only set `status = void`.
- GL reversal behavior respects open/closed period rules.
- Equipment availability/status updates atomically with invoice reversal.
- Idempotency and concurrency are protected.
- RLS/authorization is finance-safe.

Primary blockers:

- Finance policy for paid/posted/closed-period invoices
- Credit memo / reversal journal requirements
- Tax treatment
- Rental invoice branch behavior
- Invoice-to-GL-company mapping for company-scoped `gl_periods` before mutation execution

Resolved foundation blocker:

- Direct invoice-equipment linkage model now exists via `customer_invoices.qrm_equipment_id`, `equipment_invoices.equipment_id`, and `equipment_invoices.stock_number`.

### Slice 7 — Quick Add On Order Unit

Status: complete 2026-05-04.

Goal: implement the Sales Support Portal / Equipment Listing quick-add action for on-order units.

Workbook row covered:

- Action & Button Parity: Quick Add On Order Unit

Important corrections:

- Existing generic equipment/catalog import is not enough.
- Existing operational form/API appears to require fields not suited to floating on-order inventory.
- Frontend QRM types/options must support `availability = 'on_order'` if DB already does.

Likely repo areas:

- `supabase/migrations/474_qrm_equipment_wave2_columns.sql`
- `apps/web/src/features/qrm/components/QrmEquipmentFormSheet.tsx`
- `apps/web/src/features/qrm/lib/types.ts`
- `apps/web/src/features/qrm/lib/qrm-router-api.ts`
- `supabase/functions/_shared/crm-router-data.ts`
- `apps/web/src/features/qrm/pages/InventoryPressureBoardPage.tsx`
- `apps/web/src/App.tsx`

Done when:

- Dedicated quick-add form/sheet exists for Add On Order Unit.
- API/server mapping supports `stock_number` and `availability = 'on_order'`.
- Equipment listing can filter/locate on-order units.
- Business rule decides whether on-order units require customer/company/deal association or may be floating dealer inventory.
- Delete Quick Add Unit behavior is soft-delete/audited or otherwise safely constrained.

Done:

- `/qrm/inventory-pressure` exposes a Quick Add On Order Unit action and sheet.
- `QrmEquipmentFormSheet` supports `mode="on_order"`, defaults new/owned/on-order values, and requires `stockNumber` for this action.
- `qrm-router` exposes `POST /qrm/equipment/quick-add-on-order`, persists `stock_number`, forces `availability = 'on_order'`, and creates floating dealer inventory under the `QEP On-Order Inventory` company when no company is provided.
- Equipment detail shows Stock Number and exposes a constrained archive action for on-order quick-add cleanup; the server soft-deletes only records tagged `qep_quick_add_kind = on_order_unit` and writes archive metadata.
- Verified with `bunx tsc --noEmit --pretty false`, `deno check supabase/functions/crm-router/index.ts`, `bun test apps/web/src/features/qrm/lib/inventory-pressure.test.ts`, and `bun run build`.

Closed assumptions:

- On-order units may be floating dealer inventory when no customer/company/deal association exists.
- Quick-add cleanup uses constrained soft archive rather than hard delete.

### Slice 8 — VESign Provider Integration

Status: decision packet queued 2026-05-04; workbook rows remain `PARTIAL` until live VESign proof or native-signing replacement/de-scope evidence exists.

Decision packet:

- `docs/IntelliDealer/_Manifests/QEP_VESIGN_PROVIDER_DECISION_PACKET_2026-05-04.md`

Goal: move existing native signature compatibility to a real VESign/VitalEdge provider workflow, or formally de-scope it.

Workbook rows covered:

- Field Parity Matrix: Equipment Invoicing / VESign
- Field Parity Matrix: Equipment Quoting / VESign
- Field Parity Matrix: Rental Counter / VESign status

Important corrections:

- Native signature modules, `quote_signatures`, `signed_terms_url`, provider registry rows, and IntegrationHub descriptions are foundation only. They are not `BUILT` provider evidence.
- Older YAML that treats these as `BUILT` from native signature evidence conflicts with the 2026-05-04 workbook closeout rules.

Implementation sequence:

1. Confirm VitalEdge/VESign contract, sandbox, sender identity, webhook secret, and status vocabulary.
2. Define provider persistence: provider envelope table/fields, invoice/quote/rental mappings, idempotent webhook status ledger.
3. Add adapter/function boundary:
   - likely new `supabase/functions/_shared/adapters/vesign.ts`
   - new `vesign-send`, `vesign-status`, and/or `vesign-webhook` functions
4. Wire UI/status surfaces:
   - Equipment Invoicing VESign badge/send/status
   - Equipment Quoting / Quote Builder status
   - Rental Counter contract signing status/timeline
5. Preserve native QEP signing fallback but label it clearly as not VESign.

Likely repo areas:

- `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx`
- `supabase/functions/quote-builder-v2/index.ts`
- `apps/web/src/features/portal/pages/PortalQuoteRoomPage.tsx`
- `apps/web/src/features/portal/components/PortalSignaturePad.tsx`
- `apps/web/src/features/portal/pages/PortalInvoiceDetailPage.tsx`
- `supabase/functions/rental-ops/index.ts`
- `supabase/migrations/477_customer_invoice_wave2_columns.sql`
- `supabase/migrations/371_quote_signatures_snapshot.sql`
- `supabase/migrations/235_rental_contracts_and_pricing.sql`
- New VESign adapter/webhook/poller modules

Primary blockers:

- VitalEdge/VESign credentials
- API/webhook/status contract
- Sender/legal envelope policy
- Status mapping including declined/canceled/expired/partially signed
- Sandbox fixtures or webhook replay samples
- Decision whether native QEP signing is fallback or replacement/de-scope evidence

### Slice 9 — Tethr Provider Actions

Status: decision packet queued 2026-05-04; workbook rows remain `PARTIAL` until live Tethr proof or generic-telematics replacement/de-scope evidence exists.

Decision packet:

- `docs/IntelliDealer/_Manifests/QEP_TETHR_PROVIDER_DECISION_PACKET_2026-05-04.md`

Goal: finish provider-specific `Tethr It Now` actions beyond generic telematics storage.

Workbook rows covered:

- Action & Button Parity: Equipment Invoicing / Tethr It Now
- Action & Button Parity: Parts Invoicing / Tethr It Now
- Action & Button Parity: Customer Portal / Tethr It Now

Related repo-audit residual not directly listed in workbook action rows:

- Rental Counter / Tethr provider action, if still in scope for phase YAML closeout

Important corrections:

- Generic `telematics_feeds`, `telematics-ingest`, Asset 360, and Fleet Map are foundation/fallback only.
- Row-specific actions must be wired on the actual workbook surfaces.

Implementation sequence:

1. Confirm Tethr credentials, webhook/auth contract, sample payloads, and device-to-equipment mapping source.
2. Implement provider adapter/webhook normalization.
3. Add/verify mapping workflow: unknown device handling, stale data behavior, manual mapping audit.
4. Wire row-specific actions:
   - Equipment Invoicing / Sales Support Portal `Tethr It Now`
   - Parts Invoicing `Tethr It Now`
   - Customer Portal `Tethr It Now`
   - optional repo-audit residual: Rental Counter / Work Orders `Tethr It Now`
5. Use Asset 360/Fleet Map only as fallback/deeplink targets, not completion evidence.

Likely repo areas:

- `supabase/functions/telematics-ingest/index.ts`
- `supabase/functions/telematics-signal-ingest/index.ts`
- New `supabase/functions/_shared/adapters/tethr.ts`
- `apps/web/src/features/equipment/pages/AssetDetailPage.tsx`
- `apps/web/src/features/fleet/pages/FleetMapPage.tsx`
- Parts invoice/order surface, likely near `apps/web/src/features/parts`
- Portal equipment/fleet surfaces under `apps/web/src/features/portal`
- Rental/work-order surface if repo-audit residual is pursued

Primary blockers:

- Tethr credentials
- Webhook/auth contract
- Sample payloads for hours/GPS/faults
- Device-to-equipment mapping source
- Unknown-device and stale-data policy
- UI ownership for exact IntelliDealer action surfaces

### Slice 10 — Service Mobile Technician UAT

Status: decision/UAT execution packet queued 2026-05-04; workbook row remains `PARTIAL` until completed field evidence exists.

Goal: close the remaining manual UAT row with actual field acceptance evidence.

Workbook row covered:

- Gap Register: Service Mobile Web UI not production-validated for technicians

Execution packet:

- `docs/IntelliDealer/_Manifests/QEP_SERVICE_MOBILE_UAT_EXECUTION_PACKET_2026-05-04.md`

Existing prep artifacts:

- `docs/IntelliDealer/_Manifests/QEP-Phase-4-Service-Mobile-UAT-Checklist-20260422.md`
- `docs/IntelliDealer/_Manifests/QEP-Phase-4-Service-Mobile-UAT-Operator-Guide-20260422.md`
- `docs/IntelliDealer/_Manifests/QEP-Phase-4-Service-Mobile-UAT-Result-Template-20260422.md`
- `/m/service` shipped with tests per workbook evidence

Done when:

- Named technician/manager completes the UAT result template.
- Target mobile device/browser/network conditions are recorded.
- Pass/fail result and screenshots/video or equivalent proof are attached/source-controlled as allowed.
- Any blockers are fixed or explicitly waived with owner/expiration.

Queued:

- UAT run request now names required evidence, execution steps, pass criteria, and closure guardrails.

Primary blocker:

- Real technician field UAT is external/manual and cannot be proven from repo alone.

### Slice 11 — IronGuides Decision or Feed Onboarding

Status: decision packet queued 2026-05-04; workbook row remains `PARTIAL` until live-feed proof or replacement decision exists.

Goal: resolve the IronGuides contract row by live feed onboarding or a true product replacement decision.

Workbook row covered:

- Gap Register: IronGuides vendor contract pending

Decision packet:

- `docs/IntelliDealer/_Manifests/QEP_IRONGUIDES_DECISION_PACKET_2026-05-04.md`

Important correction:

- `docs/IntelliDealer/_Manifests/QEP-Phase-5-IronGuides-Dependency-Decision-20260422.md` is not a final closure artifact. It asks decision questions and recommends making a decision.

Closure paths:

1. Live feed path:
   - Contract/feed access confirmed.
   - Credentials/config and adapter/feed ingestion exist.
   - Market valuation proof uses live IronGuides data.
2. Replacement path:
   - New source-controlled decision states QEP standardizes on fallback/blended valuation and live IronGuides is not required.
   - Runtime/integration status marks the live feed as non-required/replaced.
   - Workbook row moves to `N_A` / replaced, not `BUILT`.

Queued:

- Decision packet now separates the live-feed path from the replacement/de-scope path and states the correct workbook target for each (`BUILT` for live feed, `N_A` for replacement).

Primary blocker:

- Explicit business decision or live contract/feed access.

## Recommended Execution Order

1. **Slice 6** — Equipment sale/rental reversal; requires finance policy before implementation.
2. **Slices 1–4** — JD readiness, upload, accepted POs, Proactive Jobs; only after JD scope/contract decisions.
3. **Slice 5** — OEM Base & Options imports; only after Bobcat/Vermeer sample formats or API path exists.
4. **Slices 8–9** — VESign and Tethr; provider-gated, should wait for credentials/contracts unless de-scoped.
5. Regenerate/sync workbook and run final verification after each status-changing slice.

## End-to-End Verification Gate

After any slice changes workbook status:

```bash
bun run parity:closeout:status
bun run parity:open-rows -- --expect-open=0
bun run parity:workbook:verify
bun run migrations:check
bun run wave5:provider:verify
bun run segment:gates --segment parity-closeout --ui
```

Do not claim final 100% until no `GAP` or `PARTIAL` statuses remain, except rows explicitly closed as `N_A` or replaced/decommissioned with source-controlled decision evidence.

## Domain Review Agent Results

| Domain | Verdict | Corrections Applied |
| --- | --- | --- |
| Extraction integrity | Pass | Confirmed all 18 open workbook rows represented; no extras. |
| Governance blockers | Partial pass | VitalEdge/IntelliDealer and HubSpot closed as `N_A` / replaced; Service Mobile needs real UAT; IronGuides needs real decision or feed. |
| VESign / Tethr | Conditional pass | Added provider adapter/webhook/action surfaces; clarified generic native signing/telematics are foundation only. |
| JD / OEM | Pass with corrections | Split JD readiness/upload/accepted PO/Proactive Jobs; corrected BaseOptionsPage table assumption and OEM canonical-table requirement. |
| Equipment ops | Conditional pass | Added rental-invoice branch, invoice-equipment linkage, reversal chain, GL period, and Quick Add frontend/API/type constraints. |
