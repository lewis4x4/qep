import type { ExecRoleTab } from "./types";

export interface LensPulseInput {
  role: ExecRoleTab;
  label: string;
  alerts: number;
  criticalAlerts: number;
  staleMetrics: number;
}

export interface BusinessPosture {
  label: "Stable" | "Watch" | "Intervene";
  tone: "green" | "yellow" | "red";
  detail: string;
}

export function deriveBusinessPosture(input: {
  criticalAlerts: number;
  staleMetrics: number;
  totalImpact: number;
}): BusinessPosture {
  if (input.criticalAlerts >= 3 || input.totalImpact >= 500_000 || input.staleMetrics >= 6) {
    return {
      label: "Intervene",
      tone: "red",
      detail: "Leadership attention is required now across multiple pressure points.",
    };
  }

  if (input.criticalAlerts > 0 || input.staleMetrics > 0 || input.totalImpact >= 100_000) {
    return {
      label: "Watch",
      tone: "yellow",
      detail: "The business is moving, but there are visible signals leadership should stay ahead of.",
    };
  }

  return {
    label: "Stable",
    tone: "green",
    detail: "No elevated alert pressure is visible across the executive stack right now.",
  };
}

export function rankLensPressure(lenses: LensPulseInput[]): LensPulseInput[] {
  return [...lenses].sort((left, right) => {
    const criticalDelta = right.criticalAlerts - left.criticalAlerts;
    if (criticalDelta !== 0) return criticalDelta;
    const alertDelta = right.alerts - left.alerts;
    if (alertDelta !== 0) return alertDelta;
    return right.staleMetrics - left.staleMetrics;
  });
}
