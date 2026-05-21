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

## Wired staging secrets

As of A1.3 / QEP-3, the `e2e-staging` GitHub Actions job is wired to these
repo secrets and only runs the authenticated staging suite when all three are
present:

- `PLAYWRIGHT_TEST_EMAIL`
- `PLAYWRIGHT_TEST_PASSWORD`
- `PLAYWRIGHT_AGED_EQUIPMENT_ID`

Current staging target and fixture:

- Base URL: `https://qualityequipmentparts.netlify.app`
- Test user: `playwright-e2e@qepusa.com` (`admin` fixture role so quote-save and approval paths are not blocked by rep-only RLS during CI)
- Aged stocked CRM unit: `b014e000-0000-4000-8000-000000000082`

Fork PRs or same-repo runs missing any one of the three secrets intentionally
run only the guest route smoke, so CI does not report a false green with the
approval-bypass spec skipped.

Current deployed-suite blocker: the authenticated happy-path spec now signs in,
loads catalog data, walks to Review, and reaches Document, but
`Generate Preview PDF` remains disabled on `qualityequipmentparts.netlify.app`.
That is a real downstream quote/document readiness blocker, not missing CI env.

## Skipped specs (if secrets are absent)

| Spec | Skip reason | Follow-up |
|------|-------------|-----------|
| `quote-wizard-happy-path.spec.ts` → authenticated prospect flow | `PLAYWRIGHT_TEST_EMAIL` / `PLAYWRIGHT_TEST_PASSWORD` unset | Repo secrets are wired; export locally before `bun run test:e2e` if running outside CI |
| `quote-wizard-back-forward-nav.spec.ts` | Same auth env vars | Same as above |
| `quote-approval-bypass.spec.ts` | Auth vars and/or `PLAYWRIGHT_AGED_EQUIPMENT_ID` unset | Repo secret is wired to the A1.3 staging fixture; export locally before `bun run test:e2e` if running outside CI |

## CI behavior

Fork PRs without secrets run only the guest happy-path test. Same-repo PRs
with all three secrets run the full staging suite via `bun run test:e2e:staging`.
