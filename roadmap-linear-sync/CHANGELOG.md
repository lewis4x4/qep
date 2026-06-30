# Changelog

## v2.0.0 — Bidirectional sync + operational tooling

**Bidirectional sync (Linear → Supabase)**
- New Edge Function `sync-linear-to-roadmap` with HMAC-SHA256 signature verification
- New RPC `sync_status_from_linear` with anti-ping-pong session flag
- Anti-ping-pong via 3 layers: actor-ID check, field-scope filter, trigger session flag
- Drag a card in Linear → status reflects in `/roadmap` UI within seconds

**Migration v2** (`20260519010000_bidirectional_sync_v2.sql`)
- Trigger upgraded to honor `app.linear_webhook_writer` session flag
- `roadmap_sync_events` audit log table (append-only, per-direction)
- `v_roadmap_sync_health` monitoring view (status counts, age, drift)
- `log_roadmap_sync_event` helper RPC

**Daily-ops CLIs**
- `npm run task <id>` — view, start, complete, block, note, history (with `--history` flag)
- `npm run reconcile` — drift detector, `--fix` for repair
- `npm run events` — query audit log with filters
- `npm run whoami` — discover Linear user ID for env config

**Workflow tooling**
- `npm run regen:roadmap` — refresh `UNIFIED_ROADMAP.md` snapshot block from live data
- `npm run graph` — Mermaid dependency graph (with `--phase`, `--only-blocked`, `--out`)
- `npm run alert` — Slack alert if sync becomes unhealthy

**GitHub Actions added**
- `check-pr-roadmap.yml` — enforces `Roadmap:` line on every PR
- `regen-unified-roadmap.yml` — weekly Monday 06:00 UTC, auto-commits snapshot
- `sync-health-alert.yml` — every 30 min, posts to Slack if thresholds breached
- `nightly-reconcile.yml` — drift detector at 05:45 UTC after forward sync

**Configuration**
- New env vars: `LINEAR_WEBHOOK_SECRET`, `LINEAR_SYNC_USER_ID`, optional `SLACK_WEBHOOK_URL`
- New repo variables: `PR_ROADMAP_ENFORCEMENT` (`enforce`/`warn`), threshold tunables

**Docs**
- `V2_SETUP.md` — step-by-step bidirectional sync deployment
- `CONSIDERATIONS.md` — what's not synced, anti-ping-pong layers, backups, scaling, security hardening, v3 ideas
- `CHANGELOG.md` (this file)

## v1.0.0 — Mirror only (Supabase → Linear)

- Forward sync Edge Function + nightly cron
- PR merge → Linear comment workflow
- 207-task import + idempotent re-import
- Bootstrap script for projects + labels
- `npm run next` — pick the next ready task
- README, INSTALL, HOW_TO_USE docs
