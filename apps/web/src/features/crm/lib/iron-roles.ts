import type { UserRole } from "@/lib/database.types";

export type IronRole = "iron_manager" | "iron_advisor" | "iron_woman" | "iron_man";

export interface IronRoleInfo {
  role: IronRole;
  display: string;
  description: string;
}

const IRON_ROLE_MAP: Record<string, IronRoleInfo> = {
  manager: {
    role: "iron_manager",
    display: "Iron Manager",
    description: "Pipeline oversight, approvals, pricing authority, forecasting, KPI enforcement",
  },
  owner: {
    role: "iron_manager",
    display: "Iron Manager",
    description: "Pipeline oversight, approvals, pricing authority, forecasting, KPI enforcement",
  },
  admin: {
    role: "iron_woman",
    display: "Iron Woman",
    description: "Order processing, credit apps, deposits, invoicing, warranty, inventory management",
  },
  rep: {
    role: "iron_advisor",
    display: "Iron Advisor",
    description: "Customer relationships, 10 visits/day, 15-min lead response SLA",
  },
};

/**
 * Derive Iron role from system role.
 * When the iron_role column is populated (migration 067), this can be
 * replaced with a direct database read.
 */
export function getIronRole(userRole: UserRole): IronRoleInfo {
  return IRON_ROLE_MAP[userRole] ?? IRON_ROLE_MAP.rep;
}

/**
 * Check if user has an elevated Iron role (manager-level).
 */
export function isIronElevated(userRole: UserRole): boolean {
  const iron = getIronRole(userRole);
  return iron.role === "iron_manager";
}
