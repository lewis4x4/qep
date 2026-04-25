/**
 * Floor Widget Registry — the composition catalog for The Floor.
 *
 * Responsibilities:
 *   1. Resolve a widget id stored in `floor_layouts.layout_json` into a
 *      React component renderable on The Floor.
 *   2. Gate widget visibility by Iron role (mirrors the allowedRoles
 *      field on the base dashboard registry).
 *   3. Provide UI metadata for role-default validation and admin tooling.
 *
 * Design:
 *   - We do NOT fork the existing `features/dashboards/widgets/registry.ts`.
 *     We REFERENCE its components where the wiring is already done
 *     (aging fleet, approval queue, pipeline by rep, etc.) and add thin
 *     Floor-native wrappers where a role needs a compact operational read.
 *
 * Keeping both registries in play is intentional: the legacy Iron
 * dashboards keep rendering their dense grid from `WIDGET_REGISTRY`,
 * while The Floor uses `FLOOR_WIDGET_REGISTRY` for its simplified
 * composed surface.
 */
import type { ComponentType } from "react";
import type { IronRole } from "@/features/qrm/lib/iron-roles";
import type { FloorAttentionScore, FloorAttentionSignals } from "./attention";

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
  PdiChecklistsWidget,
  DemoScheduleWidget,
  ReturnInspectionsWidget,
} from "@/features/dashboards/widgets/impls/iron-man-widgets";
import { PartsReplenishQueueWidget } from "@/features/dashboards/widgets/impls/parts-widgets";

// ── Slice: The Floor widget wirings (Week 1) ────────────────────────────
// Real-component wrappers replacing earlier placeholder cards. Each maps to an
// existing feature-owned component and fetches its own data — see
// docs/floor/widget-wiring-punch-list.md for the selection rationale.
import { OwnerBriefCard } from "@/features/owner/components/OwnerBriefCard";
import { CustomerHealthListWidget } from "../widgets/CustomerHealthListWidget";
import { CrmCustomerSearchWidget } from "../widgets/CrmCustomerSearchWidget";
// P1 moonshot widgets — see docs/floor/widget-wiring-punch-list.md.
import { SerialFirstWidget } from "../widgets/SerialFirstWidget";
import { ActionItemsWidget } from "../widgets/ActionItemsWidget";
import { DealCopilotSummaryWidget } from "../widgets/DealCopilotSummaryWidget";
import {
  DecisionRoomScoreboardFloorWidget,
  SalesAiBriefingFloorWidget,
  SalesDaySummaryFloorWidget,
  ServicePartsHubStripFloorWidget,
} from "../widgets/DirectWrapWidgets";
import {
  ExecDealVelocityFloorWidget,
  ExecRevenuePaceFloorWidget,
  MorningBriefFloorWidget,
  OpenServiceTicketsFloorWidget,
  PartsCustomerIntelFloorWidget,
  PartsDemandForecastFloorWidget,
  PartsInventoryHealthFloorWidget,
  PartsLostSalesFloorWidget,
  PartsOrderStatusFloorWidget,
  PartsQuoteDraftsFloorWidget,
  PartsSupplierHealthFloorWidget,
  PendingInvoicesFloorWidget,
  SalesCommissionSourceFloorWidget,
} from "../widgets/OperationalWidgets";
import {
  AgingDealsTeamWidget,
  CounterInquiriesWidget,
  EditablePrepQueueWidget,
  MarginTrendWidget,
  MyQuotesByStatusWidget,
  OwnerLargeDealsWidget,
  RecentDecisionsWidget,
  ServiceDeliveryScheduleWidget,
  SlaPerformanceWidget,
} from "../widgets/RoleHomeWidgets";
import { BuPulseStripWidget } from "../widgets/BuPulseStrip";
import { RecentActivityWidget } from "../widgets/RecentActivityWidget";
import { TeamPipelineTable } from "../components/TeamPipelineTable";
import { ManagerForecastCard } from "../components/ManagerForecastCard";
import { StalledDealsTable } from "../components/StalledDealsTable";

export interface FloorWidgetDescriptor {
  id: string;
  title: string;
  /** One-sentence purpose shown in admin tooling + any stub state. */
  purpose: string;
  /** Iron roles allowed to see this widget on The Floor. */
  allowedRoles: IronRole[];
  /** Default span in the responsive grid. "wide" consumes two columns on
   *  desktop; "normal" is one column. */
  size: "normal" | "wide";
  /** The component rendered inside the FloorWidget frame. */
  component: ComponentType;
  /** Optional display-only attention score. Used to auto-pin urgent widgets
   *  without mutating the saved layout JSON. */
  getAttentionScore?: (signals: FloorAttentionSignals) => FloorAttentionScore;
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

function countAttention(count: number, pointsPerItem: number, noun: string): FloorAttentionScore {
  return {
    score: count * pointsPerItem,
    reason: count > 0 ? `${count} ${noun}` : undefined,
  };
}

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
    getAttentionScore: (signals) =>
      countAttention(signals.approvalCount, 18, "approval signal waiting"),
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
    purpose: "Units in prep with one-click lifecycle status updates.",
    allowedRoles: ["iron_man", "iron_woman", "iron_manager"],
    size: "wide",
    component: EditablePrepQueueWidget,
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

  // ── Owner + operator widgets ────────────────────────────────────────
  "exec.owner-brief": {
    id: "exec.owner-brief",
    title: "Owner brief",
    purpose: "The one-page read of the business for the owner.",
    allowedRoles: ["iron_owner", "iron_manager"],
    size: "wide",
    // Slice: The Floor Week 1 wiring — wraps the feature-owned
    // OwnerBriefCard directly. It fetches its own narrative via
    // fetchOwnerMorningBrief (with a local-synth fallback when the
    // edge fn is pending) and its own event feed. Zero-prop component,
    // self-contained.
    component: OwnerBriefCard,
  },
  "exec.morning-brief": {
    id: "exec.morning-brief",
    title: "Morning brief",
    purpose: "Overnight signal summary for your pipeline.",
    allowedRoles: ["iron_advisor", "iron_manager", "iron_owner"],
    size: "wide",
    component: MorningBriefFloorWidget,
  },
  "nervous.customer-health": {
    id: "nervous.customer-health",
    title: "Customer health",
    purpose: "At-risk customer scores with the one signal driving each.",
    allowedRoles: ["iron_manager", "iron_owner"],
    size: "normal",
    // Slice: The Floor Week 1 wiring — compact list of the 5
    // lowest-scoring customer profiles. Scoring is done by the
    // nervous-system feature's nightly refresh; this widget just
    // reads the current snapshot.
    component: CustomerHealthListWidget,
  },
  "qrm.decision-room-scoreboard": {
    id: "qrm.decision-room-scoreboard",
    title: "Decision room",
    purpose: "Live deal-by-deal moves — wins, blocks, next plays.",
    allowedRoles: ["iron_manager", "iron_advisor"],
    size: "wide",
    // Phase 2-a wiring — picks the hottest active pipeline deal and
    // renders the real DecisionRoomScoreboard against live pipeline data.
    component: DecisionRoomScoreboardFloorWidget,
    getAttentionScore: (signals) =>
      countAttention(signals.staleDealCount, 10, "stale deal signal"),
  },
  "sales.ai-briefing": {
    id: "sales.ai-briefing",
    title: "AI briefing",
    purpose: "Today's priority actions tuned to your deals.",
    allowedRoles: ["iron_advisor"],
    size: "wide",
    // Phase 2-a wiring — direct adapter over the Sales Companion
    // AiBriefingCard using the existing useTodayFeed data pipeline.
    component: SalesAiBriefingFloorWidget,
  },
  "sales.action-items": {
    id: "sales.action-items",
    title: "Action items",
    purpose: "Your open touchpoints, ordered by deal value — biggest stakes first.",
    allowedRoles: ["iron_advisor"],
    size: "normal",
    // P1 moonshot wiring — joins follow_up_touchpoints → cadences →
    // qrm_deals and sorts DESC by deal amount. Per-row tel:/mailto:
    // and one-tap Mark Done on the touchpoint status column.
    component: ActionItemsWidget,
  },
  "sales.my-quotes-by-status": {
    id: "sales.my-quotes-by-status",
    title: "My quotes",
    purpose: "Actionable quote table for draft, sent, viewed, approved, declined, and expired follow-up.",
    allowedRoles: ["iron_advisor"],
    size: "wide",
    component: MyQuotesByStatusWidget,
    getAttentionScore: (signals) =>
      countAttention(signals.quoteFollowupCount, 16, "quote needing follow-up"),
  },
  "sales.recent-activity": {
    id: "sales.recent-activity",
    title: "Recent activity",
    purpose: "Latest touches you logged plus live buying signals when customers open your sent quotes.",
    allowedRoles: ["iron_advisor"],
    size: "normal",
    component: RecentActivityWidget,
  },
  "sales.day-summary": {
    id: "sales.day-summary",
    title: "Day summary",
    purpose: "Today's visits, calls, and quotes — so far.",
    allowedRoles: ["iron_advisor"],
    size: "normal",
    // Phase 2-a wiring — wraps DaySummaryCard with the live rep pipeline.
    component: SalesDaySummaryFloorWidget,
  },
  "quote.deal-copilot-summary": {
    id: "quote.deal-copilot-summary",
    title: "Deal Copilot signals",
    purpose: "Live feed of your latest Copilot turns with score deltas + extracted signals.",
    allowedRoles: ["iron_advisor", "iron_manager"],
    size: "normal",
    // P1 moonshot wiring — 5 most recent qb_quote_copilot_turns for
    // the signed-in user. Headline KPI: distinct deals moved this
    // week. Each row click-through deep-links to the quote with
    // ?copilotTurn={id} which triggers DealCopilotPanel auto-open
    // (wired in Slice 21).
    component: DealCopilotSummaryWidget,
  },
  "sales.commission-to-date": {
    id: "sales.commission-to-date",
    title: "Commission source",
    purpose: "Closed quote value that will feed commission once QA-R2 defines rules.",
    allowedRoles: ["iron_advisor", "iron_manager"],
    size: "normal",
    component: SalesCommissionSourceFloorWidget,
  },

  // ── Parts-focused widgets for Juan, Norman ──
  "parts.serial-first": {
    id: "parts.serial-first",
    title: "Serial-first lookup",
    purpose: "Paste a serial — pulls machine, owner, and service state in one read.",
    allowedRoles: ["iron_parts_counter", "iron_parts_manager"],
    size: "wide",
    // P1 moonshot wiring — paste-tolerant input, fuzzy ILIKE against
    // qrm_equipment.serial_number, three-panel snapshot on match.
    component: SerialFirstWidget,
  },
  "parts.quote-drafts": {
    id: "parts.quote-drafts",
    title: "My drafts",
    purpose: "Parts quotes auto-saved and waiting for you to finish.",
    allowedRoles: ["iron_parts_counter", "iron_parts_manager"],
    size: "normal",
    component: PartsQuoteDraftsFloorWidget,
  },
  "parts.order-status": {
    id: "parts.order-status",
    title: "Order status",
    purpose: "Today's parts orders and their fulfillment stage.",
    allowedRoles: ["iron_parts_counter", "iron_parts_manager"],
    size: "normal",
    component: PartsOrderStatusFloorWidget,
  },
  "parts.customer-intel": {
    id: "parts.customer-intel",
    title: "Customer intel",
    purpose: "Last parts + service context for the customer in front of you.",
    allowedRoles: ["iron_parts_counter", "iron_parts_manager"],
    size: "normal",
    component: PartsCustomerIntelFloorWidget,
  },
  "parts.counter-inquiries": {
    id: "parts.counter-inquiries",
    title: "Counter inquiries",
    purpose: "Unquoted counter searches and AI parts lookups that need quote follow-through.",
    allowedRoles: ["iron_parts_counter"],
    size: "wide",
    component: CounterInquiriesWidget,
    getAttentionScore: (signals) =>
      countAttention(signals.counterInquiryCount, 20, "counter inquiry needing a quote"),
  },
  "parts.demand-forecast": {
    id: "parts.demand-forecast",
    title: "Demand forecast",
    purpose: "Parts trending up in demand — what to stock deeper.",
    allowedRoles: ["iron_parts_manager"],
    size: "wide",
    component: PartsDemandForecastFloorWidget,
  },
  "parts.inventory-health": {
    id: "parts.inventory-health",
    title: "Inventory health",
    purpose: "Stock coverage, dead stock, and fill-rate summary.",
    allowedRoles: ["iron_parts_manager"],
    size: "normal",
    component: PartsInventoryHealthFloorWidget,
  },

  // ── Service-focused widgets ──
  "service.parts-hub-strip": {
    id: "service.parts-hub-strip",
    title: "Service parts hub",
    purpose: "Parts staged for today's service jobs.",
    allowedRoles: ["iron_man", "iron_manager"],
    size: "normal",
    // Phase 2-a wiring — wraps the service-owned parts strip around the
    // highest-priority open service job with parts context.
    component: ServicePartsHubStripFloorWidget,
  },
  "service.delivery-schedule": {
    id: "service.delivery-schedule",
    title: "Delivery schedule",
    purpose: "Ready-for-pickup service jobs scheduled over the next five days.",
    allowedRoles: ["iron_man"],
    size: "wide",
    component: ServiceDeliveryScheduleWidget,
  },

  // ── Slice: The Floor v2 — CRM search as a first-class Floor widget ──
  // Universal "find a customer" reflex. Autofocused input, 5 hits max,
  // click-through to /qrm/companies/{id}. Works for every role that
  // picks up the phone or walks in with a customer.
  "crm.customer-search": {
    id: "crm.customer-search",
    title: "Customer search",
    purpose: "Find any customer by name, DBA, or phone — deep-links to their record.",
    allowedRoles: [
      "iron_manager",
      "iron_advisor",
      "iron_woman",
      "iron_parts_counter",
      "iron_parts_manager",
      "iron_owner",
    ],
    size: "wide",
    component: CrmCustomerSearchWidget,
  },

  // ── Slice: The Floor v2 — role-optimized operational widgets ────────
  "exec.revenue-pace": {
    id: "exec.revenue-pace",
    title: "Revenue pace",
    purpose: "Month-to-date revenue vs. target — and what's in flight.",
    allowedRoles: ["iron_owner", "iron_manager"],
    size: "normal",
    component: ExecRevenuePaceFloorWidget,
  },
  "exec.deal-velocity": {
    id: "exec.deal-velocity",
    title: "Deal velocity",
    purpose: "How fast deals are moving through the pipeline.",
    allowedRoles: ["iron_owner", "iron_manager"],
    size: "normal",
    component: ExecDealVelocityFloorWidget,
  },
  "iron.margin-trend": {
    id: "iron.margin-trend",
    title: "Margin trend",
    purpose: "Gross margin trend and margin-floor flags from the analytics view.",
    allowedRoles: ["iron_manager", "iron_owner"],
    size: "normal",
    component: MarginTrendWidget,
  },
  "iron.aging-deals-team": {
    id: "iron.aging-deals-team",
    title: "Aging deals",
    purpose: "Workspace-wide stalled deals until direct-report filtering exists.",
    allowedRoles: ["iron_manager"],
    size: "wide",
    component: AgingDealsTeamWidget,
    getAttentionScore: (signals) =>
      countAttention(signals.staleDealCount, 12, "stale deal"),
  },
  "iron.owner-large-deals": {
    id: "iron.owner-large-deals",
    title: "Deals over $250K",
    purpose: "Large open deals with advisor, stage, value, and close-date risk.",
    allowedRoles: ["iron_owner", "iron_manager"],
    size: "wide",
    component: OwnerLargeDealsWidget,
  },
  "iron.team-pipeline-table": {
    id: "iron.team-pipeline-table",
    title: "Team pipeline by advisor",
    purpose: "Dense rep-by-rep pipeline read sorted by attention — replaces the bar-chart hero on manager home.",
    allowedRoles: ["iron_manager"],
    size: "wide",
    component: TeamPipelineTable,
  },
  "iron.manager-forecast": {
    id: "iron.manager-forecast",
    title: "Forecast",
    purpose: "Weighted-pipeline forecast for the current month plus the top three commits expected to close.",
    allowedRoles: ["iron_manager"],
    size: "normal",
    component: ManagerForecastCard,
  },
  "iron.manager-stalled-deals": {
    id: "iron.manager-stalled-deals",
    title: "Stalled deals",
    purpose: "Sortable team-wide table of deals idle 5+ days with rep, stage, amount, and inline nudge link.",
    allowedRoles: ["iron_manager"],
    size: "wide",
    component: StalledDealsTable,
    getAttentionScore: (signals) =>
      countAttention(signals.staleDealCount, 14, "stale deal"),
  },
  "exec.bu-pulse": {
    id: "exec.bu-pulse",
    title: "BU Pulse",
    purpose:
      "Four-tile cross-business snapshot: Equipment sales, Parts, Service, Rentals.",
    allowedRoles: ["iron_owner"],
    size: "wide",
    component: BuPulseStripWidget,
  },
  "iron-woman.sla-performance": {
    id: "iron-woman.sla-performance",
    title: "SLA performance",
    purpose: "Deal Desk decision speed today versus the two-hour target.",
    allowedRoles: ["iron_woman"],
    size: "normal",
    component: SlaPerformanceWidget,
  },
  "iron-woman.recent-decisions": {
    id: "iron-woman.recent-decisions",
    title: "Recent decisions",
    purpose: "Recent approval decisions for deal desk audit visibility.",
    allowedRoles: ["iron_woman"],
    size: "wide",
    component: RecentDecisionsWidget,
  },
  "iron-woman.pending-invoices": {
    id: "iron-woman.pending-invoices",
    title: "Pending invoices",
    purpose: "Approved deals waiting on invoicing — ordered by age.",
    allowedRoles: ["iron_woman", "iron_manager"],
    size: "normal",
    component: PendingInvoicesFloorWidget,
    getAttentionScore: (signals) =>
      countAttention(signals.pendingInvoiceCount, 18, "invoice waiting"),
  },
  "iron-man.open-service-tickets": {
    id: "iron-man.open-service-tickets",
    title: "Open service tickets",
    purpose: "Service work in progress across today's bay.",
    allowedRoles: ["iron_man", "iron_manager"],
    size: "normal",
    component: OpenServiceTicketsFloorWidget,
    getAttentionScore: (signals) =>
      countAttention(signals.openServiceTicketCount, 12, "open service ticket"),
  },
  "parts.lost-sales": {
    id: "parts.lost-sales",
    title: "Lost parts sales",
    purpose: "Recent parts we didn't close — with the reason code for each.",
    allowedRoles: ["iron_parts_manager", "iron_manager"],
    size: "normal",
    component: PartsLostSalesFloorWidget,
  },
  "parts.supplier-health": {
    id: "parts.supplier-health",
    title: "Supplier health",
    purpose: "Open POs + vendor fill rates + backorder exposure at a glance.",
    allowedRoles: ["iron_parts_manager"],
    size: "normal",
    component: PartsSupplierHealthFloorWidget,
  },
};

/** Resolve a widget id against the Floor registry. Returns null for
 *  unknown ids so a stale layout can't crash the page. */
export function resolveFloorWidget(id: string): FloorWidgetDescriptor | null {
  return FLOOR_WIDGET_REGISTRY[id] ?? null;
}

/** Filter the registry by role — powers role-default validation/admin tooling. */
export function floorWidgetsForRole(role: IronRole): FloorWidgetDescriptor[] {
  return Object.values(FLOOR_WIDGET_REGISTRY).filter((w) =>
    w.allowedRoles.includes(role),
  );
}
