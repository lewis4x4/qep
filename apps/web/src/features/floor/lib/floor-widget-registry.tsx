/**
 * Floor Widget Registry — the composition catalog for The Floor.
 *
 * Responsibilities:
 *   1. Resolve a widget id stored in `floor_layouts.layout_json` into a
 *      React component renderable on The Floor.
 *   2. Gate widget visibility by Iron role (mirrors the allowedRoles
 *      field on the base dashboard registry).
 *   3. Provide UI metadata for the composer palette (title + purpose).
 *
 * Design:
 *   - We do NOT fork the existing `features/dashboards/widgets/registry.ts`.
 *     We REFERENCE its components where the wiring is already done
 *     (aging fleet, approval queue, pipeline by rep, etc.) and add
 *     brand-compliant STUB wrappers for widgets whose real impls are
 *     still being built (commission-to-date, parts serial-first, etc.).
 *   - Stubs exist so Brian can compose a Floor today and see the
 *     shape of the final surface. They are clearly labeled `Preview`.
 *
 * Keeping both registries in play is intentional: the legacy Iron
 * dashboards keep rendering their dense grid from `WIDGET_REGISTRY`,
 * while The Floor uses `FLOOR_WIDGET_REGISTRY` for its simplified
 * composed surface.
 */
import type { ComponentType } from "react";
import type { IronRole } from "@/features/qrm/lib/iron-roles";

import {
  PipelineByRepWidget,
  ApprovalQueueWidget,
  InventoryAgingWidget,
} from "@/features/dashboards/widgets/impls/iron-manager-widgets";
import {
  AdvisorBriefWidget,
  FollowUpQueueWidget,
  ProspectingCounterWidget,
} from "@/features/dashboards/widgets/impls/iron-advisor-widgets";
import {
  OrderProcessingWidget,
  DepositTrackerWidget,
  IntakeProgressWidget,
  CreditAppsWidget,
} from "@/features/dashboards/widgets/impls/iron-woman-widgets";
import {
  PrepQueueWidget,
  PdiChecklistsWidget,
  DemoScheduleWidget,
  ReturnInspectionsWidget,
} from "@/features/dashboards/widgets/impls/iron-man-widgets";
import { PartsReplenishQueueWidget } from "@/features/dashboards/widgets/impls/parts-widgets";

import { FloorStubWidget } from "../components/FloorStubWidget";

export interface FloorWidgetDescriptor {
  id: string;
  title: string;
  /** One-sentence purpose shown in the composer palette + any stub state. */
  purpose: string;
  /** Iron roles allowed to see this widget on The Floor. The composer
   *  filters the palette by these. */
  allowedRoles: IronRole[];
  /** Default span in the responsive grid. "wide" consumes two columns on
   *  desktop; "normal" is one column. */
  size: "normal" | "wide";
  /** The component rendered inside the FloorWidget frame. Stubs are
   *  bound components (pre-filled with their title + purpose). */
  component: ComponentType;
}

/** Helper — bind the stub component so the registry entry is a plain
 *  ComponentType with no props. Keeps the grid renderer trivial. */
function stub(title: string, purpose: string, sample?: string): ComponentType {
  const StubBound = () => <FloorStubWidget title={title} purpose={purpose} sample={sample} />;
  StubBound.displayName = `FloorStub(${title})`;
  return StubBound;
}

const ALL_ROLES: IronRole[] = [
  "iron_manager",
  "iron_advisor",
  "iron_woman",
  "iron_man",
  "iron_owner",
  "iron_parts_counter",
  "iron_parts_manager",
];

export const FLOOR_WIDGET_REGISTRY: Record<string, FloorWidgetDescriptor> = {
  // ── Existing real widgets (re-used from legacy registry) ─────────────
  "iron.pipeline-by-rep": {
    id: "iron.pipeline-by-rep",
    title: "Pipeline by rep",
    purpose: "Open-deal swim lanes for each advisor on your team.",
    allowedRoles: ["iron_manager", "iron_owner"],
    size: "wide",
    component: PipelineByRepWidget,
  },
  "iron.approval-queue": {
    id: "iron.approval-queue",
    title: "Approvals waiting",
    purpose: "Quotes pending your approval, sorted by age.",
    allowedRoles: ["iron_manager", "iron_woman", "iron_owner"],
    size: "normal",
    component: ApprovalQueueWidget,
  },
  "iron.inventory-aging": {
    id: "iron.inventory-aging",
    title: "Aging fleet",
    purpose: "Equipment sitting longer than your target — needs a push.",
    allowedRoles: ["iron_manager", "iron_woman", "iron_owner", "iron_parts_manager"],
    size: "normal",
    component: InventoryAgingWidget,
  },
  "qrm.advisor-brief": {
    id: "qrm.advisor-brief",
    title: "SLA + new leads",
    purpose: "15-minute lead-response SLA status and today's new leads.",
    allowedRoles: ["iron_advisor"],
    size: "normal",
    component: AdvisorBriefWidget,
  },
  "qrm.follow-up-queue": {
    id: "qrm.follow-up-queue",
    title: "Follow-up queue",
    purpose: "Customers due for a touch today based on sales cadence.",
    allowedRoles: ["iron_advisor"],
    size: "normal",
    component: FollowUpQueueWidget,
  },
  "qrm.prospecting-counter": {
    id: "qrm.prospecting-counter",
    title: "Prospecting target",
    purpose: "Your daily visit target versus what you've logged.",
    allowedRoles: ["iron_advisor"],
    size: "normal",
    component: ProspectingCounterWidget,
  },
  "iron.order-processing": {
    id: "iron.order-processing",
    title: "Order processing",
    purpose: "Open order tickets working through processing.",
    allowedRoles: ["iron_woman", "iron_manager"],
    size: "normal",
    component: OrderProcessingWidget,
  },
  "iron.deposit-tracker": {
    id: "iron.deposit-tracker",
    title: "Deposit tracker",
    purpose: "Deposits expected vs. received on open deals.",
    allowedRoles: ["iron_woman", "iron_manager"],
    size: "normal",
    component: DepositTrackerWidget,
  },
  "iron.intake-progress": {
    id: "iron.intake-progress",
    title: "Intake progress",
    purpose: "Equipment intake status and PDI handoff readiness.",
    allowedRoles: ["iron_woman", "iron_man", "iron_manager"],
    size: "normal",
    component: IntakeProgressWidget,
  },
  "iron.credit-applications": {
    id: "iron.credit-applications",
    title: "Credit applications",
    purpose: "Open credit apps and their stage in the underwriting flow.",
    allowedRoles: ["iron_woman", "iron_manager"],
    size: "normal",
    component: CreditAppsWidget,
  },
  "iron.prep-queue": {
    id: "iron.prep-queue",
    title: "Prep queue",
    purpose: "Units awaiting PDI + delivery prep, ordered by demo date.",
    allowedRoles: ["iron_man", "iron_woman", "iron_manager"],
    size: "normal",
    component: PrepQueueWidget,
  },
  "iron.pdi-checklists": {
    id: "iron.pdi-checklists",
    title: "PDI checklists",
    purpose: "In-flight PDI checklists and blockers per unit.",
    allowedRoles: ["iron_man", "iron_manager"],
    size: "normal",
    component: PdiChecklistsWidget,
  },
  "iron.demo-schedule": {
    id: "iron.demo-schedule",
    title: "Demo schedule",
    purpose: "Demos on the calendar and prep status for each.",
    allowedRoles: ["iron_man", "iron_advisor", "iron_manager"],
    size: "normal",
    component: DemoScheduleWidget,
  },
  "iron.return-inspections": {
    id: "iron.return-inspections",
    title: "Return inspections",
    purpose: "Rental returns due for inspection and valuation.",
    allowedRoles: ["iron_man", "iron_woman", "iron_manager"],
    size: "normal",
    component: ReturnInspectionsWidget,
  },
  "parts.replenish-queue": {
    id: "parts.replenish-queue",
    title: "Parts replenishment",
    purpose: "Parts suggested for reorder based on demand + stock.",
    allowedRoles: ALL_ROLES,
    size: "normal",
    component: PartsReplenishQueueWidget,
  },

  // ── Stubs — widgets Brian can compose today; real impl lands later ──
  "exec.owner-brief": {
    id: "exec.owner-brief",
    title: "Owner brief",
    purpose: "The one-page read of the business for the owner.",
    allowedRoles: ["iron_owner", "iron_manager"],
    size: "wide",
    component: stub(
      "Owner brief",
      "Today's business at a glance — revenue pace, stale deals, risks.",
      "Sample: $412K pipeline · 3 blockers · 1 at-risk customer",
    ),
  },
  "exec.morning-brief": {
    id: "exec.morning-brief",
    title: "Morning brief",
    purpose: "Overnight signal summary for your pipeline.",
    allowedRoles: ["iron_advisor", "iron_manager", "iron_owner"],
    size: "wide",
    component: stub(
      "Morning brief",
      "Overnight changes across your pipeline surfaced as actions.",
      "Sample: 2 deals moved forward · 1 stale follow-up · new lead from ACME",
    ),
  },
  "nervous.customer-health": {
    id: "nervous.customer-health",
    title: "Customer health",
    purpose: "At-risk customer scores with the one signal driving each.",
    allowedRoles: ["iron_manager", "iron_owner"],
    size: "normal",
    component: stub(
      "Customer health",
      "Customers trending at-risk with a reason pinned to each drop.",
      "Sample: 4 customers below 50 · top driver: missed service windows",
    ),
  },
  "qrm.decision-room-scoreboard": {
    id: "qrm.decision-room-scoreboard",
    title: "Decision room",
    purpose: "Live deal-by-deal moves — wins, blocks, next plays.",
    allowedRoles: ["iron_manager", "iron_advisor"],
    size: "wide",
    component: stub(
      "Decision room",
      "Active deal moves across your team's pipeline.",
      "Sample: 12 plays today · 4 wins · 2 blocks to clear",
    ),
  },
  "sales.ai-briefing": {
    id: "sales.ai-briefing",
    title: "AI briefing",
    purpose: "Today's priority actions tuned to your deals.",
    allowedRoles: ["iron_advisor"],
    size: "wide",
    component: stub(
      "AI briefing",
      "Three things to do before lunch to move your pipeline.",
      "Sample: call Dave at 10 · send Whittaker re-quote · close ASV demo loop",
    ),
  },
  "sales.action-items": {
    id: "sales.action-items",
    title: "Action items",
    purpose: "Your open tasks, prioritized by deal impact.",
    allowedRoles: ["iron_advisor"],
    size: "normal",
    component: stub(
      "Action items",
      "Tasks ordered by the deal they move, not the date they were made.",
      "Sample: 5 open · 2 high-impact",
    ),
  },
  "sales.day-summary": {
    id: "sales.day-summary",
    title: "Day summary",
    purpose: "Today's visits, calls, and quotes — so far.",
    allowedRoles: ["iron_advisor"],
    size: "normal",
    component: stub(
      "Day summary",
      "Your day's activity versus target visits / calls / quotes.",
      "Sample: 6/10 visits · 14 calls · 2 quotes",
    ),
  },
  "quote.deal-copilot-summary": {
    id: "quote.deal-copilot-summary",
    title: "Deal Copilot signals",
    purpose: "Copilot-surfaced signals that moved your win probability.",
    allowedRoles: ["iron_advisor", "iron_manager"],
    size: "normal",
    component: stub(
      "Deal Copilot signals",
      "Latest copilot turns and the score deltas they produced.",
      "Sample: RT-135 @ Whittaker +8 · competitor mentioned · cash pref locked",
    ),
  },
  "sales.commission-to-date": {
    id: "sales.commission-to-date",
    title: "Commission MTD",
    purpose: "Your commission earned this month vs. pace.",
    allowedRoles: ["iron_advisor", "iron_manager"],
    size: "normal",
    component: stub(
      "Commission MTD",
      "Your month-to-date commission + in-flight pipeline commission.",
      "Sample: $14,250 booked · $8,900 in flight",
    ),
  },

  // ── Parts-focused stubs for Juan, Norman ──
  "parts.serial-first": {
    id: "parts.serial-first",
    title: "Serial-first quote",
    purpose: "Start a parts quote by typing the equipment serial number.",
    allowedRoles: ["iron_parts_counter", "iron_parts_manager"],
    size: "wide",
    component: stub(
      "Serial-first quote",
      "Type a serial and we'll match the machine + suggest compatible parts.",
      "Paste or scan a serial — we'll find the machine and owner.",
    ),
  },
  "parts.quote-drafts": {
    id: "parts.quote-drafts",
    title: "My drafts",
    purpose: "Parts quotes auto-saved and waiting for you to finish.",
    allowedRoles: ["iron_parts_counter", "iron_parts_manager"],
    size: "normal",
    component: stub(
      "My drafts",
      "Auto-saved parts quotes you can resume at any time.",
      "Sample: 3 drafts · oldest 2h ago",
    ),
  },
  "parts.order-status": {
    id: "parts.order-status",
    title: "Order status",
    purpose: "Today's parts orders and their fulfillment stage.",
    allowedRoles: ["iron_parts_counter", "iron_parts_manager"],
    size: "normal",
    component: stub(
      "Order status",
      "Orders opened today with their processing / shipped / delivered state.",
      "Sample: 8 open · 3 ready for counter pickup",
    ),
  },
  "parts.customer-intel": {
    id: "parts.customer-intel",
    title: "Customer intel",
    purpose: "Last parts + service context for the customer in front of you.",
    allowedRoles: ["iron_parts_counter", "iron_parts_manager"],
    size: "normal",
    component: stub(
      "Customer intel",
      "The customer's recent parts orders and open service tickets.",
      "Surfaces when you type a customer or serial.",
    ),
  },
  "parts.demand-forecast": {
    id: "parts.demand-forecast",
    title: "Demand forecast",
    purpose: "Parts trending up in demand — what to stock deeper.",
    allowedRoles: ["iron_parts_manager"],
    size: "wide",
    component: stub(
      "Demand forecast",
      "Parts trending up vs. last 90 days — stocking recommendations.",
      "Sample: 12 parts up >20% · top: cutter teeth, hydraulic hoses",
    ),
  },
  "parts.inventory-health": {
    id: "parts.inventory-health",
    title: "Inventory health",
    purpose: "Stock coverage, dead stock, and fill-rate summary.",
    allowedRoles: ["iron_parts_manager"],
    size: "normal",
    component: stub(
      "Inventory health",
      "Overall stock health — coverage days, dead stock dollars, fill rate.",
      "Sample: 42 days coverage · $18K dead · 92% fill rate",
    ),
  },

  // ── Service-focused stubs ──
  "service.parts-hub-strip": {
    id: "service.parts-hub-strip",
    title: "Service parts hub",
    purpose: "Parts staged for today's service jobs.",
    allowedRoles: ["iron_man", "iron_manager"],
    size: "normal",
    component: stub(
      "Service parts hub",
      "Parts picked + staged for today's service jobs.",
      "Sample: 6 jobs ready · 2 waiting on backorder",
    ),
  },
};

/** Resolve a widget id against the Floor registry. Returns null for
 *  unknown ids so a stale layout can't crash the page. */
export function resolveFloorWidget(id: string): FloorWidgetDescriptor | null {
  return FLOOR_WIDGET_REGISTRY[id] ?? null;
}

/** Filter the registry by role — powers the composer palette. */
export function floorWidgetsForRole(role: IronRole): FloorWidgetDescriptor[] {
  return Object.values(FLOOR_WIDGET_REGISTRY).filter((w) =>
    w.allowedRoles.includes(role),
  );
}
