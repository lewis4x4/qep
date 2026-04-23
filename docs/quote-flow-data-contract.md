# Sales Quote Flow Data Contract

Status: Phase 2 data contract  
Scope: Proposed single-screen quote workspace plus preserved Guided Mode.  
Rule: This contract documents the data required by the redesigned UI. It does not approve UI implementation.

| Element | Field | Type | Source of truth | Computed? | Refresh |
| --- | --- | --- | --- | --- | --- |
| Persistent quote total | `equipment_total` | money cents / numeric | Current: sum of `quote_packages.equipment[].price`; target: canonical package line items where `line_type = equipment` | Yes | Recompute immediately on line item change; persist on save/autosave response |
| Persistent quote total | `attachment_total` | money cents / numeric | Current: sum of `quote_packages.attachments_included[].price`; target: canonical package line items where `line_type = attachment` | Yes | Recompute immediately on line item change; persist on save/autosave response |
| Persistent quote total | `discount_total` | money cents / numeric | Current: `quote_packages.discount_amount` plus draft commercial discount fields | Yes | Recompute immediately on discount change; persist on save/autosave response |
| Persistent quote total | `trade_credit` | money cents / numeric | Current: `quote_packages.trade_allowance` and linked `trade_valuations` | Partly | Recompute immediately on trade allowance change; refresh linked valuation when trade valuation changes |
| Persistent quote total | `tax_total` | money cents / numeric | Current: `quote_packages.tax_amount`, draft `taxProfile`, branch tax settings | Yes | Recompute when branch, tax profile, line items, discount, or trade changes |
| Persistent quote total | `cash_down` | money cents / numeric | Current: draft `cashDown`, saved in `quote_packages.financing` / `amount_financed` derivation | No | Update immediately on input; persist on save/autosave response |
| Persistent quote total | `customer_total` | money cents / numeric | Current: `quote_packages.total_amount`; target: computed from line items, discount, trade, tax | Yes | Recompute within 150ms of any contributing input change; persist on save/autosave response |
| Persistent quote total | `amount_financed` | money cents / numeric | Current: `quote_packages.amount_financed`; draft computed in `computeQuoteWorkspace` | Yes | Recompute when customer total or cash down changes |
| Persistent quote total | `financing_method_label` | string | Current: selected finance scenario from `/calculate` response or cash/default draft state | Partly | Refresh when financing scenario, amount financed, or finance partner changes |
| Quote status chip | `status` | enum | Current: `quote_packages.status`; target enum label map for draft/sent/viewed/approved/declined/expired | No | Refresh after save, send, approval, viewed, signature, expiration, or manual status transition |
| Quote status chip | `sent_at` | timestamp | `quote_packages.sent_at` | No | Refresh after send-package action |
| Quote status chip | `viewed_at` | timestamp | `quote_packages.viewed_at` | No | Refresh from `mark-viewed` tracking and polling/realtime update |
| Quote status chip | `approved_at` / approval state | timestamp / enum | Current approval workflow tables and `quote_packages.status` | Partly | Refresh after approval workflow action |
| Last-saved indicator | `last_saved_at` | timestamp | Current: `quote_packages.updated_at`; target: explicit autosave response timestamp | No | Update after every successful autosave/manual save |
| Last-saved indicator | `save_state` | enum: idle/saving/saved/error/conflict | Client save state plus server response/conflict result | Yes | Immediate client state update; server confirmation on save/autosave response |
| Last-saved indicator | `version` | integer | Current: `quote_packages.version`; target: monotonic server version or row update token | No | Refresh after save/autosave; compare before overwriting |
| Package line items list | `line_id` | uuid | Current: missing for JSON equipment/attachments; target: canonical quote line item row id | No | Assigned on add/save; stable after autosave |
| Package line items list | `line_type` | enum: equipment/attachment/warranty/financing/custom | Current: split across JSON arrays and limited `qb_quote_line_items.line_type`; target: canonical enum | No | Update immediately on add/edit; persist on autosave |
| Package line items list | `catalog_ref` | uuid / nullable | Catalog equipment/attachment tables, `qb_equipment_models`, or custom null | No | Refresh when selected from catalog or changed manually |
| Package line items list | `description` | string | Current JSON line description/name; target line item description | No | Immediate local edit; persist on autosave |
| Package line items list | `quantity` | number | Current attachment/equipment JSON or target line item quantity | No | Immediate local edit; persist on autosave |
| Package line items list | `unit_price` | money cents / numeric | Current JSON price; target line item unit price | No | Immediate local edit; recompute totals |
| Package line items list | `display_order` | integer | Current: missing in JSON save path; target canonical line item order | No | Update on reorder; persist on autosave |
| Trade-in line item | `trade_valuation_id` | uuid / nullable | `quote_packages.trade_valuation_id` and `trade_valuations.id` | No | Refresh when trade photo/manual valuation completes |
| Trade-in line item | `book_value_range` | money range | `trade_valuations` plus trade valuation edge function response | Partly | Refresh after valuation update or source refresh |
| Trade-in line item | `book_value_source` | string / source metadata | `trade_valuations` valuation source and market comps payload | No | Refresh after valuation update |
| Trade-in line item | `condition` | enum/string | `trade_valuations` condition fields or manual trade input | No | Immediate local edit; persist on autosave |
| Trade-in line item | `allowance` | money cents / numeric | `quote_packages.trade_allowance`; target trade line item or commercial terms field | No | Immediate local edit; recompute totals |
| Commercial terms | `branch_id` / `branch_slug` | uuid/string | Current draft `branchSlug`; branch/workspace tables | No | Default from rep branch on entry; refresh when overridden |
| Commercial terms | `discount_type` | enum: flat/percent | Current draft `commercialDiscountType`; saved in quote package financing/metadata | No | Immediate local edit; recompute totals |
| Commercial terms | `discount_value` | number / money | Current draft `commercialDiscountValue`; saved in quote package total fields | No | Immediate local edit; recompute totals |
| Commercial terms | `tax_profile` | enum/string | Current draft `taxProfile`; branch/customer/default tax profile | No | Default from branch/customer; refresh when overridden |
| Commercial terms | `down_payment` | money cents / numeric | Current draft `cashDown`; saved in financing/amount financed derivation | No | Immediate local edit; recompute amount financed |
| Commercial terms | `financing_method` | enum/string | `/calculate` response, selected finance scenario, rep default partner | Partly | Refresh when amount financed or finance inputs change |
| Customer Digital Twin | `customer_company_id` / `customer_contact_id` | uuid / nullable | CRM customer/contact tables | No | Refresh on customer selection |
| Customer Digital Twin | `win_probability` | number 0-100 | Current deterministic `computeWinProbability` plus optional saved snapshot fields | Yes | Recompute when customer/equipment/trade/terms/signals change |
| Customer Digital Twin | `signals` | structured array | Current win probability context and customer signals | Yes | Recompute when source fields change |
| Customer Digital Twin | `open_deals` | count/list | CRM deal tables | Yes aggregation | Refresh on customer selection and background stale refresh |
| Customer Digital Twin | `past_quotes` | count/list | Historical `quote_packages` and/or `qb_quotes` | Yes aggregation | Refresh on customer selection and background stale refresh |
| Customer Digital Twin | `last_touch` | timestamp/string | CRM activity/task/contact history | Yes aggregation | Refresh on customer selection and activity changes |
| Customer Digital Twin | `fleet_history` | structured list | Historical quote packages, equipment ownership/service/rental data where available | Yes aggregation | Refresh on customer selection and background stale refresh |
| Opportunity description | `description_text` | text | Current draft prompt/voice summary/request text; target quote workspace field | No | Immediate local edit; persist on autosave |
| Opportunity description | `voice_transcript` | text / nullable | Voice quote tables/logs and transcription edge functions | No | Refresh after transcription completes |
| Opportunity description | `originating_log_id` | uuid / nullable | Voice/QRM request log or quote intake parse record | No | Set on entry handoff; stable after save |
| AI Copilot suggestions | `trigger_type` | enum/string | Target trigger registry; current inferred from `/recommend`, scenario, or Copilot request source | No | Create only when trigger condition is met |
| AI Copilot suggestions | `trigger_source_field` | string | Target citation metadata; current partially inferable from request payload | No | Store with suggestion at creation |
| AI Copilot suggestions | `trigger_excerpt` | text | Target visible citation; current missing as normalized field | No | Store with suggestion at creation |
| AI Copilot suggestions | `suggestion_text` | text | Current `/recommend`, scenario SSE, or `qb_quote_copilot_turns.copilot_reply` | No | Stream/fetch after trigger; keep empty before trigger |
| AI Copilot suggestions | `suggestion_state` | enum: empty/loading/ready/dismissed/applied | Client state plus persisted action tables | Partly | Immediate UI state update; persist apply/dismiss |
| Deal Coach flags | `rule_id` | string | Deal Coach rule engine and `qb_deal_coach_actions` | No | Re-evaluate when commercial context changes |
| Deal Coach flags | `severity` | enum | Deal Coach rule output | Yes | Re-evaluate when margin/program/customer/quote fields change |
| Deal Coach flags | `flag_title` / `flag_body` | text | Deal Coach rule output | Yes | Re-evaluate when source context changes |
| Deal Coach flags | `source_context` | json | Margin baseline, programs, reason intelligence, similar deals | Yes aggregation | Refresh when quote/customer/equipment/terms change |
| Deal Coach flags | `action_state` | enum: active/dismissed/applied/snoozed | `qb_deal_coach_actions` | No | Refresh after action mutation |
| Margin Waterfall | `equipment_revenue` | money cents / numeric | Current: equipment JSON sum; target line items with revenue fields | Yes | Recompute immediately on line item changes |
| Margin Waterfall | `attachment_revenue` | money cents / numeric | Current: attachment JSON sum; target line items with revenue fields | Yes | Recompute immediately on line item changes |
| Margin Waterfall | `dealer_cost` | money cents / numeric | Current: estimated `subtotal * 0.8`; target authoritative cost by line/catalog/cost table | Yes aggregation | Refresh when line items/cost sources change |
| Margin Waterfall | `discount_impact` | money cents / numeric | Current discount fields and `quote_packages.discount_amount` | Yes | Recompute immediately on discount change |
| Margin Waterfall | `trade_impact` | money cents / numeric | `quote_packages.trade_allowance`, `trade_valuations`, target trade line item economics | Yes | Recompute when trade allowance/valuation changes |
| Margin Waterfall | `net_margin` | money cents / numeric | Target waterfall calculation from revenue, cost, discounts, trade, programs | Yes | Recompute immediately on contributing input change |
| Margin Waterfall | `margin_percent` | percent | Target waterfall calculation; current `computeQuoteWorkspace.marginPct` | Yes | Recompute immediately; persist margin snapshot on save |
| Margin Waterfall | `source_attribution` | structured source list | Target cost/book/program source metadata; current mostly missing for quote waterfall | No | Refresh when cost, trade, or program source changes |
