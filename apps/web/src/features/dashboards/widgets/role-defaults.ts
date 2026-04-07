/**
 * Role-based default widget sets.
 *
 * Each Iron role gets a curated default widget list that mirrors what was
 * already on its dedicated dashboard, plus one cross-module bridge so it's
 * obvious from day one that the registry can pull data from any feature.
 *
 * Once per-user customization ships, these become the seed values for new
 * users (and the "Reset to defaults" path).
 */
import type { IronRole } from "@/features/qrm/lib/iron-roles";

export const DEFAULT_WIDGETS: Record<IronRole, string[]> = {
  iron_manager: [
    "iron.pipeline-by-rep",
    "iron.approval-queue",
    "iron.inventory-aging",
    "parts.replenish-queue",
  ],
  iron_advisor: [
    "qrm.advisor-brief",
    "qrm.follow-up-queue",
    "qrm.prospecting-counter",
  ],
  iron_woman: [
    "iron.order-processing",
    "iron.deposit-tracker",
    "iron.intake-progress",
    "iron.credit-applications",
    "parts.replenish-queue",
  ],
  iron_man: [
    "iron.prep-queue",
    "iron.pdi-checklists",
    "iron.demo-schedule",
    "iron.return-inspections",
  ],
};
