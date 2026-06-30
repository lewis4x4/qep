# V2 Setup — Bidirectional Sync + Operational Tooling

You already have v1 working (Supabase → Linear). This guide adds the reverse path (Linear → Supabase) plus the ops tools.

Total time: ~20 minutes.

---

## What v2 gives you

1. **Drag-in-Linear works.** Move a card right in Linear → status flips in `roadmap_tasks` → `/roadmap` UI shows it.
2. **`npm run task <id>`** — view, start, complete, block, note, history.
3. **`npm run reconcile`** — detect drift between Supabase and Linear; `--fix` repairs.
4. **`npm run events`** — query the audit log of every sync action.
5. **`npm run regen:roadmap`** — refresh the snapshot block in `UNIFIED_ROADMAP.md` from live data.
6. **`npm run graph`** — Mermaid dependency graph for planning.
7. **`npm run alert`** — Slack alert if sync gets unhealthy (errors, stale pending).
8. **GitHub Actions** — PR Roadmap check, weekly snapshot regen, nightly reconcile, every-30-min health alert.
9. **Audit log** — `roadmap_sync_events` table records every action with diff, direction, actor.

---

## Step 1 — Apply migration v2 (1 min)

Drop `supabase/migrations/20260519010000_bidirectional_sync_v2.sql` into your repo and apply:

```bash
supabase db push
```

Or paste it into the Supabase SQL editor and Run.

Verify:

```sql
SELECT * FROM v_roadmap_sync_health;
-- Should return one row with synced/pending/error counts.

SELECT routine_name FROM information_schema.routines
WHERE routine_name = 'sync_status_from_linear';
-- Should return one row.

SELECT COUNT(*) FROM roadmap_sync_events;
-- Returns 0 (or whatever events the forward sync wrote since it was added).
```

---

## Step 2 — Discover your Linear user ID (30 sec)

The reverse Edge Function needs to know which Linear user owns your API key, so it can ignore webhooks fired by its own writes (anti-ping-pong).

```bash
dotenv -e .env -- npm run whoami
```

Output:
```
Linear identity for this API key:
  ID:          a1b2c3d4-...
  Name:        Brian Lewis
  ...

Add this to your Supabase function secrets:
  supabase secrets set LINEAR_SYNC_USER_ID=a1b2c3d4-...
```

Copy the ID. You'll use it in Step 4.

---

## Step 3 — Create the Linear webhook (3 min)

**Linear → Settings → API → Webhooks → New webhook**

- **URL:** `https://zymenlnwyzpnohljwifx.functions.supabase.co/sync-linear-to-roadmap`
- **Resource types:** check `Issue` only (Comment / Reaction / etc. are not needed)
- **Teams:** select `SCC Compliance` only (not "All teams" — saves noise)
- **Signing secret:** click **Generate**. **Copy the secret** (looks like `lwsec_...`). You'll paste in Step 4.

Save. Linear will start sending events but they'll be rejected (signature failure) until Step 4.

---

## Step 4 — Deploy the reverse Edge Function (2 min)

```bash
supabase functions deploy sync-linear-to-roadmap --no-verify-jwt

supabase secrets set LINEAR_WEBHOOK_SECRET=lwsec_<from Step 3>
supabase secrets set LINEAR_SYNC_USER_ID=<from Step 2>
# (LINEAR_API_KEY and SUPABASE_URL / SERVICE_ROLE_KEY are already set from v1)
```

Test the function is alive:

```bash
curl https://zymenlnwyzpnohljwifx.functions.supabase.co/sync-linear-to-roadmap
# {"ok":true,"fn":"sync-linear-to-roadmap"}
```

---

## Step 5 — Smoke test (2 min)

1. Open the SCC Roadmap view in Linear.
2. Pick any task that's in `Backlog`. Drag it to `In Progress`.
3. Wait ~3 seconds.
4. Open the SCC-OS `/roadmap` UI. The same task should now show `in_progress`.
5. Check the audit log:
   ```bash
   dotenv -e .env -- npm run events -- --limit 5
   ```
   You should see a `←Lin  update` event for that task.

If it didn't propagate:
- Check Edge Function logs: Supabase Dashboard → Functions → `sync-linear-to-roadmap` → Logs
- Common causes:
  - 401 Invalid signature → wrong `LINEAR_WEBHOOK_SECRET`
  - "Ignored: sync user actor" → you ran a forward sync and Linear is echoing that event; not a bug
  - "Ignored: no task_id marker" → the Linear issue didn't come from the import (manually created? skip)

---

## Step 6 — Add GitHub secrets for the new Actions (2 min)

In your repo: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Purpose | Required? |
|---|---|---|
| `LINEAR_API_KEY` | Already added in v1 | Yes |
| `SUPABASE_URL` | Already added | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Already added | Yes |
| `SLACK_WEBHOOK_URL` | For `sync-health-alert.yml` | Optional |

Repository variables (Settings → Secrets and variables → Actions → Variables tab):

| Name | Default | Purpose |
|---|---|---|
| `LINEAR_TEAM_KEY` | `SCC` | Linear team key |
| `PR_ROADMAP_ENFORCEMENT` | `enforce` | Set to `warn` to allow PRs without `Roadmap:` line |
| `ALERT_ERROR_THRESHOLD` | `3` | Slack alert trigger |
| `ALERT_STALE_PENDING_THRESHOLD` | `5` | Slack alert trigger |

---

## Step 7 — Verify the Actions run (5 min)

In your repo: **Actions** tab.

**Run each manually once:**
- `Roadmap → Linear sync` → Run workflow → dry_run: true
- `Nightly — reconcile Supabase ↔ Linear` → Run workflow
- `Weekly — regenerate UNIFIED_ROADMAP.md snapshot` → Run workflow
- `Sync health check` → Run workflow

Each should complete in <2 minutes. Check the logs.

---

## You're done

From now on:

- **Edit anywhere.** Drag in Linear OR change in `/roadmap` UI. Both propagate within seconds.
- **`npm run next`** to grab the next task.
- **`npm run task 3.49`** for any single-task action.
- **`npm run events`** when something feels off.
- **`npm run reconcile`** if you ever suspect drift.

Sync events are logged forever. Drift gets auto-flagged. PRs require a `Roadmap:` line. The unified doc regenerates weekly.
