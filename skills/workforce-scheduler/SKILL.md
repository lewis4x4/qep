---
name: workforce-scheduler
description: CEO workforce scheduling — automatically adjusts agent heartbeat intervals and concurrency based on active sprint/project state. Use at sprint kickoff, sprint completion, or when pipeline workload changes.
---

# Workforce Scheduler

Manages agent "work hours" — heartbeat intervals and concurrency — based on current pipeline state. The CEO invokes this at pipeline transitions to ensure active agents poll frequently and idle agents conserve resources.

## When to Use

- **Sprint kickoff:** A new sprint or project phase begins. Activate agents that will participate.
- **Sprint completion:** A sprint finishes. Wind down agents that are no longer needed.
- **On demand:** Brian asks to adjust agent schedules, or the CEO detects a workload shift.
- **Full reset:** All work is done. Return every agent to default settings.

## Arguments

Pass one of these modes as the argument:

- `activate` — Analyze current pipeline, set active agents to fast intervals
- `reset` — Return all agents to default (3600s interval, 1 concurrent)
- `status` — Show current intervals and workload for all agents

## Agent Classification Rules

### Code-Modifying Agents (NEVER bump concurrency above 1)
These agents write to the git repo. Concurrent runs cause merge conflicts.
- Engineer
- DevOps/Deployment Agent
- Architect/Design Agent

### Review/Spec Agents (Safe to bump concurrency to 2)
These agents read code, write specs/reviews, or manage non-code deliverables.
- Product/Requirements Agent
- Chief Design Officer
- Security/Compliance Agent
- QA Agent
- Data/Analytics Agent
- Integration/API Specialist Agent
- Customer Success / Onboarding Agent
- Content/Copy Agent
- Testing/Simulation Agent
- Documentation Agent
- Monitoring/Post-Deploy Agent

### Always Default (Do not adjust)
- CEO — orchestrator, wakes on demand
- Revenue/Pricing Agent — only active for post-deploy value tracking

## Interval Tiers

| Tier | Interval | Concurrency | When |
|------|----------|-------------|------|
| **Active** | 300s (5 min) | 1 (code) or 2 (review) | Agent has in_progress or todo tasks |
| **Standby** | 1800s (30 min) | 1 | Agent has no active tasks but work is expected soon (next sprint phase) |
| **Default** | 3600s (1 hr) | 1 | Agent has no active tasks and no near-term work expected |

## Procedure

### Mode: `activate`

1. Query all agents: `GET /api/companies/{companyId}/agents`
2. Query all non-done issues: `GET /api/companies/{companyId}/issues?status=todo,in_progress,blocked,in_review`
3. For each agent, check if they have assigned tasks in the active set
4. Classify each agent:
   - Has active tasks → **Active tier**
   - No active tasks but is in the build chain for the current sprint (Architect chain: Engineer → CDO → QA → Testing → DevOps → Security) → **Active tier**
   - No active tasks, not in current sprint chain, but has work coming in the next phase → **Standby tier**
   - No active tasks, no near-term work → **Default tier**
5. Apply interval and concurrency via `PATCH /api/agents/{agentId}` with `runtimeConfig.heartbeat`
6. Post summary of changes

### Mode: `reset`

1. Query all agents
2. Set every agent (except CEO) to:
   - `intervalSec: 3600`
   - `maxConcurrentRuns: 1`
   - `cooldownSec: 10`
   - `wakeOnDemand: true`
   - `enabled: true`
3. Post confirmation

### Mode: `status`

1. Query all agents with their current `runtimeConfig.heartbeat`
2. Query all non-done issues grouped by assignee
3. Display a table: agent name, current interval, concurrent runs, active task count, recommended tier

## Implementation

Use the Paperclip API directly. All changes go through:

```
PATCH /api/agents/{agentId}
Headers: Authorization: Bearer $PAPERCLIP_API_KEY, X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
Body: {
  "runtimeConfig": {
    "heartbeat": {
      "enabled": true,
      "cooldownSec": 10,
      "intervalSec": <tier-value>,
      "wakeOnDemand": true,
      "maxConcurrentRuns": <tier-value>
    }
  }
}
```

## Important Notes

- All agents keep `wakeOnDemand: true` regardless of interval — they still respond instantly to task assignments
- The interval only affects background polling frequency
- Code-modifying agents (Engineer, DevOps, Architect) NEVER get concurrent > 1
- CEO interval is never changed by this skill
- Always include `X-Paperclip-Run-Id` header on PATCH calls
- Post a summary comment on the active orchestration task (e.g., QUA-92) after applying changes
