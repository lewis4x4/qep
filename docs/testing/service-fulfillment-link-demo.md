# Service job ↔ portal tracking — demo seed

Use this when pods / environments have **no CRM or service data** but you need to validate the full staff drawer flow:

**Service Command Center → job drawer → Customer access + Portal request link + Parts fulfillment link**

## 1. Apply migrations

Remote or local DB must include:

- Fulfillment tables (`115+`)
- Staff search RPC `search_parts_orders_for_link` (`120_search_parts_orders_for_link.sql`)

Run `supabase db push` (or your pipeline) first.

## 2. Seed minimal rows (service role)

From repo root, with URL + **service role** key (Dashboard → Settings → API):

```bash
export SUPABASE_URL="https://<project>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service_role_secret>"
export QEP_DEMO_WORKSPACE_ID="default"   # optional; must match staff JWT workspace
bun ./scripts/demo/service-fulfillment-link-seed.mjs seed
```

The script prints **fixed UUIDs**, seeds:

- Portal customer + **CRM company + equipment** (so **Customer & machine** on the job are not empty)
- **Portal service request** bridged to the job (`portal_request_id` + `service_requests.service_job_id`)
- Portal parts order + fulfillment run (still **unlinked** from the job until you link in the UI)

Searchable **portal customer email**: `fulfillment-link-seed@<workspace>.qep.local`

To remove demo rows:

```bash
bun ./scripts/demo/service-fulfillment-link-seed.mjs reset
```

## 3. Validate in the app

1. Log in as **rep / admin / manager / owner** whose `get_my_workspace()` matches `QEP_DEMO_WORKSPACE_ID` (usually `default`).
2. Open **Service** and find job ID `d4000000-0000-4000-8000-000000000001` (or open from list if shown).
3. **Customer access** — confirm customer preview text, **Copy track link**, and open `/service/track?...` shows **public status** (headline + detail), not raw internal enum strings.
4. **Portal request link** — confirm the linked portal request summary appears (status, type, portal customer). Use **Unlink portal request** / re-link with UUID `e7000000-0000-4000-8000-000000000001` if needed.
5. **Parts fulfillment link** — under **Find portal order**, search by the printed email or order UUID `c3000000-0000-4000-8000-000000000001` (search runs via `service-job-router` + RPC, not client-side “last 200 rows”).
6. Click **Link shop job to this run** — should succeed; `service-job-router` checks the run exists and `workspace_id` matches.
7. **Unlink** (fulfillment) should clear `fulfillment_run_id` and append run events per router logic.

## 4. Full CRM demo (optional)

For richer data (deals, contacts, etc.), use `bun run demo:seed` — it does **not** currently include this fulfillment-link bundle; use the script above for the specific UX path.
