# Paperclip stale execution runs — inventory, detection, remediation

This runbook supports [QUA-160](/QUA/issues/QUA-160) (stale `executionRunId` / zombie heartbeat runs that block checkout with **409**).

## 1. Inventory — how runs are stored

| Layer | Detail |
|--------|--------|
| **Database** | Paperclip persists heartbeat runs in table `heartbeat_runs` (see `paperclipai` package schema). Issues reference a run via `execution_run_id` → `heartbeat_runs.id` (nullable on delete). |
| **Issue fields** | `executionRunId`, `checkoutRunId`, `executionLockedAt`, `executionAgentNameKey` — visible on `GET /api/issues/:issueId`. |
| **Run record** | `GET /api/heartbeat-runs/:runId` returns `status` (`running`, terminal states), `startedAt`, `finishedAt`, `processPid`, `processStartedAt`, `agentId`, `contextSnapshot`, log pointers, etc. |
| **List by agent** | `GET /api/companies/:companyId/heartbeat-runs?agentId=:agentId` returns recent runs for that agent. |
| **Streaming** | `GET /api/heartbeat-runs/:runId/events?afterSeq=&limit=` and `GET /api/heartbeat-runs/:runId/log?offset=&limitBytes=` (adapter / UI clients). |

## 2. API / UI gaps (cancel / terminal-complete)

As of local Paperclip validation (2026-03-29):

- **GET** `/api/heartbeat-runs/:id` — supported.
- **POST / PATCH / PUT / DELETE** on `/api/heartbeat-runs/:id` — **not exposed** (404). There is **no documented public API** in this build to cancel or force-complete a stuck run from automation.
- **CLI**: `paperclipai issue release` clears assignee and returns the issue toward `todo`; it **does not reliably clear** a stale `executionRunId` when the run row remains `running` (see incident on [QUA-147](/QUA/issues/QUA-147)).

**Implication:** remediation is **human-driven** (UI workflow if available, operator action, or future API) until Product/Security approves an automated cancel path.

## 3. Detection automation (repo)

Script: `scripts/paperclip/check_stale_execution_runs.py`

- Scans open issues (`todo`, `in_progress`, `blocked` by default) with non-null `executionRunId`.
- Loads each run; flags when `status === "running"` and `startedAt` is older than threshold.
- Default threshold: **3600s** (2× a typical **1800s** agent heartbeat interval). Override with `STALE_RUN_THRESHOLD_SEC` or `--threshold-sec`.

**Environment:**

```bash
export PAPERCLIP_API_URL="http://127.0.0.1:3100"
export PAPERCLIP_API_KEY="…"        # board key or agent JWT
export PAPERCLIP_COMPANY_ID="…"
# optional:
# export STALE_RUN_THRESHOLD_SEC=3600
# export PAPERCLIP_ISSUE_PREFIX=QUA
# export PAPERCLIP_CEO_AGENT_ID="…"   # for --create-escalation
```

**Examples:**

```bash
# stdout summary; exit 1 if any stale
python3 scripts/paperclip/check_stale_execution_runs.py

# machine-readable
python3 scripts/paperclip/check_stale_execution_runs.py --json

# comment on each affected issue + rollup on parent epic (UUID)
python3 scripts/paperclip/check_stale_execution_runs.py \
  --post-issue-comments \
  --notify-parent 75324e78-76a7-4b8d-9f0b-1d4fc0b8e391

# also open a medium child assigned to CEO (requires CEO agent id)
python3 scripts/paperclip/check_stale_execution_runs.py \
  --notify-parent 75324e78-76a7-4b8d-9f0b-1d4fc0b8e391 \
  --create-escalation \
  --ceo-agent-id eac9b872-f12c-4230-b159-06263e238e0c
```

**Scheduling (macOS):** use `launchd` with `StartInterval` (e.g. 900–3600 seconds) or `StartCalendarInterval`, running the script from a login that loads the same env (or a wrapper plist `EnvironmentVariables`). Keep API keys out of the plist when possible — reference a root-only env file sourced by the wrapper script.

## 4. Remediation policy (draft — needs CEO + Security sign-off)

| Tier | Action | Gate |
|------|--------|------|
| **A — detect + notify** | Run script on a schedule; optional `--notify-parent` / `--post-issue-comments`; no mutations to runs. | Approved for local / dev immediately. |
| **B — human verify PID** | On flag, operator checks `processPid` on the Paperclip host (`kill -0 <pid>`). If dead, treat as zombie candidate; if alive, may be a long legitimate session. | Standard ops. |
| **C — human clear lock** | Use any **documented** UI or admin procedure Paperclip provides to detach or complete the run; otherwise escalate to Paperclip maintainer. | No automation without written procedure. |
| **D — auto-cancel / DB surgery** | Automatically PATCH runs or edit DB to clear `executionRunId`. | **Blocked** until CEO + Security explicitly approve (risk: double-writer, lost audit, concurrent adapter). |

**Default:** implement **A** everywhere; **B/C** only; **D** never without sign-off.

## 5. Ticket template (manual)

```markdown
## Stale Paperclip execution run

- **Issue:** [QUA-___](/QUA/issues/QUA-___)
- **Run:** [agent run](/QUA/agents/<agent-id-or-url-key>/runs/<run-id>)
- **Symptom:** checkout 409 / task stuck with `executionRunId` set
- **PID / host:** 
- **Verified dead session?** yes / no
- **Action taken:** 
- **Follow-up:** API gap / UI path / doc update
```

## 6. Handoff — Monitoring / Post-Deploy charter delta (proposal)

**Monitoring/Post-Deploy** today owns **application and infrastructure** health after deploy (latency, errors, rollbacks), **not** the Paperclip control plane.

**Proposed addition (CEO approval):**

- *Optional secondary scope:* scheduled execution of `check_stale_execution_runs.py` on the **Paperclip host**, ingestion of exit code into existing alerting, and monthly review of false-positive rate. Primary owner remains **DevOps/Deployment** for policy and script maintenance until handoff is accepted.

If Monitoring adopts this, add the above bullet to that agent’s `AGENTS.md` under scope, with explicit “no auto-cancel without tier D approval.”
