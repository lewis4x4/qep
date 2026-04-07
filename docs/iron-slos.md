# Iron Companion — Service Level Objectives

**Wave 7 v1.6.** This document defines the production SLOs for the QEP Iron
Companion. The numeric targets are queryable in real time via the
`public.iron_compute_slos()` SQL function and surfaced in the
`/admin/flow` Iron health card.

The SLOs intentionally cover the operator-facing critical path: classify →
execute → undo → cost. Anything that doesn't directly impact a rep
finishing a flow on the floor is out of scope here and tracked elsewhere.

---

## SLOs

| # | Metric | Target | Window | Source |
|---|---|---|---|---|
| 1 | **Classify p95 latency** | < 800 ms | rolling 7 days | `iron_messages.latency_ms` where `role = 'iron'` |
| 2 | **Execute p95 latency** | < 2000 ms | rolling 7 days | `flow_workflow_runs.duration_ms` where `surface in ('iron_conversational','iron_voice')` |
| 3 | **Undo success rate** | > 99.5 % | rolling 30 days | `flow_workflow_runs` where `undone_at is not null` AND status not in ('failed') |
| 4 | **Dead letter rate** | < 0.5 % | rolling 7 days | `flow_workflow_runs.status = 'dead_lettered'` ÷ total Iron runs |
| 5 | **Cost cap escalations** | < 5 % users / day | rolling 24 h | `iron_usage_counters.degradation_state in ('cached','escalated')` ÷ active users |

A breach on any metric in any 1-hour window that burns more than 2% of the
monthly error budget should fire a Sentry alert routed to `#qep-iron-health`.

---

## Why these five

1. **Classify p95 latency** — the user feels Iron's "thinking" pause directly.
   800 ms is the longest a sales rep will tolerate before they reach for the
   keyboard instead.

2. **Execute p95 latency** — between "Confirm" and the result toast. 2000 ms
   is the upper bound where users still believe the system is working without
   needing a spinner narrative.

3. **Undo success rate** — the 60-second undo window is a trust feature.
   If undo fails when the user clicks it, the trust contract is broken and
   operators stop using voice flows altogether.

4. **Dead letter rate** — runs that the engine couldn't recover from. These
   are concrete operator pain even if the user never sees the dead letter
   itself, because the underlying record didn't get created. 0.5% gives ~5
   dead letters per 1,000 flows, which is the threshold where the manager
   inbox becomes manageable rather than a backlog.

5. **Cost cap escalations** — degradation is fine; mass degradation means
   the ladder isn't tuned. 5% of users hitting cached or escalated mode in
   a single day is the trip-wire for re-tuning the daily token caps.

---

## Computation

`public.iron_compute_slos(p_workspace_id text default 'default')` returns:

```json
{
  "computed_at": "ISO timestamp",
  "workspace_id": "default",
  "classify_p95_ms": 412,
  "classify_target_ms": 800,
  "classify_pass": true,
  "execute_p95_ms": 1380,
  "execute_target_ms": 2000,
  "execute_pass": true,
  "undo_success_rate": 0.998,
  "undo_target_rate": 0.995,
  "undo_pass": true,
  "undo_attempts": 412,
  "dead_letter_rate": 0.0021,
  "dead_letter_target_rate": 0.005,
  "dead_letter_pass": true,
  "iron_runs_total": 1842,
  "cost_escalation_pct": 0.018,
  "cost_target_pct": 0.05,
  "cost_pass": true,
  "active_users_24h": 17
}
```

Each `*_pass` field is a boolean; the admin card uses these to render a
green check or red alert next to each metric.

`null` values mean "no data in the window" — treat as a non-breach.

---

## Alert delivery

For now, the SLO function is read-only and surfaced in the admin UI. A
follow-up slice will:

1. Add a nightly cron that calls `iron_compute_slos()` and writes to a
   small `iron_slo_history` table.
2. Compare current values to the prior run; on transition from pass → fail,
   `enqueue_exception(p_source='data_quality', p_severity='warn', ...)` so
   the manager Exception Inbox surfaces it.
3. Sentry burn-rate alert config keyed off the same history table.

Until that lands, the admin card is the manual visibility surface and
managers should glance at it daily.

---

## Manual check

```bash
psql "$SUPABASE_DB_URL" -c "select public.iron_compute_slos();" | jq
```

Or from the admin UI: `/admin/flow` → Iron tab → "Iron health" card.
