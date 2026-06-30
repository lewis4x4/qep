# QEP OS Roadmap ↔ Linear Sync

**One source of truth: `qep_roadmap_tasks` in Supabase. Linear is a live mirror.**

This package keeps the QEP unified roadmap (`QEP (1)/QEP_UNIFIED_ROADMAP_2026-05-19.md`) in sync between Supabase and Linear. The unified-roadmap document and `qep_roadmap_tasks` are the writers; this package pushes every change into Linear and accepts state changes from Linear back into Supabase.

---

## What it does

- **Creates `qep_roadmap_tasks`** with QEP-specific columns: `stream` (A–E), `wave` (A1, A2, …), `ship_state` (7 values including `pending_decision` and `deferred`), `blocking_decision`, `depends_on`, `evidence_link`. Plus Linear sync bookkeeping.
- **Seeds the table** with every wave + item from the unified roadmap (144 rows out of the box).
- **Mirrors every row** to a Linear issue, one-for-one, with `task_id` embedded in the description for re-discovery.
- **Maps streams → Linear projects** (Stream A — Iron Quote, etc.) and ship_states → workflow states (Backlog / In Progress / Blocked / Pending Decision / Deferred / Done / Canceled).
- **Auto-creates labels** for `stream:A`, `wave:A1`, `owner:Engineer`, `blocker:JAR-103`, plus state flag labels (`blocked`, `pending_decision`, `deferred`).
- **Pushes deltas three ways:**
  1. Supabase Database Webhook → Edge Function on each `UPDATE/INSERT` (near-real-time)
  2. Nightly GitHub Action (safety net for drift)
  3. Manual `npm run sync` (anytime)
- **Accepts state changes from Linear back into Supabase** (drag a card → ship_state updates).
- **Comments on Linear when PRs merge** — parses `Roadmap: A1.1` from PR title/body.
- **Never auto-flips ship_state from a PR merge.** Ship_state stays manual in the QEP roadmap UI or via `npm run task`.

---

## Quick start

The full ops checklist lives in `QEP (1)/QEP_Roadmap_Linear_Sync_OPS_CHECKLIST.md`. Short version:

1. Apply migrations 593 + 594 to the QEP Supabase project (`iciddijgonywtxoelous`).
2. Create the QEP Linear workspace + team (key `QEP`), then the personal API key and webhook secret.
3. Copy `.env.example` to `.env` and fill in values.
4. `npm run whoami` → record `LINEAR_SYNC_USER_ID` in `.env`.
5. `npm run bootstrap` → creates Stream A–E projects + seed labels in Linear.
6. `npm run import:limit10 -- --limit 1` → smoke-test one row.
7. `npm run import` → mirror all 144 rows.
8. Deploy both Edge Functions and create both webhooks.
9. Add GitHub repo secrets + variable; trigger each workflow once with `dry_run=true`.

End-to-end smoke test:
- Change a `ship_state` in Supabase → confirm Linear updates within seconds.
- Drag a card in Linear → confirm Supabase updates within seconds.
- `npm run reconcile` shows `perfect = 144, drift = 0`.

---

## Daily ops

| Situation | Command |
|---|---|
| What's next? | `npm run next` |
| Claim the next task | `npm run next:start` |
| View one task | `npm run task A1.1` |
| Mark shipped | `npm run task A1.1 -- --ship` |
| Mark blocked | `npm run task A1.1 -- --block "reason"` |
| Mark pending decision | `npm run task A1.1 -- --pending Q6` |
| Defer | `npm run task A1.1 -- --defer "reason"` |
| History | `npm run task A1.1 -- --history` |
| Drift check | `npm run reconcile` |
| Drift fix | `npm run reconcile:fix` |
| Audit log | `npm run events` |
| Recent errors | `npm run events:errors` |
| Snapshot regen | `npm run regen:roadmap` |
| Dependency graph | `npm run graph -- --stream A --out streamA-graph.md` |

---

## Architecture

```
              ┌───────────────────────────┐
              │  QEP_UNIFIED_ROADMAP.md   │
              │  (human-edited doc)       │
              └─────────────┬─────────────┘
                            │ seed migration 594
                            ▼
       ┌──────────────────────────────────────────┐
       │  Supabase qep_roadmap_tasks              │
       │  (system of record — RLS enforced)       │
       │                                          │
       │  Trigger marks row 'pending' on change   │
       └──────────────────────────────────────────┘
              │                          ▲
   DB Webhook │                          │ Linear webhook
   (INSERT/   │                          │ (state changes only,
    UPDATE)   ▼                          │  HMAC verified)
       ┌───────────────────────┐  ┌─────────────────────────┐
       │ sync-roadmap-linear   │  │ sync-linear-to-roadmap  │
       │  Edge Function        │  │  Edge Function          │
       └──────────┬────────────┘  └─────────────────────────┘
                  │ GraphQL
                  ▼
              ┌───────────────────────────┐
              │  Linear team "QEP"        │
              │  5 projects (Streams A-E) │
              │  Issues mirror tasks      │
              └───────────────────────────┘
```

---

## Source documents

- `QEP (1)/QEP_UNIFIED_ROADMAP_2026-05-19.md` — the canonical roadmap doc
- `QEP (1)/QEP_Roadmap_Linear_Sync_HANDOFF.md` — full setup handoff
- `QEP (1)/QEP_Roadmap_Linear_Sync_OPS_CHECKLIST.md` — step-by-step user actions
- `supabase/migrations/593_qep_roadmap_tasks.sql` — schema (lives in the repo, not the package)
- `supabase/migrations/594_qep_roadmap_tasks_seed.sql` — seed (lives in the repo, not the package)
- `INSTALL.md` — original SCC install doc (reference)
- `V2_SETUP.md` — original SCC v2 setup doc (reference)
- `HOW_TO_USE.md` — daily-ops reference (lightly QEP-flavored)
- `CONSIDERATIONS.md` — architecture decisions + risk register
