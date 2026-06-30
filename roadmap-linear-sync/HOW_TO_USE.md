# How to use this — fastest path to "Roadmap in Linear"

Read this front-to-back. Don't skip steps. Total time: ~30 minutes.

The goal: every task in `roadmap_tasks` shows up as a Linear issue in roadmap order, draggable on a kanban, with a `npm run next` command that hands you the next thing to do.

---

## What you end up with

A Linear custom view called **"SCC Roadmap"** that looks like this:

```
┌─────────────┬──────────────┬─────────────┬─────────────┐
│   Backlog   │ In Progress  │   Blocked   │    Done     │
├─────────────┼──────────────┼─────────────┼─────────────┤
│ SCC-1  1.01 │ SCC-23 2.04  │ SCC-89 3.41 │ SCC-2  1.02 │
│ SCC-3  1.03 │ SCC-45 3.12  │             │ SCC-7  1.07 │
│ SCC-4  1.04 │              │             │ ...         │
│ SCC-5  1.05 │              │             │             │
│ ...         │              │             │             │
│ SCC-207     │              │             │             │
└─────────────┴──────────────┴─────────────┴─────────────┘
        ↑
   roadmap order
   (top = next up)
```

- **Top of Backlog = next task to start**
- **Drag a card right → status updates** (when bidirectional sync is added — see step 11)
- **`npm run next`** prints the next ready task (skips blocked + unmet dependencies)
- **`npm run next -- --start`** flips it to `in_progress`

---

## Step 1 — Make the Linear team (3 min)

1. Open <https://linear.app>.
2. **Settings → Workspace → Teams → New team.**
3. Name: `SCC Compliance`. Identifier: `SCC` (this becomes your `LINEAR_TEAM_KEY`).
4. **Save.**

Now stay in Settings:

5. **API → Personal API keys → Create key.**
6. Label: `SCC-OS roadmap sync`. Copy the `lin_api_...` value — you'll only see it once. Stash it in a password manager.

Then:

7. **Teams → SCC Compliance → Workflow → + Add state.**
8. Name: `Blocked`. Type: `Unstarted`. Color: red. Save.
   (Linear's API can't create workflow states, so you have to do this manually. The sync code will use it once it exists.)

---

## Step 2 — Drop this package into your repo (3 min)

From wherever you grabbed it, copy these into your SCC-OS app repo:

```
supabase/migrations/20260519000000_add_linear_sync_to_roadmap_tasks.sql
supabase/functions/sync-roadmap-linear/
scripts/lib/
scripts/linear-bootstrap.mjs
scripts/linear-import-roadmap.mjs
scripts/linear-sync-roadmap.mjs
scripts/linear-next-up.mjs
scripts/linear-comment-on-merge.mjs
.github/workflows/roadmap-sync.yml
.github/workflows/pr-roadmap-comment.yml
.github/PULL_REQUEST_TEMPLATE.md
```

Merge into existing folders where they exist.

If your repo doesn't already have npm scripts, copy `package.json` keys (or run):
```bash
npm pkg set scripts.bootstrap="node scripts/linear-bootstrap.mjs"
npm pkg set scripts.import="node scripts/linear-import-roadmap.mjs"
npm pkg set scripts.sync="node scripts/linear-sync-roadmap.mjs"
npm pkg set scripts.next="node scripts/linear-next-up.mjs"
```

---

## Step 3 — Set 3 env vars locally (2 min)

Create `.env` in the repo root (don't commit it):

```
LINEAR_API_KEY=lin_api_<paste here>
LINEAR_TEAM_KEY=SCC
SUPABASE_URL=https://zymenlnwyzpnohljwifx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Supabase Dashboard → Settings → API → service_role secret>
```

Test:
```bash
node -e "console.log(process.env.LINEAR_TEAM_KEY ?? 'MISSING')"
```
Should print `SCC`. If it prints `MISSING`, you need to `source .env` first or use a tool like `dotenv-cli`.

If you don't have dotenv-cli:
```bash
npm install -g dotenv-cli
# then prefix every npm run with: dotenv -e .env --
```

---

## Step 4 — Apply the migration (1 min)

Easiest: open Supabase Dashboard → SQL Editor → paste the contents of `supabase/migrations/20260519000000_add_linear_sync_to_roadmap_tasks.sql` → Run.

Or via CLI:
```bash
supabase db push
```

Verify:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'roadmap_tasks' AND column_name LIKE 'linear%';
```
Should return 7 rows.

---

## Step 5 — Create Linear projects + labels (30 sec)

```bash
dotenv -e .env -- npm run bootstrap
```

Output should end with `Bootstrap complete.` and you should now see 5 projects in Linear: `Phase 1 — Foundation` through `Phase 5 — Enterprise Scale`.

---

## Step 6 — Test the import on 1 task (1 min)

```bash
dotenv -e .env -- npm run import:limit10 -- --limit 1
```

Open Linear → look at the team backlog → you should see one new issue with a title like `1.01 — <something>` and a `task_id: 1.01` block at the bottom of its description.

Then check Supabase:
```sql
SELECT task_id, linear_issue_identifier, linear_url
FROM roadmap_tasks
WHERE linear_issue_id IS NOT NULL;
```
Should show 1 row with a populated Linear URL.

---

## Step 7 — Full import (3 min for 207 tasks)

```bash
dotenv -e .env -- npm run import
```

You'll see `Created N so far...` every 10 issues. Final line should read `Done. created=206 adopted=1 skipped=0 errors=0` (it adopted the one from Step 6).

If any errored, check `linear_sync_error` in Supabase:
```sql
SELECT task_id, linear_sync_error
FROM roadmap_tasks
WHERE linear_sync_status = 'error';
```
Most errors are missing labels or missing the Blocked workflow state — fix and re-run, the import is idempotent.

---

## Step 8 — Build the "SCC Roadmap" view in Linear (2 min)

This is the killer view. Do this exactly:

1. In Linear, top-left **+ → New view → Custom view**.
2. Name: `SCC Roadmap`.
3. **Filter** (add these one at a time):
   - **Team:** is `SCC Compliance`
   - **Label:** is `mirrored-from-supabase`
   - (Leave Status unfiltered — you want all statuses visible)
4. **Group by:** `Status`.
5. **Sort by:** `Identifier`. Direction: `Ascending`.
   (Because you imported in `task_id` order, Linear's `SCC-1` = task 1.01, `SCC-2` = task 1.02, etc. So identifier-ascending = roadmap order.)
6. **Display:** Board view.
7. **Pin this view** to your sidebar (click the pin icon top-right).

Save. You should now see all 207 issues laid out as a kanban with the roadmap in order top-to-bottom within each status column.

Optional: make this the team's default view by clicking **... → Set as team default**.

---

## Step 9 — Use the "next up" command (1 min)

In the terminal:
```bash
dotenv -e .env -- npm run next
```

Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEXT UP: 3.49 — ECHO sync pipeline built
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase:    3
Section:  3A
Owner:    software
Lane:     a-field

Description:
  Pull EPA ECHO compliance data and reconcile against roadmap...

Linear:   https://linear.app/scc-compliance/issue/SCC-49/3-49-echo-sync-pipeline-built

12 of 47 pending task(s) are ready to start.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

This **skips blocked tasks and tasks with unmet dependencies** — only shows things you can actually start.

To start it (flips Supabase status → propagates to Linear):
```bash
dotenv -e .env -- npm run next -- --start
```

To also assign to a Linear user:
```bash
dotenv -e .env -- npm run next -- --start --assign you@scc.com
```

Filter to a specific owner/lane/phase:
```bash
dotenv -e .env -- npm run next -- --owner software
dotenv -e .env -- npm run next -- --phase 3
dotenv -e .env -- npm run next -- --lane a-field --owner software
```

Get it as JSON (for agents/scripts):
```bash
dotenv -e .env -- npm run next -- --json
```

---

## Step 10 — Wire up automatic sync (optional but recommended, 10 min)

You now have a working manual loop: edit in `/roadmap`, run `npm run sync` to push to Linear. To make it automatic, do these two things.

### 10a — Deploy the Edge Function (near-real-time sync)

```bash
supabase link --project-ref zymenlnwyzpnohljwifx
supabase functions deploy sync-roadmap-linear --no-verify-jwt
supabase secrets set LINEAR_API_KEY=lin_api_...
supabase secrets set LINEAR_TEAM_KEY=SCC
```

Then in **Supabase Dashboard → Database → Webhooks → Create webhook**:

- **Name:** `roadmap-tasks-to-linear`
- **Table:** `public.roadmap_tasks`
- **Events:** check `Insert` and `Update` (NOT Delete)
- **Type:** HTTP Request
- **HTTP method:** `POST`
- **URL:** `https://zymenlnwyzpnohljwifx.functions.supabase.co/sync-roadmap-linear`
- **Headers:**
  ```
  Authorization: Bearer <YOUR SERVICE ROLE KEY>
  Content-Type: application/json
  ```
- **Timeout:** 5000 ms

Save. Now any status change in `/roadmap` propagates to Linear within ~2 seconds.

### 10b — Enable the nightly drift catcher

In your repo: **Settings → Secrets and variables → Actions → New repository secret**:

- `LINEAR_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional repository variable: `LINEAR_TEAM_KEY = SCC`.

Then go to **Actions → Roadmap → Linear sync → Run workflow → dry_run: true** to verify it runs. After that, it'll run nightly at 05:17 UTC automatically.

---

## Step 11 — (Future) Bidirectional sync so dragging in Linear works (~30 min code)

What you have today is one-way: status changes in Supabase propagate to Linear. Status changes in Linear do NOT come back to Supabase. So if you drag a card in Linear, the Roadmap UI won't reflect it until someone re-imports.

To fix that, you'd add:

1. **Linear webhook**: Linear Settings → API → Webhooks → Add → URL = `https://zymenlnwyzpnohljwifx.functions.supabase.co/sync-linear-to-roadmap`. Subscribe to Issue events.
2. **New Edge Function** `sync-linear-to-roadmap`: receives Linear webhook payload, parses `task_id:` from description, writes `status` back to Supabase. Guards against ping-pong by checking the Linear webhook's `actor` field — if the actor is the API token (i.e., sync wrote the change), skip.
3. Update the migration: when the **Linear webhook writer** updates a row, the trigger should NOT mark it pending (it's already what Linear wants).

I can build this next when you want it. For now, the workflow is:

- **Edit in the in-app Roadmap UI** → Linear mirrors within seconds
- **Linear is read-only-effectively**: you can drag in Linear and it'll look right until the next sync, then snap back

If your daily workflow is "I want to drag in Linear and have Supabase update," tell me and I'll wire 11.

---

## Daily workflow (after setup is done)

**Pick up next task:**
```bash
npm run next             # see what's next
npm run next -- --start  # claim it (sets in_progress)
```
Or open the SCC Roadmap view in Linear and click the top item in Backlog.

**During the day:**
- Update the task's notes / status in the `/roadmap` UI as you go
- Linear mirrors automatically

**End of task:**
- Mark `complete` in `/roadmap`
- Linear shows it in the Done column within seconds
- Run `npm run next` to grab the next one

**When you ship code that closes a task:**
- Put `Roadmap: 3.49` in the PR description
- On merge, GitHub Action posts a "PR landed" comment on the Linear issue
- (Status stays whatever you've manually set — PR merge doesn't auto-complete)

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `MISSING` when checking env vars | `source .env` or use `dotenv -e .env --` prefix |
| `No team with key SCC` | Check Linear team identifier matches `LINEAR_TEAM_KEY` exactly (case-sensitive) |
| Some tasks didn't import | Look at `SELECT task_id, linear_sync_error FROM roadmap_tasks WHERE linear_sync_status = 'error'` |
| Tasks stuck "pending" forever | Run `npm run sync` manually, or check Edge Function logs |
| Linear view shows wrong order | Sort by **Identifier ASC** not **Created** or **Updated** |
| Dragging in Linear doesn't update Supabase | Expected — see Step 11 |
| Can't see all 207 issues in the view | Remove any team/status filters; only filter is `Label: mirrored-from-supabase` |

---

## TL;DR

```bash
# 1. Linear team + key + Blocked state    (UI, 3 min)
# 2. Drop package into repo               (3 min)
# 3. Set .env                             (2 min)
# 4. Run migration                        (1 min)
# 5. npm run bootstrap                    (30 sec)
# 6. npm run import:limit10 -- --limit 1  (1 min)
# 7. npm run import                       (3 min)
# 8. Create "SCC Roadmap" view in Linear  (2 min)
# 9. npm run next                         (use daily)
# 10. (optional) Deploy Edge Function + add GitHub secrets
```

That's the whole thing. ~15 min to working state, ~30 min including automation.
