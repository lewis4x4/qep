# QRM Contacts & Companies — World-Class Moonshot Review

**Date:** 2026-05-07
**Reviewer:** JARVIS (design-agent critique, code-grounded)
**Scope:** `/qrm/contacts`, `/qrm/companies`, and how they sit inside the QRM Graph shell.
**Mode:** Critique only. No code changes in this pass.
**Companion docs:**
- Prior audit baseline: `docs/designs/qrm-companies-contacts-moonshot-audit-2026-05-07.md`
- Oracle plan: `prompt-exports/oracle-plan-2026-05-07-181816-qrm-ui-critique-da11-1855.md`

---

## TL;DR — Verdict

**No.** These pages are *good* CRM list surfaces — better than most commercial QRMs — but they are **not yet world-class moonshot UI** and we should not be 100000% happy with them.

| Question | Answer |
|---|---|
| Is this the most world-class moonshot UI possible? | **No.** The vocabulary is moonshot; the proof is still mostly list summarization. |
| Do they flow with the other pages? | **Partially.** Contacts ↔ Companies are siblings. `/qrm/deals` (`GraphExplorer`) is a different visual system. |
| Are we 100000% happy with it? | **No.** Three credibility/coherence defects (below) must close before we sign that off. |

**Code-grounded score:** ~**83 / 100**. Ship threshold for "world-class moonshot": **90+**.

---

## What's working (don't lose this)

The current pages already implement most of the prior audit's atoms and they show:

- Shared `QrmPageHeader` / `QrmSubNav` framing and consistent header rhythm.
- Working command-deck primitives in `command-deck.tsx`: `IronBar`, `MetricStrip`, `SignalChip`, `DeckSurface`, `RowSkeleton`, `EmptyState`, `RetryState`, `KbdHint`.
- `/` to focus search, `Esc` to clear, dense monospace metadata vocabulary.
- Health-score overlays via `customer_profiles_extended`, role-aware duplicate visibility, IntelliDealer extended-search toggle on Companies.
- Contacts and Companies feel like siblings: same header, same metric strip, same row rhythm, same loading/empty/error states.
- Companies handles zero-state honestly (`Coverage tracked/loaded`, `Hot/Cool` collapse to `—`).

This is a strong scaffold. The remaining gap is **product truth**, not visual atoms.

---

## Findings — why this is not yet world-class

### F1. The pages still narrate state instead of proving fused intelligence (highest priority)

Every "intelligence" surface on these pages is currently deterministic page summary:

- `${loaded} contacts loaded`
- `${reachable}/${loaded} reachable`
- `${tracked}/${loaded} coverage`
- `Health intel pending sync`

That is honest, but it is **not transformational**. A moonshot QRM page should answer, before the operator scrolls:

1. Which account/contact should I act on next?
2. Why this one?
3. What fused signals (fleet · parts · service · health · pricing) support that?
4. What can I do in one click right now?

`MoonshotBeat` (the explicit "AI next-move" slot) **exists in `command-deck.tsx` and is rendered nowhere** (verified: 3 matches, all inside its own definition). The most important moonshot real-estate on both pages is currently empty.

### F2. Contacts duplicate-count scope is a product-trust bug (highest priority)

`QrmContactsPage.tsx`:

- Line 161 fetches the **global** duplicate candidate list: `await listDuplicateCandidates()`.
- Line 191 renders: ``${duplicateCount} duplicates detected across ${loaded} contacts``.
- Line 218 hard-codes `confidence: 0.91` whenever `duplicateCount > 0`.

That copy implies "in this cohort." The query is system-wide. For elevated users, the IronBar will state a confident, scoped-sounding number that is neither scoped nor measured. This breaks operator trust the moment somebody clicks through and finds a candidate that is not in the visible list — and "fake confidence" on a moonshot deck is exactly the failure we cannot ship.

### F3. Graph-shell coherence breaks at `/qrm/deals`

`shellMap.ts` claims a single Graph surface across Contacts · Companies · Deals. In reality:

- `/qrm/contacts` and `/qrm/companies` render the command-deck pages (`QrmPageHeader` + `QrmSubNav` + `MetricStrip` + `IronBar` + dense rows).
- `/qrm/deals` falls through `withGraphExplorer` into `GraphExplorer`, which has a different max width, different row anatomy, no `QrmPageHeader`, no `MetricStrip`, no `IronBar` and a different AI affordance vocabulary (it has per-row "Ask Iron"; Contacts/Companies do not).

Compounding this: feature flag defaults disagree.

| File | Call | Default if flag unset |
|---|---|---|
| `QrmSubNav.tsx:81` | `isFeatureEnabled(FLAGS.SHELL_V2, true)` | **on** |
| `withGraphExplorer.tsx:29` | `isFeatureEnabled(FLAGS.SHELL_V2)` | **off** |
| `withTodaySurface.tsx:17` | `isFeatureEnabled(FLAGS.SHELL_V2)` | **off** |
| `withPulseSurface.tsx:18` | `isFeatureEnabled(FLAGS.SHELL_V2)` | **off** |
| `withAskIronSurface.tsx:18` | `isFeatureEnabled(FLAGS.SHELL_V2)` | **off** |

If the flag is unset in any environment, Contacts/Companies show the new shell while Deals/Today/Pulse/Ask Iron silently do not. This is a one-token bug that causes the Graph shell to look like decorative chrome rather than one product.

### F4. "Iron sort" is a disabled promise

Companies row 268-270 renders `Hottest · soon`, `Largest pipeline · soon`, `Newest touch · soon` — disabled buttons. World-class requires **at least one** working intelligent sort. As-is, the most prominent AI-flavored affordance on the page does nothing.

### F5. Row interaction asymmetry between siblings

- Contacts: name link + chevron link.
- Companies: name link + decorative chevron (`QrmCompaniesPage.tsx:373`, no anchor wrap), with a hidden `Command` link that's hard to discover.

Two sibling pages with different "what does the row click do?" answers is exactly the kind of papercut that disqualifies a deck from "world-class."

### F6. Row-level AI handoff missing on Contacts/Companies

`GraphExplorer` already implements per-row Ask Iron (see `graphExplorerHelpers.ts`). Contacts/Companies have only an IronBar at the top of the page. The operator's next question is almost always entity-specific ("why is this account hot?", "best channel for this contact?"). Without row-level Ask Iron, the rail intelligence is decoupled from the unit of action.

### F7. Accessibility is improved, not finished

- `aria-describedby` on rows is in. Good.
- Container is still `<div>`-based — not a semantic list/listitem (or table) structure.
- Chevron behavior differs across pages (link on Contacts, decorative on Companies).
- Focus rings exist but row-as-focusable-unit is inconsistent.

Acceptable for current iteration. Not yet world-class.

---

## Top changes that move this to world-class

Ordered by impact-per-effort. Implementation deferred to a separate slice.

### P0 — required before we can claim "world-class moonshot"

1. **Render `MoonshotBeat` on both pages.** One source-backed beat each.
   - **Companies — Account Intelligence:** "Highest-risk account in view: <name>. Evidence: Fleet · Parts · Service · Health. [Open command]." If data is incomplete, render the *missing-data state* as the beat itself, with a backfill action — never fabricate a prediction.
   - **Contacts — Reach Intelligence:** "Best channel now: SMS for 4, call for 12, email for 9. Evidence: SMS opt-in · Last touch · Role · Open deals. [Review next reaches]." Same fallback rule.

2. **Fix duplicate-count scope on Contacts** *(F2).* Either:
   - **Preferred:** intersect candidate IDs with the loaded cohort, then say `${n} duplicate candidates involve contacts in this view`, or
   - **Honest fallback:** keep the global query and label it `${n} open duplicate candidates system-wide`. Drop the hard-coded `0.91` confidence; either compute it or don't show one.

3. **Align `FLAGS.SHELL_V2` default across all `with*Surface` wrappers** *(F3).* Pick one default and apply it in `withGraphExplorer`, `withTodaySurface`, `withPulseSurface`, `withAskIronSurface`, and `QrmSubNav`. This is essentially a one-line fix per file and removes a whole category of "looks broken in env X" bugs.

4. **Bring `GraphExplorer` (`/qrm/deals`) into the command-deck frame** *(F3).* Wrap it in `QrmPageHeader` + `QrmSubNav` + same max-width and row rhythm. Don't collapse Contacts/Companies into Graph — bring Graph up to them.

### P1 — coherence and interaction polish

5. **Make at least one Iron-sort option real** *(F4).*
   - Companies first sort: `Coverage risk` (we already have the data).
   - Contacts first sort: `Reachability risk` or `Best channel`.
   Disabled "soon" chips are fine to keep alongside, but at least one chip must work.

6. **Normalize row primary action across Contacts and Companies** *(F5).* Pick one rule: name link opens canonical detail/command; chevron is either a real link or removed. Apply the rule on both pages identically.

7. **Add row-level Ask Iron affordance** *(F6).* Mirror `GraphExplorer`'s pattern: hover/focus chip or row-action menu, plus a keyboard shortcut after row focus. Reuse prompt seeds from `graphExplorerHelpers.ts`.

8. **Extract a tiny shared search-rail component** *(coherence).* Just the `/`-hint + icon + caption + right-slot. Keep query logic in each page. Prevents drift between Contacts and Companies as they evolve.

### P2 — depth, motion, and accessibility

9. **Promote list semantics.** Wrap row container with `role="list"` / `role="listitem"` (or migrate to `<table>` if we want to support sort-by-column). Make rows focusable with consistent focus state.

10. **Consolidate account URL helpers.** `accountCommandUrl` (canonical, supports `returnTo`) and `buildAccountCommandHref` produce the same path today but will diverge. Pick one; delegate the other.

11. **Real, reduced-motion-safe metric tally on the `MetricStrip`.** Either implement or stop claiming it in design docs.

12. **Refresh the prior audit doc.** Several recommendations in `docs/designs/qrm-companies-contacts-moonshot-audit-2026-05-07.md` are now done. Update the score and remaining blockers so the next reviewer doesn't critique a stale baseline.

---

## Mission-lock check

Per `CLAUDE.md`, every change must clear four mission gates. The recommendations above are scored:

| Recommendation | Mission Fit | Transformation | Pressure Test | Operator Utility |
|---|---|---|---|---|
| P0.1 MoonshotBeat (real or honest-pending) | ✅ | ✅ | needs design QA on missing-data fallback | ✅ |
| P0.2 Duplicate scope fix | ✅ | — (trust, not transformation) | ✅ test elevated/rep + zero/many cohorts | ✅ |
| P0.3 Flag default alignment | ✅ | — | ✅ verify both flag states in CI | ✅ |
| P0.4 Graph shell unification | ✅ | — | ✅ visual + route-contract tests | ✅ |
| P1.5 Real Iron-sort #1 | ✅ | ✅ | ✅ test with empty/partial health data | ✅ |
| P1.6 Row primary normalization | ✅ | — | ✅ keyboard + screen reader pass | ✅ |
| P1.7 Row-level Ask Iron | ✅ | ✅ | ✅ prompt-seed coverage | ✅ |

P0.2 and P0.3 are pure trust/coherence work — they don't add transformation, but they remove the ways the deck currently lies to operators, which is a precondition for any moonshot claim sticking.

---

## Validation checklist (use after the implementation slice)

- [ ] Capture `/qrm/contacts`, `/qrm/companies`, `/qrm/deals` screenshots side-by-side.
- [ ] Re-run visual verdict against this doc's rubric; aim for ≥ 90.
- [ ] Verify elevated vs rep role: duplicate copy reads truthfully in both.
- [ ] Verify `FLAGS.SHELL_V2` set / unset / explicit-false: shell appearance is consistent across Today/Graph/Pulse/AskIron and Contacts/Companies/Deals.
- [ ] Verify zero-cohort, partial-health, and router-error states on both pages.
- [ ] Verify keyboard-only flow: `/` focus → arrow rows → row-level Ask Iron → editor sheet → `Esc` close.
- [ ] Verify reduced-motion users see no blocking animation.
- [ ] Re-score and update `docs/designs/qrm-companies-contacts-moonshot-audit-2026-05-07.md`.

---

## File-level impact (preview, not a change list)

- `apps/web/src/features/qrm/pages/QrmContactsPage.tsx` — render `MoonshotBeat`; fix duplicate scope/copy; row-level Ask Iron; row chevron rule.
- `apps/web/src/features/qrm/pages/QrmCompaniesPage.tsx` — render `MoonshotBeat`; first real Iron-sort; chevron becomes real link or is removed; row-level Ask Iron.
- `apps/web/src/features/qrm/components/GraphExplorer.tsx` — adopt `QrmPageHeader` + `QrmSubNav` + command-deck row rhythm.
- `apps/web/src/features/qrm/shell/withGraphExplorer.tsx`, `withTodaySurface.tsx`, `withPulseSurface.tsx`, `withAskIronSurface.tsx` — align `FLAGS.SHELL_V2` default with `QrmSubNav`.
- `apps/web/src/features/qrm/lib/qrm-router-api.ts` — optional `listDuplicateCandidates({ contactIds })` overload to support scoped-cohort path.
- `apps/web/src/features/qrm/lib/account-command.ts` / `account-links.ts` — consolidate canonical URL helper.
- `apps/web/src/features/qrm/components/command-deck.tsx` — likely no atom changes needed; export the search-rail primitive only if both pages still share exact behavior.
- `docs/designs/qrm-companies-contacts-moonshot-audit-2026-05-07.md` — update status and re-score.

---

## Bottom line

The deck has the **bones** of a world-class moonshot CRM. What's blocking the claim is product truth — three things specifically: an unused `MoonshotBeat` slot, a duplicate count that lies about its scope, and a Graph shell whose feature flag defaults disagree with each other. Close those three plus one real Iron-sort, and we're at 90+. Until then, "world-class" is aspirational, not earned.
