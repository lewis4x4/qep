import type { UserRole } from "@/lib/database.types";

export type IronRole = "iron_manager" | "iron_advisor" | "iron_woman" | "iron_man";

export interface IronRoleInfo {
  role: IronRole;
  display: string;
  description: string;
}

const IRON_ROLE_INFO: Record<IronRole, IronRoleInfo> = {
  iron_manager: {
    role: "iron_manager",
    display: "Iron Manager",
    description: "Pipeline oversight, approvals, pricing authority, forecasting, KPI enforcement",
  },
  iron_advisor: {
    role: "iron_advisor",
    display: "Iron Advisor",
    description: "Customer relationships, 10 visits/day, 15-min lead response SLA",
  },
  iron_woman: {
    role: "iron_woman",
    display: "Iron Woman",
    description: "Order processing, credit apps, deposits, invoicing, warranty, inventory management",
  },
  iron_man: {
    role: "iron_man",
    display: "Iron Man",
    description: "Support tech — service-specific flows, customer site response",
  },
};

const LEGACY_ROLE_MAP: Record<string, IronRole> = {
  manager: "iron_manager",
  owner: "iron_manager",
  admin: "iron_woman",
  rep: "iron_advisor",
};

function isIronRole(value: string): value is IronRole {
  return value === "iron_manager" || value === "iron_advisor" || value === "iron_woman" || value === "iron_man";
}

/**
 * Resolve the operator's Iron role.
 *
 * Prefer the authoritative `iron_role` column on profiles (migration 067,
 * auto-synced from `role` + `is_support`). Fall back to deriving from the
 * system role enum when `ironRoleFromProfile` is null — needed for anonymous
 * contexts and as a transitional safety net for any caller that hasn't yet
 * been updated to load iron_role from the profile.
 */
export function getIronRole(userRole: UserRole, ironRoleFromProfile?: string | null): IronRoleInfo {
  if (ironRoleFromProfile && isIronRole(ironRoleFromProfile)) {
    return IRON_ROLE_INFO[ironRoleFromProfile];
  }
  const derived = LEGACY_ROLE_MAP[userRole] ?? "iron_advisor";
  return IRON_ROLE_INFO[derived];
}

/**
 * Check if user has an elevated Iron role (manager-level).
 */
export function isIronElevated(userRole: UserRole, ironRoleFromProfile?: string | null): boolean {
  return getIronRole(userRole, ironRoleFromProfile).role === "iron_manager";
}
