# Service job ↔ portal fulfillment run — demo seed

Use this when pods / environments have **no CRM or service data** but you need to validate:

**Service Command Center → open job drawer → search portal parts orders → link shop job to fulfillment run**

## 1. Apply migrations

Remote or local DB must include fulfillment tables (`115+`). Run `supabase db push` (or your pipeline) first.

## 2. Seed minimal rows (service role)

From repo root, with URL + **service role** key (Dashboard → Settings → API):

```bash
export SUPABASE_URL="https://<project>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service_role_secret>"
export QEP_DEMO_WORKSPACE_ID="default"   # optional; must match staff JWT workspace
bun ./scripts/demo/service-fulfillment-link-seed.mjs seed
```

The script prints **fixed UUIDs** and a searchable **portal customer email** (`fulfillment-link-seed@<workspace>.qep.local`).

To remove demo rows:

```bash
bun ./scripts/demo/service-fulfillment-link-seed.mjs reset
```

## 3. Validate in the app

1. Log in as **rep / admin / manager / owner** whose `get_my_workspace()` matches `QEP_DEMO_WORKSPACE_ID` (usually `default`).
2. Open **Service** and find job ID `d4000000-0000-4000-8000-000000000001` (or open from list if shown).
3. In **Customer tracking**, use **Find portal order** and search by the printed email or order UUID `c3000000-0000-4000-8000-000000000001`.
4. Click **Link shop job to this run** — should succeed; `service-job-router` checks the run exists and `workspace_id` matches.
5. **Unlink** should clear `fulfillment_run_id` and append run events per router logic.

## 4. Full CRM demo (optional)

For richer data (deals, contacts, etc.), use `bun run demo:seed` — it does **not** currently include this fulfillment link bundle; use the script above for the specific UX path.
