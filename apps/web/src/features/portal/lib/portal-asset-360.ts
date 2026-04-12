import type { CustomerMachineView } from "../../../../../../shared/qep-moonshot-contracts";

export interface PortalAssetLifecycleState {
  phase: "service_attention" | "maintenance_ready" | "warranty_watch" | "stable" | "trade_signal";
  label: string;
  tone: "blue" | "amber" | "emerald" | "orange";
  detail: string;
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function derivePortalAssetLifecycleState(machine: CustomerMachineView): PortalAssetLifecycleState {
  if (machine.activeServiceJob) {
    return {
      phase: "service_attention",
      label: "Live Service Attention",
      tone: "amber",
      detail: `The machine is actively moving through a service workflow at stage "${machine.activeServiceJob.currentStage.replace(/_/g, " ")}".`,
    };
  }

  if (machine.tradeInInterest) {
    return {
      phase: "trade_signal",
      label: "Trade Signal Active",
      tone: "orange",
      detail: "Your dealership has flagged this machine for trade-in or replacement conversations based on current lifecycle signals.",
    };
  }

  const nextServiceDue = formatDate(machine.nextServiceDue);
  if (nextServiceDue) {
    return {
      phase: "maintenance_ready",
      label: "Maintenance Window",
      tone: "blue",
      detail: `The next service interval is due ${nextServiceDue}, so this is the right time to confirm maintenance timing and parts readiness.`,
    };
  }

  const warrantyExpiry = formatDate(machine.warrantyExpiry);
  if (warrantyExpiry) {
    return {
      phase: "warranty_watch",
      label: "Warranty Watch",
      tone: "emerald",
      detail: `Warranty coverage remains visible through ${warrantyExpiry}. Keep service records and dealer documents current before the coverage window closes.`,
    };
  }

  return {
    phase: "stable",
    label: "Operationally Stable",
    tone: "emerald",
    detail: "The machine is in a stable operating posture with no active service escalation visible in the portal right now.",
  };
}
