# Executive Intelligence Center — Moonshot Build Roadmap

**Date:** 2026-04-07  
**Repo:** `/Users/brianlewis/Projects/qep-knowledge-assistant`  
**Owner:** Brian Lewis  
**Canonical product route:** `/executive`

## Mission Lock

Build the best live dealership executive command center in the product, not a passive analytics page.

The surface must behave like a leadership operating room:
- live, not ornamental
- formula-backed, not vibes-backed
- drillable, not vanity-charted
- action-linked, not presentation-only
- role-aware, not one-size-fits-all
- explainable, not AI-magic theater

## Repo Truth

The current repo already has real command-center foundations:
- analytics registry + snapshots + alerts
- CEO / CFO / COO lens pages
- metric drill drawer
- executive packet generation
- AI briefing strip
- alert action links
- metric drill playbook links

The main weakness is not missing analytics machinery. It is executive product shape:
- `/executive` still carried showcase semantics
- `/exec` and `/executive` split trust
- the live module needed a true executive front door before the role lenses

## Non-Negotiable Product Rules

1. `/executive` is the live canonical leadership route.
2. Every KPI must show formula context, freshness, and a drill path.
3. Every alert must show the next action, not just the problem.
4. Every AI-generated surface must expose confidence/freshness signals or source grounding.
5. Every “important” view must route into a record, queue, playbook, or packet.
6. No raw internal jargon leaks into leadership surfaces when a curated business label is available.
7. No future/showcase copy on the live executive route.

## Build Sequence

### Phase 1 — Canonical Route and Executive Front Door
**Goal:** make `/executive` unmistakably live and unify navigation.

Ship:
- `/executive` as the canonical route
- `/exec` as alias only
- `/executive/vision` for the showcase material
- executive overview above the CEO / CFO / COO lenses
- top-level “what matters now / where to act” hierarchy

Acceptance:
- leadership lands on a live operating surface at `/executive`
- no route collision remains
- OS hub and nav both point to the same live executive route

### Phase 2 — Leadership Pulse Layer
**Goal:** give ownership a first-screen business posture, not just tabbed analytics.

Ship:
- business posture band
- cross-lens alert pressure summary
- stale-metric confidence summary
- lens preview cards with live KPI snippets
- top intervention list with direct action links

Acceptance:
- first viewport answers:
  - what changed
  - what is at risk
  - what leadership should do next
  - where to drill

### Phase 3 — Deep Role Rooms
**Goal:** make each lens a best-in-class working room, not a generic KPI grid.

#### CEO room
- growth posture
- revenue concentration
- branch comparison
- customer health movers
- expansion / churn watchlist
- strategic packet export

#### CFO room
- cash discipline wall
- AR and deposit integrity
- margin leakage explorer
- payment exception recovery
- policy enforcement timeline
- finance risk packet

#### COO room
- execution board
- backlog recovery rail
- logistics drag
- readiness blockers
- service throughput variance
- operations packet

Acceptance:
- each role room has:
  - live KPIs
  - at least one domain-specific explorer
  - at least one working queue
  - at least one direct action path

### Phase 4 — Intervention Graph
**Goal:** make the command center operationally decisive.

Ship:
- unified intervention queue across alerts, exceptions, and data quality
- “what solved this last time” memory links
- branch / department responsibility grouping
- owner-assigned follow-through state
- action logging tied to alerts and metric drills

Acceptance:
- leadership can move from metric -> alert -> record -> playbook without dead ends
- interventions are traceable and auditable

### Phase 5 — Forecasting and Scenario Layer
**Goal:** move from reactive command center to predictive command center.

Ship:
- forecast confidence band
- branch and department trajectory views
- downside / upside scenario cards
- quote expiration revenue risk
- service backlog spillover forecast
- cash and collections pressure forecast

Acceptance:
- every forecast card shows:
  - time horizon
  - source inputs
  - confidence / freshness
  - suggested action

### Phase 6 — Board Packet and Briefing System
**Goal:** convert the command center into a leadership output system, not just a screen.

Ship:
- daily briefing quality upgrade
- weekly packet presets
- role-specific packet templates
- board-ready summary mode
- packet run history with delivery state
- branch packet generation

Acceptance:
- leadership can generate role-specific packets from the live command center without leaving the module

### Phase 7 — Moonshot Modeling Layer
**Goal:** make the executive module feel ahead of the market.

Ship:
- branch operating scorecards
- opportunity concentration maps
- trade-up timing windows
- margin-by-make/model pressure
- scenario compare mode
- AI recommendation layer with explicit confidence and evidence

Acceptance:
- the command center can answer both:
  - “what is happening now?”
  - “what should we do next and why?”

## System Architecture Guidance

### Frontend
- Keep the live route under `apps/web/src/features/exec`
- Treat the overview as the front door, not a side page
- Reuse existing card, primitive, and alert patterns
- Prefer composable role views over another showcase shell

### Backend
- Keep analytics definitions, snapshots, alerts, packets, and summaries as the shared foundation
- Favor snapshot-first reads with detail drill on demand
- Reuse existing alert action logging and packet history instead of parallel systems

### Product Naming
- `Executive Intelligence Center` = leadership product name
- `CEO / CFO / COO lenses` = live role rooms
- `Vision` = non-canonical future/showcase route only

## Explicit Near-Term Order

1. Canonical route + overview shell
2. Cross-lens posture and intervention cards
3. CFO and COO explorer depth hardening
4. Executive queue / intervention graph
5. Forecast and scenario layer
6. Briefing + packet system maturity
7. Board and branch operating layers

## Acceptance Gate

This module is not “done” until:
- `/executive` is the obvious live leadership route
- leadership can see KPI posture, risk posture, and action posture in one view
- every top-risk surface has a direct action path
- every metric is explainable and drillable
- packet generation is part of the operating workflow
- the module feels like a command center, not a gallery
