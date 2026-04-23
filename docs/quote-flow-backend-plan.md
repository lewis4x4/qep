# Sales Quote Flow Backend Gap Plan

Status: Phase 3 backend gap plan  
Scope: Classify each Phase 2 contract row as READY, AGGREGATION, or MISSING.  
Classification key:

- READY: can be served directly by current schema/code.
- AGGREGATION: data exists but needs a view/RPC/API response shape for the redesigned workspace.
- MISSING: requires migration, backfill, policy work, or new integration.

## Implementation Update

The first end-to-end implementation pass closed three P0 blockers from this plan:

- `RLS-REP-SCOPE`: `supabase/migrations/382_quote_workspace_end_to_end.sql` replaces workspace-wide quote package access with rep-owned access plus admin/manager/owner workspace visibility.
- `CANONICAL-LINE-ITEMS`: the same migration extends `quote_package_line_items` with typed rows for equipment, attachment, warranty, financing, and custom package items; `/save` now syncs those rows from `line_items`.
- `AUTOSAVE-SERVER-STATE`: Workspace Mode now performs a debounced 10-second server save when draft requirements are met and passes `expected_updated_at`; `/save` returns `409` instead of overwriting a newer concurrent edit.

Remaining blockers: persisted AI trigger/citation rows, authoritative line-level dealer cost for Margin Waterfall, SMS delivery tracking, and a stable opportunity-description/voice-transcript field.

## Blocker Flags

| Flag | Severity | Area | Why it blocks UI implementation |
| --- | --- | --- | --- |
| RLS-REP-SCOPE | P0 | Quote access | `quote_packages` policy is workspace-wide, while the redesign requires reps only see their own quotes except managers. |
| AUTOSAVE-SERVER-STATE | P0 | Save model | Current incomplete drafts use `localStorage`; there is no debounced server autosave, last-saved contract, or conflict handling. |
| CANONICAL-LINE-ITEMS | P0 | Multi-item packages | Current package data is split across JSON arrays, `quote_package_line_items`, and `qb_quote_line_items`; none is the clear canonical model for equipment/attachment/warranty/financing/custom with ordering. |
| AI-TRIGGER-CITATION | P1 | AI suggestions | Recommendation/Copilot paths exist, but the "empty until triggered with visible citation" rule needs explicit persisted trigger metadata. |
| MARGIN-AUTHORITY | P1 | Margin Waterfall | Review waterfall exists, but dealer cost is estimated as 80 percent of subtotal and not sourced from authoritative line-level cost data. |
| STATUS-TRACKING | P1 | Customer status | `viewed` and `viewed_at` exist, but delivery/open/link tracking needs to be hardened for email/SMS/print/link review flows. |

## Contract Classification

| Element | Field | Classification | Current support | Backend work required |
| --- | --- | --- | --- | --- |
| Persistent quote total | `equipment_total` | AGGREGATION | Equipment exists in `quote_packages.equipment` JSON and frontend draft arrays. | Define canonical line-item source and expose quote totals view/RPC/API response. |
| Persistent quote total | `attachment_total` | AGGREGATION | Attachments exist in `attachments_included` JSON and draft arrays. | Move/shape through canonical line items. |
| Persistent quote total | `discount_total` | READY | `quote_packages.discount_amount` exists and client calculates discount. | Ensure save/autosave returns current value. |
| Persistent quote total | `trade_credit` | READY | `quote_packages.trade_allowance` and `trade_valuations` exist. | Normalize as line/economics input if package model changes. |
| Persistent quote total | `tax_total` | READY | `quote_packages.tax_amount` exists and financing step calculates tax from profile. | Add default tax profile resolver so branch/tax does not block happy path. |
| Persistent quote total | `cash_down` | AGGREGATION | Draft field exists; amount financed persists. | Persist explicit down payment/cash down in structured financing/commercial terms, not only derived totals. |
| Persistent quote total | `customer_total` | READY | `quote_packages.total_amount` exists. | Expose in workspace read model and autosave response. |
| Persistent quote total | `amount_financed` | READY | `quote_packages.amount_financed` exists. | Expose in workspace read model and autosave response. |
| Persistent quote total | `financing_method_label` | AGGREGATION | Finance scenario response and financing JSON exist. | Persist selected method/partner in a stable field or structured financing object. |
| Quote status chip | `status` | READY | `quote_packages.status` supports draft, sent, viewed, approved, expired, rejected/accepted variants. | Product decision: map declined to `rejected` or add `declined`. |
| Quote status chip | `sent_at` | READY | `quote_packages.sent_at` exists and `/send-package` updates it. | None beyond read model. |
| Quote status chip | `viewed_at` | READY | `quote_packages.viewed_at` exists and `/mark-viewed` updates it. | Validate customer tracking path for every delivery option. |
| Quote status chip | approval state | AGGREGATION | Approval status exists across `quote_packages` and approval cases. | Add status/readiness view that reconciles quote package, approval case, and signature state. |
| Last-saved indicator | `last_saved_at` | MISSING | `updated_at` exists, but incomplete drafts are local only. | Add server autosave endpoint/operation returning authoritative save timestamp. |
| Last-saved indicator | `save_state` | MISSING | Client manual mutation state exists only in page behavior. | Implement debounced autosave state machine and error/conflict states. |
| Last-saved indicator | `version` | AGGREGATION | `quote_packages.version` exists. | Use version/updated_at as optimistic concurrency token in save/autosave. |
| Package line items list | `line_id` | MISSING | JSON equipment/attachment rows do not have stable DB row ids. | Adopt canonical quote line item table and backfill IDs from JSON package arrays. |
| Package line items list | `line_type` | MISSING | `qb_quote_line_items` lacks equipment/warranty/financing/custom; current `quote_package_line_items` is not canonical. | Add/extend enum/table for equipment, attachment, warranty, financing, custom. |
| Package line items list | `catalog_ref` | AGGREGATION | Catalog IDs exist for some equipment/attachments. | Standardize nullable catalog references by line type. |
| Package line items list | `description` | AGGREGATION | Exists inside JSON payloads and line tables. | Shape through canonical line item read/write API. |
| Package line items list | `quantity` | AGGREGATION | Exists for some line shapes. | Standardize default quantity and validation. |
| Package line items list | `unit_price` | AGGREGATION | Exists in JSON and line tables. | Standardize cents/numeric representation and source priority. |
| Package line items list | `display_order` | MISSING | No clear order field in current JSON save path. | Add `display_order` to canonical line items and reorder mutation/autosave. |
| Trade-in line item | `trade_valuation_id` | READY | `quote_packages.trade_valuation_id` exists. | None beyond read model. |
| Trade-in line item | `book_value_range` | AGGREGATION | Trade valuation/range data exists through trade functions/table. | Expose as stable quote workspace field with source attribution. |
| Trade-in line item | `book_value_source` | AGGREGATION | Market/source data exists in valuation payloads. | Normalize source attribution for visible citation. |
| Trade-in line item | `condition` | READY | Trade valuation/manual input captures condition. | Ensure quote workspace read model includes it. |
| Trade-in line item | `allowance` | READY | `quote_packages.trade_allowance` exists. | None beyond canonical economics model. |
| Commercial terms | `branch_id` / `branch_slug` | AGGREGATION | Draft branch slug exists; branch tables exist. | Add default branch resolver from rep profile and make it non-blocking. |
| Commercial terms | `discount_type` | AGGREGATION | Draft field exists; only discount amount persists cleanly. | Persist discount type/value as structured commercial terms. |
| Commercial terms | `discount_value` | AGGREGATION | Draft field exists; quote package stores computed amount. | Persist raw discount input as structured commercial terms. |
| Commercial terms | `tax_profile` | AGGREGATION | Draft field exists. | Persist selected/default tax profile and tax source. |
| Commercial terms | `down_payment` | AGGREGATION | Draft field exists; amount financed persists. | Persist raw down payment field. |
| Commercial terms | `financing_method` | AGGREGATION | Finance scenario and financing JSON exist. | Persist selected finance partner/method explicitly. |
| Customer Digital Twin | customer IDs | READY | CRM/customer selection exists. | Ensure saved quote stores stable CRM IDs, not only company/contact text. |
| Customer Digital Twin | `win_probability` | READY | Deterministic score and saved snapshot fields exist. | Include in workspace read model. |
| Customer Digital Twin | `signals` | READY | Win probability context creates lifts/risks/signals. | Include signal source metadata where shown. |
| Customer Digital Twin | `open_deals` | AGGREGATION | Deal data exists. | Add customer twin view/RPC scoped to selected customer. |
| Customer Digital Twin | `past_quotes` | AGGREGATION | Historical quote packages exist. | Add customer twin view/RPC with quote history and fleet extraction. |
| Customer Digital Twin | `last_touch` | AGGREGATION | CRM activity/contact data exists. | Add customer twin view/RPC. |
| Customer Digital Twin | `fleet_history` | AGGREGATION | Past quotes/equipment/service/rental data likely exist in separate domains. | Add aggregation and source labeling. |
| Opportunity description | `description_text` | MISSING | Voice summary/prompt exists transiently; no stable quote field found. | Add workspace opportunity description field or structured metadata. |
| Opportunity description | `voice_transcript` | AGGREGATION | Voice/transcription functions exist. | Link transcript record to quote package and expose in read model. |
| Opportunity description | `originating_log_id` | AGGREGATION | Voice/QRM logs exist. | Persist stable quote origin reference. |
| AI Copilot suggestions | `trigger_type` | MISSING | Current AI calls are request-driven but not persisted as trigger rows. | Add trigger registry/metadata on suggestions. |
| AI Copilot suggestions | `trigger_source_field` | MISSING | Not found as normalized persisted field. | Persist field/source that triggered suggestion. |
| AI Copilot suggestions | `trigger_excerpt` | MISSING | Not found as normalized persisted field. | Persist visible citation excerpt. |
| AI Copilot suggestions | `suggestion_text` | READY | `/recommend`, scenario SSE, and `qb_quote_copilot_turns.copilot_reply` exist. | Route through trigger/citation rules before display. |
| AI Copilot suggestions | `suggestion_state` | AGGREGATION | Some action/dismiss state exists for Deal Coach; Copilot state is turn-based. | Add suggestion apply/dismiss state if suggestions persist beyond turns. |
| Deal Coach flags | `rule_id` | READY | Rule engine and action persistence exist. | Include in workspace read model. |
| Deal Coach flags | `severity` | READY | Deal Coach computes severity/status. | Include in workspace read model. |
| Deal Coach flags | title/body | READY | Deal Coach outputs visible guidance. | Include in workspace read model. |
| Deal Coach flags | `source_context` | AGGREGATION | Inputs exist across margin/program/reason/similar-deal calls. | Shape evidence context and source labels. |
| Deal Coach flags | `action_state` | READY | `qb_deal_coach_actions` persists actions. | Include in read model. |
| Margin Waterfall | `equipment_revenue` | AGGREGATION | Equipment revenue can be computed from JSON/draft arrays. | Serve from canonical line items. |
| Margin Waterfall | `attachment_revenue` | AGGREGATION | Attachment revenue can be computed from JSON/draft arrays. | Serve from canonical line items. |
| Margin Waterfall | `dealer_cost` | MISSING | Current code estimates cost as 80 percent of subtotal. | Integrate authoritative line-level cost source and permissions. |
| Margin Waterfall | `discount_impact` | READY | Discount amount exists and is computed. | Include in waterfall read model. |
| Margin Waterfall | `trade_impact` | AGGREGATION | Trade allowance and valuation exist. | Define whether trade affects margin, financed amount, both, and source attribution. |
| Margin Waterfall | `net_margin` | AGGREGATION | Client computes estimated margin. | Recompute server-side from authoritative revenue/cost/discount/trade/program inputs. |
| Margin Waterfall | `margin_percent` | AGGREGATION | Client computes margin percent and snapshots may persist. | Server-side authoritative calculation. |
| Margin Waterfall | `source_attribution` | MISSING | Current quote waterfall lacks visible cost/trade/program source attribution. | Add source metadata fields/API output. |

## Required Gap Calls

### Multi-item Package Support

Current state:

- Frontend draft state supports arrays of equipment and attachments.
- `/quote-v2` save writes those arrays into `quote_packages.equipment` and `quote_packages.attachments_included`.
- `quote_package_line_items` exists but is not the canonical current save/read model.
- `qb_quotes` and `qb_quote_line_items` exist, but `qb_quotes` still has a single `equipment_model_id`, and `qb_quote_line_items.line_type` does not cover the target model of equipment/attachment/warranty/financing/custom.

Required to lift constraints:

1. Choose the canonical table family for quote workspace packages.
2. Add or extend a line item table with `quote_package_id` or `quote_id`, `line_type`, `catalog_ref`, `description`, `quantity`, `unit_price`, `unit_cost`, `taxability`, `display_order`, `metadata`, `created_by`, and timestamps.
3. Backfill current `quote_packages.equipment` and `attachments_included` JSON arrays into line rows.
4. Update `/save` and read endpoints to write/read line items transactionally with quote package totals.
5. Preserve compatibility for historical quotes during migration.

Migration cost: moderate to high. The data exists, but the canonical model is split and multiple feature surfaces depend on the old JSON payload.

### Auto-Save

Current state:

- Incomplete drafts are saved to `localStorage`.
- Manual save uses `/save` and requires enough quote content to create/update `quote_packages`.
- No debounced server sync, explicit last-saved server timestamp, conflict state, or optimistic concurrency behavior was found.

Required:

1. Server draft save endpoint that accepts partial quote state.
2. Debounced client write target of 10 seconds max, plus Cmd-S manual save.
3. `version` or `updated_at` concurrency token on every write.
4. Conflict response when a stale client attempts to overwrite a newer server version.
5. Read model that returns `last_saved_at`, `version`, and normalized quote workspace state.

Classification: MISSING.

### AI Copilot Suggestions

Current state:

- AI equipment recommendation exists via `/recommend`.
- Scenario/deal assistance exists through streaming scenario flows.
- Per-quote Copilot history exists through `qb_quote_copilot_turns`.
- Deal Coach has rule-driven flags and persisted actions.

Gap:

- The redesigned rule requires AI suggestions to be empty until a specific trigger condition is met, and every suggestion must cite the input that triggered it.
- Existing AI paths do not provide a single persisted suggestion object with `trigger_type`, `trigger_source_field`, `trigger_excerpt`, `suggestion_text`, and `suggestion_state`.

Required:

1. Define trigger registry, for example customer selected, opportunity text entered, equipment added, margin below threshold, trade value changed, discount changed.
2. Persist trigger/citation metadata with every generated suggestion.
3. Separate deterministic Deal Coach flags from generated AI suggestions in the API response.
4. Make suggestions non-blocking on initial render. The workspace should render without AI output and populate only after trigger events.
5. Latency budget: initial workspace render under 1.5 seconds without waiting for AI. Triggered suggestion requests should stream or show loading within 1 second and should not block quote editing; long-running scenario streams can continue asynchronously.

Classification: MISSING for trigger/citation; READY/AGGREGATION for existing AI generation paths.

### Status State Machine and Customer Viewed Tracking

Current state:

- `quote_packages.status` supports `viewed` and `viewed_at`.
- `/mark-viewed` exists.
- `share_token` exists.
- `/send-package` updates sent state and enforces approval/margin checks.

Gaps:

- Product status labels need final mapping. `declined` is not currently a `quote_packages.status` value; closest current value is `rejected`.
- Customer viewed tracking should be validated for every delivery route: email, SMS, print, and copied link.
- Email open pixel vs quote-link tracking should be decided. Link tracking is safer and already aligned with `share_token` and `mark-viewed`; email-open pixels can be blocked by clients.

Required:

1. Define canonical state machine transitions and guards.
2. Map or add `declined`.
3. Track share link opens through `mark-viewed` and optionally store channel/source/user agent metadata.
4. Ensure send is blocked when required fields or approval gates fail.

Classification: READY for base viewed support; AGGREGATION/MISSING for complete tracking and label mapping.

### RLS and Rep Access

Current state:

- `quote_packages` RLS is workspace-wide.
- `trade_valuations` also uses workspace-scoped access.
- Newer `qb_quotes` policies are not the active `/quote-v2` persistence path and still need validation against manager/rep role rules.

Required:

1. Update `quote_packages` and dependent tables so sales reps can select/update their own quotes.
2. Add explicit manager/admin exceptions.
3. Ensure service-role edge functions verify caller access before reading or mutating quote packages, especially by `deal_id`, `share_token`, or package id.
4. Include related records: line items, signatures, approval cases, copilot turns, deal coach actions, and trade valuations.

Classification: MISSING and P0 blocker for production redesign.

## Backend Work Sequence Before UI Implementation

1. Decide canonical quote workspace read/write model.
2. Design and migrate typed quote line items.
3. Add partial draft autosave with concurrency tokens.
4. Add quote workspace read model that returns totals, status, last saved, line items, commercial terms, customer twin summary, Deal Coach flags, AI suggestion state, and Margin Waterfall.
5. Harden RLS to rep-own plus manager exceptions.
6. Add trigger/citation persistence for AI suggestions.
7. Define status state machine and customer viewed tracking path.
8. Backfill existing quote package JSON into the canonical line model.

## Pre-Phase-4 Decision Points

- Approve `quote_packages` as the continuing parent table, or migrate `/quote-v2` to `qb_quotes`.
- Decide whether `declined` is a new status value or UI label for `rejected`.
- Decide whether Margin Waterfall can use estimated dealer cost initially, or must wait for authoritative cost data.
- Decide whether customer Digital Twin should be a materialized view/RPC or assembled from multiple existing APIs.
- Decide if email-open tracking is required, or if customer link open tracking is sufficient for `viewed`.
