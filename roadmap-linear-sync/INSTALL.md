# Install — Roadmap → Linear Sync

Step-by-step. Do these in order. Should take ~30 minutes the first time.

---

## 0. Prerequisites

- Linear workspace with admin access (you = owner of SCC team)
- Supabase project with `roadmap_tasks` table populated (you have this — 207 rows)
- Supabase CLI installed (`brew install supabase/tap/supabase` or `npm i -g supabase`)
- Node 20+ locally
- Repo this package will live in (your SCC-OS app repo)

---

## 1. Create the Linear team and grab an API key

1. **Linear → Settings → Workspace → Teams → New team**
   - Name: `SCC Compliance`
   - Key: `SCC` (this becomes `LINEAR_TEAM_KEY`)
2. **Linear → Settings → API → Personal API keys → Create key**
   - Label: `SCC-OS roadmap sync`
   - Copy the `lin_api_...` value. You'll only see it once.
3. **Add a "Blocked" workflow state** (Linear's API can't create states):
   - Settings → Teams → `SCC Compliance` → Workflow → **+ Add state**
   - Name: `Blocked`
   - Type: `Unstarted` (this is required so it doesn't count as in-progress)
   - Color: red

---

## 2. Drop this package into your repo

Copy the contents of `roadmap-linear-sync/` into your app repo root, merging:

- `supabase/migrations/...` → your existing migrations folder
- `supabase/functions/sync-roadmap-linear/` → your existing functions folder
- `scripts/...` → your scripts folder (or create one)
- `.github/workflows/...` → your workflows folder
- `.github/PULL_REQUEST_TEMPLATE.md` → replace or merge with existing template

Then in repo root:

```bash
npm pkg set scripts.bootstrap="node scripts/linear-bootstrap.mjs"
npm pkg set scripts.import="node scripts/linear-import-roadmap.mjs"
npm pkg set scripts.sync="node scripts/linear-sync-roadmap.mjs"
```

…or copy the included `package.json` if you don't already have one.

---

## 3. Set local env

```bash
cp .env.example .env
```

Edit `.env`:

```
LINEAR_API_KEY=lin_api_<paste here>
LINEAR_TEAM_KEY=SCC
SUPABASE_URL=https://zymenlnwyzpnohljwifx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Supabase Dashboard -> Project Settings -> API -> service_role>
```

Confirm:
```bash
node -e "console.log(process.env.LINEAR_TEAM_KEY)"
```
…should print `SCC`.

---

## 4. Apply the migration

```bash
supabase db push
```

Or if you don't use `supabase db push`:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260519000000_add_linear_sync_to_roadmap_tasks.sql
```

Verify:

```sql
\d roadmap_tasks
-- should now show linear_issue_id, linear_synced_at, linear_sync_status, etc.

SELECT * FROM v_roadmap_tasks_pending_linear_sync LIMIT 5;
-- view exists
```

---

## 5. Bootstrap Linear (idempotent)

```bash
# Dry run first to see what would happen:
npm run bootstrap:dry

# Then for real:
npm run bootstrap
```

You should now see 5 projects in Linear: `Phase 1 — Foundation` through `Phase 5 — Enterprise Scale`, and labels `blocked` and `mirrored-from-supabase`.

---

## 6. Test import on a single task

```bash
# Try just 1 task first to verify everything wires up
npm run import -- --limit 1
```

Open Linear → check the new issue appears in the right project, has the `task_id: X.xx` block in its description, and is labeled correctly. Then verify Supabase:

```sql
SELECT task_id, linear_issue_id, linear_issue_identifier, linear_url, linear_synced_at
FROM roadmap_tasks
WHERE linear_issue_id IS NOT NULL;
```

If that looks right, run the full import:

```bash
npm run import
```

This creates ~207 Linear issues. If anything errors, the row's `linear_sync_status` flips to `error` with the message in `linear_sync_error`.

---

## 7. Deploy the Edge Function

```bash
# Link the local repo to your Supabase project if not already
supabase link --project-ref zymenlnwyzpnohljwifx

# Deploy
supabase functions deploy sync-roadmap-linear --no-verify-jwt

# Set the function's secrets
supabase secrets set LINEAR_API_KEY=lin_api_...
supabase secrets set LINEAR_TEAM_KEY=SCC
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected
```

Test it directly:

```bash
curl -X POST \
  https://zymenlnwyzpnohljwifx.functions.supabase.co/sync-roadmap-linear \
  -H "Content-Type: application/json" \
  -d '{"type":"UPDATE","table":"roadmap_tasks","schema":"public","record":null,"old_record":null}'
# Should return 200 "Ignored: delete or empty record"
```

---

## 8. Create the Database Webhook

Dashboard route: **Supabase Dashboard → Database → Webhooks → Create a new webhook**

Settings:
- **Name:** `roadmap-tasks-to-linear`
- **Table:** `public.roadmap_tasks`
- **Events:** `Insert`, `Update`  (NOT delete)
- **HTTP method:** `POST`
- **URL:** `https://zymenlnwyzpnohljwifx.functions.supabase.co/sync-roadmap-linear`
- **HTTP headers:**
  ```
  Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
  Content-Type: application/json
  ```
- **HTTP params:** (none)
- **Timeout:** 5000 ms

Save. Then verify: open the in-app Roadmap UI, change one task's status, watch:
1. Edge Function logs in Supabase Dashboard
2. The Linear issue updates within ~2 seconds

---

## 9. Add GitHub secrets

In your repo: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|---|---|
| `LINEAR_API_KEY` | `lin_api_...` |
| `SUPABASE_URL` | `https://zymenlnwyzpnohljwifx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` |

And a repository **variable** (not secret) if you want a non-default team key:

| Name | Value |
|---|---|
| `LINEAR_TEAM_KEY` | `SCC` |

---

## 10. Verify GitHub Actions

In your repo: **Actions → Roadmap → Linear sync → Run workflow → dry_run: true**

You should see logs:
```
[sync] N task(s) need sync ...
[sync] Done. updated=0 created_missing=0 errors=0
```

Then run for real (`dry_run: false`).

---

## 11. PR template

The included `PULL_REQUEST_TEMPLATE.md` will be picked up automatically by GitHub. Verify by opening a new PR — the body should contain the `Roadmap: ` line.

Test the PR → comment flow:
1. Create a throwaway PR with `Roadmap: <some-real-task-id>` in the body
2. Merge it
3. Watch the `PR landed → Linear comment` workflow run in Actions
4. Confirm the Linear issue got the comment

---

## 12. Optional — Tom and contractor access

1. **Linear → Settings → Members → Invite**
2. Add Tom and contractors with appropriate role (Member for Tom; Guest with limited team access for contractors)
3. They can now see everything in Linear; only you (or whoever has Supabase write) flips status.

---

## Troubleshooting

**"No team with key SCC"** — bootstrap or import fails immediately. Fix: confirm Linear team key matches `LINEAR_TEAM_KEY`. Case-sensitive.

**Issues created but no project assigned** — the bootstrap script didn't run, or projects were renamed. Re-run `npm run bootstrap`.

**Status not propagating** — check Supabase webhook in Dashboard → Database → Webhooks. Click the webhook to view recent invocations. If they're failing 401, the Authorization header is missing or wrong.

**Linear comments not appearing on PR merge** — the workflow runs but logs `No "Roadmap: X.xx" found in PR`. The author forgot the line. Or the task ID doesn't match any row's `task_id`.

**A task is stuck in error state** — read `linear_sync_error` for the exact message. After fixing, reset:
```sql
UPDATE roadmap_tasks
SET linear_sync_status = 'pending', linear_sync_attempt_count = 0, linear_sync_error = NULL
WHERE task_id = '<x.yy>';
```

---

## Rollback

If you need to back out:
1. Pause the Database Webhook in Supabase Dashboard
2. Disable both GitHub Actions workflows
3. Apply the down-migration at the bottom of `20260519000000_add_linear_sync_to_roadmap_tasks.sql`
4. (Optional) Archive the Linear team or projects

Issues in Linear stay where they are; deleting them from Linear has no effect on `roadmap_tasks` once columns are dropped.
