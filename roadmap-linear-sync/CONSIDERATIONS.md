# Considerations — Things to think about beyond what's built

This package gives you a complete bidirectional sync. Things below are not bugs in what's built; they're decisions and risks to be aware of, plus future directions if you want to push further.

---

## 1. What gets synced — and what doesn't

| Field | Supabase → Linear | Linear → Supabase | Notes |
|---|---|---|---|
| `title` | yes | no | Computed from `task_id` + title. Editing in Linear is futile. |
| `description` (Linear) | yes | no | Built from `description` + `notes` + metadata block. |
| `status` | yes | yes (state change) | The whole point of bidirectional sync. |
| `phase` (→ project) | yes | no | Move issues to different projects in Linear gets overwritten next sync. |
| `section`, `owner`, `lane` (→ labels) | yes | no | Same — Linear is downstream of Supabase. |
| `assignee` | no | no | We don't sync this. Linear has its own assignee field; uses it freely without consequence. |
| `priority` | no | no | Linear users can set priority freely; we don't mirror it. |
| Comments | no | no | Linear comments don't flow to `notes`. PR-merge comments are one-way Supabase → Linear. |
| Linear `cycle` (sprint) | no | no | Not tracked. |

**Implication:** If a non-status field changes in Linear, the next forward sync overwrites it. Tell collaborators "edit content in the Roadmap UI; use Linear for status only."

If you want bidirectional comments or assignee sync, that's v3 — straightforward but more API calls. Same pattern as status sync.

---

## 2. Anti-ping-pong logic — three layers

This is the bug class that kills naive bidirectional syncs. Three layers of defense:

1. **Actor ID check** in reverse Edge Function. If `event.actor.id === LINEAR_SYNC_USER_ID`, skip immediately. Catches 99% of loops.
2. **Field-scope check** in reverse Edge Function. Only state changes are accepted. Description/title/labels from Linear are ignored.
3. **Session flag in trigger** via `app.linear_webhook_writer`. When the RPC writes back, the trigger DOESN'T re-mark the row pending — so the forward sync doesn't fire on writes that just came from Linear.

If you ever see "task got synced 50 times in 5 minutes" in `roadmap_sync_events`, one of these layers broke. Check Edge Function logs.

---

## 3. Backups

Two tables you care about:

- `roadmap_tasks` — your source of truth
- `roadmap_sync_events` — the audit log (append-only, grows forever)

Supabase has automatic daily backups on the Pro plan. For belt-and-suspenders:

```bash
# Manual backup any time
pg_dump --table=roadmap_tasks --table=roadmap_sync_events \
  postgresql://postgres:<pw>@db.zymenlnwyzpnohljwifx.supabase.co:5432/postgres \
  > roadmap_backup_$(date +%Y%m%d).sql
```

For `roadmap_sync_events` retention, after 90 days the rows aren't very useful. Optional cleanup job:

```sql
-- Keep last 90 days of events
DELETE FROM roadmap_sync_events WHERE occurred_at < NOW() - INTERVAL '90 days';
```

Add to a monthly GitHub Action if the table gets huge.

---

## 4. Linear plan and limits

- **Linear Free:** 250 issues per workspace. **You have 207 already.** Adding new work pushes you over. Linear Plus ($10/user/mo for SCC + Tom + a few contractors) gives unlimited issues, cycles, custom views, and the webhook features used here.
- **API rate limits:** Linear allows ~1500 requests/hour per API key. Forward sync uses ~3 calls per task; 207-task full resync = ~620 calls. Well within limits. Don't run a full resync more than once per minute.
- **Webhook delivery:** Linear retries on 5xx for ~12 hours. If your Edge Function is down longer, you'll miss events. The nightly `reconcile` Action catches drift in this case.

---

## 5. Linear personal API key vs OAuth

Right now sync uses a **personal API key** owned by you. Implications:

- If you leave the org (lol), the key dies and sync breaks
- The key has full workspace access; can't be scoped tighter
- Your name appears as the author of every sync-written event in Linear

**Better long-term:** create a dedicated "SCC-OS Service" user in Linear, give it Member access only to the `SCC Compliance` team, and generate its API key. Even better: Linear OAuth app with scoped permissions. Requires building an OAuth flow — skipping for now since you're not multi-tenant.

---

## 6. Drift sources to watch

Things that can put Supabase and Linear out of sync, ranked by likelihood:

1. **Edge Function fails silently** — webhook returns 500, Linear retries, eventually gives up. Mitigated by nightly reconcile + Slack alert.
2. **You delete a Linear issue** — issue gone; next forward sync recreates it. Idempotent.
3. **You manually edit description in Linear** — overwritten on next forward sync. Tell people not to.
4. **Linear adds a new workflow state type** (unlikely) — status map needs an update.
5. **You delete a row from `roadmap_tasks`** — Linear issue stays orphaned. **Add a delete trigger** if you want auto-archive in Linear (we don't currently — deletes are rare).
6. **A bug in the RPC overwrites status with stale value** — defended by the idempotency short-circuit in `sync_status_from_linear`.

The `reconcile` script catches 1–4. For #5, here's a one-liner to archive orphaned Linear issues:

```sql
-- Find Linear issue IDs that no longer exist in roadmap_tasks
-- (you'd need to query Linear to compare; out of scope here)
```

---

## 7. Performance at scale

Today: 207 tasks, single-row Edge Function invocations. Comfortable.

If `roadmap_tasks` grows to 5000+ tasks:

- **Forward sync batching** — the cron script handles 250 per run by default. Bump `--batch`.
- **Edge Function latency** — each invocation does 3-4 Linear API calls. ~500ms median. Still fine even at high rates because the Database Webhook fires per-row asynchronously.
- **Reconcile script** — 5000 individual Linear API reads = 5000 calls. Takes ~3 minutes. Acceptable.

If you ever hit Linear rate limits, the package's retry logic backs off (errors are logged and retried by the next cron). You won't lose data.

---

## 8. Multi-tenant (if SCC-OS becomes a SaaS)

Right now the assumption: one Supabase project + one Linear workspace = one SCC-OS installation.

When you license SCC-OS to another mining operator, they need their own Linear workspace. Refactor needed:

- Add `tenant_id` to `roadmap_tasks` (already in your data model — confirm)
- Add a `tenant_linear_config` table: `tenant_id`, `linear_team_key`, `linear_api_key_encrypted`, `linear_sync_user_id`
- Sync scripts read config per tenant, loop through tenants
- Each tenant gets its own Linear webhook URL with their tenant_id in the path

Not needed today. Flag this for v3.

---

## 9. Things this does NOT do (yet)

Worth knowing in case anyone asks:

- **Cycles / sprints.** Linear has Cycles (time-boxed). The sync doesn't manage them. Use them freely in Linear; they don't conflict with anything.
- **Estimates / story points.** Add an `estimate` column to `roadmap_tasks` and we can sync to Linear's `estimate` field.
- **Linear initiatives.** Could group the 5 phase projects under an SCC-OS initiative. UI-only, no sync needed.
- **Time tracking.** Not built. Linear has it; we don't surface it.
- **Linear views shared via URL.** Already works — pin your "SCC Roadmap" view and share its URL.
- **Custom fields for `task_id` etc.** Linear custom fields are Plus+ only. We use the description-embedded YAML block instead, which works on all plans.
- **Agent activity stream.** When Paperclip agents write to `roadmap_tasks`, sync propagates to Linear automatically. To make agent activity *visible* as separate comments in Linear (not just label changes), you'd extend the forward Edge Function to also `commentCreate` when `notes` changes — about 20 lines of code.
- **Markdown rendering of description.** Linear renders markdown in issue descriptions. The `buildIssueBody` function produces clean markdown.

---

## 10. Security hardening

What you have:

- Service role key is in Supabase Function secrets (never exposed)
- Linear API key is in Supabase Function secrets + GitHub secrets
- Webhook signature verification (HMAC-SHA256) on the reverse Edge Function
- Edge Functions deploy with `--no-verify-jwt` (necessary because Linear doesn't send a JWT)

What's worth adding:

- **Webhook IP allowlist.** Linear publishes their webhook source IPs. You can add a reverse-proxy or Edge Function check that drops requests from other IPs. Defense-in-depth on top of signature.
- **Audit log access.** Right now `service_role` and authenticated users can read `roadmap_sync_events`. Tighten the policy if you want only admins.
- **Rotate the personal API key annually.** Generate a new one, deploy, retire the old.
- **Webhook secret rotation.** Same: rotate `LINEAR_WEBHOOK_SECRET` annually; the function picks up the new value on next deploy.

---

## 11. What you might want next (v3 ideas)

In priority order, if you keep building:

1. **Linear comments → Supabase notes.** When Tom comments on a Linear issue, append to `roadmap_tasks.notes`. ~30 lines added to the reverse Edge Function.
2. **Agent activity → Linear comments.** When a Paperclip agent updates a task, post a Linear comment so contractors see the activity in their normal workflow. ~20 lines added to forward Edge Function.
3. **Slack slash command `/scc next`.** Wrap `npm run next` in a tiny Slack app so Tom can grab tasks from Slack.
4. **Cycles auto-population.** When you create a Linear cycle for "Week of June 1", auto-assign the next N pending tasks to it. ~50 lines of code + a new column on `roadmap_tasks`.
5. **Dashboard page in SCC-OS.** Build `/roadmap/sync-health` that reads `v_roadmap_sync_health` and shows the same data the Slack alert uses. No new infra needed.
6. **Linear GitHub integration.** Linear can auto-link branches to issues based on identifier in branch name. Enable in Linear Settings → Integrations → GitHub. Doesn't conflict with anything here.
7. **Estimates / story points.** Add `estimate` column to `roadmap_tasks`, mirror to Linear's `estimate` field. ~5 lines per direction.
8. **Bulk operations CLI.** `npm run bulk:phase 3 --status complete` style for mass updates with confirmation prompt. Useful when reshaping the roadmap.

None of these are needed for what you asked for. They're future leverage.

---

## 12. Operational runbook (one place)

| Situation | Command |
|---|---|
| Want to start work | `npm run next` (or `npm run next:start`) |
| Update one task | `npm run task 3.49 -- --note "..."` |
| Block a task | `npm run task 3.49 -- --block "waiting on X"` |
| Complete a task | `npm run task 3.49 -- --complete` |
| See what happened to a task | `npm run task 3.49 -- --history` |
| Suspect sync is broken | `npm run events -- --errors --since 24h` |
| Want to force a resync | `UPDATE roadmap_tasks SET linear_sync_status='pending' WHERE task_id='X.YY';` then `npm run sync` |
| Want a roadmap snapshot | `npm run regen:roadmap` |
| Want to see dependencies | `npm run graph -- --phase 3 --out phase3-deps.md` |
| Suspect drift | `npm run reconcile` then `npm run reconcile:fix` |
| Onboard a new contributor | Send them the Linear "SCC Roadmap" view URL + access to it |
| Onboard a new agent (Paperclip / Cursor) | Give it Supabase service role key + tell it to write to `roadmap_tasks`. Sync is automatic. |
| Webhook secret got leaked | Rotate in Linear Settings → API → Webhooks → Regenerate. `supabase secrets set LINEAR_WEBHOOK_SECRET=<new>`. |

Pin this in your team docs.
