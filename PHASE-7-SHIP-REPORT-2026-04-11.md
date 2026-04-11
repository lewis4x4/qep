# Phase 7 Ship Report

Date: 2026-04-11  
Repo: `/Users/brianlewis/Projects/qep-knowledge-assistant`

## Overview

Phase 7 is the intelligence-and-command phase of QEP OS.

If Phase 6 made the product feel like an operating system, Phase 7 made it feel like a dealership intelligence system with a live operator companion attached to it.

Phase 7 shipped across three major lanes:

- **7A — Seam Layer + Operating Surfaces**
- **7B — The Outward Turn**
- **7C — Hidden Forces readiness and ethics gate**

It also shipped the **Wave 7 Iron Companion** as the operator-facing control layer that sits on top of the system.

## What Phase 7 Was

Phase 7 moved QEP OS from operational visibility into operating intelligence.

This phase was about:

- understanding relationships, timing, risk, and white space at the account level
- exposing branch, territory, machine, and workflow realities in dedicated command surfaces
- making AI usable as an in-product operator companion instead of a detached chat idea
- turning dealership memory, workflow friction, and competitive pressure into visible, routeable work
- creating a governance boundary for the more sensitive “hidden forces” ideas before they are allowed to ship

In short: Phase 7 is where the system stopped only tracking dealership work and started modeling how the dealership actually wins, loses, stalls, hands off, and grows.

## Phase 7 Structure

The roadmap defines Phase 7 in three sub-phases:

### 7A — Seam Layer + Operating Surfaces

This is the inside-the-dealership layer:

- handoffs
- time and pressure
- account / branch / territory command
- machine lifecycle
- exceptions
- workflow audit
- operational intelligence surfaces

### 7B — The Outward Turn

This is the customer-and-market intelligence layer:

- customer genome
- operating profile
- fleet intelligence
- relationship map
- white-space capture
- deal coaching
- branch chief / strategist / ops copilot
- replacement prediction
- seasonality
- reputation
- ecosystem context
- decision cycle and cash rhythm

### 7C — Hidden Forces

This is the sensitive inference layer.

In repo truth, Phase 7 shipped the **entry check, evidence model, and ethics gate** for 7C. The actual hidden-forces slices are governed and constrained rather than opened recklessly.

That distinction matters:

- **7A and 7B are implemented as operating surfaces**
- **7C shipped as governance, readiness, and ethical boundary control**

## What Shipped

## Wave 7 Iron Companion

The most important operator-facing deliverable in Phase 7 is **Iron**.

Iron is not a generic chatbot. It is the operator companion layer for QEP OS.

### What shipped

Frontend shell and UX:

- `apps/web/src/lib/iron/IronShell.tsx`
- `apps/web/src/lib/iron/IronCorner.tsx`
- `apps/web/src/lib/iron/IronAvatar.tsx`
- `apps/web/src/lib/iron/IronBar.tsx`
- `apps/web/src/lib/iron/FlowEngineUI.tsx`
- `apps/web/src/lib/iron/IronUndoToast.tsx`
- `apps/web/src/lib/iron/IronGlobalSubscribers.tsx`
- `apps/web/src/lib/iron/useIronKnowledgeStream.ts`
- `apps/web/src/lib/iron/voice/*`

Backend and orchestration:

- `supabase/functions/iron-orchestrator/index.ts`
- `supabase/functions/iron-knowledge/index.ts`
- `supabase/functions/iron-execute-flow-step/index.ts`
- `supabase/functions/iron-undo-flow-run/index.ts`
- `supabase/functions/iron-transcribe/index.ts`
- `supabase/functions/iron-tts/index.ts`
- `supabase/functions/iron-pattern-mining/index.ts`
- `supabase/functions/iron-redteam-nightly/index.ts`

Supporting documentation/spec:

- `WAVE-7-IRON-COMPANION-BUILD-SPEC.md`
- `WAVE-7-IRON-COMPANION-BUILD-SPEC-v2.md`
- `docs/iron-slos.md`

### What Iron is

Iron is the dealership’s operator companion:

- summonable from the app shell
- aware of the user’s role and workspace
- able to answer read-only questions with sources
- able to dispatch into flows
- able to keep memory, usage, and safety rails

### How it works

At the app layer:

- `App.tsx` mounts `IronShell` inside the authenticated tree
- `IronShell` mounts the avatar, bar, flow UI, and undo surface once for the whole application
- the avatar/presence layer reflects state like idle, thinking, speaking, listening, and alert

At the orchestration layer:

- `iron-orchestrator` is the entry point for user text/voice
- it authenticates the user
- resolves workspace from `profiles.active_workspace_id`
- applies a cost ladder using `iron_usage_counters`
- loads Iron-eligible flows from `flow_workflow_definitions`
- classifies the interaction with Anthropic using structured input
- validates and guards the classifier output
- enforces flow allowlists and server-side role checks
- redacts PII before persistence
- returns either a flow dispatch, a read-answer path, or an agentic/escalation result

At the knowledge layer:

- `iron-knowledge` is the sourced answer path
- it runs a multi-tool loop rather than a simple one-shot prompt
- it can query internal data and knowledge sources
- it streams results back into the bar

At the control layer:

- `iron-execute-flow-step` performs server-side step execution
- `iron-undo-flow-run` supports the undo model after successful actions
- `iron-pattern-mining` and `iron-redteam-nightly` support quality, suggestion mining, and regression defense

### Why Iron matters

Iron is the unifying user interface for the intelligence system built in Phase 7.

Instead of forcing users to hunt through surfaces, Iron gives the app a single operational companion that can:

- answer
- guide
- route
- confirm
- undo

That is a foundational product shift.

## 7A — Seam Layer + Operating Surfaces

7A is the lane that made internal dealership seams visible and actionable.

### Core shipped surfaces

From the roadmap and route inventory, the shipped 7A surface set includes:

- `TimeBankPage`
- `AccountCommandCenterPage`
- `BranchCommandCenterPage`
- `TerritoryCommandCenterPage`
- `MobileFieldCommandPage`
- `VisitIntelligencePage`
- `TradeWalkaroundPage`
- `LifecyclePage`
- `InventoryPressureBoardPage`
- `IronInMotionRegisterPage`
- `RentalCommandCenterPage`
- `ServiceToSalesPage`
- `PartsIntelligencePage`
- `ExceptionHandlingPage`
- `OpportunityMapPage`
- `RevenueRescueCenterPage`
- `CompetitiveDisplacementCenterPage`
- `OperatorIntelligencePage`
- `PostSaleExperienceCenterPage`
- `WorkflowAuditPage`
- `SopFolkWorkflowPage`
- `RepRealityReflectionPage`

### What 7A delivered

7A delivered operating surfaces for the dealership’s internal seams:

- where work gets blocked
- where handoffs fail
- where time disappears
- where machines decay outside the yard
- where workflow drift becomes invisible
- where reps need private reflection
- where exceptions need to become first-class operational objects

### Notable 7A themes

#### Time and seam awareness

- **Time Bank** makes time balance visible by deal/account/rep
- **Handoff Trust** logic and related surfaces make cross-role seams measurable
- the system starts treating time, attention, and handoff quality as real operating resources

#### Command-center architecture

The command-center family in Phase 7 gives the same dealership reality multiple scopes:

- account
- branch
- territory

The shared backend for this is centered around:

- `supabase/functions/qrm-command-center/index.ts`
- `_shared/qrm-command-center/*`

That endpoint:

- composes raw signals from existing tables
- scopes by workspace and Iron role
- reads through caller-enforced security paths
- ranks and packages signals into command-center payloads

This is important because Phase 7 did not ship these pages as disconnected dashboards. It shipped a shared intelligence composition layer behind them.

#### Workflow and exception reality

7A also made internal workflow quality visible:

- **Workflow Audit** surfaces where processes break, stall, reroute, or fail silently
- **SOP + Folk Workflow** puts official process and actual behavior side by side
- **Exception Handling** turns dealership disruptions into a real operating surface

#### Machine and movement intelligence

7A made equipment movement and lifecycle more explicit:

- **Lifecycle**
- **Iron in Motion Register**
- **Inventory Pressure Board**
- **Opportunity Map**
- **Service-to-Sales**

This shifted machine intelligence from passive data to active operating context.

### Why 7A matters

7A is where the system began to understand the dealership as a set of seams, queues, handoffs, pressure points, and movement patterns instead of just records.

That is the layer required before more advanced AI surfaces can be credible.

## 7B — The Outward Turn

7B is the account, customer, and market intelligence layer.

This is where the system stops only looking inward at internal operations and starts modeling the customer, the account, the branch opportunity, and the external market context.

### Core shipped surfaces

From the roadmap, route inventory, and commit history, the shipped 7B set includes:

- `CustomerGenomePage`
- `CustomerOperatingProfilePage`
- `FleetIntelligencePage`
- `RelationshipMapPage`
- `WhiteSpaceMapPage`
- `RentalConversionEnginePage`
- `DealCoachPage`
- `BranchChiefPage`
- `CustomerStrategistPage`
- `OperationsCopilotPage`
- `ReplacementPredictionPage`
- `CompetitiveThreatMapPage`
- `SeasonalOpportunityMapPage`
- `LearningLayerPage`
- `CrossDealerMirrorPage`
- `CashflowWeatherMapPage`
- `DecisionRoomSimulatorPage`
- `DecisionCycleSynchronizerPage`
- `EcosystemLayerPage`
- `ReputationSurfacePage`
- `RepSkuPage`
- `ExitRegisterPage`
- `UnmappedTerritoryPage`

### What 7B delivered

7B delivered the outward-facing intelligence model of the dealership:

- who the customer really is
- how they buy
- what their fleet implies
- who actually decides
- where QEP is leaving revenue uncaptured
- what competitive pressure looks like by account and branch
- when replacement, seasonality, or cash rhythm create openings or risk

### Notable 7B themes

#### Customer model depth

7B made the account legible as a real business organism:

- **Customer Genome** gives a multidimensional account profile
- **Customer Operating Profile** models work type, terrain, brand preference, and buying behavior
- **Fleet Intelligence** models owned equipment, age, hours, gaps, and replacement windows
- **Relationship Map** identifies who signs, influences, blocks, and operates

That is the intelligence foundation under the later coaching and strategy surfaces.

#### Revenue and capture intelligence

Several 7B surfaces are about missed opportunity and recovery:

- **White-Space Map**
- **Rental Conversion Engine**
- **Replacement Prediction**
- **Seasonal Opportunity Map**
- **Competitive Threat Map**

These are not just descriptive. They try to answer:

- where revenue is being left behind
- which accounts are entering a window
- where a competitor is weak
- what timing matters right now

#### AI operating roles

The “AI role” surfaces are a major Phase 7 theme:

- **Deal Coach**
- **Branch Chief**
- **Customer Strategist**
- **Operations Copilot**
- **Owner Briefing** in commit history and related executive lane work

These surfaces are the product’s move from static dashboards to role-shaped intelligence.

They do not just show information. They frame decisions for a specific operator:

- a rep
- a manager
- a branch leader
- an owner

#### Decision context and external reality

The later 7B surfaces deepen external-account reasoning:

- **Cross-Dealer Mirror**
- **Cashflow Weather Map**
- **Decision Room Simulator**
- **Decision Cycle Synchronizer**
- **Ecosystem Layer**
- **Reputation Surface**
- **Rep as SKU**
- **Exit Register**
- **Unmapped Territory**

These are the more ambitious outward-turn surfaces. They attempt to model:

- what the customer experiences elsewhere
- how money moves through the account
- how decisions get made
- who else shapes the decision
- what the dealership is not seeing

### Why 7B matters

7B is where QEP OS starts behaving like a strategic intelligence layer, not just an internal CRM/service system.

It gives the dealership a model of:

- the customer
- the fleet
- the account power structure
- the market context
- the opportunity timing

That is the difference between “we have records” and “we understand the account.”

## 7C — Hidden Forces Readiness and Ethics Gate

7C is intentionally different from 7A and 7B.

In repo truth, what shipped for 7C is the governance and readiness layer, not an unrestricted rollout of sensitive inference surfaces.

### What shipped

Key governance artifacts:

- `docs/operations/7c-entry-check.md`
- `docs/operations/7c1-trust-thermostat-ethics-review.md`
- `docs/operations/7c-entry-check-2026-04-11.md` (referenced by the entry check doc)
- recent commits:
  - `dfc0468` Document the ethics gate before opening hidden-forces work
  - `21423e9` Record the blocked ethics decision before opening hidden-forces work
  - `563c029` Make the 7C entry condition executable instead of implicit
  - `2a51df6` Record the current 7C gate result instead of guessing at readiness
  - `fc7e226` Let the 7C gate write its own evidence note
  - `099958d` Point the ethics gate at the executable 7C readiness check
  - `c6a5353` Standardize the slice-level ethics review workflow for 7C

### What that means

Phase 7 shipped a real boundary around hidden-forces work.

The repo explicitly records:

- 7B must be signed off
- honesty calibration must have a full fiscal year of evidence
- the owner must make an explicit decision before opening 7C slices
- sensitive slices like **Trust Thermostat** remain blocked until those conditions are met

### Current 7C state

The current repo state says:

- 7C entry is not open for full implementation
- 7C.1 Trust Thermostat is reviewed but blocked
- the ethical limits, audience limits, trace requirements, and kill-switch are documented

That is part of what shipped.

Phase 7 did not treat advanced inference as something to casually release. It shipped the mechanism that prevents premature release.

## Additional Phase 7 Surfaces

### Iron-role dashboards

Phase 7 also includes the Iron-role dashboard family:

- `IronManagerDashboard.tsx`
- `IronAdvisorDashboard.tsx`
- `IronWomanDashboard.tsx`
- `IronManDashboard.tsx`
- `IronDashboardShell.tsx`
- role widget implementations under `apps/web/src/features/dashboards/widgets/impls/`

These matter because Phase 7 is not only about record-level intelligence. It is also about shaping the operating view around the role that uses it.

### Admin / operational governance surfaces

Phase 7 deepened admin/operator oversight with:

- `/admin/flow`
- `FlowApprovalsPanel`
- `FlowRunHistoryDrawer`
- Iron health/SLO surfacing in flow admin

This complements the public-facing Phase 7 intelligence layer by giving operators and managers visibility into the automation/control plane itself.

## How Phase 7 Works

Phase 7 works because its surfaces are connected rather than isolated.

### The model

1. The app exposes command-center, account, branch, territory, machine, and market intelligence surfaces.
2. Shared backend composition functions turn raw records into ranked, decision-oriented payloads.
3. Iron sits on top of the system as an operator companion and dispatch/control surface.
4. Workflow, prediction, and memory systems support those intelligence surfaces.
5. Governance controls prevent the most sensitive inference layers from opening before the evidence and ethics bar is met.

### The user loop

An operator can:

- land on an account, branch, or territory command surface
- see pressure, blockers, relationships, timing, and opportunity
- open Iron for contextual assistance
- drill to operational detail
- route into exception or workflow surfaces

Leadership can:

- consume owner-grade briefings and role-shaped intelligence
- inspect account, branch, and market context at a higher level
- review whether the system is healthy enough to trust

The system can:

- classify and route interactions through Iron
- compose operational payloads through command-center logic
- track flows, health, and SLOs
- enforce governance before opening sensitive hidden-forces slices

## Architectural Foundations

## Iron orchestration

The Iron pipeline is one of the key architectural pillars of Phase 7.

`iron-orchestrator` handles:

- auth
- workspace resolution
- usage and cost ladder selection
- flow allowlist loading
- classifier execution
- classifier guard/validation
- flow dispatch decisions
- PII-redacted message persistence

This matters because the operator-facing intelligence layer is not trusted blindly.

The repo explicitly enforces:

- server-side flow allowlists
- server-side role checks
- structured classifier input
- guarded classifier output
- persisted, redacted interaction history

## QRM command center composition

The command-center backend is the composition engine behind many of the 7A surfaces.

`supabase/functions/qrm-command-center/index.ts`:

- composes raw workspace signals
- scopes them by caller and Iron role
- scores and ranks them
- packages them into role-appropriate command payloads

This means the various command pages are not separate product islands. They are different views over a shared intelligence layer.

## Workflow and automation substrate

Phase 7 sits on top of the workflow/event foundation:

- `flow-runner`
- `flow-synthesize`
- `_shared/flow-engine/*`
- `_shared/flow-bus/*`
- `_shared/flow-workflows/*`

This matters because many Phase 7 surfaces are not merely explanatory. They are supposed to point into action, escalation, or automation.

## SLO / health discipline

Phase 7 also introduced explicit operational health thinking for Iron.

`docs/iron-slos.md` defines targets for:

- classify latency
- execute latency
- undo success
- dead-letter rate
- cost-cap escalation rate

That is part of Phase 7’s maturity. It did not only ship AI surfaces. It shipped a production-health contract for them.

## Why Phase 7 Matters

Phase 7 is the phase where QEP OS becomes opinionated about how the dealership works.

Phase 6 gave the product operating surfaces.

Phase 7 gave it:

- account intelligence
- role-shaped command
- relationship modeling
- market positioning
- machine and replacement timing intelligence
- AI companion control
- workflow and seam awareness
- ethics gates for sensitive inference

That is a different category of product.

It is not just software that stores dealership work. It is software that tries to understand dealership motion, pressure, timing, and opportunity.

## Canonical Files for the Release

High-signal Phase 7 reference files:

- `QEP-OS-Master-Roadmap.md`
- `WAVE-7-IRON-COMPANION-BUILD-SPEC.md`
- `WAVE-7-IRON-COMPANION-BUILD-SPEC-v2.md`
- `docs/iron-slos.md`
- `supabase/functions/iron-orchestrator/index.ts`
- `supabase/functions/qrm-command-center/index.ts`
- `docs/operations/7c-entry-check.md`
- `docs/operations/7c1-trust-thermostat-ethics-review.md`

## Bottom Line

Phase 7 shipped the intelligence phase of QEP OS.

It delivered:

- Iron as the operator companion
- seam-aware operational command surfaces
- outward-turn account and market intelligence
- role-specific intelligence pages
- branch/account/territory command centers
- workflow and exception visibility
- learning, timing, replacement, and relationship intelligence
- a real ethics/readiness gate for the hidden-forces lane

That is what makes Phase 7 more than a feature wave.

It is the phase where the product starts acting like a dealership intelligence system with an operator companion attached to it.
