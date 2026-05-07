## Final Prompt
<taskname="QRM Wizard Plan"/>
<task>Build an implementation plan (not code) for a full QRM Quote Tool wizard aligned to `QRM_QUOTE_WIZARD_SPEC_2026-05-05.md`, grounded in existing codebase nouns and current quote-builder/tax/approval architecture. Map each required wizard step to existing surfaces, identify reuse vs net-new work, and define blockers as placeholders/feature flags instead of stopping skeleton delivery.</task>

<architecture>
- `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx` is the current orchestration surface. It already implements a 6-step flow (`entry -> customer -> equipment -> tradeIn -> financing -> review`) with autosave, approval submit, review/send modal, and PDF/share actions.
- Frontend behavior is split across quote-builder components (`CustomerPicker`, `EquipmentSelector`, `TradeInSection`, `FinancingCalculator`, `QuoteReviewWorkflowPanels`, `SendQuoteSection`) and hooks (`useQuoteTaxPreview`, `useQuoteFinancingPreview`).
- Quote state and readiness are computed in `quote-workspace.ts`; API payload/contracts are in `quote-api.ts` and `shared/qep-moonshot-contracts.ts`.
- Tax currently runs through `tax-api.ts` -> Supabase edge function `tax-calculator` (estimate model using `tax_treatments`, exemption certs, section_179 support).
- Approval/margin gates are currently split: client-side threshold checks in `pricing-discipline-api.ts`, and quote approval cases/policies + workflow states in quote APIs/migrations.
- Persistence model is `quote_packages` + `quote_package_line_items` + approval/version tables from existing migrations (359/363/382), with related tax/incentive tables (151/167).
- Backend quote function exists at `supabase/functions/quote-builder-v2/index.ts` (codemap selected) and already exposes list/save/approval/send/share/public endpoints and quote version artifacts.
</architecture>

<selected_context>
QEP (1)/QRM_QUOTE_WIZARD_SPEC_2026-05-05.md: Binding 11-step wizard requirements, tax rules (FL post-trade + county surtax cap), send panel behavior, lease/additional schema proposals, blockers, and acceptance criteria.
QEP (1)/RYLEE_QRM_FEEDBACK_REPLY_2026-05-05.md: Source-aligned product clarifications from the 2026-05-04 feedback thread (wizard UX, tax behavior, send panel intent, lease/trade/deposit dependencies).
apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx: Current end-to-end page flow, step state, autosave, save/submit approval behavior, review/send dialog, and integration points for quote/tax/finance APIs.
apps/web/src/features/quote-builder/components/CustomerPicker.tsx: Existing customer search-first picker/dedupe surface and manual-entry handoff.
apps/web/src/features/quote-builder/components/EquipmentSelector.tsx: Existing equipment search and AI recommendation selection surface.
apps/web/src/features/quote-builder/components/TradeInSection.tsx: Existing trade valuation integration and trade value callback wiring.
apps/web/src/features/quote-builder/components/FinancingCalculator.tsx: Current discount/tax/finance scenario UX and data expectations.
apps/web/src/features/quote-builder/components/QuoteReviewWorkflowPanels.tsx: Current approval-case rendering, send gating by `canSend`, and portal revision workflow.
apps/web/src/features/quote-builder/components/SendQuoteSection.tsx: Existing single-action email send component (candidate for replacement/expansion into 3-action send panel).
apps/web/src/features/quote-builder/hooks/useQuoteTaxPreview.ts: Tax preview query contract and activation conditions.
apps/web/src/features/quote-builder/hooks/useQuoteFinancingPreview.ts: Financing preview query contract.
apps/web/src/features/quote-builder/lib/quote-workspace.ts: Readiness, totals, discount math, and margin/approval readiness signals.
apps/web/src/features/quote-builder/lib/quote-api.ts: Quote builder API contracts (save, calculate, send, submit approval, approval case/policy, portal revisions).
apps/web/src/features/quote-builder/lib/tax-api.ts: Client tax edge-function adapter contract.
apps/web/src/features/admin/lib/pricing-discipline-api.ts: Margin thresholds/exceptions and under-threshold logic used by margin gate.
shared/qep-moonshot-contracts.ts: Canonical shared types for quote workspace draft, line items, tax profiles, approval case/policy, version snapshots.
supabase/functions/quote-builder-v2/index.ts (codemap): Existing server endpoints and approval/version workflow helpers; inspect for where wizard_step, follow-up, send panel actions, and new line kinds should integrate.
supabase/functions/tax-calculator/index.ts: Current tax calculation implementation (jurisdiction by branch state, tax_treatments table, exemption cert handling, section_179 persistence).
supabase/migrations/151_tax_intelligence.sql: Tax treatment and exemption schema foundations.
supabase/migrations/167_wave5_closeout_tax_incentives.sql: Quote tax breakdown + manufacturer incentive tables.
supabase/migrations/359_quote_builder_commercial_terms.sql: Existing quote commercial fields (branch slug, discounts, tax profile/total, finance selection).
supabase/migrations/363_quote_approval_cases_and_policies.sql: Approval policy/case/condition schema and status sync behavior.
supabase/migrations/382_quote_workspace_end_to_end.sql: Current workspace persistence hardening and line-item model constraints.
</selected_context>

<relationships>
- `QuoteBuilderV2Page` -> `computeQuoteWorkspace` for totals/readiness -> drives save/submit/send button states.
- `QuoteBuilderV2Page` -> `useQuoteTaxPreview` -> `calculateTax` (`tax-api.ts`) -> `supabase/functions/tax-calculator`.
- `QuoteBuilderV2Page` -> `useQuoteFinancingPreview` -> `calculateFinancing` (`quote-api.ts`) -> `quote-builder-v2/calculate`.
- `QuoteBuilderV2Page` -> `saveQuotePackage`/`submitQuoteForApproval`/`sendQuotePackage` (`quote-api.ts`) -> `quote-builder-v2` endpoints.
- `MarginFloorGate` + `pricing-discipline-api` threshold lookup/exception logging coexist with approval-case routing in quote APIs (`quote_approval_cases`, `quote_approval_policies`).
- `QuoteReviewWorkflowPanels` consumes `getQuoteApprovalCase` and `approval_case.canSend` to gate `SendQuoteSection`.
- Shared TS contracts (`qep-moonshot-contracts.ts`) constrain both frontend draft state and backend normalization/version logic.
- Migrations 359/363/382 define current `quote_packages`/approval/line-item persistence baseline that the new wizard schema changes must extend rather than fork.
</relationships>

<ambiguities>
- The original 2026-05-04 email artifact itself is not directly present; only the compiled spec and a 2026-05-05 reply derived from it are available in selected context.
- Spec proposes new tables/columns (`tax_jurisdictions`, `quote_financing_scenarios`, extended quote fields, new line kinds) that partially overlap existing persistence (`quote_packages`, `quote_package_line_items`, `quote_tax_breakdowns`, approval tables). Planning must reconcile extension vs replacement explicitly.
- Current quote flow is 6 steps; spec requires 11-step UX. Decide whether to evolve existing route/state machine vs introduce a parallel `quote-wizard` feature path under feature flag.
- Tax spec requires FL county surtax cap by delivery county; current tax function resolves by branch state and `tax_treatments` with no county-cap logic.
- Send panel spec requires Preview/Email/Text with Graph/Twilio integrations and required follow-up logging; current implementation is primarily email send plus share link.
- Lease quoting and some trade/deposit details are blocked on external inputs; these should be represented as gated placeholders (`FEATURE_LEASE_QUOTING`, blocked step panels, stub persistence fields) in the plan.
</ambiguities>

## Selection
- Files: 28 total (22 full, 6 codemap)
- Total tokens: 108092 (Auto view)
- Token breakdown: full 102217, codemap 5875

### Files
### Selected Files
/Users/brianlewis/Projects/qep-knowledge-assistant/
├── QEP (1)/
│   ├── QRM_QUOTE_WIZARD_SPEC_2026-05-05.md — 5,004 tokens (full)
│   └── RYLEE_QRM_FEEDBACK_REPLY_2026-05-05.md — 871 tokens (full)
├── apps/
│   └── web/
│       └── src/
│           └── features/
│               ├── admin/
│               │   └── lib/
│               │       └── pricing-discipline-api.ts — 3,264 tokens (full)
│               └── quote-builder/
│                   ├── components/
│                   │   ├── CustomerPicker.tsx — 4,161 tokens (full)
│                   │   ├── EquipmentSelector.tsx — 1,310 tokens (full)
│                   │   ├── FinancingCalculator.tsx — 4,229 tokens (full)
│                   │   ├── QuoteReviewWorkflowPanels.tsx — 4,890 tokens (full)
│                   │   ├── SendQuoteSection.tsx — 719 tokens (full)
│                   │   └── TradeInSection.tsx — 808 tokens (full)
│                   ├── hooks/
│                   │   ├── useQuoteFinancingPreview.ts — 172 tokens (full)
│                   │   └── useQuoteTaxPreview.ts — 388 tokens (full)
│                   ├── lib/
│                   │   ├── quote-api.ts — 14,746 tokens (full)
│                   │   ├── quote-workspace.ts — 1,355 tokens (full)
│                   │   └── tax-api.ts — 386 tokens (full)
│                   └── pages/
│                       └── QuoteBuilderV2Page.tsx — 38,735 tokens (full)
├── shared/
│   └── qep-moonshot-contracts.ts — 8,941 tokens (full)
└── supabase/
    ├── functions/
    │   └── tax-calculator/
    │       └── index.ts — 1,935 tokens (full)
    └── migrations/
        ├── 151_tax_intelligence.sql — 2,080 tokens (full)
        ├── 167_wave5_closeout_tax_incentives.sql — 3,087 tokens (full)
        ├── 359_quote_builder_commercial_terms.sql — 783 tokens (full)
        ├── 363_quote_approval_cases_and_policies.sql — 2,721 tokens (full)
        └── 382_quote_workspace_end_to_end.sql — 1,632 tokens (full)

### Codemaps
/Users/brianlewis/Projects/qep-knowledge-assistant/
├── apps/
│   └── web/
│       └── src/
│           └── features/
│               ├── portal/
│               │   └── lib/
│               │       └── portal-api.ts — 1,164 tokens (manual)
│               └── quote-builder/
│                   ├── components/
│                   │   └── OutcomeCaptureDrawer.tsx — 177 tokens (manual)
│                   └── lib/
│                       ├── customer-search-api.ts — 1,827 tokens (manual)
│                       ├── factor-verdict.ts — 205 tokens (manual)
│                       └── local-draft.ts — 796 tokens (manual)
└── supabase/
    └── functions/
        └── quote-builder-v2/
            └── index.ts — 1,706 tokens (manual)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `qrm-wizard-plan-05C126` | **Mode**: plan

### Response
## 1. **Summary**

Evolve the existing `quote-builder` feature into the full 11-step QRM Quote Tool wizard rather than creating a parallel `quote-wizard` feature. The current `QuoteBuilderV2Page.tsx` already owns draft state, autosave, quote persistence, financing/tax previews, approval submission, PDF/share actions, and send gating, so the safest path is to replace its current 6-step guided/workspace UX with an 11-step wizard state machine while extracting step-specific panels into focused components. Net-new work is required for county-capped Florida tax, normalized financing scenarios, quote detail fields, promotions selection, generated PDF artifact persistence, and a Preview/Email/Text send panel. Blocked business dependencies should ship as flagged placeholders so the skeleton can be delivered without waiting on Trade SOP, Deposit SOP, lease rate sheets, Graph, Twilio, or full FL county seed completion.

---

## 2. **Current-state analysis**

### Existing orchestration and state ownership

`apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx` is the current orchestration surface.

It owns:

- `step: "entry" | "customer" | "equipment" | "tradeIn" | "financing" | "review"`
- `builderMode: "workspace" | "guided"`
- the mutable `QuoteWorkspaceDraft`
- autosave timing and server save mutation
- local draft restore/persistence
- tax and financing preview query inputs
- approval submission
- review/send modal state
- PDF download/share-link actions

Current data flow:

```text
UI input
  → setDraft(...)
  → computeQuoteWorkspace(draft)
  → useQuoteTaxPreview(...) / useQuoteFinancingPreview(...)
  → saveQuotePackage(buildQuoteSavePayload(...))
  → supabase/functions/quote-builder-v2
  → quote_packages + quote_package_line_items + approval/version tables
  → React Query invalidation + draft.quoteStatus update
```

### Existing reusable frontend surfaces

| Existing file | Current responsibility | Reuse decision |
|---|---|---|
| `CustomerPicker.tsx` | Search-first CRM customer picker with manual-entry handoff | Reuse for Step 1; expand new-customer fields and dedupe blocking. |
| `EquipmentSelector.tsx` | Catalog search and AI recommendation selection | Reuse for Step 2; expand search modes, availability, category cascade. |
| `TradeInSection.tsx` | Reads existing trade valuation and applies value | Reuse inside Step 4; add SOP-placeholder checklist/lock. |
| `FinancingCalculator.tsx` | Discount, tax profile, cash down, custom financing, scenario selection | Split/reuse pieces across Step 5 Pricing and Step 7 Financing. |
| `QuoteReviewWorkflowPanels.tsx` | Approval case display, `canSend` gating, portal revision workflow | Reuse for Step 9 approval state; move send UI out to new Step 11 panel. |
| `SendQuoteSection.tsx` | Single email send action through `sendQuotePackage` | Replace with expanded send panel; keep as compatibility wrapper if still used elsewhere. |
| `useQuoteTaxPreview.ts` | React Query wrapper around `tax-api.ts` | Extend input for delivery county/state and overrides. |
| `useQuoteFinancingPreview.ts` | React Query wrapper around quote calculate endpoint | Extend for saved finance/lease scenario support. |
| `quote-workspace.ts` | Totals, discount math, margin, readiness | Extend for 11-step readiness and new line kinds. |
| `quote-api.ts` | Client quote-builder API adapter and payload builder | Extend payloads/endpoints; keep existing functions backward-compatible. |
| `shared/qep-moonshot-contracts.ts` | Shared quote draft/approval/finance types | Extend canonical draft and line item contracts. |

### Existing persistence baseline

Current schema is not the spec’s proposed `quotes` / `quote_lines` model. The actual system uses:

- `quote_packages`
- `quote_package_line_items`
- `quote_package_versions`
- `quote_approval_cases`
- `quote_approval_policies`
- `quote_approval_case_conditions`
- `quote_tax_breakdowns`
- `manufacturer_incentives`
- `quote_incentive_applications`

Therefore, the wizard schema must extend these tables instead of introducing a separate `quotes` table.

### Current tax flow

```text
QuoteBuilderV2Page
  → useQuoteTaxPreview(input)
  → calculateTax(params) in tax-api.ts
  → supabase/functions/tax-calculator/index.ts
  → tax_treatments + tax_exemption_certificates + section_179_scenarios
```

Current tax limitations:

- resolves jurisdiction from `branch_slug → branches.state_province`
- no delivery county input
- no `tax_jurisdictions` table
- no Florida discretionary surtax cap
- no manual override contract
- exemptions are supported but based on existing certificate model and `tax_profile`

### Current approval flow

Approval is split today:

1. Client-side margin floor gate:
   - `pricing-discipline-api.ts`
   - `qb_margin_thresholds`
   - `qb_margin_exceptions`
   - `MarginFloorGate`

2. Formal approval cases:
   - `submitQuoteForApproval`
   - `quote_approval_cases`
   - `quote_approval_policies`
   - `QuoteReviewWorkflowPanels`
   - `activeApprovalCase.canSend`

The implementation should keep `quote_approval_cases` as the authoritative send gate. Do **not** add a parallel `approval_status` column unless needed only as a denormalized display field. The spec’s `approval_status = pending_manager / rep_cleared` maps to existing package statuses and approval case state.

---

## 3. **Design**

### 3.1 Architectural decision: evolve existing quote-builder, do not fork

**Decision:** implement the 11-step wizard inside `apps/web/src/features/quote-builder`, with extracted step components, rather than creating `src/features/quote-wizard`.

**Rationale:** current quote-builder already owns the required API contracts, draft state, autosave, approval, tax, financing, PDF, and send relationships. A parallel feature would duplicate state and persistence paths.

**Target UX state:**

- Remove `builderMode` as a primary user-facing switch.
- Replace the current 6-step guided flow with an 11-step wizard.
- Keep the old workspace layout only behind a temporary rollback flag, for example:

```ts
FEATURE_QUOTE_WORKSPACE_LEGACY
```

Default behavior should be the wizard.

---

### 3.2 Wizard step model

Add a canonical frontend step union in `QuoteBuilderV2Page.tsx` or a new local wizard module.

Illustrative shape:

```ts
type QuoteWizardStepId =
  | "customer"
  | "equipment"
  | "configure"
  | "tradeIn"
  | "pricing"
  | "promotions"
  | "financing"
  | "details"
  | "review"
  | "document"
  | "send";
```

Persist numeric step index to the server as `quote_packages.wizard_step`.

Mapping:

| Step | Spec name | Existing reuse | Net-new work |
|---:|---|---|---|
| 1 | Customer | `CustomerPicker`, `CustomerInfoCard`, `CustomerIntelPanel` | New-customer drawer fields, phone+last-name dedupe block, tax certificate indicator/upload placeholder. |
| 2 | Equipment | `EquipmentSelector`, `searchCatalog`, AI recommendation flow | Availability status, category→make→model cascade, confirm-availability notification placeholder. |
| 3 | Configure | existing compatible attachments surfaced from `EquipmentSelector` | Dedicated configure step with tabs: Attachments, Options, Accessories, Warranty. |
| 4 | Trade-in | `TradeInSection`, `PointShootTradeCard`, `TradeInInputCard` | SOP-placeholder inspection checklist and locked trade allowance behavior. |
| 5 | Pricing build | `FinancingCalculator` commercial fields, `quote-workspace.ts` math | Dedicated pricing waterfall, new line kinds, discount reason codes, PDI/freight/doc/title/tag/good-faith fields. |
| 6 | Rebates & promotions | `manufacturer_incentives`, `quote_incentive_applications`, `IncentiveStack` | Selectable mfg/dealer/loyalty promotions and quote line application. |
| 7 | Financing scenarios | `useQuoteFinancingPreview`, `FinancingCalculator`, `custom-finance` | Cash/Finance/Lease tabs, normalized saved scenarios, lease placeholder flag. |
| 8 | Quote details | none direct | Expiration, deposit, delivery ETA, terms, Why This Machine. |
| 9 | Review + approval | `MarginCheckBanner`, `QuoteReviewWorkflowPanels`, approval APIs | 11-step summary layout and approval-rule explanation. |
| 10 | Generate document | `useQuotePDF`, branch document header/footer | Backend-generated/stored PDF artifact, preview pane. |
| 11 | Send & log | current `SendQuoteSection` as email fallback | New Preview/Email/Text panel, follow-up required, send event logging, Graph/Twilio placeholders. |

The old `entry` step should not remain a wizard step. Voice, AI chat, manual, and trade-photo entry modes become intake controls inside Step 1 or a compact pre-step banner, because the binding spec defines Step 1 as Customer.

---

### 3.3 Shared contract changes

Modify `shared/qep-moonshot-contracts.ts`.

#### Extend `QuoteLineItemKind`

Current:

```ts
"equipment" | "attachment" | "warranty" | "financing" | "custom"
```

After:

```ts
| "equipment"
| "attachment"
| "option"
| "accessory"
| "warranty"
| "financing"
| "pdi"
| "freight"
| "good_faith"
| "doc_fee"
| "title"
| "tag"
| "registration"
| "discount"
| "trade_allowance"
| "rebate_mfg"
| "rebate_dealer"
| "loyalty_discount"
| "tax_state"
| "tax_county"
| "custom"
```

Keep existing values valid for backward compatibility.

#### Extend `QuoteWorkspaceDraft`

Add fields owned by the wizard:

```ts
wizardStep?: number;
expiresAt?: string | null;
followUpAt?: string | null;
depositRequiredAmount?: number | null;
deliveryEta?: string | null;
deliveryState?: string | null;
deliveryCounty?: string | null;
specialTerms?: string | null;
whyThisMachine?: string | null;
taxJurisdictionId?: string | null;
taxOverrideAmount?: number | null;
taxOverrideReason?: string | null;
selectedPromotionIds?: string[];
```

Add financing scenarios if normalized client-side editing is needed:

```ts
savedFinanceScenarios?: QuoteFinanceScenarioDraft[];
```

Where `QuoteFinanceScenarioDraft.kind` should distinguish:

```ts
"cash" | "finance" | "lease_fmv" | "lease_fppo"
```

#### Extend `QuoteFinanceScenario`

Current type only has:

```ts
type: "cash" | "finance" | "lease"
```

Keep `type` for UI compatibility, and add optional fields:

```ts
kind?: "cash" | "finance" | "lease_fmv" | "lease_fppo";
downPayment?: number | null;
residualAmount?: number | null;
moneyFactor?: number | null;
isDefault?: boolean;
```

---

### 3.4 Quote workspace computation and readiness

Modify `apps/web/src/features/quote-builder/lib/quote-workspace.ts`.

#### New responsibilities

- Compute pricing waterfall totals from expanded line kinds.
- Keep trade allowance subtracted before tax.
- Add readiness by wizard step.
- Require follow-up date only for Step 11 send/log, not for draft save.
- Keep approval readiness tied to existing approval case/status.

#### Pricing math

Use these invariants:

```text
equipmentAndConfigSubtotal =
  equipment + attachment + option + accessory + warranty

pricingAdders =
  pdi + freight + good_faith + doc_fee + title + tag + registration + custom positive adders

discounts =
  quote discount + rebate_mfg + rebate_dealer + loyalty_discount

taxableBasis =
  max(0, equipmentAndConfigSubtotal + pricingAdders - discounts - tradeAllowance)

netTotal =
  taxableBasis before tax

customerTotal =
  netTotal + taxTotal

amountFinanced =
  max(0, customerTotal - cashDown)
```

Current `netTotal = subtotal - discount - tradeAllowance` should be generalized so Step 5 line items are first-class.

#### Readiness additions

Illustrative output extension:

```ts
wizardReadiness: Record<QuoteWizardStepId, {
  ready: boolean;
  blocking: string[];
  warnings: string[];
}>
```

Blocking rules:

- Customer: customer identity required.
- Equipment: at least one equipment line; `source_required` availability blocks forward movement unless cleared.
- Configure: optional unless incompatible required options exist.
- Trade-in: skippable; if trade allowance > 0, provisional checklist must be completed or manager approval required.
- Pricing: required; delivery county required for FL tax preview unless tax-exempt or override reason present.
- Promotions: skippable.
- Financing: skippable for cash; TILA disclaimer always shown when payment math is visible.
- Details: expiration defaults to 30 days; deposit can remain null while SOP blocked.
- Review: draft readiness + approval decision.
- Document: requires approval before final customer-facing PDF generation.
- Send: requires document artifact, customer contact route, and follow-up date.

---

### 3.5 Frontend wizard page and components

#### `QuoteBuilderV2Page.tsx`

Refactor, do not rewrite all business logic at once.

Responsibilities retained:

- draft state
- existing quote hydration
- local draft fallback
- autosave
- save/submit mutations
- tax/finance preview query setup
- active quote id/status derivation
- global wizard progress state

Responsibilities extracted:

- Step rendering into new components.
- Review/send dialog into Step 10/11 surfaces.
- Pricing waterfall into a dedicated Step 5 component.

New local state:

```ts
const [step, setStep] = useState<QuoteWizardStepId>("customer");
```

Step persistence should continue using session storage, but persist by numeric server step as well.

```text
on step change
  → persist sessionStorage last step
  → if quote package exists, autosave wizard_step
```

Do not block jumping backward. Forward navigation should block only hard requirements for the current step.

#### New components under `apps/web/src/features/quote-builder/components/wizard/`

1. `QuoteWizardProgress.tsx`
   - renders 11-step progress bar
   - supports jump-back and allowed jump-forward
   - owns no draft state

2. `QuoteCustomerStep.tsx`
   - wraps `CustomerPicker`, `CustomerInfoCard`, `CustomerIntelPanel`
   - exposes `onDraftPatch`
   - includes voice/AI/manual intake controls formerly in `entry`

3. `QuoteEquipmentStep.tsx`
   - wraps `EquipmentSelector`
   - adds availability display and confirm-availability placeholder

4. `QuoteConfigureStep.tsx`
   - tabs: Attachments, Options, Accessories, Warranty
   - uses existing `draft.attachments` with expanded `kind`
   - warranty offers remain placeholder/catalog-driven until OEM data exists

5. `QuoteTradeInStep.tsx`
   - wraps `TradeInSection`, `PointShootTradeCard`, `TradeInInputCard`
   - adds provisional SOP checklist
   - marks trade line `approval_required` when SOP is incomplete or manager threshold unavailable

6. `QuotePricingBuildStep.tsx`
   - owns visual waterfall
   - fields for freight, PDI, good-faith, doc/title/tag/registration
   - manual discount requires `reason_code`

7. `QuotePromotionsStep.tsx`
   - lists manufacturer/dealer/loyalty programs
   - selected programs become quote lines and `quote_incentive_applications`

8. `QuoteFinancingStep.tsx`
   - reuses `FinancingCalculator` pieces
   - Cash / Finance / Lease tabs
   - lease tab disabled unless `FEATURE_LEASE_QUOTING=true` and seeded rate tables are present

9. `QuoteDetailsStep.tsx`
   - expiration date default +30 days
   - deposit placeholder
   - delivery ETA
   - special terms
   - Why This Machine draft/edit field

10. `QuoteReviewStep.tsx`
   - summary, pricing waterfall, tax breakdown, approval gate
   - includes `QuoteReviewWorkflowPanels` approval case portion
   - does not own send actions

11. `QuoteDocumentStep.tsx`
   - generates/stores customer-facing PDF artifact
   - preview pane
   - reuses `useQuotePDF` only as a fallback until backend generation is complete

12. `QuoteSendPanel.tsx`
   - replaces `SendQuoteSection`
   - buttons: Preview Quote, Email Quote, Text Quote
   - requires follow-up date
   - logs delivery events

---

### 3.6 Customer step

#### Reuse

- `CustomerPicker.tsx`
- `CustomerInfoCard`
- `SelectedCustomerChip`
- `CustomerIntelPanel`
- `hydrateCustomerById`

#### Required changes

- Expand manual new-customer form to include:
  - first name
  - last name
  - phone
  - billing address
  - assigned salesperson
  - optional business name
  - optional email
  - shipping same as billing toggle
  - tax ID
  - resale certificate upload placeholder

Do not persist tax certificate upload until document storage is confirmed. The skeleton should render a disabled or “attach later” control.

#### Dedupe behavior

Implement client-side precheck plus server validation.

Rule:

```text
if new customer phone matches existing contact phone
and last name matches existing contact last name
then block create/save and surface existing record
```

Client can use current `searchCustomers`; server save must still enforce/return a structured warning because client search is not authoritative.

---

### 3.7 Equipment and configure steps

#### Equipment search

`EquipmentSelector.tsx` should be extended rather than replaced.

Add:

- serial/stock search path
- category → make → model cascade
- availability status display:
  - `in_stock`
  - `in_transit`
  - `source_required`

If selected equipment has `source_required`:

```text
set line metadata.availability_status = "source_required"
block forward navigation from Step 2
show "Confirm availability"
```

Confirm availability action should call a new backend placeholder endpoint or existing notification system if present. If backend notification is not ready, store a `metadata.availability_confirmation_requested_at` timestamp and show “requested”.

#### Configure step

Use `draft.attachments` but distinguish kinds:

- `attachment`
- `option`
- `accessory`
- `warranty`

The current `availableOptions` state in `QuoteBuilderV2Page.tsx` should move into `QuoteConfigureStep` or become derived from selected equipment.

---

### 3.8 Trade-in step

#### Reuse

- `TradeInSection`
- `PointShootTradeCard`
- `TradeInInputCard`
- existing `getTradeValuation`

#### Placeholder strategy for blocked Trade SOP

Ship a provisional checklist with fields from the spec:

- hour meter
- undercarriage condition
- hydraulic leaks yes/no + notes
- engine hours at last service
- tires/tracks condition
- visible damage photos placeholder

Behavior:

```text
if tradeAllowance > 0 and checklist incomplete:
  keep trade allowance visible
  mark trade line approval_required = true
  show "Trade SOP pending — manager approval required"
```

This avoids stopping skeleton delivery while still respecting the spec’s guardrail intent.

---

### 3.9 Pricing build step

#### Reuse

- `computeCommercialDiscountTotal`
- `computeQuoteWorkspace`
- parts of `FinancingCalculator`
- `MarginCheckBanner`

#### New line handling

Pricing fields should write into `draft.attachments` or a new `draft.pricingLines` array. Prefer a new array only if needed for clarity, but persistence should still normalize to `quote_package_line_items`.

Recommended draft shape:

```ts
pricingLines?: QuoteLineItemDraft[];
```

This avoids mixing freight/doc/tax rows into `attachments`.

If adding `pricingLines`, update:

- `QuoteWorkspaceDraft`
- `computeQuoteWorkspace`
- `buildQuoteSavePayload`
- saved quote hydration

Required pricing lines:

- PDI
- freight
- good faith cost
- doc fee
- title
- tag
- registration
- discount
- trade allowance display row
- tax state/county display rows

Manual discount requires:

```ts
reasonCode:
  | "competitive_match"
  | "volume_buyer"
  | "aged_inventory"
  | "loyalty"
  | "other"
```

Store this on `quote_package_line_items.reason_code`.

---

### 3.10 Promotions step

#### Reuse existing incentive architecture

Do not create a separate `promotions` table unless actual constraints in implementation prove `manufacturer_incentives` cannot support the rows.

Use `manufacturer_incentives` as the canonical program table by adding `source`:

```sql
source text not null default 'manufacturer'
check (source in ('manufacturer', 'dealer', 'loyalty'))
```

For dealer and loyalty programs, set `manufacturer = 'QEP'` if the existing `manufacturer NOT NULL` constraint remains.

Use existing:

- `quote_incentive_applications`
- `IncentiveStack`

Add selected promotions to quote line items as:

- `rebate_mfg`
- `rebate_dealer`
- `loyalty_discount`

Amounts should be negative in totals but persisted as positive `applied_amount` in `quote_incentive_applications`.

---

### 3.11 Financing and lease step

#### Reuse

- `useQuoteFinancingPreview`
- `calculateFinancing`
- `FinancingCalculator`
- `buildCustomFinanceScenario`

#### New normalized persistence

Add table:

```text
quote_financing_scenarios
  id
  workspace_id
  quote_package_id
  scenario_label
  kind: cash | finance | lease_fmv | lease_fppo
  down_payment
  term_months
  apr
  residual_amount
  money_factor
  monthly_payment
  total_cost
  lender
  is_default
  created_at
```

Backend `save` should replace scenarios for the quote package transactionally on save.

#### Lease placeholder

Lease tab renders only when:

```text
FEATURE_LEASE_QUOTING=true
and lease rate/residual seed data exists
```

When disabled:

- show FMV/FPPO disabled cards
- explain “Awaiting lease rate sheets, OEM list, residual tables”
- do not block completing the wizard

TILA disclaimer renders on every payment math surface, including disabled lease placeholder.

---

### 3.12 Quote details step

Add fields to draft and persistence:

- `expires_at`, default `now + 30 days`
- `deposit_required_amount`, nullable while Deposit SOP blocked
- `delivery_eta`
- `special_terms`
- `why_this_machine`

Why This Machine behavior:

```text
initial suggestion source:
  draft.recommendation.reasoning
  + draft.voiceSummary
  + selected equipment specs

rep must edit/confirm before send
```

Do not send AI-generated text automatically. Add a boolean if needed:

```ts
whyThisMachineConfirmed?: boolean
```

If not confirmed, Step 11 should warn or block depending product preference. Recommended: block customer-facing send until confirmed if the field is non-empty and AI-suggested.

---

### 3.13 Review and approval gate

#### Authoritative approval model

Keep:

- `quote_approval_policies`
- `quote_approval_cases`
- `quote_approval_case_conditions`
- `quote_packages.status`
- `activeApprovalCase.canSend`

Do not add a separate approval workflow table.

#### Policy mapping

Spec rules map to current/new conditions:

| Spec trigger | Existing/new source |
|---|---|
| margin below floor | `quote_approval_policies.standard_margin_floor_pct` |
| trade credit above max | add policy field or condition payload `max_trade_allowance` |
| rep discount above cap | add policy field `rep_discount_max_pct` |
| line item approval required | new `quote_package_line_items.approval_required` |

Migration should extend `quote_approval_policies`:

```text
trade_credit_max numeric
rep_discount_max_pct numeric
```

Backend approval submission should include these in `reason_summary_json`.

---

### 3.14 Document generation step

Current `useQuotePDF` appears download-oriented. The spec requires generated PDFs stored in R2.

Add a backend document artifact model:

```text
quote_document_artifacts
  id
  workspace_id
  quote_package_id
  quote_package_version_id
  artifact_type = 'customer_quote_pdf'
  storage_bucket
  storage_key
  status = pending | generated | failed
  generated_at
  generated_by
  expires_at
  created_at
```

Add API endpoints in `quote-builder-v2`:

```text
POST /document/generate
GET  /document/latest?quote_package_id=...
POST /document/preview-url
```

Frontend Step 10:

```text
click Generate Quote
  → auto-save if dirty
  → require approval canSend or approved status
  → call /document/generate
  → show PDF preview pane using signed URL
```

For skeleton delivery, if backend PDF generation is not ready, use existing `useQuotePDF` for preview/download but still create a placeholder artifact row with status `pending` or `failed` only after backend is implemented. Do not fake successful persisted documents.

---

### 3.15 Send and log step

Replace `SendQuoteSection.tsx` with `QuoteSendPanel.tsx`.

#### UI contract

Three buttons:

1. **Preview Quote**
   - opens latest generated PDF in side pane
   - logs a `preview` event
   - does not mark quote sent

2. **Email Quote**
   - opens editable composer
   - customer email prefilled
   - subject: `Your QEP Quote {quote_number}`
   - rep BCC behavior represented in UI
   - actual Graph send behind:

```text
FEATURE_QRM_GRAPH_EMAIL=true
```

If disabled, composer opens but send button is disabled with setup message.

3. **Text Quote**
   - opens SMS/MMS composer
   - short branded message
   - uses PDF signed URL
   - actual Twilio send behind:

```text
FEATURE_QRM_TEXT_QUOTE=true
```

If disabled, button opens disabled setup panel.

#### Required follow-up

Step 11 blocks final send/log until:

```text
draft.followUpAt != null
```

Default:

```text
now + 3 days
```

#### Persistence

Add `quote_delivery_events`:

```text
id
workspace_id
quote_package_id
document_artifact_id
channel: preview | email | text | link | print
status: draft | attempted | sent | failed
recipient
subject
message_body
provider: graph | twilio | resend | local_preview
provider_message_id
error_message
follow_up_at
created_by
created_at
```

Backend send action should:

```text
validate approval canSend
validate document artifact
validate follow_up_at for email/text
create delivery event
update quote_packages.status = 'sent' only for successful email/text
write CRM timeline activity
schedule cadence placeholders
```

Current `sendQuotePackage(quotePackageId)` remains as an email compatibility helper but should call the new endpoint internally or be marked legacy.

---

### 3.16 Tax engine design

#### Client contract

Extend `TaxCalculation` in `tax-api.ts`:

```ts
tax_lines: Array<{
  description: string;
  rate: number;
  amount: number;
  applies_to: string;
  jurisdiction_id?: string | null;
  cap_applied?: number | null;
}>
total_tax: number;
state_tax: number;
county_tax: number;
taxable_basis: number;
exemptions_applied: string[];
manual_override_applied?: boolean;
```

Extend `calculateTax` params:

```ts
delivery_state?: string;
delivery_county?: string;
tax_override_amount?: number | null;
tax_override_reason?: string | null;
```

#### Backend calculation

In `supabase/functions/tax-calculator/index.ts`:

1. Compute:

```text
taxableBasis = max(0, subtotal - discount_total - trade_allowance)
```

2. If verified exemption exists:
   - return zero tax
   - include exemption certificate text
   - do not apply manual override

3. If manual override amount is present:
   - require reason
   - return override as tax total
   - include audit metadata

4. If state is FL:
   - state tax = `taxableBasis * 0.06`
   - lookup `tax_jurisdictions` by delivery county
   - county surtax = `min(taxableBasis, surtax_cap_amount ?? taxableBasis) * county_surtax_rate`
   - for FL, cap should be 5000

5. For non-FL:
   - preserve current `tax_treatments` behavior

Acceptance edge case:

```text
taxableBasis = 50000
county_surtax_rate = 0.01
surtax_cap_amount = 5000
county tax = 50
```

#### Tax jurisdiction persistence

Add `tax_jurisdictions` exactly as a new table because current `tax_treatments` cannot represent county caps cleanly.

---

## 4. **File-by-file impact**

### `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx`

**Changes**

- Replace `Step` union with 11-step `QuoteWizardStepId`.
- Remove/default-disable `builderMode`.
- Move large inline step JSX into new wizard step components.
- Keep:
  - draft state
  - hydration
  - autosave
  - save/submit mutations
  - tax/finance queries
  - approval status derivation
- Add defaults:
  - `expiresAt = +30 days`
  - `followUpAt = +3 days` when entering Step 11
- Pass draft patches to step components.
- Persist `wizard_step` in save payload.

**Depends on**

- shared contract extension
- new wizard components
- `quote-workspace.ts` readiness extension

---

### `apps/web/src/features/quote-builder/components/CustomerPicker.tsx`

**Changes**

- Keep core picker behavior.
- Add optional badges for tax-exempt / equipment owner if available from search API.
- No ownership of new-customer drawer fields.

**Depends on**

- customer search API returning or tolerating additional badge metadata.

---

### `apps/web/src/features/quote-builder/components/EquipmentSelector.tsx`

**Changes**

- Add search mode selector:
  - stock/serial
  - category cascade
  - existing free search
  - AI recommend
- Include `availabilityStatus` in selected entry.
- Surface `source_required` confirmation CTA via parent callback.

**Depends on**

- catalog search API supporting or safely ignoring new filters.

---

### `apps/web/src/features/quote-builder/components/TradeInSection.tsx`

**Changes**

- Keep existing valuation read/apply.
- Add optional props for checklist state if used directly, or wrap in `QuoteTradeInStep`.

**Depends on**

- draft fields for trade checklist or line metadata.

---

### `apps/web/src/features/quote-builder/components/FinancingCalculator.tsx`

**Changes**

- Split reusable subpanels or make props flexible enough for:
  - Step 5 pricing
  - Step 7 financing
- Add TILA disclaimer display.
- Support lease placeholder cards via props.

**Depends on**

- extended `QuoteFinanceScenario`.

---

### `apps/web/src/features/quote-builder/components/QuoteReviewWorkflowPanels.tsx`

**Changes**

- Keep approval-case rendering.
- Remove direct rendering of `SendQuoteSection`; send is Step 11.
- Continue to expose `activeApprovalCase.canSend` and conditions.

**Depends on**

- new `QuoteSendPanel`.

---

### `apps/web/src/features/quote-builder/components/SendQuoteSection.tsx`

**Changes**

- Either:
  - convert to a wrapper around `QuoteSendPanel` in email-only mode, or
  - leave for legacy paths and stop using in wizard.

**Depends on**

- new send API design.

---

### New wizard components

Create under:

```text
apps/web/src/features/quote-builder/components/wizard/
```

Files:

- `QuoteWizardProgress.tsx`
- `QuoteCustomerStep.tsx`
- `QuoteEquipmentStep.tsx`
- `QuoteConfigureStep.tsx`
- `QuoteTradeInStep.tsx`
- `QuotePricingBuildStep.tsx`
- `QuotePromotionsStep.tsx`
- `QuoteFinancingStep.tsx`
- `QuoteDetailsStep.tsx`
- `QuoteReviewStep.tsx`
- `QuoteDocumentStep.tsx`
- `QuoteSendPanel.tsx`

Each component should be controlled by parent draft props and callbacks. None should own persisted quote state.

---

### `apps/web/src/features/quote-builder/hooks/useQuoteTaxPreview.ts`

**Changes**

- Add delivery state/county and override values to input and query key.
- Keep enabled condition as:
  - branch or delivery state exists
  - subtotal > 0
- For FL, include delivery county in readiness.

**Depends on**

- `tax-api.ts` contract extension.

---

### `apps/web/src/features/quote-builder/hooks/useQuoteFinancingPreview.ts`

**Changes**

- Include scenario inputs if financing preview becomes dependent on selected tab/lease flag.
- Keep stale time.

**Depends on**

- `quote-api.ts` financing request extension.

---

### `apps/web/src/features/quote-builder/lib/quote-workspace.ts`

**Changes**

- Add expanded line-kind totals.
- Add wizard readiness.
- Add follow-up send readiness.
- Add approval-required line-item consideration.
- Add FL delivery county readiness warning/blocking.

**Depends on**

- shared contract extension.

---

### `apps/web/src/features/quote-builder/lib/quote-api.ts`

**Changes**

- Extend `QuoteFinancingRequest`.
- Extend `buildQuoteSavePayload` to include:
  - `wizard_step`
  - `expires_at`
  - `follow_up_at`
  - `deposit_required_amount`
  - `delivery_eta`
  - `delivery_state`
  - `delivery_county`
  - `special_terms`
  - `why_this_machine`
  - `tax_jurisdiction_id`
  - `tax_override_amount`
  - `tax_override_reason`
  - expanded line item fields
  - selected promotions
  - normalized financing scenarios
- Add API helpers:
  - `generateQuoteDocument`
  - `getLatestQuoteDocument`
  - `getQuoteDocumentPreviewUrl`
  - `sendQuoteDeliveryAction`

**Depends on**

- backend `quote-builder-v2` endpoint additions.

---

### `apps/web/src/features/quote-builder/lib/tax-api.ts`

**Changes**

- Extend request and response interfaces for FL county tax.
- Include auth retry behavior consistent with `quote-api.ts` if possible.

**Depends on**

- `tax-calculator` changes.

---

### `apps/web/src/features/admin/lib/pricing-discipline-api.ts`

**Changes**

- No replacement.
- Keep client-side margin exception logging.
- Optionally expose helper for rep discount threshold only if admin UI already manages it.

**Depends on**

- approval policy migration for new thresholds.

---

### `shared/qep-moonshot-contracts.ts`

**Changes**

- Extend quote line kinds.
- Extend draft fields.
- Extend finance scenario fields.
- Add send/document event types if shared across frontend/backend.

**Depends on**

- all frontend and backend payload changes.

---

### `supabase/functions/tax-calculator/index.ts`

**Changes**

- Add `delivery_state`, `delivery_county`, override handling.
- Add FL state + county capped tax path.
- Preserve current exemption and Section 179 behavior.
- Persist richer `quote_tax_breakdowns` if `quote_package_id` is available later; current function only receives `deal_id`, so do not require persistence for preview.

**Depends on**

- `tax_jurisdictions` migration.

---

### `supabase/functions/quote-builder-v2/index.ts`

**Changes**

Validate exact names during implementation from the codemap.

Required endpoint changes:

- `/save`
  - persist new quote package fields
  - persist expanded line items
  - replace normalized financing scenarios
  - persist promotion applications
  - persist wizard step
- `/calculate`
  - include saved scenario/lease support if needed
- `/submit-approval`
  - evaluate new approval triggers:
    - trade max
    - rep discount max
    - line item `approval_required`
- `/send-package`
  - keep backward compatible
  - internally call new email delivery action or remain legacy
- New:
  - `/document/generate`
  - `/document/latest`
  - `/document/preview-url`
  - `/delivery-action`

**Depends on**

- migrations
- shared contract changes

---

### `supabase/migrations/151_tax_intelligence.sql`

**Changes**

- No rewrite.
- Existing `tax_treatments` and exemption certs remain.

---

### `supabase/migrations/167_wave5_closeout_tax_incentives.sql`

**Changes**

- Extend `manufacturer_incentives` with `source`.
- Keep `quote_incentive_applications`.

---

### `supabase/migrations/359_quote_builder_commercial_terms.sql`

**Changes**

- Add quote package wizard/detail fields in a new migration, not by editing historical migration.

---

### `supabase/migrations/363_quote_approval_cases_and_policies.sql`

**Changes**

- Add policy fields in a new migration:
  - `trade_credit_max`
  - `rep_discount_max_pct`

---

### `supabase/migrations/382_quote_workspace_end_to_end.sql`

**Changes**

- Add line item fields/constraint extension in a new migration:
  - expanded `line_type` allowed values
  - `reason_code`
  - `approval_required`

---

### New migration

Create a new migration, for example:

```text
supabase/migrations/<timestamp>_qrm_quote_wizard_schema.sql
```

It should add:

- `tax_jurisdictions`
- `quote_packages` wizard/detail/tax override fields
- `quote_package_line_items` expanded kinds and approval metadata
- `quote_financing_scenarios`
- `quote_document_artifacts`
- `quote_delivery_events`
- `manufacturer_incentives.source`
- `quote_approval_policies.trade_credit_max`
- `quote_approval_policies.rep_discount_max_pct`

---

## 5. **Risks and migration**

### Backward compatibility

- Existing saved quotes must hydrate with missing wizard fields as defaults.
- Existing line item kinds remain valid.
- Existing `sendQuotePackage` callers must keep working.
- Existing quote approval cases remain authoritative.
- Do not rename `quote_packages` or introduce a parallel `quotes` table.

### Rollback strategy

- Wizard UI can be guarded by `FEATURE_QRM_QUOTE_WIZARD`.
- Legacy workspace can remain behind `FEATURE_QUOTE_WORKSPACE_LEGACY` for one release.
- New nullable columns do not break old code.
- New tables are additive.
- Expanded line-type check is backward-compatible but rollback must avoid deleting rows using new kinds.

### Unknowns to validate during implementation

1. Actual `quote-builder-v2/index.ts` endpoint structure and transaction helpers.
2. Whether existing PDF generation can store to R2 or only downloads client-side.
3. Whether `manufacturer_incentives.manufacturer` is actually `NOT NULL` in the target database.
4. Whether existing CRM activity/cadence tables can replace `quote_delivery_events`.
5. Whether catalog data exposes stock/serial and availability status already.

Validation approach: inspect actual DB types/generated `database.types.ts`, backend function routes, and catalog table columns before writing migrations.

---

## 6. **Implementation order**

1. **Add shared contracts first**
   - Extend quote line kinds, draft fields, finance scenario fields.
   - Compile frontend typecheck before behavioral changes.

2. **Add additive migration**
   - New quote package fields.
   - New tax jurisdictions.
   - Expanded line item metadata.
   - Financing scenarios.
   - Document artifacts.
   - Delivery events.
   - Approval policy threshold fields.
   - Incentive source field.

3. **Extend backend save/hydration**
   - Persist and return new draft fields.
   - Keep old payloads valid.
   - Normalize expanded line items.
   - Save financing scenarios transactionally.

4. **Extend tax engine**
   - Add delivery county/state request fields.
   - Implement FL 6% post-trade state tax.
   - Implement county surtax cap.
   - Preserve exemption and Section 179 behavior.

5. **Refactor `QuoteBuilderV2Page` step model**
   - Introduce 11-step union and progress rail.
   - Keep existing 6-step bodies temporarily mapped to new steps.
   - Ensure autosave still works.

6. **Extract and wire Step 1–4**
   - Customer.
   - Equipment.
   - Configure.
   - Trade-in placeholder checklist.

7. **Extract and wire Step 5–8**
   - Pricing build.
   - Promotions.
   - Financing/lease placeholder.
   - Quote details.

8. **Wire Step 9 approval review**
   - Use existing approval APIs.
   - Add new approval triggers server-side.
   - Keep `activeApprovalCase.canSend` as send gate.

9. **Implement Step 10 document artifact flow**
   - Add generate/latest/preview API helpers.
   - Store generated artifact or use explicit pending/fallback behavior.

10. **Implement Step 11 send panel**
    - Preview action.
    - Email composer with Graph flag.
    - Text composer with Twilio flag.
    - Required follow-up.
    - Delivery event logging.

11. **Update tests**
    - Tax math: FL state post-trade, county cap, exemption, override.
    - Workspace totals with new line kinds.
    - Wizard readiness by step.
    - Approval trigger conditions.
    - Send panel follow-up required.
    - Existing saved quote hydration.

12. **Final verification**
    - Typecheck.
    - Unit tests.
    - Quote save/load smoke test.
    - Approval submit smoke test.
    - Tax preview smoke test.
    - Feature-flag disabled states for lease, Graph email, and Twilio text.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "qrm-wizard-plan-05C126", new_chat: false)
---

## Orchestrator decomposition — active checklist

### Item 1 — Foundation/contracts/schema/tax/backend
- [x] Extend shared quote contracts for wizard fields, expanded line kinds, financing scenarios, delivery county/state and tax overrides.
- [x] Add additive Supabase migration(s) for quote package wizard/detail fields, line item metadata, tax jurisdictions, financing scenarios, document artifacts, delivery events, approval policy threshold fields, and incentive source if compatible.
- [x] Extend quote-builder-v2 save/hydration enough to persist new wizard fields/line metadata/finance scenarios without breaking old payloads.
- [x] Extend tax preview engine for FL 6% post-trade state tax, county surtax cap, exemption and override handling.
- [x] Add focused tests for tax math and workspace totals/contracts.

### Item 2 — Wizard UX shell and Steps 1–4
- [x] Refactor `QuoteBuilderV2Page` into an 11-step wizard with progress rail, slide/simple one-step-at-a-time flow, autosave preserved, and legacy workspace fallback if needed.
- [x] Implement/wire Step 1 Customer, Step 2 Equipment, Step 3 Configure, Step 4 Trade-in using existing components where possible.
- [x] Keep UX simple for non-technical salespeople: one primary action per screen, plain language blockers, no overloaded scroll page.

### Item 3 — Steps 5–9 pricing/promotions/financing/details/review
- [x] Implement pricing waterfall, line adders, discount reason codes, tax preview placement, and trade-after-taxable-basis math in UI.
- [x] Implement promotions selection and financing/lease placeholder tabs with TILA disclaimer.
- [x] Implement quote details and review/approval summary, preserving existing approval case gate as the authoritative send gate.

### Item 4 — Steps 10–11 document/send/log plus final verification
- [x] Implement document preview/generate surface with explicit fallback if persistent PDF artifacts are not fully available.
- [x] Replace/extend send section into Preview Quote, Email Quote, Text Quote panel with required follow-up date and feature-flagged Graph/Twilio placeholders.
- [x] Add/adjust tests for wizard readiness, send blocking, approval triggers, and smoke coverage.
- [x] Run lint/typecheck/tests and segment gates if feasible; record remaining risks/blockers. Segment gates latest: `test-results/agent-gates/20260505T141422Z-qrm-quote-wizard.json` failed only credential-dependent KB/design checks in local env.
