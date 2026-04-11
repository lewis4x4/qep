# Phase 6 Ship Report

Date: 2026-04-10  
Repo: `/Users/brianlewis/Projects/qep-knowledge-assistant`

## Overview

Phase 6 is the operating-system layer of QEP OS. It turned the product from a collection of role-specific pages into a connected operating surface with:

- shared visual primitives
- account and asset intelligence
- fleet visibility
- operational service state
- contextual AI entry points
- portal fleet mirroring
- data quality and exception routing
- executive control surfaces
- in-app bug capture
- internal workflow automation

In practical terms, Phase 6 made the system feel like a real dealership operating platform instead of a set of separate tools.

## What Phase 6 Was

Phase 6 was the layer that connected visibility, actionability, and escalation.

Before Phase 6, the repo already had CRM, quotes, service, portal, and SOP surfaces. Phase 6 added the connective tissue:

- consistent UI building blocks so dashboards looked and behaved like one system
- 360-degree operational views of accounts, equipment, and fleet
- operator-safe AI entry points embedded in context
- data quality and exception handling so bad state became visible work instead of silent drift
- an executive command layer for owner-grade operating visibility
- Flare for in-app, context-rich bug and idea capture
- the Flow Engine for internal automation and orchestration

## What Shipped

### 6.1 Shared Primitives

Phase 6.1 shipped the reusable dashboard/UI building blocks used across the rest of the system.

Core primitives shipped from `apps/web/src/components/primitives/` include:

- `StatusChipStack`
- `FilterBar`
- `CountdownBar`
- `AssetCountdownStack`
- `ForwardForecastBar`
- `Last24hStrip`
- `AssetBadgeRow`
- `AskIronAdvisorButton`
- `DashboardPivotToggle`
- `MapWithSidebar`

What this delivered:

- a consistent visual language for operational dashboards
- reusable cards, chips, filters, counters, and map layouts
- a faster path to shipping new pages without inventing a new UI pattern each time

How it works:

- these primitives are plain React components used by many route-level pages
- they centralize recurring dashboard patterns into one shared component layer
- they reduce duplication and give the app one coherent operational UX vocabulary

### 6.2 Account / Asset 360

Phase 6.2 shipped the intelligence surface for accounts and equipment.

Key surfaces:

- `QrmCompanyDetailPage`
- `Account360Tabs`
- `QrmEquipmentDetailPage`
- asset/account RPC support from `173_account_360_and_fleet_radar_rpcs.sql`

What this delivered:

- a single place to see what QEP knows about an account
- a single place to see what QEP knows about a machine
- drillable operational context instead of forcing users to bounce between CRM, service, and notes

How it works:

- account and equipment pages aggregate CRM records, lifecycle signals, field context, service context, and related intelligence
- tabs segment the intelligence into usable operating views instead of one overloaded page
- these surfaces act as the “current truth” page for a customer or machine

### 6.3 Fleet Map

Phase 6.3 shipped live fleet visibility.

Key surfaces:

- `FleetMapPage`
- `PortalFleetMapPage`
- `MapWithSidebar`

What this delivered:

- a map-based operational view of equipment
- internal and portal-facing fleet location visibility
- drill paths from geography into the underlying equipment and account records

How it works:

- map pages render equipment/fleet state spatially
- sidebar and list/map coupling provide both geographic and tabular navigation
- internal and portal views share a common interaction model while respecting audience scope

### 6.4 Service Dashboard + Canonical State

Phase 6.4 established service as an operating system, not just a list of jobs.

Key foundation:

- `161_service_dashboard_and_canonical_state.sql`
- service route surfaces under `apps/web/src/features/service/`

What this delivered:

- a canonical operational view of service status
- shared definitions for service state instead of fragmented local interpretations
- better routing for intake, scheduling, completion, notifications, and downstream actions

How it works:

- the database establishes canonical service state and supporting views/RPCs
- service UI pages read from those normalized service contracts
- cron jobs and edge functions enforce or react to service state transitions

### 6.5 Geofences

Phase 6.5 added restrained geospatial intelligence.

Key foundation:

- `162_geofences_postgis.sql`

What this delivered:

- geography-aware operating rules
- foundations for customer jobsite, branch territory, and competitor-yard logic
- exception routing tied to spatial conflicts instead of only manual observation

How it works:

- PostGIS-backed geometry/geofence data is stored in the database
- the app and operational functions can use those geofences to reason about whether equipment or actions fall into expected spatial boundaries
- v1 is intentionally constrained to the specific geofence types the business can operationalize safely

### 6.6 Ask Iron Advisor Everywhere

Phase 6.6 embedded contextual AI entry points into real work surfaces.

Key surface:

- `AskIronAdvisorButton`

What this delivered:

- contextual AI access directly inside record-level workflows
- less context switching to a separate “AI page”
- a visible pattern for operator assistance embedded in the interface

How it works:

- the button appears inside target surfaces and carries route/entity context forward
- the chat layer can preload that context and answer inside the frame of the current record
- later Iron work in Wave 7 builds on this placement model instead of replacing it

### 6.7 Portal Fleet Mirror

Phase 6.7 brought the fleet view into the customer portal.

Key surfaces:

- `PortalFleetPage`
- `PortalFleetMapPage`

What this delivered:

- customer-facing fleet visibility
- parity between internal fleet awareness and portal-safe fleet awareness
- a more useful portal that reflects real equipment context rather than static account info

How it works:

- portal routes render a constrained, customer-safe mirror of internal equipment/fleet state
- the same fleet concepts are used internally and externally, but the data scope is narrowed for customer visibility

### 6.8 Data Quality Layer

Phase 6.8 made bad data visible, classified, and actionable.

Key foundations:

- `164_data_quality_audit.sql`
- `176_dq_expansion_and_duplicate_finder.sql`
- `DataQualityPage`
- later data-quality migrations and supporting logic

What this delivered:

- a formal data quality layer instead of ad hoc cleanup
- issue classes for operational data gaps and drift
- pages and cross-links that turn bad data into resolvable work

How it works:

- database audit logic computes issue classes
- admin pages surface those issues in one place
- issue-specific links take users directly to the record or workflow needed to fix the underlying problem

### 6.9 Exception Inbox

Phase 6.9 shipped the unified human work queue.

Key foundation:

- `165_exception_inbox.sql`
- `ExceptionInboxPage`

What this delivered:

- one inbox for things the system cannot safely auto-resolve
- a generic surface reused by multiple later systems
- a single human-triage mechanism instead of parallel issue queues

How it works:

- system failures, blockers, and escalation-worthy events are inserted into `exception_queue`
- the UI renders them as actionable human work
- later systems, including analytics alerts and workflow dead letters, reuse this same queue instead of inventing new inboxes

### 6.10 Executive Command Center

Phase 6.10 shipped the owner-grade operating layer.

Key surfaces and functions:

- `/exec` owner route
- `ExecCommandCenterPage`
- `analytics-snapshot-runner`
- `analytics-alert-evaluator`
- `exec-summary-generator`
- `exec-packet-generator`
- `morning-briefing`
- related migrations `166`, `187`, `188`, `189`, `190`, `191`, `192`, `193`

What this delivered:

- CEO/CFO/COO operating views
- KPI snapshots and threshold-driven alerts
- executive summaries and exportable packets
- drill paths from high-level metrics into the underlying operational causes

How it works:

- materialized views and snapshot tables provide fast, immutable KPI reads
- analytics refresh functions compute the metrics on a schedule
- alert evaluation writes blockers into `exception_queue`
- the owner-facing UI reads snapshots, alerts, and drill contracts rather than doing large raw-table reads in the browser

What made it important:

- this is the layer that gave leadership a single operational cockpit
- it connected finance, revenue, execution, and risk into one route
- it established the pattern that the system should surface action, not just reporting

### 6.11 Flare

Phase 6.11 shipped in-app, context-aware bug and idea capture.

Key surfaces and functions:

- hotkeys: `⌘+⇧+B` for bug, `⌘+⇧+I` for idea
- `apps/web/src/lib/flare/`
- `supabase/functions/flare-submit/`
- `supabase/functions/flare-notify-fixed/index.ts`
- `FlareAdminPage`
- `FlareDetailDrawer`
- migrations `185_flare_reports.sql` and `186_flare_storage_bucket_and_aha.sql`

What this delivered:

- in-app reporting with screenshot, DOM, event trail, route trail, console trail, and performance context
- fan-out to Supabase, Linear, Slack, Paperclip, blocker email, analytics alerts, and exception queue
- offline queueing and replay
- admin triage UI
- close-the-loop notification when a report is fixed

How it works:

- client capture layer records click, network, route, console, and perf context
- screenshot and DOM are captured client-side
- the submit edge function stores the flare and fans it out to the configured systems
- blockers route into `exception_queue`
- idea-mode flares can cross-write into the idea backlog
- fix notifications route back to the reporter and the relevant system threads

Why it matters:

- it turned bug reporting from vague text into reproducible operational evidence
- it made product/ops quality issues visible in the same system as the work

### 6.11 v1 Flow Engine

Also under the Phase 6.11 umbrella, the Flow Engine shipped the internal automation fabric.

Key surfaces and functions:

- `flow-runner`
- `flow-synthesize`
- `/admin/flow`
- migrations `194`, `195`, `196`

What this delivered:

- internal event-driven workflows
- idempotent action chains
- workflow approvals
- dead-letter handling through the same exception queue already used elsewhere

How it works:

- workflow definitions live as typed code
- the runner matches pending events to workflow definitions
- actions execute through a registry with retry and idempotency
- failures dead-letter into `exception_queue`
- owners/admins can review definitions, runs, and approvals from `/admin/flow`

Why it matters:

- this turned the app from a read/write system into an orchestration system
- it established the automation substrate later waves can build on

## How Phase 6 Works as One System

The important thing about Phase 6 is not any single page. It is the way the parts reinforce each other.

### Shared operating loop

1. A user works inside a contextual surface like Account 360, Asset 360, Service, Fleet, or Portal Fleet.
2. Shared primitives keep the views coherent and drillable.
3. Contextual AI helps on-record instead of from a detached assistant page.
4. Data quality issues and exceptions surface where operational drift is happening.
5. Leadership gets the aggregate version of those same system realities in `/exec`.
6. Flare captures friction and breakage in context.
7. The Flow Engine automates or routes what should happen next.

That is what Phase 6 shipped: not just pages, but an operating loop.

## Core Routes and Operator Surfaces

Notable shipped routes and surfaces in the Phase 6 lane include:

- `/fleet`
- `/portal/fleet`
- `/admin/quality`
- `/admin/exceptions`
- `/admin/exec`
- `/admin/flare`
- `/admin/flow`
- account/company detail surfaces
- equipment detail surfaces
- service operational pages
- portal fleet and portal context pages

## Backend and Database Foundations

Phase 6 shipped as both frontend surfaces and backend infrastructure.

### Database patterns introduced or expanded

- canonical state tables and views
- data quality audit tables and RPCs
- exception queue as the unified human escalation surface
- analytics snapshots, alerts, and executive packet runs
- flare reports, rate limits, storage bucket policies, dedupe RPCs
- flow workflow definitions, runs, steps, approvals, idempotency

### Edge-function patterns introduced or expanded

- scheduled analytics refresh and alert evaluation
- executive summary and packet generation
- flare ingestion and fan-out
- close-the-loop notification on fix
- workflow execution and workflow synthesis

### Architectural patterns Phase 6 locked in

- one shared exception queue instead of multiple inboxes
- reusable primitives instead of page-by-page UI invention
- snapshot-based executive reads instead of heavy direct reads
- event-driven automation with idempotent actions
- context-first AI invocation from the record the operator is already viewing

## Why Phase 6 Matters

Phase 6 is where QEP OS stopped being a set of application modules and became a real operating system.

It shipped:

- visibility
- context
- escalation
- triage
- executive oversight
- automation

It also established the product patterns that later work depends on:

- Flare context capture
- exception queue reuse
- snapshot-driven executive views
- contextual AI preload
- workflow/event orchestration

## Files and Docs That Define the Release

High-signal reference files for the Phase 6 release:

- `plans/2026-04-06-wave-5-6-reconciliation-matrix.md`
- `docs/STABILIZATION.md`
- `docs/QEP-COMPLETE-SYSTEM-REFERENCE.md`
- `WAVE-6.11-FLARE-BUILD-SPEC.md`
- `WAVE-6.11-FLARE-HANDOFF.md`

## Bottom Line

Phase 6 shipped the operational backbone of QEP OS.

It delivered:

- a shared operational UI language
- 360-degree account and equipment views
- fleet intelligence
- service-state normalization
- embedded contextual AI
- portal fleet mirroring
- a data quality layer
- a unified exception inbox
- an owner-grade executive command center
- in-app context-aware bug capture
- an internal automation engine

That combination is what made the system feel like a dealership operating system rather than a collection of separate tools.
