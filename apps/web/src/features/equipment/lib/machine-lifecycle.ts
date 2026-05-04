export type MachineLifecyclePhase =
  | "inventory_ready"
  | "inbound_inventory"
  | "sales_motion"
  | "rental_active"
  | "service_recovery"
  | "customer_active"
  | "disposed";

export interface MachineLifecycleInput {
  ownership: "owned" | "leased" | "customer_owned" | "rental_fleet" | "consignment";
  availability: "available" | "rented" | "sold" | "in_service" | "in_transit" | "reserved" | "decommissioned" | "on_order";
  openWorkOrders: number;
  openQuotes: number;
  pendingPartsOrders: number;
  overdueIntervals: number;
  tradeUpScore: number;
  predictedReplacementDate?: string | null;
  replacementConfidence?: number | null;
}

export interface MachineLifecycleState {
  phase: MachineLifecyclePhase;
  label: string;
  tone: "blue" | "orange" | "amber" | "emerald" | "red" | "slate";
  detail: string;
}

function formatReplacementDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function deriveMachineLifecycleState(input: MachineLifecycleInput): MachineLifecycleState {
  if (input.availability === "sold" || input.availability === "decommissioned") {
    return {
      phase: "disposed",
      label: "Disposed",
      tone: "slate",
      detail: "This machine is no longer in the active operating lifecycle.",
    };
  }

  if (input.availability === "in_service" || input.openWorkOrders > 0 || input.pendingPartsOrders > 0) {
    const detail = input.overdueIntervals > 0
      ? `${input.overdueIntervals} maintenance interval${input.overdueIntervals === 1 ? "" : "s"} are overdue while service work is active.`
      : `${input.openWorkOrders} open work order${input.openWorkOrders === 1 ? "" : "s"} and ${input.pendingPartsOrders} pending parts order${input.pendingPartsOrders === 1 ? "" : "s"} are shaping recovery.`;
    return {
      phase: "service_recovery",
      label: "Service Recovery",
      tone: "amber",
      detail,
    };
  }

  if (input.ownership === "rental_fleet" || input.availability === "rented") {
    return {
      phase: "rental_active",
      label: "Rental Active",
      tone: "orange",
      detail: "The machine is in the rental lifecycle and should route through rental utilization and return workflows.",
    };
  }

  if (input.openQuotes > 0 || input.availability === "reserved") {
    return {
      phase: "sales_motion",
      label: "Sales Motion",
      tone: "blue",
      detail: `${input.openQuotes} open quote${input.openQuotes === 1 ? "" : "s"} are keeping this machine in active commercial motion.`,
    };
  }

  if (input.ownership === "customer_owned") {
    const replacementDate = formatReplacementDate(input.predictedReplacementDate);
    const replacementLine = replacementDate
      ? `Replacement signal points to ${replacementDate}${input.replacementConfidence != null ? ` at ${Math.round(input.replacementConfidence)}% confidence` : ""}.`
      : input.tradeUpScore >= 70
        ? "Trade-up pressure is elevated from current usage and service history."
        : "Monitor service and parts activity to spot replacement or attachment opportunity.";
    return {
      phase: "customer_active",
      label: "Customer Active",
      tone: "emerald",
      detail: replacementLine,
    };
  }

  if (input.availability === "in_transit") {
    return {
      phase: "inbound_inventory",
      label: "Inbound Inventory",
      tone: "orange",
      detail: "The machine is moving into stock and should flow through readiness, intake, and commercial prep.",
    };
  }

  return {
    phase: "inventory_ready",
    label: "Inventory Ready",
    tone: "blue",
    detail: "The machine is in active inventory and ready for sale, rental, or reassignment.",
  };
}
