# Iron Quote Build — Executive Summary (2026-05-17)

**Audience:** Brian Lewis (brief Ryan + Rylee for sign-off)  
**Repo:** `qep-knowledge-assistant` @ `20b3805e`  
**Status:** **Code-complete.** Fixes A–F are shipped or audit-closed. Sign-off is operational only.

---

## Headline

The Iron Quote wizard build from the May 14 transcript delta is **done in code**. The 11-step wizard is decomposed, edge auth is registered, Playwright e2e is bootstrapped, equipment override has a typed DB column, and the sales-advisor `/floor` home passes the 7-element transcript audit (including real UCC CSV ingest on the prospecting map).

**Nothing left for engineering to build** before you can call this verified — only secrets, staging QA, PDF parity review, and product policy answers.

---

## What shipped (code lanes A–F)

| Lane | Deliverable | Evidence |
|------|-------------|----------|
| **A** | Equipment override typed column | Migration `578_*`, `equipment-override-price.ts`, `quote-builder-v2` |
| **B** | Wizard decomposition | `QuoteBuilderV2Page.tsx` = 5 lines; 11 `steps/*`; `WizardShell`; orchestrator hook |
| **C** | Edge gateway | 186/186 functions in `config.toml`; `unregistered_in_config` empty |
| **D** | Test infra | Playwright + 3 specs; `e2e-staging.yml`; 1,154 vitest tests green |
| **E** | Inbound freight when in stock | `inboundFreightEligible` in `PricingAdderBuckets` — staging spot-check pending |
| **F** | `/floor` advisor home | All 7 transcript elements — see `IRON_FLOOR_AUDIT_2026-05-17.md` |

---

## What each person does to close sign-off

### Brian / DevOps (≈30 min)

1. Add GitHub Actions secrets on `e2e-staging`: `PLAYWRIGHT_TEST_EMAIL`, `PLAYWRIGHT_TEST_PASSWORD`, `PLAYWRIGHT_AGED_EQUIPMENT_ID` (staging rep + aged equipment UUID).  
   → E2E goes from **1 pass / 3 skip** to **full green**.

### Rylee (half-day staging)

1. **§3.3 manual QA** on `https://qep.blackrockai.co/quote-v2`: FL 6% tax, Columbia surtax $5K cap, tax-exempt PDF badge, four manager approval outcomes, TILA on payment surfaces.  
2. **Spot-checks:** equipment price override on Steps 5+9 (margin moves); inbound freight hidden on in-stock unit.  
3. **Aged-inventory bypass:** quote aged stocked unit ≥8% margin → auto-approved banner, no manager case.  
4. **`/floor`:** open as advisor — confirm briefing feels useful (quality residual if thin).  
5. **Voice routes (new Q16):** three entry points from home (`/voice-quote`, `/voice`, `/voice-qrm`) — say whether to consolidate or relabel.

### Architect (half-day)

1. **§3.4 PDF parity:** generate a rich quote PDF; side-by-side vs IntelliDealer **Q02699** (§10.15 items 1–30). Sign off or file deltas.

### Ryan + Brian (product, not blocking deploy)

Answer open questions in handoff §6: **Q6** post-approval default, **Q7** prospect-quote policy, **Q11** IntelliDealer cutover scope, **Q12** M365 consent, **Q15** floor priority (mostly moot — all 7 elements exist), **Q16** voice-route UX.

---

## Quality residuals (track, do not block)

1. **Three voice routes** from one home — product labeling/consolidation (Q16).  
2. **Prospecting map** is a quick-link to `/qrm/opportunity-map`, not an embedded `/floor` widget — optional small PR if map-on-home is required.  
3. **AI briefing depth** — verify against prod data; upgrade path is `useFloorNarrative` + `static-narrative.ts` if Rylee wants richer daily narrative.

---

## Automated gates (already green @ 20b3805e)

```bash
bun run migrations:check   # exit 0
bun run audit:edges        # exit 0
cd apps/web && bun run typecheck && bun test src/features/quote-builder  # exit 0, 1154 pass
cd apps/web && bun run test:e2e   # exit 0, 1 pass / 3 skip (until secrets)
bun run build            # exit 0
```

---

## Reference docs (in repo)

| Doc | Path |
|-----|------|
| Full verification matrix | `docs/operations/IRON_QUOTE_BUILD_VERIFICATION_HANDOFF_2026-05-16.md` |
| Floor audit (Fix F) | `docs/operations/IRON_FLOOR_AUDIT_2026-05-17.md` |
| Playwright skip follow-up | `apps/web/tests/e2e/TODO_PLAYWRIGHT.md` |
| Transcript delta (binding) | `QEP (1)/IRON_QUOTE_DELTA_2026-05-14.md` (local `QEP (1)/` folder) |

---

## One-liner for Ryan and Rylee

> "The quote wizard Brian asked for from the May 14 call is built and tested in CI — we're waiting on your staging walkthrough, PDF sign-off against Q02699, and a few policy calls (prospect quotes, post-approval routing, voice buttons on the floor). Engineering is not holding anything."
