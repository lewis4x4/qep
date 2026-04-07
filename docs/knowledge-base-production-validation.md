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

## Automated regression checks

These are required release gates. Missing credentials or skipped execution is a failure for KB-affecting changes.

With live Supabase credentials:

```bash
KB_EVAL_REQUIRED=true bun run kb:eval
bun run kb:eval:report
```

With live role tokens:

```bash
SUPABASE_URL=... \
SUPABASE_ANON_KEY=... \
KB_TEST_ADMIN_TOKEN=... \
KB_TEST_REP_TOKEN=... \
KB_INTEGRATION_REQUIRED=true \
bun run test:kb-integration
```

Required workspace-isolation guard when retrieval, auth, RLS, or workspace scoping changes:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
KB_ISOLATION_CASES='[{"workspace_id":"default","query":"What are our core values?","forbidden_title_contains":["Finance"]}]' \
KB_ISOLATION_REQUIRED=true \
bun run kb:workspace-isolation
```

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

`segment:gates` now treats KB eval, KB integration, and KB workspace isolation as hard failures when the live inputs are missing.

## Types vs remote schema

Regenerate client types from Supabase (stderr suppressed so CLI upgrade text is not appended to the file):

```bash
bun run supabase:types:remote
```

Voice capture JSON shapes live in `apps/web/src/lib/voice-capture-extraction.types.ts` (not emitted by `gen types`).
