# Iron Quote Wizard — Build Verification Handoff (2026-05-16, verified 2026-05-17 @ 20b3805e)

**For:** RepoPrompt orchestrator → builder model(s). This is a self-contained verification + remediation pass. Do not assume prior context; everything you need is in this doc or linked from it.
**Mission:** Prove that every line of the three source-of-truth specs is shipped in the repo. For anything that is partial or missing, ship the fix in this same pass.

---

## 0. Status banner — code-complete 2026-05-17 @ commit 20b3805e

**Code lanes A–F are closed.** Fix F (`/floor` audit) verified in `IRON_FLOOR_AUDIT_2026-05-17.md`. Only operational gates remain (Playwright secrets, staging QA, PDF sign-off, product Q answers).

Overnight builder run shipped Fix A (override column), Fix B (PRs 13–21 wizard decomposition), Fix C (edge gateway 36 → 0), Fix D (Playwright bootstrap + 3 specs + CI workflow + bundle:check), and Fix F (floor audit). Status matrices in §3 and §4 below have been updated in place.

**What is now ✓ that wasn't on 2026-05-16:**
- `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx` is now **5 lines** — a thin entrypoint to `useQuoteBuilderV2Orchestrator`. Wizard god-file decomposition is done.
- All 11 step modules exist under `steps/` (Customer → Send) plus `wizard/WizardShell.tsx` and the orchestrator hook.
- Migration `578_equipment_override_price_column.sql` is applied; `lib/equipment-override-price.ts` writes the typed column; `quote-builder-v2` edge fn reads it; tests cover the path.
- `scripts/edge-auth-allowlist.json::unregistered_in_config` is **empty** — all 186 edge functions registered in `config.toml`.
- `apps/web/playwright.config.ts` + 3 specs + `e2e-staging.yml` CI workflow + `bundle:check` script.
- Vitest count: **1,154 pass** (was 1,103 on the 2026-05-16 snapshot).

**What is left for "verified to spec" (the only remaining gates — all operational, no code lanes):**
1. Manual/staging QA for §3.3 (FL 6% state tax math, county surtax $5K cap, tax-exempt badge, all four manager approval outcomes, TILA disclaimer surfaces).
2. §3.4 IntelliDealer PDF parity sign-off — side-by-side vs Q02699, architect-level.
3. ~~Fix F — `/floor` widget audit~~ ✓ Closed. See `IRON_FLOOR_AUDIT_2026-05-17.md` — all 7 transcript elements shipped for `iron_advisor`.
4. E2E suite full green — set `PLAYWRIGHT_TEST_EMAIL`, `PLAYWRIGHT_TEST_PASSWORD`, `PLAYWRIGHT_AGED_EQUIPMENT_ID` per `apps/web/tests/e2e/TODO_PLAYWRIGHT.md`. Today: 1 pass / 3 skip.
5. Staging spot-checks for §3.2 #21 (inline override behavior in browser) and §3.2 #25 (inbound freight hidden when `in_stock=true`).
6. Open product questions Q6, Q7, Q11–Q15 (not code blockers per §6) + a new product Q raised by the floor audit (three voice routes — consolidate or label?).

---

## 1. Sources of truth (read these first, in this order)

1. **`QEP (1)/QRM_QUOTE_WIZARD_SPEC_2026-05-05.md`** — Original Rylee-driven 11-step wizard spec. §6 acceptance items 1–18 + §10.15 IntelliDealer parity checklist 1–30. Binding.
2. **`QEP (1)/QRM_QUOTE_MOONSHOT_HANDOFF_2026-05-07.md`** — M1–M10 moonshot moves layered on top of §1. Refinements §11 added acceptance items 14–18. Binding.
3. **`QEP (1)/IRON_QUOTE_DELTA_2026-05-14.md`** — Transcript-driven 18-item delta from the Brian+Ryan+Rylee Omi call (`1125e55b-c427-49ed-9cec-8d396a9854d2`). §6 added acceptance items 19–28. Binding where it amends 1/2.
4. **`QEP (1)/IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.md`** — Strangler-fig refactor plan. §3 PR sequence + §5 column promotion + §6 edge backlog + §7 test infra. Binding.

When 1/2 and 3 conflict, **3 wins** (it postdates and was driven by direct customer feedback).

---

## 2. Working tree facts (verified 2026-05-17 @ 20b3805e)

- Repo root: `/Users/brianlewis/Projects/qep-knowledge-assistant`
- Wizard page: `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx` — **5 lines**, thin entrypoint to `useQuoteBuilderV2Orchestrator`. Decomposition complete.
- Orchestrator + shell: `useQuoteBuilderV2Orchestrator` hook + `components/QuoteBuilderV2PageShell.tsx` / `QuoteBuilderV2PageView.tsx` own page-level orchestration.
- Wizard module: `apps/web/src/features/quote-builder/wizard/` — `wizard-types.ts`, `wizard-storage.ts`, `wizard-navigation.ts`, `WizardStateProvider.tsx`, `useWizard.ts`, `WizardProgress.tsx`, `IntakeInput.tsx`, `WizardShell.tsx`.
- Step modules: `apps/web/src/features/quote-builder/steps/` — all 11 step bodies extracted: `CustomerStep`, `EquipmentStep`, `ConfigureStep`, `TradeInStep`, `PricingStep`, `PromotionsStep`, `FinancingStep`, `DetailsStep`, `ReviewStep`, `DocumentStep`, `SendStep`.
- Hooks: `useLiveMargin.ts`, `usePdiAutofill.ts`, `useApprovalBypass.ts`, `useDraftAutosave.ts`, `useQuoteBuilderV2Orchestrator.ts`, plus pre-existing `useQuotePDF`, `useQuoteFinancingPreview`, `useQuoteTaxPreview`.
- Shared lib: `equipment-override-price.ts`, `cost-visibility` (via `quote-workspace.ts`), `money.ts`, `package-kind-label.ts`.
- Shared components: `QuoteWorkspaceLineRow.tsx`, `PricingAdderBuckets.tsx` (hosts the in-stock inbound-freight gate).
- Migration head: `578_equipment_override_price_column.sql`. Wizard-foundation: `542_*`. Delta band: `560–578_*`. Override column applied + backfilled.
- Edge functions: 186 total, **all 186 registered** in `supabase/config.toml`. `unregistered_in_config` is **empty**.
- Test infra: vitest **1,154 quote-builder tests pass**. Playwright config + 3 specs (`apps/web/tests/e2e/`) + `e2e-staging.yml` CI workflow + `bundle:check` script. Today: 1 pass / 3 skip until `PLAYWRIGHT_TEST_*` env vars are set (see `apps/web/tests/e2e/TODO_PLAYWRIGHT.md`). Lighthouse not yet wired.

---

## 3. Build verification matrix

Status legend: **✓ done** | **△ partial** | **✗ missing** | **□ not started**.
For each row, run the **verify** column. If it fails, do the work in the **fix** column. If `verify` passes and `fix` says "n/a", check the box and move on.

### 3.1 Transcript-delta items (`IRON_QUOTE_DELTA_2026-05-14.md` §1, items 1–18)

| # | Topic | Status | Verify | Fix |
|---|---|---|---|---|
| 1 | Fast intake — kill Manual, single typed + mic | ✓ | Open `QuoteBuilderV2Page.tsx` and `wizard/IntakeInput.tsx`. Both intake surfaces (Start quote, Fast intake) render `<IntakeInput />`. No Manual / Trade Photo mode buttons in the picker grid (the original 4-mode picker is gone). Mobile screenshot shows one input + mic icon. | n/a |
| 2 | Step pill nav both ways | ✓ | `wizard/WizardProgress.tsx`: `isReachable = canJumpToWizardIndex(index, maxCompletedIndex)`. Click a previously-completed step from the current step → navigates. Try to click an uncompleted future step → button disabled. | n/a |
| 3 | Inline base price override on Step 5 + Step 9 Review | ✓ | Migration `578_equipment_override_price_column.sql` applied. `lib/equipment-override-price.ts` writes the typed `equipment_override_price_cents` column. `quote-builder-v2` edge fn reads the column for margin/approval/PDF math. Tests in `apps/web/src/features/quote-builder/lib/__tests__/equipment-override-price.test.ts` cover backfill + override semantics. | Staging spot-check: open a quote, override the equipment base on Step 5, watch margin recompute, regenerate PDF, confirm override price prints. |
| 4 | Live margin on Steps 5 + 9 | ✓ | `hooks/useLiveMargin.ts` exists. `MarginCheckBanner` renders inside the Pricing step and the Review step. Edit a price → margin number updates. | n/a |
| 5 | Internal vs customer-facing cost split | ✓ | `cost_visibility` column on `quote_package_line_items`. `quoteLineCostVisibility()` in `lib/quote-workspace.ts`. PDF generator (`QuotePDFDocument.tsx` + `quote-print-html.ts`) filters out `cost_visibility='internal'` lines. `<QuoteWorkspaceLineRow costVisibilityEditable />` toggle on Configure. | n/a |
| 6 | PDI rolling average → Step 5 | ✓ | `supabase/migrations/561_pdi_history_rolling_average.sql` defines `pdi_average_by_model`. `hooks/usePdiAutofill.ts` queries it. Page line ~2365 wires it to `PRICING_ADDER_FIELDS.pdi`. Verify: pick a make+model with PDI history → Step 5 PDI line pre-fills. | n/a (verify autoprefill in staging) |
| 7 | Inbound / outbound freight split | ✓ | `supabase/migrations/562_freight_inbound_outbound_split.sql`. `qb_internal_freight_rules` already drives inbound. Outbound enabled as customer-facing line. **Verify:** `equipment.in_stock = true` hides the inbound freight input (acceptance #25). | If verify fails: open the Pricing-step inbound freight surface and gate visibility on `equipment.in_stock`. |
| 8 | Aged-inventory auto-approval bypass | ✓ | `supabase/migrations/565_approval_bypass_rules.sql`. Seeded row: `min_stock_age_days=365`, `min_margin_pct=8.00`, `requires_in_stock=true`. `hooks/useApprovalBypass.ts`. UI banner: "Auto-approved (aged inventory)" surfaces on Step 9. | n/a (production: confirm seeded row for QEP workspace is active) |
| 9 | Rebate stack completeness | ✓ | `563_rebate_stack_kind_tag.sql` + `572_manufacturer_incentive_stack_kind.sql`. `supabase/functions/quote-incentive-resolver/index.ts` returns `stack_kind` per program. Verify cash-vs-finance addons render side-by-side on Step 6. | n/a |
| 10 | Parts tab on Step 3 Configure | ✓ | `steps/ConfigureStep.tsx` tab list includes `{ id: "part", label: "Parts" }`. Parts add through `PackageItemSearchDialog`. | n/a |
| 11 | Misc charges / down payment surface | △ | Customer-facing bucket exists in Step 5 Pricing waterfall. No dedicated Misc-charges panel was built (folded into Pricing per the delta's "pick one surface" option). | **Product Q11.** Confirm Pricing-as-host is acceptable. If yes, mark ✓. If no, build a dedicated Misc Charges panel in `steps/PricingStep.tsx` (PR 14 surface). |
| 12 | Mobile — strip top Back/Next | ✓ | Page lines ~3585+ have `className="hidden touch-manipulation md:inline-flex"` on the top action buttons. `WizardProgress` has `compact` prop, page sets `compact` on mobile. Sticky bottom Next bar always visible on mobile. | n/a |
| 13 | Post-approval routing | △ | Schema shipped: `566_quote_post_approval_action.sql` adds `post_approval_action enum ('return_to_rep','auto_send_customer')` with `return_to_rep` default. UI may or may not expose the per-quote toggle yet. | **Product Q6.** Confirm default is `return_to_rep`. If yes, mark ✓ and ship a workspace-level setting in `apps/web/src/features/admin/` to let owners change the default. If no, change default + ship UI. |
| 14 | IntelliDealer historic snapshot ETL | △ | `scripts/stage-intellidealer-{customer,equipment,quotes,parts,service}-*.py` exist with `SOURCE_TAG_DEFAULT = 'intellidealer_snapshot_2026-05-14'`. `scripts/commit-intellidealer-snapshot-import.mjs` orchestrates. Verify scripts exist alongside. | **Operations.** Run on production data + commit cutover. Open: scope (full history vs last N years), cutover date (Q11). Not a code fix — flag to operations owner. |
| 15 | M365 token rotation | ✓ | `supabase/functions/m365-token-refresh/index.ts` + `m365-mailbox-sync/index.ts`. Migration `567_m365_token_refresh_cron.sql` schedules via `pg_cron`. `571_m365_mailbox_sync.sql` adds health fields. Tokens encrypted via `decryptOneDriveToken` / `encryptOneDriveToken`. | **Operations.** Verify cron is running in production (`pg_cron` runs list) + Rylee's mailbox shows fresh `m365_mail_last_synced_at` + Mail.Read/Mail.Send scope granted. Not a code fix. |
| 16 | Prospect-quote path | △ | `wizard-quote-for-prospect` helper + button live in `steps/CustomerStep.tsx`. Dedicated e2e spec covers the path. | **Product Q7.** Confirm allow/deny + conversion timing. Code is in place; policy decision is the only thing gating ✓. |
| 17 | Sales-advisor home (`/floor`) | ✓ | All 7 transcript elements shipped for `iron_advisor`. Per-element evidence in `IRON_FLOOR_AUDIT_2026-05-17.md`: AI briefing (`sales.ai-briefing` widget + `AdvisorBriefingBanner`), open deals (`sales.my-quotes-by-status` + MY PIPELINE card + quick action), follow-ups (`Today's Follow-ups` live card backed by `fetchAdvisorFollowUpStats` + `qrm.follow-up-queue` widget), voice-quote starter (`/voice-quote` button + voice_note quick action), voice-note starter (`/voice` QuickToolLink), prospecting/map with UCC CSV (`/qrm/opportunity-map` page wires `parseUccProspectCsv` + Upload affordance + `uccProspects` state — real code, not label-only), log-action shortcuts (Submit service request → `/service/intake`, Add customer → `/qrm/companies?new=1`). Three quality residuals tracked in audit §3 (voice-route consolidation, optional map-as-widget embed, briefing depth check) — none block. |
| 18 | Trade single-number → comp range | ✓ | `supabase/functions/trade-book-value-range/index.ts`, `trade-valuation/index.ts`. `components/PointShootTradeCard.tsx` uses `inferTradeRangeSummary` for range display. `components/TradeInSection.tsx` shows "Trade Range" label. | **Spot-check.** Open every code path that shows a trade value and confirm none of them display a single bogus number from the old single-valuation feed. |

### 3.2 Acceptance criteria 19–28 (`IRON_QUOTE_DELTA_2026-05-14.md` §5)

| # | Criterion | Verify | Status if verify passes |
|---|---|---|---|
| 19 | Intake = exactly one input field (typed + mic), no mode picker visible. Placeholder = "Describe what you want to quote." | Open `wizard/IntakeInput.tsx` line ~73. Screenshot mobile + desktop. | ✓ |
| 20 | Any previously-completed step pill clickable from any later step. Forward jump past unfilled step blocked. | Open `wizard/WizardProgress.tsx` lines ~51–61. Click sequence on the live wizard. | ✓ |
| 21 | Equipment base price overridable inline on Step 5 + Step 9, margin recomputes on each keystroke. | Open Pricing step + Review step in browser. Type into the override field. Watch the margin number. | ✓ (column shipped; staging browser proof recommended) |
| 22 | PDF prints zero internal-tagged lines (PDI, inbound freight, good faith, attachment install labor) for any quote. | Generate a quote with internal-tagged lines. Open the PDF. | ✓ (Track A PDF filter) |
| 23 | PDF prints all customer-tagged lines (outbound delivery, doc fee, tag, title, registration) when populated. | Same quote. | ✓ |
| 24 | PDI line on Step 5 pre-fills from `pdi_average_by_brand_model` view for selected make+model. | Pick an ASV/Bandit/Yanmar model with prior PDI history. | ✓ |
| 25 | Inbound freight field is hidden when `equipment.in_stock=true`. | Quote against an in-stock unit. Inspect the Pricing step. | ✓ in code (`inboundFreightEligible` in `PricingAdderBuckets.tsx` / `PricingStep.tsx`); staging spot-check recommended. |
| 26 | Aged-inventory bypass fires when stock age ≥ 365d AND margin ≥ 8% (per seeded thresholds). | Quote against an aged stocked unit at 9% margin. Approval status = `auto_approved`. Banner visible. | ✓ |
| 27 | Step 3 Configure has a Parts tab; rep adds part numbers from QEP parts inventory. | Open Step 3. Tap Parts tab. Search dialog returns part-number-backed rows. | ✓ |
| 28 | M365 token-rotation cron runs successfully and never lets a rep's token expire without rotation logged. | `select * from cron.job where jobname like 'm365%'` + check `onedrive_sync_state.token_refresh_fail_count` is 0 across rep rows. | ✓ (in staging — needs production confirm) |

### 3.3 Spec §6 acceptance criteria 1–18 (`QRM_QUOTE_WIZARD_SPEC_2026-05-05.md`)

These were the original acceptance items before the transcript delta. Items 1–18 from §6 are covered by the wizard build itself (steps 1–11 + tax engine + approval + PDF) and are not re-listed here. Builder should re-walk them once 3.1 and 3.2 are clean — they are upstream prerequisites that the delta items assume.

**Open call-outs the builder should explicitly re-verify:**
- §6 #2: state tax math = `(subtotal - trade) * 0.06` for FL deliveries.
- §6 #3: county surtax $5,000 cap (Columbia at 1.5% × $5,000 = $75.00, per IntelliDealer Q02699).
- §6 #4: tax-exempt customer with valid certificate produces $0 tax line + "Tax Exempt" badge on PDF.
- §6 #6: approval fires on margin floor, trade max, rep discount cap, OR any line flagged.
- §6 #7: all four manager outcomes route (approve, approve-with-edits, reject, reject-with-comments).
- §6 #11: TILA disclaimer on every payment-math surface.

### 3.4 IntelliDealer PDF parity (`QRM_QUOTE_WIZARD_SPEC_2026-05-05.md` §10.15, items 1–30)

Open the live quote PDF in staging next to IntelliDealer Q02699 (the canonical reference). Compare line-by-line. **Every one of items 1–30 must be present.** Items 11.5/11.9 in the spec amend items 17, 18, 19 to suppress when empty — verify empty-section suppression instead of bare headers.

**Run:** generate a quote with multi-unit + trade-in + parts + misc + financing scenario. Side-by-side review against Q02699. Architect-level sign-off required before this section is marked ✓.

### 3.5 Decomposition plan (`IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.md` §3)

| PR | Topic | Status |
|---|---|---|
| 1 | wizard-types + wizard-storage | ✓ |
| 2 | WizardProgress | ✓ |
| 3 | wizard-navigation | ✓ |
| 4 | WizardStateProvider + useWizard | ✓ |
| 5 | useLiveMargin | ✓ |
| 6 | usePdiAutofill | ✓ |
| 7 | useApprovalBypass | ✓ |
| 8 | equipment-override-price helpers + typed column | ✓ (`578_*` migration + lib + edge fn + PDF + tests all shipped) |
| 9 | useDraftAutosave | ✓ |
| 9.5 | IntakeInput shared primitive | ✓ |
| 10 | CustomerStep | ✓ |
| 11 | EquipmentStep | ✓ |
| 12 | ConfigureStep + QuoteWorkspaceLineRow + lib/money + lib/package-kind-label | ✓ |
| 13 | TradeInStep | ✓ |
| 14 | PricingStep | ✓ |
| 15 | PromotionsStep | ✓ |
| 16 | FinancingStep | ✓ |
| 17 | DetailsStep | ✓ |
| 18 | ReviewStep | ✓ |
| 19 | DocumentStep | ✓ |
| 20 | SendStep | ✓ |
| 21 | WizardShell | ✓ |

**Decomposition is complete.** Page is 5 lines; orchestration moved to `useQuoteBuilderV2Orchestrator` + `QuoteBuilderV2PageShell` / `QuoteBuilderV2PageView`. Future per-step work lands in the step file that owns it.

---

## 4. Required fixes — order of operations

### Fix A — Equipment override typed-column promotion ✓ SHIPPED

Migration `578_equipment_override_price_column.sql` applied + backfilled. `lib/equipment-override-price.ts` writes the typed column. `quote-builder-v2` edge fn reads it for margin / approval / PDF. Vitest spec in `lib/__tests__/equipment-override-price.test.ts` green.

### Fix B — Wizard decomposition PRs 13–21 ✓ SHIPPED

All 11 step modules in `apps/web/src/features/quote-builder/steps/`. `wizard/WizardShell.tsx` extracted. Page is 5 lines + orchestrator hook + shell/view components. See §3.5.

### Fix C — Edge gateway backlog ✓ SHIPPED

`scripts/edge-auth-allowlist.json::unregistered_in_config` is empty. All 186 edge functions have `[functions.X]` blocks in `supabase/config.toml`. `bun run audit:edges` exits 0.

### Fix D — Test infra ✓ MOSTLY SHIPPED

Playwright config + 3 specs in `apps/web/tests/e2e/` (`quote-wizard-happy-path`, `quote-wizard-back-forward-nav`, `quote-approval-bypass`). `e2e-staging.yml` CI workflow + `bundle:check` script in `apps/web/package.json`. **Remaining:** set `PLAYWRIGHT_TEST_EMAIL`, `PLAYWRIGHT_TEST_PASSWORD`, `PLAYWRIGHT_AGED_EQUIPMENT_ID` env vars on CI per `apps/web/tests/e2e/TODO_PLAYWRIGHT.md` so all 3 specs go from skipped to pass. Lighthouse hardening still open (not blocking).

### Fix E — Step 25 verification ✓ IN CODE, STAGING SPOT-CHECK PENDING

`inboundFreightEligible` gate in `components/PricingAdderBuckets.tsx` / `steps/PricingStep.tsx`. Open the Pricing step in staging against an in-stock unit; confirm the inbound freight input is hidden. If it isn't, the gate's truthiness check is wrong — patch in `PricingAdderBuckets.tsx`.

### Fix F — Floor / sales-advisor home audit ✓ AUDITED — all 7 elements shipped

See `IRON_FLOOR_AUDIT_2026-05-17.md` for the per-element evidence map. No net-new build required. Three quality residuals tracked separately (voice-route consolidation, optional map-as-widget embed, AI briefing depth) — none block sign-off.

---

## 5. Acceptance gates — runnable now

Repo head 20b3805e passes all of these (last run 2026-05-17):

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
bun run migrations:check                                # exit 0
bun run audit:edges                                     # exit 0 — 186/186 registered
bun run audit:secrets                                   # exit 0
( cd apps/web && bun run typecheck )                    # exit 0
( cd apps/web && bun test src/features/quote-builder )  # 1,154 pass / 0 fail
( cd apps/web && bun run test:e2e )                     # exit 0 — 1 pass / 3 skip
( cd apps/web && bun run build )                        # exit 0
```

To flip the 3 skipped Playwright specs to pass, set the env vars from `apps/web/tests/e2e/TODO_PLAYWRIGHT.md` on the `e2e-staging` CI job:
- `PLAYWRIGHT_TEST_EMAIL`
- `PLAYWRIGHT_TEST_PASSWORD`
- `PLAYWRIGHT_AGED_EQUIPMENT_ID`

When all of §3.1, §3.2, §3.3, §3.4, §3.5 are ✓ **and** the Playwright suite is fully green (3 pass) **and** §3.4 PDF parity is signed off by architect: the build is verified to spec.

---

## 6. Open product questions still blocking "world-class"

These are **not code fixes.** They block sign-off, not the build. Flag them in the PR description; do not block PRs on them.

From `IRON_QUOTE_DELTA_2026-05-14.md` §3:

| # | Question | Affects |
|---|---|---|
| Q1 | Speaker identity in transcript (Craig = Brian?) | Provenance only |
| Q2 | Aged-inventory bypass thresholds beyond seeded 365 / 8% | Already has working defaults via `approval_bypass_rules` table |
| Q3 | Margin floor for non-bypass path | Approval gate baseline |
| Q4 | PDI history data source confirmation (`pdi_average_by_model` populated from?) | Verify production data is flowing |
| Q5 | Inbound freight calc source (`qb_internal_freight_rules` rows) | Verify production data is flowing |
| Q6 | Post-approval routing default (`return_to_rep` vs `auto_send_customer`) | Schema in place, default needs sign-off |
| Q7 | Prospect-quote path allow/deny + conversion timing | Closes 3.1 row 16 |
| Q8 | Per-line cost-visibility manual toggle behavior | Toggle exists; product confirms semantics |
| Q9 | Outbound delivery PDF copy template | Final wording for the line that prints |
| Q10 | Rebate stack precedence policy (cash+finance both, or one-or-other) | `stack_kind` schema in place; policy needs sign-off |
| Q11 | IntelliDealer snapshot scope + cutover date | Closes 3.1 row 14 |
| Q12 | M365 tenant consent model (per-user vs admin-consent) | Closes 3.1 row 15 production verification |
| Q13 | Mobile breakpoint number (currently tailwind `md:` 768px) | Style only |
| Q14 | 8x8 vs Twilio for Step-2 availability escalation | Notification channel |
| Q15 | Sales-advisor home v1 cut priority order | Closes 3.1 row 17 scope |
| Q16 | Three voice routes from `/floor` (`/voice-quote`, `/voice`, `/voice-qrm`) — consolidate or label? | Floor audit §3.1; rep UX on advisor home |

---

## 7. Out of scope for this verification pass

- Cluster A behavior change to drop one of the two intake surfaces (Start quote vs Fast intake). Both render identically via `<IntakeInput />` now — picking which to keep is a product decision.
- Lease quoting (Step 7 Lease tab) — still gated on `FEATURE_LEASE_QUOTING` flag + Rylee's rate sheets per `BLK-3`.
- Cyber insurance / NDA.
- Bundle-size and Lighthouse hardening beyond the budget guard in Fix D.

---

## 8. How RepoPrompt should fan this out (verified 2026-05-17)

**Lane 1 — Decomposition + override column.** ✓ Done. Fix A, Fix B PRs 13–21 all shipped at 20b3805e.
**Lane 2 — Edge gateway backlog.** ✓ Done. `unregistered_in_config` is empty.
**Lane 3 — Test infra.** ✓ Mostly done. Playwright config + 3 specs + CI workflow + bundle:check shipped. Only env-var wiring remains.
**Lane 4 — Operations.** Open. §3.3 manual QA on staging, §3.4 PDF parity sign-off, Playwright env-var wiring, product Qs in §6 (incl. Q16 from floor audit). Fix F closed — see `IRON_FLOOR_AUDIT_2026-05-17.md`.

**Zero remaining code lanes.** Fixes A–F shipped or audit-closed.

**Single remaining ops sequence:**
1. Brian / DevOps wires `PLAYWRIGHT_TEST_*` env vars on the `e2e-staging` CI job → 3 specs go green.
2. Rylee + architect do the §3.3 manual QA pass + §3.4 PDF parity sign-off against Q02699 in staging.
3. Product (Brian / Rylee / Ryan) answers §6 Qs Q6, Q7, Q11–Q15 plus the new floor-audit voice-route Q, and updates this doc with the answers.

When the ops sequence closes: the build is verified to spec.
