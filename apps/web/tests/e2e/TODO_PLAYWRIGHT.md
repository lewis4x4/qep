# Playwright e2e — follow-ups

## Auth strategy

`/quote-v2` requires Supabase login and `profile.role` in `rep | admin | manager | owner` (`App.tsx`). No `VITE_E2E_TEST_AUTH` bypass exists yet.

| Variable | Purpose |
|----------|---------|
| `PLAYWRIGHT_TEST_EMAIL` | Staging/local rep test user |
| `PLAYWRIGHT_TEST_PASSWORD` | Password for that user |
| `PLAYWRIGHT_AGED_EQUIPMENT_ID` | CRM equipment UUID (365+ day `received_at`, in stock, margin ≥ 8%) |
| `PLAYWRIGHT_BASE_URL` | Override app URL (default `http://127.0.0.1:5173`) |
| `PLAYWRIGHT_SKIP_WEBSERVER` | Set `1` for deployed targets |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Real project keys in `.env` for authenticated flows |

Guest smoke **passes without credentials**: `quote-wizard-happy-path.spec.ts` → `unauthenticated visit is gated behind login`.

## Skipped specs (flip to PASS)

| Spec | Skip reason | Follow-up |
|------|-------------|-----------|
| `quote-wizard-happy-path.spec.ts` → authenticated prospect flow | `PLAYWRIGHT_TEST_EMAIL` / `PLAYWRIGHT_TEST_PASSWORD` unset | Add GitHub Actions secrets (same as `e2e-staging.yml`) or export locally before `bun run test:e2e` |
| `quote-wizard-back-forward-nav.spec.ts` | Same auth env vars | Same as above |
| `quote-approval-bypass.spec.ts` | Auth vars and/or `PLAYWRIGHT_AGED_EQUIPMENT_ID` unset | Seed or pick a CRM unit with `received_at` ≥ 365 days, in stock, margin ≥ 8%; set UUID in env |

## CI behavior

Fork PRs without secrets run only the guest happy-path test. Same-repo PRs with secrets run the full staging suite via `bun run test:e2e:staging`.
