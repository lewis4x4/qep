import type { UserRole } from "@/lib/database.types";

export type ExecutiveDepartmentKey = "qrm" | "service" | "parts" | "rental";

export interface ExecutiveDepartmentView {
  key: ExecutiveDepartmentKey;
  label: string;
  audience: string;
  href: string;
  description: string;
  leadershipPrompt: string;
}

export const EXECUTIVE_DEPARTMENT_VIEWS: ExecutiveDepartmentView[] = [
  {
    key: "qrm",
    label: "Sales / QRM",
    audience: "Sales team and deal leadership",
    href: "/qrm",
    description:
      "The live revenue surface for pipeline pressure, relationship risk, and the next customer move.",
    leadershipPrompt:
      "See what the sales floor sees when reps are prioritizing deals, follow-up, and opportunity heat.",
  },
  {
    key: "service",
    label: "Service",
    audience: "Service managers, writers, and shop leaders",
    href: "/service",
    description:
      "The operating queue for machine-down jobs, delayed work, parts dependencies, and invoice-ready execution.",
    leadershipPrompt:
      "Check whether the shop view matches the backlog reality and whether delayed work is being surfaced fast enough.",
  },
  {
    key: "parts",
    label: "Parts",
    audience: "Counter, inventory, and fulfillment teams",
    href: "/parts",
    description:
      "The live parts board for open orders, vendor pressure, replenishment approvals, and transfer recommendations.",
    leadershipPrompt:
      "Confirm that inventory pressure, stockouts, and replenishment decisions are visible the way the parts team experiences them.",
  },
  {
    key: "rental",
    label: "Rental",
    audience: "Rental operations and fleet coordination",
    href: "/rentals",
    description:
      "The rental command surface for fleet utilization, return recovery, movement risk, and daily revenue in play.",
    leadershipPrompt:
      "Pressure-test how clearly rental teams can see revenue-producing units, recovery cases, and motion risk before it slips.",
  },
];

const EXECUTIVE_DEPARTMENT_PREVIEW_ROLES: UserRole[] = ["admin", "owner"];

export function canAccessExecutiveDepartmentDeck(role: UserRole): boolean {
  return EXECUTIVE_DEPARTMENT_PREVIEW_ROLES.includes(role);
}

export function buildEmbeddedExecutivePreviewHref(href: string): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}embedded=1&executive-preview=1`;
}
