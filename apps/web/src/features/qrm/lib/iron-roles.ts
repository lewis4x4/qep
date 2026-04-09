import type { UserRole } from "@/lib/database.types";

export type IronRole = "iron_manager" | "iron_advisor" | "iron_woman" | "iron_man";

export interface IronRoleInfo {
  role: IronRole;
  display: string;
  description: string;
}

/**
 * Phase 0 P0.5 — a single weighted entry in an operator's role blend.
 *
 * The blend is the new authoritative shape for "what role(s) does this
 * operator hold right now?" — see `supabase/migrations/210_profile_role_blend.sql`.
 * The legacy single-role helper {@link getIronRole} remains as a deprecation
 * shim until Phase 0 Day 9 (frontend adoption) and Phase 4 (column retired).
 */
export interface IronRoleBlendEntry {
  role: IronRole;
  display: string;
  description: string;
  /** Weight in [0, 1]. Sum across the array SHOULD equal 1.0. */
  weight: number;
}

/**
 * Raw row shape coming back from `v_profile_active_role_blend`.
 *
 * Kept loose-typed (string for iron_role) so callers can pass straight from
 * the Supabase client without an extra cast — the helper will narrow.
 */
export interface IronRoleBlendInput {
  iron_role: string;
  weight: number;
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
 * @deprecated Phase 0 P0.5 introduces {@link getIronRoleBlend} as the
 * authoritative shape. This single-role helper is kept as a backwards-compat
 * shim for callers that have not yet migrated to the blend. Day 9 wires
 * the QRM frontend (RoleVariantShell, ranker) to consume the blend; the
 * legacy `profiles.iron_role` column is retired in Phase 4.
 *
 * Prefer {@link getIronRoleBlend} for new code. Use this only when a single
 * dominant role is genuinely required and the caller has no access to the
 * blend (e.g. anonymous contexts).
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
 *
 * @deprecated Use {@link isIronBlendElevated} when a blend is available.
 */
export function isIronElevated(userRole: UserRole, ironRoleFromProfile?: string | null): boolean {
  return getIronRole(userRole, ironRoleFromProfile).role === "iron_manager";
}

/**
 * Build a typed, sorted Iron role blend from raw active-blend rows.
 *
 * Input is the rows returned by `v_profile_active_role_blend` (or any
 * equivalently-shaped array). The helper:
 *   1. Drops rows whose iron_role is not a recognized value (defensive
 *      against future enum drift in the DB).
 *   2. Drops rows with weight ≤ 0 (a weight of 0 is a tombstone).
 *   3. Drops rows with weight > 1 (defensive against bad writes).
 *   4. Sorts by weight DESC so the dominant role is always at index 0.
 *   5. Returns an empty array if no valid rows survive — callers should
 *      treat empty as "fall back to single-role legacy" rather than as
 *      a fatal error.
 *
 * The helper does NOT normalize weights to sum to 1.0. Sum drift is a
 * P0.6 honesty probe concern, not a rendering concern. Callers that need
 * a normalized split should handle it explicitly.
 */
export function getIronRoleBlend(rows: IronRoleBlendInput[] | null | undefined): IronRoleBlendEntry[] {
  if (!rows || rows.length === 0) return [];

  const entries: IronRoleBlendEntry[] = [];
  for (const row of rows) {
    if (!row || typeof row.iron_role !== "string") continue;
    if (!isIronRole(row.iron_role)) continue;
    if (typeof row.weight !== "number" || Number.isNaN(row.weight)) continue;
    if (row.weight <= 0 || row.weight > 1) continue;

    const info = IRON_ROLE_INFO[row.iron_role];
    entries.push({
      role: info.role,
      display: info.display,
      description: info.description,
      weight: row.weight,
    });
  }

  entries.sort((a, b) => b.weight - a.weight);
  return entries;
}

/**
 * Pick the dominant entry from a blend (highest weight wins).
 *
 * Returns null when the blend is empty — caller should fall back to the
 * legacy single-role path via {@link getIronRole}.
 *
 * Tie-breaking: when two entries share the highest weight, the one earlier
 * in the sorted blend wins. {@link getIronRoleBlend} sorts by weight DESC
 * so ties resolve to the order the rows arrived in from the view.
 */
export function getDominantIronRoleFromBlend(
  blend: IronRoleBlendEntry[] | null | undefined,
): IronRoleBlendEntry | null {
  if (!blend || blend.length === 0) return null;
  return blend[0];
}

/**
 * Resolve the operator's effective Iron role with a blend-first strategy.
 *
 * Strategy (in order):
 *   1. If `blendRows` produces a non-empty blend, return the dominant
 *      entry as IronRoleInfo.
 *   2. If `ironRoleFromProfile` is a recognized iron_role, return it.
 *   3. Fall back to the legacy `LEGACY_ROLE_MAP` derivation from
 *      `userRole`.
 *
 * This is the function Day 9's frontend should adopt. The legacy
 * {@link getIronRole} remains for callers that genuinely have no blend
 * access yet.
 */
export function getEffectiveIronRole(
  userRole: UserRole,
  blendRows: IronRoleBlendInput[] | null | undefined,
  ironRoleFromProfile?: string | null,
): IronRoleInfo {
  const blend = getIronRoleBlend(blendRows);
  const dominant = getDominantIronRoleFromBlend(blend);
  if (dominant) {
    return IRON_ROLE_INFO[dominant.role];
  }
  return getIronRole(userRole, ironRoleFromProfile);
}

/**
 * Check if any role in the blend is elevated (manager-level).
 *
 * Returns true when iron_manager appears in the blend with weight > 0.
 * This is the blend-aware analogue of {@link isIronElevated}.
 *
 * NOTE: this is a "any" check, not "dominant" — a manager covering an
 * advisor at 0.4 weight is still elevated for approval-gate purposes.
 * Callers that need dominant-only elevation should use
 * `getDominantIronRoleFromBlend(...).role === "iron_manager"`.
 */
export function isIronBlendElevated(blend: IronRoleBlendEntry[] | null | undefined): boolean {
  if (!blend || blend.length === 0) return false;
  return blend.some((entry) => entry.role === "iron_manager" && entry.weight > 0);
}
