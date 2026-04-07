/**
 * Widget registry — canonical catalog of every dashboard widget.
 *
 * Add a new widget by:
 *   1. Implementing the React component under widgets/impls/
 *   2. Registering it here with a stable id, title, module, and role list
 *   3. (Optional) Adding it to a role's defaults in role-defaults.ts
 *
 * The id is the persistence key — once a layout is stored against an id we
 * can never repurpose it. Pick stable, namespaced names like "parts.replenish-queue".
 */
import type { ComponentType } from "react";
import type { IronRole } from "@/features/qrm/lib/iron-roles";

import {
  PipelineByRepWidget,
  ApprovalQueueWidget,
  InventoryAgingWidget,
} from "./impls/iron-manager-widgets";
import {
  AdvisorBriefWidget,
  FollowUpQueueWidget,
  ProspectingCounterWidget,
} from "./impls/iron-advisor-widgets";
import {
  OrderProcessingWidget,
  DepositTrackerWidget,
  IntakeProgressWidget,
  CreditAppsWidget,
} from "./impls/iron-woman-widgets";
import {
  PrepQueueWidget,
  PdiChecklistsWidget,
  DemoScheduleWidget,
  ReturnInspectionsWidget,
} from "./impls/iron-man-widgets";
import { PartsReplenishQueueWidget } from "./impls/parts-widgets";

export type WidgetModule =
  | "iron"
  | "qrm"
  | "parts"
  | "service"
  | "rentals"
  | "sales";

export interface WidgetDescriptor {
  /** Stable persistence id — never reuse or rename. */
  id: string;
  title: string;
  module: WidgetModule;
  /** Iron roles allowed to see this widget at all. */
  allowedRoles: IronRole[];
  component: ComponentType;
}

const ALL_ROLES: IronRole[] = ["iron_manager", "iron_advisor", "iron_woman", "iron_man"];

export const WIDGET_REGISTRY: Record<string, WidgetDescriptor> = {
  // ── Iron Manager source ────────────────────────────────────────────
  "iron.pipeline-by-rep": {
    id: "iron.pipeline-by-rep",
    title: "Pipeline by advisor",
    module: "iron",
    allowedRoles: ["iron_manager"],
    component: PipelineByRepWidget,
  },
  "iron.approval-queue": {
    id: "iron.approval-queue",
    title: "Approvals waiting",
    module: "iron",
    allowedRoles: ["iron_manager", "iron_woman"],
    component: ApprovalQueueWidget,
  },
  "iron.inventory-aging": {
    id: "iron.inventory-aging",
    title: "Aging fleet",
    module: "iron",
    allowedRoles: ["iron_manager", "iron_woman"],
    component: InventoryAgingWidget,
  },

  // ── Iron Advisor source ────────────────────────────────────────────
  "qrm.advisor-brief": {
    id: "qrm.advisor-brief",
    title: "SLA + new leads",
    module: "qrm",
    allowedRoles: ["iron_advisor"],
    component: AdvisorBriefWidget,
  },
  "qrm.follow-up-queue": {
    id: "qrm.follow-up-queue",
    title: "Follow-up queue",
    module: "qrm",
    allowedRoles: ["iron_advisor"],
    component: FollowUpQueueWidget,
  },
  "qrm.prospecting-counter": {
    id: "qrm.prospecting-counter",
    title: "Prospecting target",
    module: "qrm",
    allowedRoles: ["iron_advisor"],
    component: ProspectingCounterWidget,
  },

  // ── Iron Woman source ──────────────────────────────────────────────
  "iron.order-processing": {
    id: "iron.order-processing",
    title: "Order processing",
    module: "iron",
    allowedRoles: ["iron_woman", "iron_manager"],
    component: OrderProcessingWidget,
  },
  "iron.deposit-tracker": {
    id: "iron.deposit-tracker",
    title: "Deposit tracker",
    module: "iron",
    allowedRoles: ["iron_woman", "iron_manager"],
    component: DepositTrackerWidget,
  },
  "iron.intake-progress": {
    id: "iron.intake-progress",
    title: "Equipment intake progress",
    module: "iron",
    allowedRoles: ["iron_woman", "iron_man", "iron_manager"],
    component: IntakeProgressWidget,
  },
  "iron.credit-applications": {
    id: "iron.credit-applications",
    title: "Credit applications",
    module: "iron",
    allowedRoles: ["iron_woman", "iron_manager"],
    component: CreditAppsWidget,
  },

  // ── Iron Man source ────────────────────────────────────────────────
  "iron.prep-queue": {
    id: "iron.prep-queue",
    title: "Prep queue",
    module: "iron",
    allowedRoles: ["iron_man", "iron_woman", "iron_manager"],
    component: PrepQueueWidget,
  },
  "iron.pdi-checklists": {
    id: "iron.pdi-checklists",
    title: "PDI checklists",
    module: "iron",
    allowedRoles: ["iron_man", "iron_manager"],
    component: PdiChecklistsWidget,
  },
  "iron.demo-schedule": {
    id: "iron.demo-schedule",
    title: "Demo schedule",
    module: "iron",
    allowedRoles: ["iron_man", "iron_advisor", "iron_manager"],
    component: DemoScheduleWidget,
  },
  "iron.return-inspections": {
    id: "iron.return-inspections",
    title: "Return inspections",
    module: "iron",
    allowedRoles: ["iron_man", "iron_woman", "iron_manager"],
    component: ReturnInspectionsWidget,
  },

  // ── Cross-module bridges ───────────────────────────────────────────
  "parts.replenish-queue": {
    id: "parts.replenish-queue",
    title: "Parts replenishment queue",
    module: "parts",
    allowedRoles: ALL_ROLES,
    component: PartsReplenishQueueWidget,
  },
};

/**
 * Resolve widget ids against the registry, dropping anything unknown so a
 * stale persisted layout from an older build can never crash the dashboard.
 */
export function resolveWidgets(ids: string[]): WidgetDescriptor[] {
  return ids
    .map((id) => WIDGET_REGISTRY[id])
    .filter((w): w is WidgetDescriptor => Boolean(w));
}

/**
 * All widgets a given role is allowed to see, useful for the future
 * "Customize dashboard" picker UI.
 */
export function widgetsForRole(role: IronRole): WidgetDescriptor[] {
  return Object.values(WIDGET_REGISTRY).filter((w) => w.allowedRoles.includes(role));
}
