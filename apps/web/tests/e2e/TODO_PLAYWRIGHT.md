# Playwright e2e — follow-ups

## Auth strategy

`/quote-v2` is gated behind Supabase login and `profile.role` in `rep | admin | manager | owner` (`App.tsx`). There is no `VITE_E2E_TEST_AUTH` bypass yet.

| Variable | Purpose |
|----------|---------|
| `PLAYWRIGHT_TEST_EMAIL` | Staging/local rep test user |
| `PLAYWRIGHT_TEST_PASSWORD` | Password for that user |
| `PLAYWRIGHT_AGED_EQUIPMENT_ID` | CRM equipment UUID (365+ day `received_at`, in stock) for approval-bypass spec |
| `PLAYWRIGHT_BASE_URL` | Override app URL (default `http://127.0.0.1:5173`; CI staging uses `https://qep.blackrockai.co`) |
| `PLAYWRIGHT_SKIP_WEBSERVER` | Set `1` when targeting a deployed build |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Injected into the Playwright `webServer` from repo `.env` when present |

Guest smoke (`unauthenticated visit is gated behind login`) runs without credentials.

## Skipped specs

_(Updated each slice — see git history.)_
