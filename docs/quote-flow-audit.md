# Sales Quote Flow Audit

Status: Phase 1, read-only audit  
Primary route under audit: `/quote-v2`  
Supporting routes: `/quote`, `/voice-quote`  
Evidence sources: route wiring, React components, Supabase migrations, generated database types, edge functions, and supplied production screenshots.

## Surprises

1. The current builder is already a 6-step flow in code, not just in production screenshots. `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx:90` defines `entry`, `customer`, `equipment`, `tradeIn`, `financing`, and `review`; `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx:1144` renders the step rail.
2. `/quote-v2` saves through the older `quote_packages` JSON-backed model, while newer normalized-looking quote tables also exist. The save payload writes `equipment` and `attachments_included` JSON arrays in `apps/web/src/features/quote-builder/lib/quote-api.ts:640`; the table is defined in `supabase/migrations/087_quote_builder_v2.sql:57`. Newer `qb_quotes` and `qb_quote_line_items` were added in `supabase/migrations/286_qb_quotes_deals.sql:29`, but `/quote-v2` does not appear to use them as the primary persistence path.
3. Incomplete drafts are persisted to `localStorage`, not server-side auto-save. The local draft key and hydration live in `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx:435`; server save is a manual mutation in `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx:632`.
4. `quote_packages` RLS is workspace-wide for all authenticated users in the workspace. `supabase/migrations/087_quote_builder_v2.sql:150` allows `workspace_id = public.get_active_workspace_id()`, which is broader than the redesign requirement that reps only see their own quotes except managers.
5. Customer viewed tracking already exists. `supabase/migrations/256_quote_package_viewed_at.sql:14` adds `viewed_at`, `supabase/migrations/370_quote_share_tokens.sql:14` adds `share_token`, and the edge function implements `mark-viewed` in `supabase/functions/quote-builder-v2/index.ts:3132`.
6. Margin Waterfall is present, but only in review-time UI and it is based on an estimated dealer cost. `apps/web/src/features/quote-builder/components/MarginCheckBanner.tsx:40` renders the waterfall; `apps/web/src/features/quote-builder/lib/quote-workspace.ts:83` computes dealer cost as `subtotal * 0.8`. A separate `margin_waterfalls` table exists in `supabase/migrations/013_dge_foundation.sql:400`, but that table is tied to deal scenarios and the migration explicitly gates it away from reps.
7. Point-Shoot-Trade is available inside the trade-in step, but it is not an equal entry card on Step 1. The Step 1 cards are Voice, AI Chat, and Manual in `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx:1185`; the trade photo card appears later through `PointShootTradeCard` in `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx:1581`.

## A. Current Implementation Inventory

### Routes, Pages, and Route Owners

| Route | Owner | Purpose | Evidence |
| --- | --- | --- | --- |
| `/quote` | `QuoteListPage` | Quote list/manage route. | `apps/web/src/App.tsx:1092` |
| `/quote-v2` | `QuoteBuilderV2Page` | Current 6-step quote builder. | `apps/web/src/App.tsx:1103` |
| `/quotes` | Redirect to `/quote` | Legacy alias. | `apps/web/src/App.tsx:1098` |
| `/voice-quote` | `VoiceQuotePage` | Voice entry and handoff surface. | `apps/web/src/App.tsx:64` |
| Floor quick action | Sales role floor layout | New Quote action points at `/quote-v2`. | `apps/web/src/features/floor/lib/default-layouts.ts` |

### Quote Builder Page and Step Components

The current builder is centered in `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx`.

| Area | Components / modules | Notes |
| --- | --- | --- |
| Step shell | `QuoteBuilderV2Page`, `QUOTE_STEPS` | Six-step wizard: Entry, Customer, Equipment, Trade-In, Financing, Review. |
| Entry | inline entry cards in `QuoteBuilderV2Page` | Voice, AI Chat, Manual. Trade Photo is not present as entry method. |
| Customer | `CustomerPicker`, `SelectedCustomerChip`, `CustomerInfoCard`, `CustomerIntelPanel` | Customer search, selected customer, Digital Twin-style summary, recommended CTA. |
| Equipment | `EquipmentSelector`, `AiRecommendationCard`, `IntelligencePanel` | Catalog search, AI recommendation, selected equipment and attachments. |
| Trade-In | `TradeInSection`, `PointShootTradeCard`, `TradeInInputCard` | Photo/manual trade capture and trade value handoff. |
| Financing | `FinancingCalculator`, `TaxBreakdown`, `FinancingPreviewCard` | Discount, tax profile, cash down, financed amount, finance preview. |
| Review | `WinProbabilityStrip`, `MarginCheckBanner`, `MarginFloorGate`, `QuoteReviewWorkflowPanels`, `SendQuoteSection`, `IncentiveStack`, `QuotePDFDocument`, `useQuotePDF` | Readiness, margin, workflow, PDF/send actions. |
| Right rail | `IntelligencePanel`, `DealCoachSidebar`, `ConversationalDealEngine`, `DealCopilotPanel` | Recommendation, financing preview, Deal Coach, Deal Assistant/Copilot surfaces. |
| Quote calculations | `computeQuoteWorkspace`, `getSendReadiness`, `computeWinProbabilityContext`, `computeWinProbability` | Client-side workspace totals, readiness, and deterministic win probability. |
| API layer | `quote-api.ts`, `quote-approval.ts`, `quote-pdf.ts`, `quote-workspace.ts` | Edge function calls, save payload shaping, approval state, PDF generation helpers. |

### Supabase Tables, Views, RPCs, and Edge Functions

#### Primary quote tables

| Object | Role in current flow | Evidence / notes |
| --- | --- | --- |
| `quote_packages` | Primary `/quote-v2` persistence table. Stores quote package, customer snapshot, equipment JSON, attachment JSON, financing JSON, totals, status, approval fields, share token, viewed tracking. | `supabase/migrations/087_quote_builder_v2.sql:57`; status widened in `supabase/migrations/378_quote_packages_status_widen.sql:17`; viewed/share-token fields in `256_quote_package_viewed_at.sql` and `370_quote_share_tokens.sql`. |
| `quote_package_line_items` | Existing normalized line-item table, but current save payload does not use it for canonical package lines. It appears tied to price intelligence/catalog impact. | `supabase/migrations/155_price_intelligence_completion.sql:32`. |
| `qb_quotes` | Newer quote table with deal linkage, single `equipment_model_id`, pricing fields, status, and metadata. | `supabase/migrations/286_qb_quotes_deals.sql:29`. |
| `qb_quote_line_items` | Newer line-item table for attachments, trade-in, discounts, credits, adjustments. It does not currently model equipment/warranty/financing/custom line types. | `supabase/migrations/286_qb_quotes_deals.sql:127`. |
| `trade_valuations` | Trade capture and valuation table used by Point-Shoot-Trade. | `supabase/migrations/074_trade_valuations.sql:14`. |
| `quote_approval_cases` | Approval workflow state for margin/floor exceptions. | Referenced by `QuoteReviewWorkflowPanels` and quote approval logic. |
| `quote_signatures` | Customer signature/acceptance table for quote packages. | `supabase/migrations/087_quote_builder_v2.sql:111`. |
| `qb_quote_copilot_turns` | Per-quote Copilot turn history and extracted context. | `supabase/migrations/373_qb_copilot_state.sql:34`. |

#### Catalog, CRM, and Digital Twin inputs

| Object / area | Role |
| --- | --- |
| `customers`, CRM contact/company data | Customer search and selected customer identity. |
| `deals` / pipeline tables | Deal carry-through, customer open deal context, quote-to-deal linkage. |
| `qb_equipment_models` and catalog tables | Equipment search and AI recommendation source. |
| `quote_packages` historical rows | Past quote and fleet history signals in `CustomerIntelPanel`. |
| `voice_to_qrm` / request logs | Voice intake and scenario context handoff. |
| `price_change_impact` view / pricing intelligence tables | Price impact and attachment/catalog intelligence. |
| `margin_waterfalls` | Existing manager/owner-only deal scenario economics table, not current quote workspace source. |

#### Edge functions and API actions

| Edge function / action | Role | Evidence |
| --- | --- | --- |
| `quote-builder-v2` `/recommend` | AI equipment recommendation from prompt/customer/equipment context. | `supabase/functions/quote-builder-v2/index.ts:2404` |
| `quote-builder-v2` `/calculate` | Financing scenario calculation. | `supabase/functions/quote-builder-v2/index.ts:2540` |
| `quote-builder-v2` `/save` | Manual quote package save/upsert. | `supabase/functions/quote-builder-v2/index.ts:2880` |
| `quote-builder-v2` `/mark-viewed` | Marks shared quote as viewed. | `supabase/functions/quote-builder-v2/index.ts:3132` |
| `quote-builder-v2` `/share` | Creates or retrieves share token/link. | `supabase/functions/quote-builder-v2/index.ts:3771` |
| `quote-builder-v2` `/send-package` | Sends quote package and updates sent status. | `supabase/functions/quote-builder-v2/index.ts:3806` |
| `qb-copilot-turn` | Per-quote Deal Copilot turn handling. | Called by `DealCopilotPanel`; persisted by `qb_quote_copilot_turns`. |
| `qb-parse-request` | Parses quote intake/request text. | Related quote intake edge function. |
| `quote-incentive-resolver` | Resolves incentive/program stack. | Used by review/approval surfaces. |
| `equipment-vision`, `trade-book-value-range`, `trade-valuation` | Point-Shoot-Trade image identification and valuation flow. | Used by trade components and trade valuation table. |
| `voice-to-qrm`, `voice-capture-sync`, `iron-transcribe` | Voice quote and QRM handoff support. | Used by voice quote surfaces. |

### Visible Feature Classification

| Feature | Real implementation or mockup-only? | Notes |
| --- | --- | --- |
| Digital Twin | Real, lightweight | `CustomerIntelPanel` shows open deals, past quotes, last touch, fleet history, and credit tier-like fields from available customer/deal/quote context. It is not a full behavioral twin. |
| AI Recommendation | Real after trigger, but screenshots imply always-present rail | `/recommend` calls `quote-builder-v2`; `AiRecommendationCard` renders only when recommendation data exists. Production screenshots show a persistent recommendation, which may be demo/preloaded state rather than fresh user-triggered context. |
| Deal Coach | Real | `DealCoachSidebar` evaluates rule-driven suggestions with margin/program/context inputs and persists actions. |
| Point-Shoot-Trade | Real, but mid-flow only | Trade photo capture is available in Step 4. It is not an equal Step 1 entry method. |
| Biggest Lifts / Resting On | Real, rule-based | `WinProbabilityStrip` renders lifts and risks from deterministic win probability context. |
| Job Considerations | Real when recommendation includes them | Displayed through `AiRecommendationCard` when the AI response includes considerations. |
| Urgency Signal | Partially real / mostly state-derived | The visible signal is driven by quote/customer/voice state and may default to "No voice signal attached yet." No independent urgency service was found. |
| Next Move | Partially real / state-derived | The rail copy changes with state, but it is not a separate task engine. |
| Pipeline Carry-Through | Partially real | Deal linkage exists, but visible carry-through guidance is mostly status copy unless a linked deal/customer context is present. |
| Deal Assistant | Real | `ConversationalDealEngine` supports scenario/cold-start assistance and related streaming paths. |
| Iron Advisor | Real launcher/context surface | The builder includes `AskIronAdvisorButton`; broader Iron Advisor behavior lives outside this specific wizard. |
| Commercial Readiness | Real, client-computed | `computeQuoteWorkspace` and review workflow panels compute readiness, approval state, and missing fields. |
| Win Probability | Real, deterministic | `computeWinProbability` and `WinProbabilityStrip` produce live score/lifts/risks; save snapshots can be persisted. |
| Financing Preview | Real | Uses `/calculate` through quote financing APIs. |
| Margin Waterfall | Real but review-only and estimated | `MarginCheckBanner` renders review-time unit economics using client-estimated dealer cost, not an authoritative per-line cost source. |

## B. Data Model

### Current Quote Tables

`quote_packages` is the current `/quote-v2` source of truth. Important fields include:

| Field group | Fields |
| --- | --- |
| Identity | `id`, `workspace_id`, `deal_id`, `created_by`, `quote_number`, `version`, `created_at`, `updated_at` |
| Customer snapshot | `customer_company`, `customer_contact`, `customer_email`, `customer_phone` |
| Package content | `equipment` JSONB, `attachments_included` JSONB, `trade_valuation_id`, `financing` JSONB |
| Commercial totals | `subtotal`, `discount_amount`, `trade_allowance`, `tax_amount`, `total_amount`, `amount_financed` |
| Status/workflow | `status`, `valid_until`, `sent_at`, `sent_via`, `viewed_at`, `share_token`, approval fields |
| Intelligence snapshots | AI recommendation fields, win probability snapshot fields, summary fields |

`quote_package_line_items` exists, but it is not the canonical line-item source for the current save path. The current API payload still serializes equipment and attachments into JSONB columns.

`qb_quotes` and `qb_quote_line_items` provide a newer quote model. However, `qb_quotes` contains a single `equipment_model_id`, while `qb_quote_line_items.line_type` is limited to attachment/trade-in/discount/credit/adjustment. This is not yet the target multi-item package model.

### Trade-Ins

`trade_valuations` stores trade-in capture and valuation details, including customer/equipment context and valuation ranges. The quote package stores `trade_valuation_id` and `trade_allowance`, so the quote flow currently combines a linked valuation record with a quote-level credit.

### Customers and Digital Twin Sources

Current customer context is assembled from CRM customer/contact data, linked deals, historical `quote_packages`, and selected quote draft state. The UI exposes this as a compact Digital Twin, but it is a composite client/server view rather than one canonical `customer_digital_twin` table.

### RLS Policies

`quote_packages` is currently workspace-scoped, not rep-scoped. Any authenticated workspace user can access rows under the migration policy in `supabase/migrations/087_quote_builder_v2.sql:150`. Newer `qb_quotes` policies are somewhat narrower for updates, but still allow team/workspace visibility patterns that need verification against the "rep own except managers" requirement.

### Current Quote Status Enum / State Machine

`quote_packages.status` now allows:

`draft`, `pending_approval`, `approved`, `approved_with_conditions`, `changes_requested`, `ready`, `sent`, `viewed`, `accepted`, `rejected`, `expired`, `converted_to_deal`, `archived`.

The redesign requested `draft/sent/viewed/approved/declined/expired`. Current support is close, but `declined` maps to `rejected` unless the product wants a new status label/value. Customer `viewed` tracking exists through `viewed_at` and `mark-viewed`.

## C. Known Pain Points in Production

### Data that could be inferred but currently blocks flow

- Branch selection can become a late blocker. The code defaults branch only when exactly one branch is available; otherwise Step 5 warns that tax, save, and send readiness remain unresolved until a branch is selected.
- Tax profile and financing defaults are not fully inferred from rep/customer/branch context. They are editable in Step 5 and can delay send readiness.
- Customer email is required for send readiness, even when a rep is still drafting and may only know the company or contact.

### AI shown before real input

- In code, the recommendation starts empty and is populated by `/recommend` from voice or prompt input. The screenshots show a persistent right-rail recommendation across steps, which can read as pre-populated AI even before fresh quote context is entered.
- Win probability and Deal Coach can show default/generated guidance from partial quote state. That is useful, but the redesign rule "AI is empty until triggered" needs a stricter distinction between deterministic status flags and generated suggestions.

### Multi-item package support

- Frontend draft state allows multiple equipment entries and attachments.
- Persistence serializes equipment and attachments as JSON arrays on `quote_packages`.
- Normalized line tables exist, but they are split across `quote_package_line_items` and `qb_quote_line_items`, neither of which currently provides the target typed package model of equipment/attachment/warranty/financing/custom with ordering and authoritative pricing/cost/tax metadata.

### Auto-save

- No debounced server auto-save was found for the current builder.
- Incomplete quote drafts are saved to `localStorage`; database save is manual or occurs before send/approval flows.
- There is no observed optimistic concurrency or conflict resolution model for simultaneous edits.

### Running quote total

- Totals are live-computed in the client via `computeQuoteWorkspace` from draft equipment, attachments, discount, trade, tax, and cash down.
- The total is not persistent in a top bar. It appears primarily in financing/review sections and right-rail financing preview.
- The Margin Waterfall is only review-time, not visible in the main workspace while reps add discounts, trades, and attachments.

## D. Audit Conclusion

The current flow has substantial real backend and AI infrastructure, but the user experience is still wizard-first and the canonical data model is split. The most important pre-redesign risks are:

- Choose and harden one canonical quote line-item model before building the workspace.
- Replace local-only draft persistence with server auto-save and conflict detection.
- Tighten quote RLS to rep-own visibility with explicit manager exceptions.
- Keep AI suggestions empty until trigger conditions are met, and persist visible trigger/citation metadata.
- Move Margin Waterfall into the workspace only after defining authoritative unit economics fields.
