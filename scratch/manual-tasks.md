# Manual tasks

- 2026-05-20T00:00:00-04:00 — task_id: A1.1 — service/system: staging QA / Iron Quote — manual action required: Rylee + architect manual staging QA pass covering FL 6% state tax, county surtax $5K cap, tax-exempt badge, all four manager approval outcomes, and TILA disclaimer surfaces. — why automation cannot do it: roadmap assigns this to human QA/sign-off, not Engineer implementation. — value/URL/command: Linear QEP-1 https://linear.app/jarvislewis/issue/QEP-1/a11-manual-staging-qa-pass — blocks task completion: yes for A1.1; does not block Engineer-buildable A1.5.
- 2026-05-20T11:20:00-04:00 — task_id: A3.8 — service/system: Supabase project iciddijgonywtxoelous / quote-builder-v2 immutable PDF R2 path — manual action required: provision edge runtime secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_QUOTE_PDFS` and confirm Cloudflare R2 bucket CORS permits browser `PUT` with `Content-Type: application/pdf` from staging/prod app origins. — why automation cannot do it: CLI only exposes secret names+digests; missing R2 secrets and external R2 CORS policy require credentialed operator access outside repo automation. — value/URL/command: verify with `supabase secrets list --project-ref iciddijgonywtxoelous` and R2 dashboard CORS rules — blocks task completion: yes (customer send cannot create immutable R2 versions until configured).
## 2026-05-20 — A3.10/QEP-23 release blocked (A3.10-4)
- `supabase db push` failed: remote migration history contains version `20260520154601` not present locally; run `supabase migration repair --status reverted 20260520154601` and reconcile via `supabase db pull`/migration sync before re-attempting migration 600 rollout.
- A3.10 runtime prerequisite unresolved for customer-send immutable PDF path: project secrets list does not include required R2 keys (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_QUOTE_PDFS`) used by `quote-builder-v2`; configure before marking shipped.
- Verify `APP_URL` resolves to a public HTTPS origin (not localhost/private/internal) for QR landing validation in production send flow.

## 2026-05-20 — Quote discovery reconciliation blockers
Source: `QEP (1)/QEP-Quote-Discovery-Decisions-and-Gaps-Review.docx`.

Critical before locking conversion/state-machine work:
- C1: Define the trade-in value lock event for above-floor deals. Recommended options in review: customer acceptance or explicit rep "lock trade" action before send.
- C2: Rule that pre-acceptance quotes remain editable, but converted quotes become system-locked and changes go through order modification; otherwise QEP OS can desync from IntelliDealer and inventory holds.
- C3: Pick e-signature trigger. Review recommends e-sign when either deposit is required or the deal is financed.
- C4: Define cash-stock conversion and modification-lock events. Review recommends full payment received for conversion and payment or delivery for lock.
- R1: Ratify whether sales reps may see landed cost and dealer rebate amounts; update role-access matrix/RLS to match.

Parallel QEP-owned inputs:
- G1: Confirm soft-hold TTL; review recommends 14 days.
- G4: Provide final quote-PDF template/logo/brand colors if the current repo assets are not acceptable.
- G7: Set HubSpot hard-cutover date and confirm API key ownership.
- G8: Confirm whether government/municipal sales are in scope.
- G10: Confirm used-equipment margin target/floor (22%/15%) and Develon new-equipment 7% floor exception.
- R3: Define how over-allowed trades are booked into used inventory.
