# Executive Command Center Moonshot Roadmap

**Date:** 2026-04-07  
**Scope:** Make the executive module the canonical live ownership operating room for QEP OS.

## Mission

Build the most credible live executive command center in the product by turning the current executive experience into a real operating surface:

- one canonical executive route
- live KPI trust and drillability
- decision-oriented CEO / CFO / COO lenses
- direct playbook actions on every alert, metric, and risk surface
- packet, briefing, and watchlist workflows for leadership cadence

This is not a showcase lane. It is the leadership operating system lane.

## Current Truth

### Already shipped

- `/executive` is now the canonical live executive route
- `/exec` is now a legacy alias that redirects into the canonical route
- Live executive data model and views exist under `apps/web/src/features/exec`
- CEO / CFO / COO lenses exist
- metric drill drawer exists
- alert action links exist
- metric action links exist
- executive packet generation exists
- executive summary strip exists

### Current product gap

- the old showcase still exists as a vision surface and must stay clearly secondary
- the live command center shell is functional but still reads like an internal tool, not an ownership operating room
- the experience is not yet clearly staged around decisions, control loops, and intervention workflows

## Build Principles

- `/executive` becomes the canonical route
- legacy showcase content moves off the primary executive path
- every KPI must explain itself, prove freshness, and drill into action
- every alert must route to a record or a playbook
- every leadership lens must answer:
  - what changed
  - what is off track
  - what requires intervention now
  - where to go next
- the command center should degrade gracefully when some feeds are partial or stale

## Release Roadmap

### Phase 1 — Canonical Executive Surface

Goal: make the live command center the obvious executive product.

- move the live experience onto `/executive`
- keep `/exec` as legacy alias
- move the showcase page to `/executive/future`
- upgrade the live shell with:
  - mission-grade header
  - role lens selector
  - quick intervention links
  - stronger executive framing

### Phase 2 — Trust and Freshness Layer

Goal: make KPI data feel operationally trustworthy.

- freshness band across metrics
- partial/stale feed state summaries
- confidence language on AI-derived summaries
- per-lens “data condition” status
- clearer source visibility in drill drawer and KPI definitions

### Phase 3 — Intervention Rail

Goal: move from “read dashboard” to “run the business from here”.

- prioritized decision queue
- watchlist cards for:
  - revenue at risk
  - AR pressure
  - service execution bottlenecks
  - parts delay concentration
  - customer health movers
- one-click actions into:
  - exception inbox
  - data quality
  - quote builder
  - nervous system
  - service dashboard
  - portal follow-up surfaces

### Phase 4 — Lens Deepening

Goal: make each leadership lens materially distinct.

- CEO:
  - growth, risk concentration, branch comparison, operating leverage
- CFO:
  - margin leakage, AR pressure, deposit/payment policy, cash conversion
- COO:
  - execution board, service backlog, logistics reliability, recovery queue

Each lens should have:
- 8 to 12 trusted KPIs
- top decisions today
- operating exceptions
- branch or entity comparison
- action paths

### Phase 5 — Command Cadence

Goal: support real leadership rhythm, not just page views.

- saveable packet runs
- generated morning / weekly leadership briefings
- role-aware export packs
- persistent watchlists
- “what changed since last review” strip

### Phase 6 — Comparative Intelligence

Goal: make leadership faster than reporting.

- branch stack ranking
- make/model mix visibility
- trend deltas across 7 / 30 / 90 days
- exception hotspot movement
- leading indicators vs lagging outcomes

### Phase 7 — Moonshot Modeling Layer

Goal: move from observability to proactive operating intelligence.

- predicted risk clusters
- forward-looking scorecards
- management recommendation engine
- scenario panels:
  - margin under pricing pressure
  - backlog impact
  - AR block exposure
  - trade-up window concentration

## Immediate Execution Order

1. Canonical route consolidation
2. Live executive shell upgrade
3. Trust/freshness framing pass
4. Decision queue and watchlist rail
5. Lens-specific deepening

## Definition of Done

The executive command center is not done until:

- `/executive` is the live command center
- the experience feels live, not aspirational
- leadership can see metrics, alerts, playbooks, and drill paths in one place
- every major KPI and alert has a route into action
- the module is credible enough to use in a real owner review
