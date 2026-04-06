# Knowledge base — production validation

This complements `knowledge-base-manual-test-checklist.md`. **Production checks require a human** signed into the deployed app (Netlify / `qep.blackrockai.co` or current URL) with real roles and documents.

## Edge function reachability (automated)

After deploy, from a shell with **no keys in the repo** (use Netlify env or a local `.env` you do not commit):

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SUPABASE_ANON_KEY="<anon-jwt>"
# Optional if your CORS allowlist differs:
# export SMOKE_ORIGIN="https://qep.blackrockai.co"
bun run smoke:edge
```

Expect `OK (200)` for **chat**, **ingest**, and **document-admin**. A **404** means the function name or project URL is wrong.

## Preconditions

- Remote DB migrations through **042** applied; Edge Functions **chat**, **ingest**, **document-admin** deployed.
- At least one **`company_wide` / `published`** handbook (or similar) with text that answers a test question.

## Run the checklist

1. Open `docs/knowledge-base-manual-test-checklist.md`.
2. Execute each section (1–5) in production.
3. Record **Pass / Fail**, **date**, **tester**, and **trace IDs** for any chat errors.

## What automation cannot replace

- Grounded answers and **Document** vs **QRM** citations need live LLM + embeddings + your corpus.
- **Finance vs rep** leakage tests need documents and users with the right roles.
- **Manager upload → pending_review → publish** needs manager + admin accounts.

## Repo verification (CI / local)

After code changes:

```bash
bun run build
```

Optional release gate:

```bash
bun run segment:gates --segment knowledge-base-module-1 --ui
```

## Types vs remote schema

Regenerate client types from Supabase (stderr suppressed so CLI upgrade text is not appended to the file):

```bash
bun run supabase:types:remote
```

Voice capture JSON shapes live in `apps/web/src/lib/voice-capture-extraction.types.ts` (not emitted by `gen types`).
