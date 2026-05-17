# GOAL — WAVE-QB-PARITY-CLOSE

Close the Quote Builder mobile-first parity arc by deep-reflowing the three remaining QB steps (Customer, Document, Send) the deep-reflow wave didn't touch, and eliminating the residual `/quote-v2` inline links the polish wave left behind. Work autonomously. Do not stop until every completion criterion below is met. Do not ask for permission on routine implementation decisions inside the locked stack.

This wave is the tail end of the QB family. Predecessors (all shipped to `main` on 2026-05-17):

- `WAVE-MOBILE-FIRST-SALES-REP-HANDOFF.md` → `WAVE-MOBILE-FIRST-SALES-REP-SHIP-REPORT-2026-05-17.md`
- `WAVE-QUOTE-BUILDER-DEEP-REFLOW-HANDOFF.md` → `WAVE-QUOTE-BUILDER-DEEP-REFLOW-SHIP-REPORT-2026-05-17.md`
- `WAVE-QUOTE-BUILDER-POLISH-HANDOFF.md` → `WAVE-QUOTE-BUILDER-POLISH-SHIP-REPORT-2026-05-17.md`
- `WAVE-QB-CI-QUALITY-HANDOFF.md` → `WAVE-QB-CI-QUALITY-SHIP-REPORT-2026-05-17.md`
- `WAVE-QB-QUALITY-TAIL-HANDOFF.md` → `WAVE-QB-QUALITY-TAIL-SHIP-REPORT-2026-05-17.md`

---

## Paths

- Project root (build target): `/Users/brianlewis/Projects/qep-knowledge-assistant`
- Remote: `github.com/lewis4x4/qep` (branch: `main`)
- QB steps directory: `apps/web/src/features/quote-builder/steps/`
- Page shell (reference for `<lg` single-column pattern): `apps/web/src/features/quote-builder/QuoteBuilderV2PageShell.tsx`
- Mobile primitives (existing — use these, don't build new ones): `apps/web/src/components/mobile/MobileBottomSheet.tsx`, `apps/web/src/components/mobile/MobileVoiceTextarea.tsx`, `apps/web/src/components/mobile/MobileWizardStepper.tsx`
- Quote-route helper (use for all `/sales/quotes/...` links): `apps/web/src/lib/quote-route.ts`
- Redirect helper (legacy `/quote-v2` inbound): `apps/web/src/components/RedirectPreserveSearch.tsx`
- Canonical test sweep script: `scripts/run-integration-tests.mjs` (driven by `bun run test`)
- Ship report destination: `WAVE-QB-PARITY-CLOSE-SHIP-REPORT-2026-05-17.md` at repo root

CLAUDE.md at repo root references the wrong project path (`/Users/brianlewis/client-projects/qep`). The correct path is the one above. Do not edit CLAUDE.md as part of this wave.

---

## First action

Before writing code:

1. `git status` — verify clean working tree on `main`. `git pull --rebase origin main` if behind.
2. Read the predecessor ship reports in this order to understand the established reflow pattern: `WAVE-QUOTE-BUILDER-DEEP-REFLOW-SHIP-REPORT-2026-05-17.md`, `WAVE-QUOTE-BUILDER-POLISH-SHIP-REPORT-2026-05-17.md`, `WAVE-QB-QUALITY-TAIL-SHIP-REPORT-2026-05-17.md`.
3. Read one already-reflowed step end-to-end as the pattern reference — `apps/web/src/features/quote-builder/steps/ReviewStep.tsx` (B5) is the cleanest example.
4. Read the three target step files to inventory what changes: `CustomerStep.tsx`, `DocumentStep.tsx`, `SendStep.tsx`.
5. `grep -rn "/quote-v2" apps/web/src --include="*.tsx" --include="*.ts" | grep -v "RedirectPreserveSearch\|redirect-preserve\|.test.\|.spec."` — expect 3 occurrences. Confirm before slice 4.

---

## Slice plan

Slice-per-commit, push to `origin/main` after each green slice. Verification gates run before every commit.

### Slice 1 — `CustomerStep.tsx` deep reflow

Apply the same `<lg` single-column pattern used by Pricing/Financing/Promotions/Equipment/Configure/TradeIn/Details/Review:

- Wrap the step body so the right-rail aside collapses below `lg` (match shell behavior — aside is `hidden xl:block` upstream).
- Move customer search / picker / address-book affordances into `MobileBottomSheet` triggers at `<lg`. Keep desktop dialog behavior above `lg`.
- Any free-text fields (notes, custom address lines) → `MobileVoiceTextarea` at `<lg`.
- Tap targets `min-h-[44px]`, sticky primary action on phone using `pb-[env(safe-area-inset-bottom)]` (lift the pattern from ReviewStep).
- Accordion-group dense field clusters where appropriate.
- Test: add or update an integration test that asserts the customer picker/search opens as `MobileBottomSheet` at phone width and as a dialog above `lg`. Co-locate with existing step tests.

Commit message:

```
[wave-qb-parity] CustomerStep deep reflow

- Single-column shell at <lg
- MobileBottomSheet for customer search / address picker
- Sticky primary CTA with safe-area inset
- Integration test for phone vs desktop picker surface
```

### Slice 2 — `DocumentStep.tsx` deep reflow

- Stack uploaders vertically at `<lg`; preview pane becomes a `MobileBottomSheet` at phone width.
- `Upload` / `Replace` / `Remove` buttons stay reachable inside iOS Safari URL chrome — apply `pb-[env(safe-area-inset-bottom)]`.
- Any free-text fields (titles, descriptions) → `MobileVoiceTextarea` at `<lg`.
- Test: integration test asserting preview opens in `MobileBottomSheet` at phone width.

Commit message:

```
[wave-qb-parity] DocumentStep deep reflow

- Stacked uploader column at <lg
- Preview migrates to MobileBottomSheet on phone
- Safe-area inset for action buttons
- Integration test for phone preview surface
```

### Slice 3 — `SendStep.tsx` deep reflow

- Collapse recipient + delivery options into a single scrollable column at `<lg`.
- Address-book / contact picker → `MobileBottomSheet`.
- Sticky `Send` primary CTA on phone with safe-area inset.
- Success-state takes over the full viewport at `<lg` (full-bleed); preserve desktop card behavior above `lg`.
- Test: integration test verifying sticky Send button and phone success-state behavior.

Commit message:

```
[wave-qb-parity] SendStep deep reflow

- Single-column delivery layout at <lg
- MobileBottomSheet for contact picker
- Sticky Send CTA with safe-area inset
- Full-bleed success state on phone
- Integration test for sticky CTA and success state
```

### Slice 4 — Eliminate residual `/quote-v2` inline links

- Replace remaining inline `/quote-v2` occurrences (3 expected) with the `quote-route.ts` helper.
- After the sweep, `grep -rn "/quote-v2" apps/web/src --include="*.tsx" --include="*.ts" | grep -v "RedirectPreserveSearch\|redirect-preserve\|.test.\|.spec." | wc -l` MUST return `0`.
- Inspect `App.tsx`. If `RedirectPreserveSearch` for `/quote-v2` is no longer referenced anywhere except the route mount itself, keep the route mount (inbound bookmarks). If anything else still references it, leave it untouched.
- Test: add a unit test (vitest) asserting zero non-helper, non-test occurrences of `/quote-v2` in `apps/web/src`. Use a `glob` + `readFileSync` pattern so it runs in the existing sweep.

Commit message:

```
[wave-qb-parity] kill residual /quote-v2 inline links

- 3 callsites migrated to quote-route.ts helper
- Guard test asserts zero non-helper /quote-v2 in apps/web/src
- RedirectPreserveSearch route mount preserved for inbound bookmarks
```

### Slice 5 — Verification + ship report

- Run all build gates (see "Final completion gate" below).
- Walk the wizard end-to-end at 390×844 manually if a browser is available; otherwise rely on integration tests + a viewport-resize unit pass.
- Write `WAVE-QB-PARITY-CLOSE-SHIP-REPORT-2026-05-17.md` at repo root. Structure mirrors the quality-tail ship report: outcome paragraph, slice ledger table, per-slice pieces table, build-gates table, "What's left" section (lighthouse authed baseline is still passive; multi-approver still blocked), Jarvis Frontend Handoff note (likely "no backend changes").
- Commit message:

```
[wave-qb-parity] verification + ship report
```

---

## Completion criteria — the goal is met when ALL of these pass

1. Slice 1 (`CustomerStep` deep reflow) is committed to `origin/main` with commit prefix `[wave-qb-parity]` and `[SLICE 1 COMPLETE]` block visible in the transcript.
2. Slice 2 (`DocumentStep` deep reflow) is committed to `origin/main` with prefix `[wave-qb-parity]` and `[SLICE 2 COMPLETE]` block visible.
3. Slice 3 (`SendStep` deep reflow) is committed to `origin/main` with prefix `[wave-qb-parity]` and `[SLICE 3 COMPLETE]` block visible.
4. Slice 4 (residual `/quote-v2` inline-link sweep) is committed to `origin/main` with prefix `[wave-qb-parity]` and `[SLICE 4 COMPLETE]` block visible. The grep count anchor `0` must appear in the transcript output for `grep -rn "/quote-v2" apps/web/src --include="*.tsx" --include="*.ts" | grep -v "RedirectPreserveSearch\|redirect-preserve\|.test.\|.spec." | wc -l`.
5. `bun run migrations:check` from repo root exits 0 with the file-count line visible in the transcript.
6. `bun run build` from repo root exits 0.
7. `bun run build` from `apps/web` exits 0.
8. `bun run typecheck` from `apps/web` exits 0.
9. `bun run test` from repo root (the canonical per-file isolation sweep) reports `all 22 file(s) green` and zero failures across the unit + integration sweeps — output visible in the transcript.
10. `WAVE-QB-PARITY-CLOSE-SHIP-REPORT-2026-05-17.md` exists at repo root and is committed to `origin/main`.
11. `git log --oneline origin/main` shows the slice commits in order with `[wave-qb-parity]` prefix and the ship-report commit at HEAD.
12. Final `[GOAL COMPLETE]` marker output in the final turn.

If any criterion fails, the goal is not met. Continue working.

---

## Binding rules — never violate

- Mission lock: every change must strengthen the equipment/parts sales+rental operations surface for reps, employees, corporate ops, and management. If a slice drifts off-mission, stop and surface.
- Stack is locked. React 18 + TypeScript strict + Tailwind + shadcn primitives + Supabase. No new state-management libraries. No new mobile UI primitive libraries — use the existing `MobileBottomSheet` / `MobileVoiceTextarea` / `MobileWizardStepper`.
- No `any` types except where a third-party constraint forces it, and only with an inline comment justifying it.
- Mobile-first quality is required. Every reflowed step must pass a visual check at 390×844 viewport.
- WCAG AA floor: tap targets `min-h-[44px]` minimum, focus rings visible, `prefers-reduced-motion` respected on any new motion.
- RLS / role / workspace security: out of scope for this wave — no backend changes expected. If a step turns out to need a backend touch, stop and surface.
- The canonical test sweep is `bun run test` (per-file isolation). Never gate on raw `bun test --timeout=30000` — the documented `mock.module` persistence makes raw bun fail intermittently. If raw bun fails but `bun run test` passes, the gate is green.
- No `/quote-v2` literal strings introduced anywhere except `RedirectPreserveSearch` and the existing route mount. All link callsites go through `quote-route.ts`.
- No mid-slice commits. No broken-build commits. Verify gates pass before every commit.
- Do not edit CLAUDE.md (path inconsistency noted in this brief — handle separately if Brian asks).
- Do not introduce architecture resets or breaking API shape changes. Build from the in-flight baseline.

Forbidden patterns (ship none of these):

- New desktop-only dialogs at `<lg` (must be `MobileBottomSheet`).
- Hard-coded pixel widths for layout containers (use Tailwind responsive utilities).
- Inline `<textarea>` for free-text on phone (use `MobileVoiceTextarea`).
- New `/quote-v2` literal references outside the redirect mount.
- Skipping a build gate "because the change is small."
- Adding `// eslint-disable-next-line` without a comment explaining the constraint.
- Snapshot tests for visual diff (use behavioral assertions).

---

## Autonomy

Decide on your own — proceed without asking:

- File-level layout choices inside a step (accordion grouping, field order, sticky placement) as long as the established pattern is followed.
- Test names, file placement, fixture choices, mock surfaces — match the existing test conventions in the same directory.
- Whether a given inline picker becomes a `MobileBottomSheet` or stays inline (default: if it opens a dialog upstream, it becomes a sheet at `<lg`).
- Commit message wording inside the established prefix/format.
- Whether to add a guard test for slice 4 as vitest or as a script — prefer vitest co-located with existing unit tests.
- Minor refactors inside the touched step file (extracting a sub-component, renaming a prop) that improve clarity without changing public API.
- Tailwind class ordering / whitespace cleanup inside touched files.

Surface and pause only for:

- A step turning out to require a backend / RPC / RLS change (out of scope; mission-misaligned for this wave).
- A merge conflict on `main` that requires non-trivial reconciliation.
- A regression in the canonical sweep that doesn't reproduce in isolation and isn't traceable to the wave's changes (could indicate a different in-flight issue).
- Discovery that a residual `/quote-v2` link points to a route that doesn't exist in `quote-route.ts` (helper needs extension; surface for direction).

Do not pause for:

- "Permission" on routine edits inside the locked stack.
- Confirmation that a build is green — the gates speak for themselves.
- Whether to push after a slice — always push.
- Whether to write a test for a slice — always write the test before committing the slice.
- Whether to bump versions, edit changelog, edit CLAUDE.md, or touch unrelated files — do not.

---

## Commit cadence

Slice-per-commit. Push to `origin/main` after each green slice. Commit format:

```
[wave-qb-parity] <slice name>

- <what shipped, one line each>
```

Do not commit mid-slice. Do not commit broken builds. Verify the gates listed under "Final completion gate" pass before every commit (the per-slice gate is the minimum set: `apps/web` typecheck + `apps/web` build + `bun run test`; the full root-level gates run once before the ship-report commit).

---

## Progress reporting

After each slice completes and is committed and pushed, output:

```
[SLICE N COMPLETE]

Commit: <short SHA>
Pushed: origin/main

Shipped:
- <bullets>

Gates (per-slice minimum):
- apps/web typecheck: PASS
- apps/web build: PASS
- bun run test: PASS

Acceptance for this scope:
- <bullets matching the slice plan>

Next: Slice N+1 — <name>
```

If you hit a blocker, output:

```
[BLOCKED — Slice N]

Blocker: <description>
Tried: <what you attempted>
Need: <specific decision or input required>
```

---

## Quality bar — applied every slice

A senior product designer would not flag the chrome on the reflowed step at 390×844 viewport. Operational density is preserved at desktop. No regressions to the desktop layout. The phone surface feels like a native app, not a desktop page squeezed to fit.

If at any point the output feels like "shrunk desktop in a phone frame" rather than a deliberately reflowed mobile surface, stop and surface it. That signal is more important than shipping the slice cleanly. The QB wave family has been ruthless about this; don't let parity-close be the slice that drops the standard.

---

## Final completion gate

After Slice 5's ship-report commit, before declaring complete, run from the repo root:

1. `bun run migrations:check`
2. `bun run build` (repo root)
3. `cd apps/web && bun run build`
4. `cd apps/web && bun run typecheck`
5. `bun run test` (canonical per-file isolation sweep — must report `all 22 file(s) green`)
6. `grep -rn "/quote-v2" apps/web/src --include="*.tsx" --include="*.ts" | grep -v "RedirectPreserveSearch\|redirect-preserve\|.test.\|.spec." | wc -l` — must output `0`
7. `git log --oneline origin/main | head -10` — must show 5 `[wave-qb-parity]` commits including the ship-report commit at HEAD
8. `ls -la WAVE-QB-PARITY-CLOSE-SHIP-REPORT-2026-05-17.md` — must exist

When all gates pass, output:

```
[GOAL COMPLETE]

WAVE-QB-PARITY-CLOSE shipped end-to-end to origin/main.
Quote Builder mobile-first parity arc is closed: all 11 steps deep-reflowed, residual /quote-v2 inline links eliminated, canonical sweep green.

Slice commits (oldest → newest):
- <SHA> [wave-qb-parity] CustomerStep deep reflow
- <SHA> [wave-qb-parity] DocumentStep deep reflow
- <SHA> [wave-qb-parity] SendStep deep reflow
- <SHA> [wave-qb-parity] kill residual /quote-v2 inline links
- <SHA> [wave-qb-parity] verification + ship report

Ship report: WAVE-QB-PARITY-CLOSE-SHIP-REPORT-2026-05-17.md
```

Then stop.
