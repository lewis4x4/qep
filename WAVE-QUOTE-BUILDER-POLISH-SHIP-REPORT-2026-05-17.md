# WAVE Quote Builder Polish + Wizard Stepper Swap — Ship Report
**Date:** 2026-05-17
**Branch:** `main`
**Commits prefix:** `[wave-qb-polish]`
**Repo:** `/Users/brianlewis/Projects/qep-knowledge-assistant` → `github.com/lewis4x4/qep`
**Predecessors:**
- `WAVE-MOBILE-FIRST-SALES-REP-HANDOFF.md` (closed 2026-05-17; commits bf6a9b92 → a0b9b0a0)
- `WAVE-QUOTE-BUILDER-DEEP-REFLOW-HANDOFF.md` (closed 2026-05-17; commits 36377204 → 8af48312)

**Reference:** `WAVE-QUOTE-BUILDER-POLISH-HANDOFF.md`

---

## Outcome

The polish wave closed every WAVE-deferred UX gap inside the Quote
Builder: the wizard stepper swap, voice dictation on every multiline
field, the trade-capture + outcome + review-send + per-approval flows
in `MobileBottomSheet`, the canonical quote-route helper rolled out
across ~30 inline callsites, and the verification spec extended to iPad
portrait. Every slice landed behind green build gates and a
`[wave-qb-polish]` commit on `origin/main`.

## Slice ledger

| # | Slice | Commit | Status |
|---|---|---|---|
| 1 | WizardShell mobile stepper swap | `11bc229c` | ✅ shipped |
| 2 | `MobileVoiceTextarea` primitive + step rollout | `f60b8612` | ✅ shipped |
| 3 | PointShoot / TradeCapture sheet conversion | `8c2b0a18` | ✅ shipped |
| 4 | Review per-approval sheets | `3e7f8885` | ✅ shipped |
| 5 | `/quote-v2` link sweep | `4015db20` | ✅ shipped |
| 6 | Remaining drawer/dialog sweep | `12cfe9ed` | ✅ shipped |
| — | Verification + ship report | this report | ✅ |

## Primitives + helpers

| File | Status |
|---|---|
| `features/sales/components/MobileVoiceTextarea.tsx` | **new** (Slice 2) — forwardRef'd textarea with Web Speech API mic in the bottom-right corner on mobile; graceful no-op when API unavailable; transcript appends to current value via synthetic React.ChangeEvent so controlled-form + react-hook-form callers see it through the same onChange contract |
| `features/quote-builder/lib/quote-route.ts` | **new** (Slice 5) — `buildQuoteBuilderHref({...})` + `buildQuoteListHref()` |
| `features/sales/components/MobileWizardStepper.tsx` | reused (Slice 1) |
| `features/sales/components/MobileBottomSheet.tsx` | reused (Slices 3, 4, 6) — `data-mobile-sheet="true"` stamp from the deep-reflow wave remains intact |
| `features/sales/hooks/useIsMobileViewport.ts` | reused (Slices 1, 3, 4, 6) |
| `features/sales/components/MobileVoiceMicButton.tsx` | unchanged — the handoff's `size="sm" + onTranscript` template doesn't compile against the existing primitive (96-128pt size contract, no transcription pipeline), so MobileVoiceTextarea hosts a 36pt inline mic of its own |

## Slice-by-slice surface

### Slice 1 — WizardShell mobile stepper swap
- `WizardShell` now renders `MobileWizardStepper` (chip rail) at
  `<640px` and falls back to `QuoteWizardProgress` (the existing tile
  grid) at sm+. Step status mapping mirrors the existing
  `canJumpToWizardIndex` + `findWizardStepIndex` logic so the two
  views stay in lockstep.
- `onStepClick` funnels through `useWizard().setStep`, so jumping
  between steps from the chip rail uses the same state path the
  desktop pills already use.
- New `WizardShell.mobile.test.tsx` (3 cases): chip rail renders at
  mobile, `QuoteWizardProgress` shows at desktop, current step
  receives `aria-current="step"`.

### Slice 2 — `MobileVoiceTextarea` + rollout
- New primitive at `features/sales/components/MobileVoiceTextarea.tsx`
  with 6-case unit test (passthrough, mic mobile-only, transcript
  append on existing + empty value, no-API hide, `data-state`).
- Raw `<textarea>` replaced in 11 quote-builder files (every one):
  `wizard/IntakeInput.tsx`, `components/OutcomeCaptureDrawer.tsx`,
  `components/QuoteReviewWorkflowPanels.tsx` (×2),
  `components/ConversationalDealEngine.tsx`,
  `components/DealCopilotPanel.tsx`,
  `components/EquipmentSelector.tsx`,
  `components/MarginFloorGate.tsx`,
  `components/TradeCaptureDialog.tsx`,
  `components/ReviewSendDialog.tsx`,
  `steps/DetailsStep.tsx` (×2), `steps/CustomerStep.tsx`.
- Every input bumps from `text-sm` to `text-base` on phone so iOS
  Safari does not auto-zoom on focus.

### Slice 3 — TradeCaptureDialog mobile sheet
- Body extracted into a shared JSX fragment; the dialog branches on
  `useIsMobileViewport` and renders as `MobileBottomSheet`
  (`size="tall"`) at `<640px`. Desktop Radix Dialog preserved at
  sm+. New mobile spec covers both viewports + `data-mobile-sheet`
  stamp.

### Slice 4 — Review per-approval sheets
- `QuoteReviewWorkflowPanels` surfaces the Approval Case as a
  tap-to-drill summary card on phone with `aria-haspopup="dialog"`
  + keyboard Enter/Space + an amber "{N} conditions open" hint when
  evaluations are unsatisfied. Tapping opens a `MobileBottomSheet`
  with the full evaluation grid + decision note.
- Detail body extracted into a shared JSX fragment so phone and
  desktop render identical content.
- **Spec note:** the handoff's "multi-approver per-approval cards"
  shape isn't possible with the current `getQuoteApprovalCase` data
  contract (1:1 quote→case relationship, not 1:N approvers). The
  tap-to-drill summary is the closest phone-friendly shape the
  existing payload supports.

### Slice 5 — `/quote-v2` link sweep
- New `features/quote-builder/lib/quote-route.ts` with 12-case test
  covering empty input, single-param permutations, special-char
  encoding, multi-param ordering, the `quoteId` path-param branch,
  empty-string filtering, and the list href.
- ~30 callsites migrated across `features/admin`,
  `features/qrm/command-center`, `features/qrm/components`,
  `features/qrm/pages`, `features/qrm/lib`,
  `features/dashboards`, `features/exec/lib`, `features/floor/*`,
  `features/voice-quote`, `components/TopBar.tsx`,
  `components/AppLayout.tsx`, and `lib/iron/IronBar.tsx`.
- Final grep:
  ```bash
  grep -rn "/quote-v2\|to=\"/quote\"" apps/web/src \
    --include="*.tsx" --include="*.ts" \
    | grep -v "test\|RedirectPreserveSearch"
  ```
  returns **3 doc-comment hits** in `App.tsx` (×2) and
  `AppLayout.tsx` that describe the legacy redirect — no active deep
  links remain. The `RedirectPreserveSearch from="/quote-v2"` in
  `App.tsx` stays as belt-and-suspenders per handoff §5.

### Slice 6 — Remaining drawer/dialog sweep
- `OutcomeCaptureDrawer` side `Sheet` collapses to
  `MobileBottomSheet` at `<640px`. Same step machine (outcome /
  reason / details), same Save + Skip CTAs.
- `ReviewSendDialog` Radix Dialog collapses to `MobileBottomSheet`
  at `<640px`. Same PDF preview + delivery options + readiness
  gating.
- Audit complete — every `*Dialog.tsx` / `*Drawer.tsx` in
  `features/quote-builder/components/` now branches to
  `MobileBottomSheet` on phone:
  `CatalogBrowserDialog` (prior wave), `MarginFloorGate` (prior),
  `PackageItemSearchDialog` (prior), `TradeCaptureDialog` (Slice 3),
  `OutcomeCaptureDrawer` (Slice 6), `ReviewSendDialog` (Slice 6).

## Verification

`apps/web/tests/e2e/quote-builder-mobile-deep.spec.ts` extended:

1. The wizard-pill selector now matches **both** `[data-step-id="X"]`
   (mobile MobileWizardStepper from Slice 1) and the legacy
   `[data-testid="wizard-progress-X"]` (desktop QuoteWizardProgress)
   — same walk works on either chrome.
2. New phone-only case: `mobile-wizard-stepper` test-id renders at
   `<640px` (proves the Slice 1 swap shipped).
3. New 768×1024 iPad-portrait describe block walks 9 of the 11 steps,
   asserts no horizontal scroll, no stray Dialog, and that the
   `Quick actions` SalesShell trigger remains visible — guarantees no
   desktop two-column regression at tablet width.
4. Existing assertions kept: no-horizontal-scroll, no
   `[role="dialog"]:not([data-mobile-sheet])`, 44pt tap targets on
   Customer landing step, Pricing margin strip + Review hero +
   summary accordions render.

Grep gates after the wave:
```bash
# (1) no leftover hardcoded /quote-v2 → only doc-comments remain
grep -rn "/quote-v2\|to=\"/quote\"" apps/web/src --include="*.tsx" --include="*.ts" \
  | grep -v "test\|RedirectPreserveSearch"
# → 3 doc-comment hits (App.tsx ×2, AppLayout.tsx ×1) describing the legacy redirect

# (2) no raw <textarea> in quote-builder
grep -rn "<textarea" apps/web/src/features/quote-builder \
  --include="*.tsx" --include="*.ts" | grep -v "MobileVoiceTextarea\|test"
# → 0 hits
```

## Build gates (run after every slice)

| Gate | Result |
|---|---|
| `bun run migrations:check` (root) | ✅ 576 files, 001..578 |
| `bun run build` (root) | ✅ green |
| `bun run typecheck` (`apps/web`) | ✅ green |
| `bun run build` (`apps/web`) | ✅ green |
| `bun test src/features/quote-builder src/features/sales` | ✅ 1234/1234 pass after Slice 6 |

Every slice ran every gate before commit + push.

## Test count delta

| Wave checkpoint | Sales + quote-builder tests |
|---|---|
| Pre-polish (post-deep-reflow) | 1207 |
| After Slice 1 (WizardShell.mobile) | 1210 (+3) |
| After Slice 2 (MobileVoiceTextarea) | 1216 (+6) |
| After Slice 3 (TradeCaptureDialog.mobile) | 1219 (+3) |
| After Slice 4 (QuoteReviewWorkflowPanels.mobile smoke) | 1220 (+1) |
| After Slice 5 (quote-route helper) | 1232 (+12) |
| After Slice 6 (OutcomeCaptureDrawer/ReviewSendDialog smoke) | 1234 (+2) |

**Net: +27 tests across the polish wave.**

## Deferred / out of scope (handed off to CI/quality wave)

These were explicitly listed as **out of scope** in the polish
handoff (§Out of Scope) and will be addressed in a separate
`WAVE-QB-CI-QUALITY-HANDOFF.md`:

1. Lighthouse mobile perf integration (handoff §6 acceptance: not
   captured in this report — requires CI run with creds).
2. `axe-playwright` accessibility scan — same.
3. `bun:test` cross-file `mock.module` pollution + full-suite hang.
4. Multi-approver-per-quote backend contract change (Slice 4 noted).

User-facing UX gaps surfaced in the predecessor ship reports are all
closed by this wave.

## Jarvis Frontend Handoff

No backend changes were made in this wave. Database schema,
migrations, RPCs, edge functions, and RLS are untouched. No new
TypeScript types needed in `jarvis-os/src/types/`. The wave is purely
frontend: 1 new primitive (`MobileVoiceTextarea`), 1 new helper
(`quote-route.ts`), 1 wizard-chrome swap, 4 desktop dialogs converted
to mobile-aware MobileBottomSheet branches, and ~30 inline quote-link
callsites consolidated behind a single helper.

---

🤖 Generated for the WAVE Quote Builder Polish + Wizard Stepper Swap
