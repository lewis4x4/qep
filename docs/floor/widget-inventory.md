# The Floor — Widget Inventory

**Purpose:** Catalog every widget that can appear on The Floor, grouped by category and role. **Ruthlessly constrained:** each role gets a curated list of 3–6 widgets, not a firehose. This file is the source of truth for F-0.

**Mission rule (non-negotiable):** Default = empty. Hard cap = 6. No widget earns its slot until Brian places it.

---

## 1. What's already registered (`features/dashboards/widgets/registry.ts`)

Fourteen widgets exist today. The Floor reuses the same registry — we do NOT fork it. Simplification is per-role composition, not per-widget rewrite.

| id | Title | Module | Allowed roles (existing) | Floor fit |
|---|---|---|---|---|
| `iron.pipeline-by-rep` | Pipeline by advisor | iron | iron_manager | ✅ Sales Manager |
| `iron.approval-queue` | Approvals waiting | iron | iron_manager, iron_woman | ✅ Sales Manager, Deal Desk |
| `iron.inventory-aging` | Aging fleet | iron | iron_manager, iron_woman | ✅ Sales Manager, Owner |
| `qrm.advisor-brief` | SLA + new leads | qrm | iron_advisor | ✅ Sales Rep |
| `qrm.follow-up-queue` | Follow-up queue | qrm | iron_advisor | ✅ Sales Rep |
| `qrm.prospecting-counter` | Prospecting target | qrm | iron_advisor | 🟡 Sales Rep (optional — ego meter) |
| `iron.order-processing` | Order processing | iron | iron_woman, iron_manager | ✅ Deal Desk |
| `iron.deposit-tracker` | Deposit tracker | iron | iron_woman, iron_manager | ✅ Deal Desk |
| `iron.intake-progress` | Equipment intake progress | iron | iron_woman, iron_man, iron_manager | ✅ Deal Desk, Prep Tech |
| `iron.credit-applications` | Credit applications | iron | iron_woman, iron_manager | ✅ Deal Desk |
| `iron.prep-queue` | Prep queue | iron | iron_man, iron_woman, iron_manager | ✅ Prep Tech |
| `iron.pdi-checklists` | PDI checklists | iron | iron_man, iron_manager | ✅ Prep Tech |
| `iron.demo-schedule` | Demo schedule | iron | iron_man, iron_advisor, iron_manager | ✅ Sales Rep, Prep Tech |
| `iron.return-inspections` | Return inspections | iron | iron_man, iron_woman, iron_manager | ✅ Prep Tech |
| `parts.replenish-queue` | Parts replenishment queue | parts | ALL | ✅ Parts Counter, Parts Manager |

## 2. Registered direct wraps (existing components)

These components already exist and are registered through typed Floor descriptors. Entries marked "Floor adapter" use a zero-prop wrapper to provide the source component's required props and live data.

| Proposed id | Wraps (existing component) | Category | Roles |
|---|---|---|---|
| `sales.ai-briefing` | `features/sales/components/AiBriefingCard.tsx` via Floor adapter | sales | iron_advisor |
| `sales.day-summary` | `features/sales/components/DaySummaryCard.tsx` via Floor adapter | sales | iron_advisor |
| `sales.action-items` | Floor-native action list over follow-up touchpoints | sales | iron_advisor |
| `quote.win-probability-compact` | `features/quote-builder/components/WinProbabilityStrip.tsx` (compact variant) | sales | iron_advisor, iron_manager |
| `quote.deal-copilot-summary` | Slice 21 Deal Copilot summary card (new thin wrapper) | sales | iron_advisor, iron_manager |
| `nervous.customer-health` | `features/nervous-system/components/CustomerHealthScore.tsx` | cross | iron_manager, iron_owner |
| `parts.demand-forecast` | `features/parts/components/DemandForecastCard.tsx` | parts | iron_parts_manager, iron_manager |
| `parts.inventory-health` | `features/parts/components/InventoryHealthCard.tsx` | parts | iron_parts_manager |
| `parts.order-status` | `features/parts/components/OrderStatusBadge.tsx` (compact list) | parts | iron_parts_counter, iron_parts_manager |
| `parts.customer-intel` | `features/parts/components/CustomerPartsIntelCard.tsx` | parts | iron_parts_counter, iron_parts_manager |
| `service.parts-hub-strip` | `features/service/components/ServicePartsHubStrip.tsx` via Floor adapter | service | iron_man, iron_manager |
| `service.job-card` | `features/service/components/ServiceJobCard.tsx` (list variant) | service | iron_man |
| `exec.morning-brief` | `features/dashboards/components/AdvisorMorningBriefingCard.tsx` | cross | iron_advisor, iron_manager, iron_owner |
| `exec.owner-brief` | `features/owner/components/OwnerBriefCard.tsx` | cross | iron_owner |
| `qrm.decision-room-scoreboard` | `features/qrm/components/DecisionRoomScoreboard.tsx` via Floor adapter | sales | iron_manager, iron_advisor |

## 3. Widgets that still need NEW component builds (human-gated)

These are called out in the QEP handoff but don't exist yet. Do NOT block F-1/F-2 on these — land the shell first.

| Proposed id | Component to build | Category | Role | Handoff ref |
|---|---|---|---|---|
| `sales.commission-to-date` | Final commission ledger/RPC | sales | iron_advisor, iron_manager | QA-R2, fly-on-the-wall |
| `sales.quote-drafts` | `MyQuoteDraftsCard.tsx` | sales | iron_advisor | C8 |
| `parts.lost-sales` | Reason-code logging flow | parts | iron_parts_manager | QA-N1 |
| `reports.first-five` | `FirstFiveReportsCard.tsx` | cross | iron_manager, iron_owner | QA-R3 |

## 4. Role model extensions needed

Current iron roles: `iron_manager`, `iron_advisor`, `iron_woman`, `iron_man`. QEP team mapping:

| QEP person | QEP title | Existing iron role | Fit |
|---|---|---|---|
| Rylee McKenzie | Sales & Marketing Manager | iron_manager | ✅ direct |
| Ryan McKenzie | Owner | — | ❌ need `iron_owner` |
| Juan | Parts counter | — | ❌ need `iron_parts_counter` |
| Norman | Parts manager | — | ❌ need `iron_parts_manager` |
| David | Sales rep | iron_advisor | ✅ direct |
| Angela | Sales admin / compliance | iron_woman | 🟡 approximate |
| Tina | Finance | iron_woman | ✅ direct |
| Service writer | TBD | iron_woman | 🟡 approximate |
| Technician | TBD | iron_man | ✅ direct |

**Proposal:** Extend `IronRole` type with three additions in F-1 so the Floor can serve every role on the QEP team from day one:

```ts
export type IronRole =
  | "iron_manager"
  | "iron_advisor"
  | "iron_woman"
  | "iron_man"
  | "iron_owner"         // NEW — Ryan
  | "iron_parts_counter" // NEW — Juan, Bobby
  | "iron_parts_manager" // NEW — Norman
```

## 5. Recommended starting layouts (≤ 6 widgets each)

This is the curated v1 per-role Floor. Brian can edit anything the day he signs in.

### iron_owner (Ryan) — "What went down today"
1. `exec.owner-brief` (hero)
2. `nervous.customer-health` (list of at-risk customers)
3. `iron.inventory-aging` (aging fleet)
4. `iron.approval-queue` (approvals I need to make)

**Quick actions:** "Ask Iron" (executive chat), "Open Pipeline"

### iron_manager (Rylee) — "What I approve, what's stale"
1. `exec.morning-brief` (one line)
2. `iron.approval-queue` (hero — the biggest driver)
3. `iron.pipeline-by-rep`
4. `sales.commission-to-date` *(real closed-quote source; final commission math gated by QA-R2)*
5. `qrm.decision-room-scoreboard`
6. `iron.inventory-aging`

**Quick actions:** "Open approval queue", "New quote"

### iron_advisor (David) — "Mobile-first, what to do today"
1. `sales.ai-briefing` (hero)
2. `sales.action-items`
3. `qrm.follow-up-queue`
4. `sales.day-summary`
5. `quote.deal-copilot-summary`

**Quick actions:** "New quote", "Voice capture", "Log visit"

### iron_parts_counter (Juan) — "Serial, quote, done"
1. `parts.serial-first`
2. `parts.quote-drafts`
3. `parts.order-status` (today's orders)
4. `parts.customer-intel`
5. `parts.replenish-queue`

**Quick actions:** "New parts quote", "Lookup by serial", "Open drafts"

### iron_parts_manager (Norman) — "Stock health"
1. `parts.demand-forecast` (hero)
2. `parts.inventory-health`
3. `parts.replenish-queue`
4. `parts.order-status`
5. `iron.inventory-aging` (equipment side, for cross-dept context)

**Quick actions:** "Review replenishments", "Stock variance"

### iron_woman (Angela, Tina) — "Orders, deposits, credit"
1. `iron.order-processing` (hero)
2. `iron.deposit-tracker`
3. `iron.credit-applications`
4. `iron.intake-progress`
5. `iron.approval-queue`

**Quick actions:** "New credit app", "Deposit entry"

### iron_man (Service/Prep) — "Today's work"
1. `iron.prep-queue` (hero)
2. `iron.pdi-checklists`
3. `iron.demo-schedule`
4. `iron.return-inspections`
5. `service.parts-hub-strip`

**Quick actions:** "Next job", "PDI checklist"

## 6. Widgets intentionally NOT on The Floor (v1)

Density-trap widgets that exist in the codebase but we keep off The Floor in v1 because they belong on dedicated pages, not a landing surface:

- Every `*Banner` component — surface-level UI, not first-class
- `features/qrm/components/DraggableDealCard.tsx` — kanban primitive, not standalone
- `features/exec/components/AlertsInboxPanel.tsx` — lives on alerts page
- `features/dge/components/DgeIntelligencePanel.tsx` — dedicated DGE page
- `features/qrm/components/QrmCompanyHierarchyCard.tsx` — lives on company detail
- `features/oem-portals/components/CredentialCard.tsx` — admin-only, rare

These stay accessible through the existing routes; they don't land on role Floors.

## 7. What this inventory enables

- F-1 migration knows the 6-widget hard cap is realistic (max role above has 6).
- F-2 /floor shell renders at most 6 cards + 1 narrative + 2-3 quick actions — **fixed size**. No infinite scroll. No density creep.
- F-3 composer palette knows which widgets each role is allowed to see (from existing `allowedRoles` field).
- Role model extension in F-1 (+3 Iron roles) means every QEP team member can log in to a Floor built for them on day one.

---

**Next:** `docs/floor/visual-language.md` pins down the charcoal + orange + Bebas Neue execution target so F-2 shell is unambiguous.
