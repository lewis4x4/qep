# Iron Quote Tool — Delta vs. Transcript (2026-05-14)

**Source of truth:** Omi transcript `1125e55b-c427-49ed-9cec-8d396a9854d2` (Brian + Ryan + Rylee, with Omi mislabeling speakers).
**Compared against:** `QRM_QUOTE_WIZARD_SPEC_2026-05-05.md`, `QRM_QUOTE_MOONSHOT_HANDOFF_2026-05-07.md`, `CLAUDE_CODE_HANDOFF_2026-04-23.md`, AND the live repo at `/Users/brianlewis/Projects/qep-knowledge-assistant`.
**Repo state:** Confirmed. Live wizard lives in `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx` (5,220 lines, monolithic page). Schema in `supabase/migrations/`. 559 migrations applied. Cluster file lists in §4 now reflect real paths discovered in the audit.

---

## 0. Executive read

The wizard architecture chosen in the 2026-05-05 spec was validated on the call. The flow (Customer → Equipment → Configure → Trade → Pricing → Rebates → Financing → Details → Review → Generate → Send) is keeping. What needs to change is mostly **intake mode reduction, navigation behavior, internal-vs-customer-facing pricing split, live margin, auto-approval rules, and a real PDI-from-history feed.** Plus two operations items: IntelliDealer historic-snapshot import and Microsoft 365 token rotation.

No structural rewrite. No phase renumber. 18 work items, mapped below.

---

## 1. Delta table — what the spec says now vs. what the meeting decided

| # | Topic | Current spec | Meeting decision | Change required |
|---|---|---|---|---|
| 1 | Fast intake modes | Step 1→2 transition shows three pickers: Manual / Voice / AI Chat | **Kill Manual.** Collapse to a single input: typed box with a microphone icon inside it. Prompt copy: "Describe what you want to quote." | Remove Manual entry; merge Voice + AI Chat into one input surface with mic affordance |
| 2 | Wizard back/forward navigation | Spec says "jump-back enabled via the progress bar." | Currently broken: once a rep goes back, the step pills don't fire on click — forces tap of Next through every step | Make any completed step pill clickable in both directions; preserve "can't skip ahead past unfilled steps" rule |
| 3 | Edit price on Review | Step 9 Review is read-only; to change price the rep goes back to Step 2 or Step 5 | Allow inline override of equipment base price directly on Review (and recompute downstream). Override is its own field — does not mutate the system base price | Add `equipment_override_price` field; render editable on Step 5 AND on Step 9 summary block |
| 4 | Live margin while editing | Margin only shown on Step 9 Review | Margin recomputes live as any price field changes. Show on Step 5 (pricing build) and Step 9. "You're going to make this margin." | Margin calc component reused across Steps 5 and 9; reactive to all `quote_lines` changes |
| 5 | Internal vs customer-facing pricing split | Step 5 mixes PDI / freight / good faith / doc fee / title / tag as one waterfall | Two clearly labeled buckets. **Internal cost adders** (load to machine cost, NOT on PDF): PDI, inbound freight to QEP yard, 1% good faith, attachment install labor. **Customer-facing charges** (line items on PDF): outbound delivery, doc fee, tag, title, registration, wrap, deposit | Re-group Step 5 UI into two collapsible sections; tag every `quote_line.kind` with `cost_visibility: 'internal' \| 'customer'`; PDF generator suppresses internal lines |
| 6 | PDI source | "Configurable default per equipment type" | Rolling average from historical PDI cost for that specific make/model. Pre-populates. Trend visible (going up = condition declining or shop pricing change) | New table `pdi_history` + view `pdi_average_by_model`; Step 5 calls the view and pre-fills with override allowed |
| 7 | Freight handling | Single freight field, manual entry or zip-to-zip estimate | Two freights, conditional on stock status. **Inbound** (mfr→QEP) — internal cost, auto-calc from weight + lane history, **only added when machine NOT in stock** because in-stock machines have inbound freight already baked into loaded cost. **Outbound** (QEP→customer) — customer-facing, free or set value, prints with delivery-terms text | Add `inbound_freight_amount` (internal-tagged, auto-suppressed when `equipment.in_stock=true`) and `outbound_delivery_amount` (customer-tagged) to `quote_lines`; freight UI shows the right one based on stock state |
| 8 | Auto-approval (margin gate bypass) | Approval fires if margin < floor OR trade > max OR rep discount > cap OR any line flagged | Add an **auto-approval lane** for aged stocked inventory. Rule example: stocked inventory received ≥ 12 months ago can be quoted down to 8% (or 6%) margin without manager approval. "Hot list" flag also bypasses approval. | New table `approval_bypass_rules` (criteria: stock_age_days ≥ 365, in_stock=true, hot_list=true, discount_pct ≤ X). Step 9 routing logic checks bypass rules before firing manager-approval flow |
| 9 | Rebate completeness | Step 6 filters by OEM + active date | Surface every applicable rebate, including stacked / cash-vs-finance variants. Real miss cited: $20K rebate on top of finance rebate that didn't show up | Rebate engine queries returns ALL active rebates matching OEM+model+date AND tags each as `stack_kind: 'cash_alt' \| 'finance_addon' \| 'always_on'` so UI shows the full stack |
| 10 | Parts on Step 3 Configure | Tabs are Attachments / Factory Options / Accessories / Warranty | **Add Parts box** on Step 3 so the rep can drop part numbers from QEP inventory into the quote during configure. Currently Additional Parts has nowhere in the wizard to populate from — only appears on the PDF | New Parts tab on Step 3 with part-number lookup against parts table; emits `quote_lines.kind='accessory'` (or new `kind='part'` if we want it separate on the PDF) |
| 11 | Misc Charges/Credits surface | Lives in PDF section 10.9 but no dedicated wizard surface | Either fold into Step 5 Pricing as a labeled subsection OR add explicit Misc Charges/Credits panel. Down payment received belongs here too | Pick one (recommend folding into Step 5 under the customer-facing bucket from #5); ensure down-payment-received negative line is supported |
| 12 | Mobile reformat — Step 2 + Step 3 | C5 mobile floating action bar exists in handoff; spec calls for mobile-first | Top step pills currently let reps tap-ahead before scrolling, causing skipped fields. Remove Back/Next from the top — leave them only at the bottom of the step | Strip top action buttons on mobile breakpoint; keep step-pill row (clickable but not labeled "Next"); bottom Next button stays sticky |
| 13 | Post-approval send routing | Step 11 Send Panel: rep sends, system logs, follow-up required | After manager approval, decide where the quote goes: (A) auto-send to customer, or (B) route back to rep to send. **OPEN — needs decision.** Likely setting per quote type or rep | Add `quotes.post_approval_action enum ('auto_send_customer','return_to_rep')` defaulting to `return_to_rep`; approval workflow respects the setting |
| 14 | IntelliDealer historic snapshot | Spec puts IntelliDealer integration at Phase 3; HubSpot migration is Sprint 5 | Snapshot IntelliDealer as of 2026-05-14: pull all customers, equipment, quotes, parts, history. Preload Iron. New quotes go in Iron going forward. No live IntelliDealer sync needed for this cutover — separate from the Phase 3 work | New one-time ETL job: export from IntelliDealer (CSV or DB dump), transform to Iron schema (companies / contacts / equipment / quotes / quote_lines / parts), load with `source='intellidealer_snapshot_2026-05-14'` provenance tag. Independent of Phase 3 API work |
| 15 | M365 auth — token rotation | M365 OAuth listed as Sprint 4 dependency (BLK-6) | Production bug today: agent's M365 token expired, can't read email, can't send. Needs auto-rotation before expiry | Implement refresh-token flow with rotation N hours before `expires_at`. Add health-check probe + alert. Re-auth Rylee's tenant first to unblock current state |
| 16 | Prospect-without-customer path | Step 1 requires customer record; dedupe enforced | Open question: allow rep to start a quote on a prospect (no full customer record) and convert later. Rylee said "always need a customer" but acknowledged friction. **OPEN — needs decision.** | If yes: introduce `prospects` table or `customers.is_prospect=true`; quote can attach to prospect; conversion flow promotes prospect→customer at quote-sent time. If no: status quo |
| 17 | Sales-advisor home | Generic dashboard exists | Sales-advisor role-specific home: AI briefing, open deals, today's follow-ups, voice-quote starter, voice-note starter, prospecting/map button (ingest UCC Excel data, currently in Google My Maps), log-action shortcuts (submit service request, add customer), pipeline view | New `/sales-advisor` route. Map module accepts CSV upload (UCC fields) and renders pins; reuses existing prospecting map shell. Quick-action toolbar reads from a config table per role |
| 18 | Trade-in auto-value accuracy | ADR-005: display comparable range, no single number | Current build shows a SINGLE auto-value that Ryan flagged as "not right." Either revert to spec's comp-range UI (rep-facing only per §11.4) or fix the comp source feed | Audit current trade-value source. If pinned to a single Sandhills/Iron Solutions lookup, switch to the range presentation. Comp range stays rep-facing only — does NOT print on customer PDF |

---

## 2. Items already in spec that the meeting reinforced (no change needed)

- Wizard step-by-step flow with progress bar — keep.
- Branch selector at top — keep.
- Three-state availability (in_stock / in_transit / source_required) — keep, surface on Step 2 result card.
- Attachment compatibility + warranty pre-fill on Step 3 — keep.
- Margin waterfall on Review — keep, just expose the calculator earlier (item #4).
- Approval routing on margin/trade/discount — keep, just add bypass lane (item #8).
- Branded PDF parity with IntelliDealer Q02699 — keep all parity items in §10.15 of spec.
- 1% good faith auto-calc — keep, but tag as internal (item #5).

---

## 3. Open questions for Brian — answer inline before RepoPrompt fan-out

1. **Speaker identity.** Omi labeled "Craig" as the builder voice (DragonFruit Mac Mini, DGX Spark, "I built it / I changed the wizard"). That's your voice. Was Craig actually a real attendee — or did Omi just rename you "Craig" through most of the recording? Need this confirmed before I tag work items to people.
2. **Auto-approval thresholds (item #8).** What are the real numbers? Aged inventory cutoff days (you said "received a year ago or more" — is 365 the line, or 270?). Auto-approve margin floor on aged stock (you said "8 or 6"). And what defines "hot list" — is it a flag the manager sets per machine, or a derived signal?
3. **Margin floor — current state.** The spec references an `approval_thresholds` table but doesn't have your real value. What's the rep-clear margin floor today, in percent? Both for new units and for aged inventory?
4. **PDI history source (item #6).** Where does historical PDI data live today? IntelliDealer GL hits a service work order tied to the stock number? Or is it in QuickBooks? Or only in Tina's spreadsheets? This dictates the import job in #14.
5. **Inbound freight calc (item #7).** "Weight-based, lane-history" — is there an existing rate table or carrier API, or do we build a freight estimator from your historical inbound shipments? If the latter, where's the source?
6. **Post-approval routing default (item #13).** Default to auto-send to customer, or default to return-to-rep? Per-rep override, per-quote-type override, or global setting?
7. **Prospect-quote path (item #16).** Allow or deny? If allow, do you want auto-conversion at quote-sent OR at order-creation?
8. **Internal-vs-customer line tagging (item #5).** Are there any lines you'd want the rep to be able to toggle visibility on per-quote? E.g. occasionally show PDI to the customer as a value-add? Or hard-wired by line kind?
9. **Outbound delivery line text (item #5/#7).** What's the exact text that prints on the PDF for a delivered machine? You mentioned "states what the delivery terms were" but didn't dictate the exact phrasing. Need the template.
10. **Rebate stack precedence (item #9).** When cash-rebate and finance-rebate are both applicable, can both stack — or is it one-or-the-other?
11. **IntelliDealer snapshot scope (item #14).** Just customers + equipment + open quotes? Or full historic quotes too? Cutoff date — only last N years of history, or everything?
12. **M365 tenant scope (item #15).** Just Rylee's mailbox, or the whole `qepusa.com` tenant including Ryan, Angela, David? Each user has their own consent — do you want a single admin consent for the tenant?
13. **Mobile breakpoint (item #12).** Today Iron renders responsive by aspect ratio. Want me to define the exact breakpoint where top step-pills strip their labels? Standard tailwind `md:` (768px) or earlier?
14. **Step 2 — "request availability check" routing.** When a rep hits source_required and clicks "Request availability check," the spec says it notifies sales manager + admin via 8x8 / email / in-app. The transcript hinted at a problem here. Confirm 8x8 is still the SMS path or if you want Twilio for this too.
15. **Sales-advisor home priorities (item #17).** Of the seven elements Rylee listed (briefing, open deals, follow-ups, voice-quote, voice-note, map, log-actions), which is the v1 cut? You're not building all seven in one pass.

---

## 4. RepoPrompt fan-out plan — REAL repo paths

RepoPrompt orchestrates; this is the fan-out, not a Paperclip queue. Paths below are verified against the live tree.

**Repo facts confirmed during audit:**
- Wizard is ONE monolithic page: `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx` (5,220 lines). The 11-step `Step` type, `WIZARD_STEPS` array, `QuoteWizardProgress` step-pill component, all four entry-mode buttons, all 9 step bodies, AND the "Quote for prospect" button all live in this single file.
- Schema lives in `supabase/migrations/`, currently 559 migrations. Wizard foundation is `542_qrm_quote_wizard_foundation.sql`. Tables are `quote_packages` + `quote_package_line_items` (NOT `quotes` / `quote_lines` as the spec doc names them).
- Internal freight rules already exist: `qb_internal_freight_rules` table (migration `300_qb_deal_economics.sql`) + `qb_brands.has_inbound_freight_key`. Admin UI: `apps/web/src/features/admin/components/DealEconomics/InternalFreightRulesForm.tsx`.
- PDI defaults exist (`qb_brands.pdi_default_cents`, per-quote snapshot `qb_quotes_deals.pdi_cents`). NO rolling-average-by-model exists yet — that's net new.
- Rebate `aged_inventory` enum value already exists in `qb_programs`. Stacking rules already modeled. Auto-approval bypass IS NOT modeled yet.
- "Quote for prospect" button at line 3150 + `handleQuoteForProspect` at line 2412 already exist. Item #16 in §1 may already be resolved — verify what it actually does.
- M365 auth code: `supabase/functions/onedrive-oauth/index.ts` exists. State table is `onedrive_sync_state`. NO separate mail-token refresh function. The "AI agent can't read email" bug points at this surface — likely missing scheduled refresh.
- IntelliDealer import scaffolding already exists for the customer master: `scripts/audit-intellidealer-customer-master.py`, `scripts/stage-intellidealer-customer-master.py`, `scripts/commit-intellidealer-customer-import.mjs`, plus `scripts/verify/intellidealer-*` smoke tests. Equipment / quotes / parts history snapshot is net new.
- `apps/web/src/features/floor/` already exists as the sales-advisor home foundation (per `App.tsx` line 762 comment: "The Floor (/floor) is the primary home for iron_advisor").
- `iron-avatar/` is a separate package at the repo root. The "AI agent" the transcript references — Rylee's email-reading agent — likely lives here.

**Cluster A — Wizard UX changes** (single model, frontend specialist)
- Items 1, 2, 3, 4, 12
- Primary file: `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx`
- Specific edits:
  - **Item 1 (kill Manual, merge intake to single mic input)** — Edit the entry-mode picker at lines 2619-2641 and the duplicate picker at lines 3230-3266. Remove `manual` and `trade_photo` cards from the grid (or keep Trade Photo as a separate icon button). Collapse Voice + AI Chat into one input field with placeholder "Describe what you want to quote." and an inline mic icon. The existing `aiPrompt` textarea + `VoiceRecorder` component get fused into one component.
  - **Item 2 (wizard back/forward nav bug)** — Edit `QuoteWizardProgress` at lines 5050-5102. Current code (line 5078-5083): `disabled={isFuture}` and `onClick={() => { if (!isFuture) onJumpBack(item.id); }}`. Add a `maxCompletedStepIndex` prop. Allow click when `index <= maxCompletedStepIndex`. Rename prop `onJumpBack` → `onJumpTo`. Persist `maxCompletedStepIndex` in `draft` state alongside `wizardStep`.
  - **Item 3 (inline base-price override on Review)** — Add a new field `equipment_override_price_cents` on `quote_package_line_items` (new migration). In `QuoteBuilderV2Page.tsx` add an editable input on the Step 5 pricing waterfall and on the Step 9 review summary block (~lines 4276-4440 area).
  - **Item 4 (live margin)** — Extract margin computation from `DealCoachSidebar.tsx:179` into a shared hook `apps/web/src/features/quote-builder/hooks/useLiveMargin.ts`. Reuse `MarginCheckBanner` (already at `apps/web/src/features/quote-builder/components/MarginCheckBanner.tsx`). Surface on Step 5 (pricing) in addition to Step 9.
  - **Item 12 (mobile step bar)** — Same `QuoteWizardProgress` component. Add a `compact` prop that strips the Back/Next buttons from the top action area (lines 3145-3158) on mobile breakpoint. Bottom Next button (already exists per-step) stays sticky on mobile.
- Output: PR with mobile + desktop screenshots, before/after. Touch one file (the page) + extract one new hook.

**Cluster B — Pricing & cost-model refactor** (single model, full-stack)
- Items 5, 6, 7, 9, 10, 11
- Schema migrations (new, sequential after `559`):
  - `560_quote_line_cost_visibility.sql` — add `cost_visibility text not null default 'customer' check (cost_visibility in ('internal','customer'))` to `public.quote_package_line_items`. Backfill existing PDI / good_faith / freight-inbound lines to `internal`. Update `PRICING_ADDER_FIELDS` at line 208 to tag each.
  - `561_pdi_history_rolling_average.sql` — new table `pdi_actuals` (machine_id, work_order_id, pdi_cost_cents, completed_at) populated from service WO completions. New view `pdi_average_by_brand_model` (12-month rolling average per make+model). Hook into Step 5 pre-fill.
  - `562_freight_inbound_outbound_split.sql` — split current `freight_cents` on `qb_quotes_deals` and `quote_package_line_items` into `inbound_freight_cents` (internal) + `outbound_delivery_cents` (customer). Existing `qb_internal_freight_rules` already drives inbound; add an outbound-freight UI panel. Suppress inbound when `equipment.in_stock=true`.
  - `563_rebate_stack_kind_tag.sql` — add `stack_kind text` to `qb_programs` (`cash_alt | finance_addon | always_on`). Update `quote-incentive-resolver` edge function to return all applicable in stack order.
  - `564_quote_part_line_kind.sql` — extend the existing `quote_line_kind` enum (defined in `542`, line 137) with `'part'` if not already present, OR confirm `accessory` is fine for the Step 3 Parts tab and skip this migration.
- Frontend:
  - `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx` — re-group Step 5 waterfall (~lines 3780-3997) into two collapsible sections: "Internal cost adders" and "Customer-facing charges." Add Parts tab to Step 3 Configure (~lines 3520-3675) reusing `PackageItemSearchDialog` and parts-lookup. Down-payment line handling in Step 5 customer-facing bucket.
  - `apps/web/src/features/quote-builder/components/QuotePDFDocument.tsx` — PDF generator filters out `cost_visibility='internal'` lines before rendering.
  - `apps/web/src/features/quote-builder/lib/quote-proposal-data.ts` — same filter applied to proposal-data shape used by `useQuotePDF` hook and `quote-print-html.ts`.
- Edge functions: `supabase/functions/quote-incentive-resolver/index.ts` for rebate stacking; `supabase/functions/quote-builder-v2/index.ts` for cost-visibility-aware totals.
- Output: 4-5 new migrations + rollback, updated PDF snapshot test against Q02699 parity.

**Cluster C — Approval engine + routing** (single model, backend logic)
- Items 8, 13
- New migration `565_approval_bypass_rules.sql`: table `approval_bypass_rules` with criteria (`stock_age_days_min`, `discount_pct_max`, `requires_in_stock`, `requires_hot_list`, `min_margin_pct`). Seed default rule for aged-inventory bypass (per answers to Q2/Q3).
- New migration `566_quote_post_approval_action.sql`: add `post_approval_action text not null default 'return_to_rep' check (post_approval_action in ('return_to_rep','auto_send_customer'))` to `quote_packages`.
- Edge function: existing flow in `supabase/functions/quote-builder-v2/index.ts` + `supabase/migrations/554_quote_approval_notification_idempotency.sql` + `555_quote_approval_authority_band.sql`. Add bypass evaluation before manager-route.
- Frontend: Step 9 review block in `QuoteBuilderV2Page.tsx` (~lines 4270-4440) — surface "Auto-approved (aged inventory)" badge when bypass fires.
- Output: unit test matrix in `apps/web/src/features/quote-builder/lib/__tests__/` covering bypass + non-bypass paths.

**Cluster D — Operations / integration** (single model, devops + integration)
- Items 14, 15
- **Item 14 (IntelliDealer snapshot ETL):**
  - Extend existing scripts: `scripts/stage-intellidealer-customer-master.py` already imports customers. Add `scripts/stage-intellidealer-equipment-master.py`, `scripts/stage-intellidealer-quotes-history.py`, `scripts/stage-intellidealer-parts-master.py`, `scripts/stage-intellidealer-service-history.py` following the same audit→stage→commit pattern.
  - Provenance tag: `source='intellidealer_snapshot_2026-05-14'` on every row.
  - Verify scripts mirror existing `scripts/verify-intellidealer-customer-import.mjs`.
- **Item 15 (M365 token rotation + agent email):**
  - New edge function: `supabase/functions/m365-token-refresh/index.ts` — runs as cron, finds rows in `onedrive_sync_state` where `token_expires_at < now() + interval '30 minutes'`, refreshes via `https://login.microsoftonline.com/common/oauth2/v2.0/token`.
  - Add `pg_cron` schedule entry (new migration `567_m365_token_refresh_cron.sql`).
  - Audit `iron-avatar/` package (separate repo subdirectory) for where the "AI agent reads Rylee's email" actually lives. If `iron-avatar/` calls Graph directly with a static token, point it at the rotated token in `onedrive_sync_state` or a new `microsoft_graph_tokens` table covering Mail.Read + Mail.Send scopes.
  - Confirm Graph scope set covers `Mail.Read`, `Mail.Send`, `Files.ReadWrite`. Re-run consent for Rylee's mailbox to unblock today's state.
- Output: working ETL scripts with dry-run + commit modes; M365 refresh cron live in staging; health-check probe queryable from admin panel.

**Cluster E — Trade-in correction** (single model, narrow)
- Item 18
- Files: `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx` (Step 4 tradeIn section ~lines 3678-3775) + `apps/web/src/features/quote-builder/components/TradeInInputCard.tsx` + `apps/web/src/features/quote-builder/components/TradeInSection.tsx` + `apps/web/src/features/quote-builder/components/PointShootTradeCard.tsx`.
- Edge functions: `supabase/functions/trade-book-value-range/index.ts` and `supabase/functions/trade-valuation/index.ts`. Audit which one is being called by the wizard and what shape it returns — Ryan said the single-number is "not right." Either swap UI to comp-range display per ADR-005 §11.4 OR fix the source feed.
- Comp range stays rep-facing only — confirm `QuotePDFDocument.tsx` does NOT print it.
- Output: trade-value provenance labels visible to rep; customer PDF unchanged.

**Cluster F — Sales-advisor home + prospect path** (single model, frontend + schema)
- Items 16, 17
- **Item 16 (prospect path):** likely already partly implemented. Audit `handleQuoteForProspect` in `QuoteBuilderV2Page.tsx:2412` and the "Quote for prospect" button at `:3150`. If the button creates a working quote without a customer record, item #16 reduces to "confirm working in production" — no new code. If it half-works, extend.
- **Item 17 (sales-advisor home):** Floor route already exists at `apps/web/src/features/floor/` per `App.tsx:762`. Audit `pages/` and `widgets/` there to see what's wired today. Likely deltas:
  - AI briefing card — likely uses `supabase/functions/owner-morning-brief/index.ts` pattern; clone for `iron-advisor-morning-brief`.
  - Voice-quote starter — point at `/voice-quote` route (already in `App.tsx:1152`).
  - Map / prospecting — likely `apps/web/src/features/floor/widgets/` has a slot; new component to ingest UCC CSV (uses `papaparse` or existing CSV utilities).
  - Quick actions (submit service request, add customer) — link to `/service/intake` and `/sales/customers/new` routes.
- Schema: `prospects` table only if Cluster F audit finds the prospect path needs a new entity. May already be using `customers.is_prospect=true` flag.
- Output: confirmation of what's already there + a sharp PR that closes the gaps.

Each cluster ships as its own PR. RepoPrompt assigns one model per cluster, runs in parallel, merges on green. No cluster blocks another at design time — but `QuoteBuilderV2Page.tsx` is a 5,220-line god-file touched by Clusters A, B, C, E, F. **Recommend merging Cluster A first**, then B (largest change set), then C/E/F can run in parallel against the A+B merged base. Cluster D is fully orthogonal — run it in its own lane.

---

## 5. Acceptance additions to spec §6

Add to the acceptance criteria list in `QRM_QUOTE_WIZARD_SPEC_2026-05-05.md` Section 6:

19. Intake surface has exactly one input field (typed + mic) with placeholder "Describe what you want to quote." No mode picker visible.
20. Any previously-completed step pill is clickable from any later step. Forward jump past an unfilled step is blocked.
21. Equipment base price can be overridden inline on Step 5 and on Step 9 Review; margin recomputes on every keystroke.
22. PDF prints zero internal-tagged lines (PDI, inbound freight, good faith, attachment install labor) for any quote.
23. PDF prints all customer-tagged lines (outbound delivery, doc fee, tag, title, registration) when populated.
24. PDI value on Step 5 pre-fills from `pdi_average_by_model` view for the selected make+model.
25. Inbound freight field is hidden when `equipment.in_stock=true`.
26. Aged-inventory auto-approval bypass fires when `equipment.received_at <= now() - interval '365 days'` AND `quote.margin_pct >= 6` (or final threshold per Q2/Q3 above).
27. Step 3 Configure has a Parts tab; rep can add part numbers from QEP parts inventory.
28. M365 token-rotation cron runs successfully and never lets a rep's token expire without rotation logged.

---

## 6. Verification (run before closing this delta)

- [x] File paths in §4 confirmed against live repo. The spec's `src/features/quote-wizard/` path does NOT exist — the wizard is `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx`. §4 has been rewritten to real paths.
- [ ] Smoke test staging build at `https://qep.blackrockai.co` against the 28 acceptance criteria (1–18 original spec + 19–28 added here).
- [ ] Re-listen to the transcript spans flagged with `OPEN — needs decision` (items #13 and #16) — item #16 may already be resolved in code (Quote-for-prospect button exists). Confirm in person on next QEP touchpoint.
- [ ] Run `bun run migrations:check` and `bun run build` (both repo root and `apps/web/`) before each cluster PR closes, per `CLAUDE.md` release gate.
- [ ] Pull Q02699 PDF snapshot test and confirm Cluster B changes still match IntelliDealer parity §10.15.

---

## 7. What I did not address (and why)

- **Pricing on the Sales-Advisor home dashboard widgets** — not in the transcript, deferred.
- **Multi-branch quote scoping** — already covered in spec §10 parity (branch_code on quotes); not raised in meeting.
- **Lease quoting (FMV/FPPO)** — not raised in this meeting; remains blocked on rate sheets per `BLK-3`.
- **Cyber insurance / NDA** — not in this transcript scope.
