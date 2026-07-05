# QEP Engineer Actionable Blocker Revalidation

Prepared: 2026-07-05
Owner: Engineering
Purpose: implement the long-session handoff for the five Engineer-owned actionable roadmap rows without bypassing declared dependency gates.

## Source-Of-Truth Checkpoint

Commands run:

```bash
git status --short --branch
npm --prefix roadmap-linear-sync run next -- --owner Engineer --json
```

Observed state:

- Git branch at checkpoint: `main`, clean, tracking `origin/main`.
- Long-session branch created: `codex/engineer-blocker-handoff-20260705`.
- Roadmap helper result: `{"task":null,"reason":"all_actionable_have_blockers","total_actionable":5}`.
- No roadmap task was marked shipped during this revalidation.

## Five Engineer Rows

| Task | Linear | State | Dependency gate |
| --- | --- | --- | --- |
| A7.4 - Price diff engine | QEP-164 | not_started | Depends on A7.1 and blocked A7.3 |
| A7.5 - Open-quote mispricing scan | QEP-169 | not_started | Depends on A7.4 |
| A7.7 - Re-price action with margin-floor gate | QEP-170 | not_started | Depends on A7.6 |
| A7.9 - Re-price audit log + 7-day reversibility | QEP-174 | not_started | Depends on A7.7 |
| B2.5 - VC-5 canonical source enum normalization | QEP-53 | in_progress | Depends on blocked B3.1 |

## A7 Blocker Revalidation

Blocking row:

- `A7.3 / QEP-173` - OEM price-sheet parser
- Current state: `blocked`
- Current blocker: `BLK-OEM-SHEETS`
- Declared dependency: A7.1 plus D3.14

Required external inputs remain absent from tracked source:

- ASV sample price-sheet PDF
- Yanmar sample price-sheet PDF
- Bandit sample sheet or confirmed format
- CMI sample sheet or confirmed format
- Column legends
- Discount, rebate, freight, and list-price conventions
- Effective-date rules

Local evidence reviewed:

- `apps/web/src/lib/pricing/__tests__/fixtures/asv_rt135_gmu.ts` is not a real ASV sheet; it says the list price is a placeholder until real ASV prices are seeded.
- `apps/web/src/lib/pricing/__tests__/fixtures/yanmar_vio55_48mo_0pct.ts` is not a real Yanmar sheet; it says the list price and attachment prices are placeholders until an uploaded Yanmar sheet exists.
- `apps/web/src/lib/pricing/__tests__/fixtures/forestry_bandit_no_programs.ts` is a pricing-regression fixture; it uses a synthetic freight input and does not provide a Bandit sheet format.
- `supabase/migrations/740_c23_pdf_price_book_parser_closeout.sql` closes only the YCENA parser row and explicitly keeps broader OEM rows separate.
- `supabase/migrations/741_c24_ycena_sample_import_closeout.sql` closes only ASV/Yanmar YCENA sample import evidence and explicitly keeps Bobcat, Vermeer, and broader OEM expansion separate.
- Existing A7 server/UI code exists in `supabase/functions/oem-price-feeds/*`, `apps/web/src/features/price-intelligence/*`, and `apps/web/src/features/sales/*`, but A7.4-A7.9 must not be promoted while A7.3 remains blocked.

Decision:

- Do not implement speculative ASV/Yanmar/Bandit/CMI parser behavior.
- Do not mark A7.4, A7.5, A7.6, A7.7, or A7.9 shipped.
- Post a fresh blocker update to QEP-173 with the exact missing inputs and downstream impact.

## B3.1/B2.5 Blocker Revalidation

Blocking row:

- `B3.1 / QEP-54` - OM-1 omi-webhook edge function + admin shell
- Current state: `blocked`
- Current blocker: `OMI-DOCS`

Required external inputs remain absent from tracked source:

- Omi webhook/API documentation
- HMAC/signature validation rules
- Event payload examples
- Event ID and idempotency behavior
- Credential/secrets delivery path for staging
- Omi sandbox/staging endpoint details

Local evidence reviewed:

- `QEP (1)/QEP-OMI-CONSOLIDATED-BUILD-PLAN.md` says OM-1 is blocked for full external integration on Omi docs/secrets.
- The same plan defines B2.5/VC-5 as dependent on OM-1 for active Omi source tagging.
- No `supabase/migrations/*voice_captures_source*.sql`, `supabase/functions/omi-webhook`, or source-controlled Omi webhook payload contract exists in the active tree.

Decision:

- Do not add an active `omi` insert path or any `wearable_glasses` behavior without the real bridge contract.
- Do not mark B2.5 shipped while B3.1 remains blocked.
- Post a fresh blocker update to QEP-54 with the exact missing vendor inputs and downstream B2.5 impact.

## Linear Comment Bodies

### QEP-173

```markdown
2026-07-05 blocker revalidation for A7.3 / BLK-OEM-SHEETS:

I rechecked the long-session Engineer queue and local source evidence. A7.3 remains blocked, so A7.4/A7.5/A7.6/A7.7/A7.9 must not be promoted yet.

Still needed to unblock parser work:
- ASV sample price-sheet PDF
- Yanmar sample price-sheet PDF
- Bandit sample sheet or confirmed format
- CMI sample sheet or confirmed format
- Column legends
- Discount/rebate/freight/list-price conventions
- Effective-date rules

Local evidence is not enough to clear this:
- ASV/Yanmar quote fixtures use placeholders and explicitly say to update once real price sheets are seeded.
- Bandit fixture is a synthetic pricing regression, not a sheet format.
- C2.3/C2.4 closeouts cover YCENA parser/sample import only and do not satisfy this A7 parser row.

Engineering boundary: no speculative parser support will be built or shipped until the sample-sheet packet or confirmed formats are supplied.
```

### QEP-54

```markdown
2026-07-05 blocker revalidation for B3.1 / OMI-DOCS:

I rechecked the long-session Engineer queue and local source evidence. B3.1 remains blocked, so B2.5 / VC-5 canonical source normalization must not be shipped with an active Omi source path yet.

Still needed to unblock OM-1:
- Omi webhook/API documentation
- HMAC/signature validation rules
- Event payload examples
- Event ID/idempotency behavior
- Credential/secrets delivery path for staging
- Omi sandbox/staging endpoint details

Local evidence is not enough to clear this:
- QEP-OMI-CONSOLIDATED-BUILD-PLAN still says OM-1 is blocked for full external integration on Omi docs/secrets.
- No active `supabase/functions/omi-webhook` implementation or source-controlled Omi payload contract exists in the active tree.
- No canonical `voice_captures.source` migration is present in the active tree.

Engineering boundary: no active `omi` insert path or `wearable_glasses` behavior should be shipped until the real bridge contract is supplied and verified.
```

## Manual Tasks Required

SUPABASE DASHBOARD:
- [ ] No environment variable change required for this revalidation.
- [ ] When B3.1 is unblocked, set `OMI_WEBHOOK_SECRET` and any Omi API credential through Supabase function secrets, not git.

EXTERNAL SERVICES:
- [ ] QEP-173 owner supplies ASV, Yanmar, Bandit, and CMI sample-sheet packet or confirmed formats.
- [ ] QEP-54 owner supplies Omi webhook/API docs, payload examples, HMAC rules, idempotency behavior, staging endpoint, and secret delivery path.

VERIFICATION:
- [ ] Re-run `npm --prefix roadmap-linear-sync run next -- --owner Engineer --json` after owner inputs land.
- [ ] Do not run A7.4-A7.9 ship updates until A7.3 is unblocked and shipped.
- [ ] Do not run B2.5 ship update until B3.1 is unblocked and shipped.
