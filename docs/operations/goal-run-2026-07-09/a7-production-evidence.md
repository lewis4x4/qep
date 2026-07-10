# A7 OEM Re-Price — Production Evidence

Date: 2026-07-09

Production project: `iciddijgonywtxoelous`

Fixture workspace: `a7-accept-2026-07-10t022145765z-41978d2d8b`

Verdict: **PASS for fixture-driven A7.4/A7.5/A7.6/A7.7/A7.9; real OEM ingestion remains gated**

Evidence: `test-results/agent-gates/a7-production-acceptance-2026-07-09.json`

## Governed Production Flow

- An isolated fixture seeded two brands, two price sheets, four quote packages, and six quote lines on the production-shaped schema from migrations 812/813.
- Preview scanned all four quotes, found three changed catalog items, classified one material and two quiet quotes, and replayed deterministically.
- Brand scoping, an active customer lock, strict materiality, and yard-stock protection held: the material quote had a 100,000-cent line-percentage exposure; the locked quote contributed zero automatic delta; the quiet quote's 10,000-cent change remained quiet; the same model under the other brand was untouched.
- Publish created one active price-book event affecting one material quote, and replay returned the same event idempotently.
- The assigned rep received one actionable chip/card result with two impact lines. A current reassignment hid it from the former owner and exposed it to the current owner.
- A locked impact could not enter approval (HTTP 409). The eligible rep draft bound the exact lines and economics to a manager case: 4,000,000 current net cents, 4,100,000 projected net cents, 100,000 delta cents, and 26.83% projected margin.
- Manager approval never advanced or sent the quote. Apply changed only the unlocked, in-brand line and canonical totals, produced one append-only audit, and replay was dollar-idempotent.
- Reversal restored the original line and 4,000,000-cent net total, preserved the locked and other-brand lines, produced one linked reversal audit, and replay was dollar-idempotent.
- Apply and reversal both record `customer_communication: none`; both audit rows record no customer communication and no side effects. The quote remained `draft` with `sent_at: null`.

## Gate Chain And Specialist Verdicts

- `A7.4-TRUE-PRICE-DIFF` — PASS: `test-results/agent-gates/20260710T013101Z-a7-true-price-diff.json`.
- `A7.5-OPEN-QUOTE-IMPACT-HARDENING` — PASS with required UI/design and chaos checks: `test-results/agent-gates/20260710T013642Z-a7-open-quote-impact-hardening.json`.
- `A7.6-REP-PRICE-IMPACT-UX` — PASS with required UI/design and chaos checks: `test-results/agent-gates/20260710T013934Z-a7-rep-price-impact-ux.json`.
- `A7.7+A7.9-ATOMIC-APPLY-AUDIT-REVERSAL` — PASS with required UI/design and chaos checks: `test-results/agent-gates/20260710T014533Z-a7-reprice-apply-audit-reversal.json`.
- A preceding apply/reversal run is retained at `test-results/agent-gates/20260710T014207Z-a7-reprice-apply-audit-reversal.json`; it failed only because two unrelated knowledge-base uploads returned HTTP 503. The complete clean rerun above passed 15/15 checks. No waiver was used.
- QA: PASS; focused diff, impact, approval, financial-integrity, apply, reversal, and UI/API tests are green.
- Chief Design Officer: PASS; the Today chip, impact queue, approval/apply/reversal surfaces passed blocking desktop/mobile/accessibility review. Browser evidence is recorded in `docs/operations/goal-run-2026-07-09/a76-rep-price-impact-browser-qa.md`.
- Testing/Simulation: PASS; chaos ran on all A7 segments and replay/stale/authorization boundaries are covered.
- Security: PASS; tenant, current-assignment, role, price-lock, no-send, and server-authoritative money boundaries passed, and the independent review reported no P0, P1, or P2 finding.
- Migration: PASS; migrations 812 and 813 are applied and current in production.
- Performance: PASS; scans are paginated and the integrated gate/build/bundle checks are green. The acceptance fixture scanned every seeded quote without truncation.
- Release: PASS for the fixture-developed A7 scope; production-shaped apply/reversal and cleanup are complete.
- Waivers: none.

## Cleanup And Retained Evidence

- Cleanup completed with zero errors. Current assignment was restored; the restored impact was dismissed; internal fixture notifications and transient non-audited quotes/deals/customer rows were removed; and the reassignment-only user was deleted.
- The retained rep and manager actors were disabled.
- Exactly one apply audit (`ae1cb3ef-4625-43f4-848c-23c49e33cad4`) and one reversal audit (`61c00c91-da0c-4717-ab31-fe22e9eb14a7`) remain. Their quote, draft, impact, approval case, event, price sheets, and actors remain only because the append-only ledger uses `RESTRICT` provenance keys.
- The retained chain is restored and dismissed, so it is non-actionable production evidence rather than a live rep queue item.

## Mission Alignment

### A7.4-TRUE-PRICE-DIFF

- Verdict: PASS.
- Operator: pricing administrators and sales operations.
- Changed workflow/decision: canonical server-side diff tells the organization which equipment models changed, including brand-isolated and removed/discontinued cases, before exposing quotes.
- Evidence exercised: two brands/sheets, every change class in focused fixtures, deterministic preview replay, and production schema lineage.
- Residual risk: A7.2/A7.3 remain blocked; no real PDF/Excel parser or OEM sample ingestion is claimed.

### A7.5-OPEN-QUOTE-IMPACT-HARDENING

- Verdict: PASS.
- Operator: sales reps and managers protecting active deal margin.
- Changed workflow/decision: only materially exposed, unlocked, correct-brand quote lines become actionable; yard stock and quiet changes remain contextual rather than automatically repriced.
- Evidence exercised: exact threshold behavior, active lock, brand collision, yard line, quiet line, event replay, and complete fixture scan.
- Residual risk: production acceptance is fixture-driven until real OEM ingestion is available.

### A7.6-REP-PRICE-IMPACT-UX

- Verdict: PASS.
- Operator: assigned field sales reps and authorized managers.
- Changed workflow/decision: the Today chip/card and focused queue put the affected quote and projected impact in a short review path without implying a customer send or final commission truth.
- Evidence exercised: assigned/current-owner visibility, quiet suppression, chip/card API state, four responsive viewport checks, keyboard/accessibility checks, and reduced-motion coverage.
- Residual risk: browser timing is local smoke evidence, not production RUM; projected commission remains subordinate to the blocked final commission-plan work.

### A7.7+A7.9-ATOMIC-APPLY-AUDIT-REVERSAL

- Verdict: PASS.
- Operator: reps submitting a change and managers authorizing margin-sensitive pricing.
- Changed workflow/decision: one governed action prepares and applies an approved current re-price without sending the customer, while an authorized reversal reconstructs and restores every dollar.
- Evidence exercised: locked rejection, no-send approval, canonical total recomputation, idempotent apply/reverse, unchanged yard/other-brand lines, current ownership, and linked immutable audits.
- Residual risk: the immutable evidence chain intentionally remains in production; A7.2/A7.3 still block claims about real-file ingestion.
