# QEP Web (`@qep/web`)

Operator-facing QEP OS shell (Vite + React).

## Development

```bash
bun install
bun run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the repo root `.env` or `apps/web/.env.local` (see `.env.example`).

## E2E (Playwright)

Install the browser once:

```bash
bun run test:e2e:install
```

Run the suite (starts `bun run dev` on `http://127.0.0.1:5173` unless overridden):

```bash
bun run test:e2e
```

Interactive UI:

```bash
bun run test:e2e:ui
```

### Environment

| Variable | Purpose |
|----------|---------|
| `PLAYWRIGHT_BASE_URL` | App URL (default `http://127.0.0.1:5173`) |
| `PLAYWRIGHT_SKIP_WEBSERVER` | Set `1` when targeting a deployed build |
| `PLAYWRIGHT_TEST_EMAIL` / `PLAYWRIGHT_TEST_PASSWORD` | Rep/admin user for authenticated wizard specs |
| `PLAYWRIGHT_AGED_EQUIPMENT_ID` | CRM equipment UUID for approval-bypass spec |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Loaded from `.env` for the dev server; Playwright falls back to test placeholders if unset |

Staging CI uses `bun run test:e2e:staging` against `https://qualityequipmentparts.netlify.app` with repo secrets.

Skipped specs and follow-ups: `tests/e2e/TODO_PLAYWRIGHT.md`.

## Tests (unit)

```bash
bun test src/features/quote-builder
```
