# QEP OS — CRM/QRM Status Report

**Prepared for:** QEP Ownership
**Date:** April 9, 2026
**Prepared by:** Brian Lewis, Engineering Lead

---

## Executive Summary

The QEP CRM (internally called QRM — Quote Relationship Manager) is a purpose-built CRM system designed to replace HubSpot. It is **approximately 70% complete** for a full go-live cutover. The foundation is production-grade and already exceeds HubSpot in several critical areas: voice-driven deal capture, AI deal scoring, equipment/fleet management, and automated follow-up sequences.

**What works today:** Pipeline management, deal tracking, contact/company management, voice-to-CRM, needs assessment, equipment management, follow-up automation, quote building, and the AI command center.

**What's needed before go-live:** "New Deal" button on the pipeline, quote PDF generation, email sending integration, and CSV export.

**Estimated time to close go-live gaps:** 2-3 weeks of focused engineering.

---

## What Has Been Built

### 22 Production Pages

| # | Page | Route | What It Does |
|---|------|-------|-------------|
| 1 | **Pipeline Board** | `/qrm/deals` | Kanban swim-lane view of all deals. Drag-and-drop between stages. Table view toggle. Stage filtering. |
| 2 | **Deal Detail** | `/qrm/deals/:id` | Full deal view: activity timeline, equipment, needs assessment, cadence, demos, DGE scenarios, deposits. |
| 3 | **Contacts List** | `/qrm/contacts` | Searchable contact directory with inline creation. |
| 4 | **Contact Detail** | `/qrm/contacts/:id` | Contact profile with activity timeline, signals, custom fields, company links. |
| 5 | **Companies List** | `/qrm/companies` | Company directory with search and inline creation. |
| 6 | **Company Detail** | `/qrm/companies/:id` | Account 360: equipment fleet, hierarchy, activities, lifecycle, next best actions. |
| 7 | **Activities Feed** | `/qrm/activities` | All CRM activities (calls, emails, tasks, notes, meetings) in a searchable feed. |
| 8 | **Equipment Detail** | `/qrm/equipment/:id` | Asset page: specs, pricing, service history, readiness status. |
| 9 | **Fleet Radar** | `/qrm/companies/:id/fleet-radar` | Equipment fleet analysis: aging, trade-up opportunities, underutilized assets. |
| 10 | **Customer Lifecycle** | `/qrm/companies/:id/lifecycle` | Timeline from first contact through purchase, service, and retention. |
| 11 | **Quote Builder v2** | `/quote-v2` | Multi-mode quote creation (voice, AI chat, manual). Equipment selection, financing, margins, taxes. |
| 12 | **Voice Capture** | `/voice-qrm` | Record a field call. AI extracts deal data, contacts, equipment, and creates CRM records automatically. |
| 13 | **QRM Command Center** | `/qrm` | AI-powered operating dashboard with 9 intelligence sections and role-variant layouts. |
| 14 | **Quote Velocity Center** | `/qrm/command/quotes` | Quote aging, conversion rates, status distribution, and deal-linked quote table. |
| 15 | **Approval Center** | `/qrm/command/approvals` | One-click approve/deny for margins, deposits, trades, and demos. Manager-gated. |
| 16 | **Blocker Board** | `/qrm/command/blockers` | Every deal blocked from progression, grouped by type, with resolve buttons. |
| 17 | **AI Prediction Trace** | `/qrm/command/trace/:id` | Explainability view: why the AI ranked a deal the way it did. |
| 18 | **Idea Backlog** | `/qrm/ideas` | Ideas captured from voice, text, meetings — tracked and prioritized. |
| 19 | **Activity Templates** | `/admin/templates` | Create and manage reusable activity templates for reps. |
| 20 | **Follow-Up Sequences** | `/admin/sequences` | Build automated follow-up cadences triggered by deal stage entry. |
| 21 | **Duplicate Resolution** | `/admin/duplicates` | Detect and merge duplicate company records with undo support. |
| 22 | **Email Draft Inbox** | `/email-drafts` | AI-generated email drafts for budget cycle, price increase, requote, trade-up scenarios. |

### 57 Purpose-Built Components

**Pipeline & Deals (14 components)**

| Component | Purpose |
|-----------|---------|
| PipelineSwimLanesBoard | Drag-and-drop Kanban board with stage columns |
| DraggableDealCard | Deal card that can be dragged between stages |
| DroppableStageColumn | Stage column that accepts dropped deals |
| PipelineDealCard | Deal card showing amount, stage, signals, and actions |
| PipelineDealTableRow | Table row view of a deal with quick actions |
| PipelineDealsTableView | Full table view alternative to Kanban |
| PipelineFiltersBar | Stage, urgency, and saved filter controls |
| PipelineManagerSummary | Manager-level pipeline totals by stage |
| PipelineQueryStatus | Loading, error, and cache status indicators |
| QrmPipelineManagerMetrics | KPI display for manager pipeline oversight |
| QrmDealEditorSheet | Deal creation/edit form (stage, contact, company, amount, dates) |
| QrmDealUpdateCard | Quick deal stage update with follow-up date picker |
| QrmDealEquipmentSection | Equipment list linked to a specific deal |
| QrmDealSignalBadges | Visual badges for overdue follow-ups and stalled deals |

**Contacts & Companies (10 components)**

| Component | Purpose |
|-----------|---------|
| QrmContactEditorSheet | Contact creation/edit form with company selection |
| QrmCompanyEditorSheet | Company creation/edit form |
| QrmCompanyEquipmentSection | Equipment fleet list for a company |
| QrmCompanySubtreeEquipmentSection | Equipment across company and subsidiaries |
| QrmCompanyHierarchyCard | Parent/child company tree visualization |
| CompanyMergeDialog | UI for merging duplicate companies with preview |
| Account360Tabs | Tabbed account view: fleet, quotes, service, invoices |
| QrmTerritoryConflictBadge | Warning when contacts have overlapping territory assignments |
| QrmCustomFieldsCard | Custom field editor for any CRM record |
| QrmGlobalSearchCommand | Command palette (Cmd+K) for searching all CRM entities |

**Activities & Follow-Up (6 components)**

| Component | Purpose |
|-----------|---------|
| QrmActivityTimeline | Chronological activity feed with type icons and timestamps |
| QrmActivityComposer | Create new activities with template suggestions |
| CadenceTimeline | Visual timeline of deal follow-up touchpoints |
| FollowUpQuickActions | One-click buttons: follow up in 1, 3, 7, or 14 days |
| SlaCountdown | Stage SLA countdown timer |
| ProspectingKpiCounter | Daily visit count vs. target tracker |

**Command Center Intelligence (13 components)**

| Component | Purpose |
|-----------|---------|
| RoleVariantShell | Orchestrates all sections based on Iron role |
| CommandStrip | Top KPI bar: closable revenue, at-risk, blocked, overdue |
| AiChiefOfStaff | AI hero cards: best move, biggest risk, fastest path |
| ActionLanes | Three-column priority lanes: Ready, At Risk, Blockers |
| RecommendationCard | Individual AI recommendation with accept/dismiss/snooze |
| PipelinePressureMap | Stage-by-stage health visualization with risk states |
| RevenueRealityBoard | Financial truth: DGE-blended weighted revenue, blocker breakdown |
| DealerRealityGrid | 6-tile operational radar (Quotes, Trades, Demos, Traffic, Rentals, Service) |
| RelationshipEngine | 5 signal streams: heating up, cooling off, competitor rising, fleet replacement, silent accounts |
| KnowledgeGapsEngine | Manager-only: unanswered questions + per-rep data completeness |
| ExecutiveIntelLayer | Manager-only: forecast confidence, rep performance, margin pressure, branch health |
| ScopeSwitcher | Toggle between personal and team views |
| ActionLaneCard | Compact card wrapper for lane display |

**Quote Builder (6 components)**

| Component | Purpose |
|-----------|---------|
| EquipmentSelector | Catalog search with AI recommendation integration |
| FinancingCalculator | Term/rate/payment scenario calculator |
| MarginCheckBanner | Margin health indicator (red <10%, green >20%) |
| TaxBreakdown | Multi-jurisdiction tax calculation display |
| IncentiveStack | Applied manufacturer incentives with toggle controls |
| TradeInSection | Trade-in valuation lookup and display |

**Supporting (8 components)**

| Component | Purpose |
|-----------|---------|
| QrmSubNav | Secondary navigation bar for QRM section |
| QrmPageHeader | Page header with HubSpot sync status |
| QrmVoiceCaptureSignalBlock | Voice capture metadata display |
| DepositGateBadge | Deposit requirement indicator |
| ARCreditBlockBanner | A/R credit hold alert banner |
| DemoRequestCard | Demo request summary for a deal |
| VoiceRecorder | Audio recording UI with upload |
| VoiceQrmSummaryCard | AI-generated voice capture summary |

---

## Where QEP QRM Exceeds HubSpot

| Capability | HubSpot | QEP QRM |
|-----------|---------|---------|
| Voice-driven deal creation | Not available | Full — record a call, AI creates the deal |
| AI deal scoring | Basic lead scoring | 14-variable Deal Genome Engine with 3 scenarios |
| Equipment/fleet management | Not available | 32-column equipment records with lifecycle tracking |
| Needs assessment | Custom form | 27-field structured assessment with completeness % |
| Deposit gate enforcement | Not available | Database-enforced — deals cannot progress without verified deposit |
| Margin check automation | Not available | Auto-flags <10% margin, routes to manager approval |
| AI command center | Not available | 9-section operating dashboard with role-variant layouts |
| Follow-up sequences | Workflows (paid tier) | Built-in cadences triggered by stage, with voice integration |

---

## What's Needed Before Go-Live

| Gap | Why It Matters | Effort | Priority |
|-----|---------------|--------|----------|
| **"New Deal" button on pipeline** | Reps need to create deals from the main pipeline view without navigating away | 1 day | Must-have |
| **Quote PDF generation** | Reps must be able to send branded proposals to customers | 2-3 days | Must-have |
| **Email sending** (Gmail/Outlook integration) | Drafts exist but cannot be sent from the system | 3-5 days | Must-have |
| **CSV export** (deals, contacts, companies) | Managers need to pull reports for meetings | 1-2 days | Should-have |
| **Advanced filter/search UI** | Power users need saved views and multi-field filtering | 2-3 days | Nice-to-have |

**Total estimated effort to go-live readiness: 2-3 weeks**

---

## Technical Foundation

| Metric | Count |
|--------|-------|
| Database migrations | 215 |
| Edge functions (serverless APIs) | 111 |
| TypeScript source files | 430 |
| Deno backend tests | 58 (command center alone) |
| CRM pages | 22 |
| CRM components | 57 |
| Supabase project | `iciddijgonywtxoelous` (production) |

---

## Recommended Go-Live Timeline

| Week | Milestone |
|------|-----------|
| **Week 1** | Close "New Deal" button + CSV export gaps |
| **Week 2** | Quote PDF generation + email integration |
| **Week 3** | Testing, HubSpot data migration rehearsal, staff training |
| **Week 4** | Go-live: disable HubSpot write access, route all CRM to QRM |

---

*This report reflects the codebase state as of April 9, 2026. The QRM system is actively under development with daily commits to the main branch.*
