export function resolveHomeRoute(
  userRole: string | null | undefined,
  ironRole?: string | null,
  audience?: string | null,
  floorMode?: boolean | null,
  isSupport?: boolean | null,
): string {
  // Stakeholder audience (external QEP USA build observers — Ryan, Rylee,
  // Juan, Angela) always lands on the Build Hub regardless of role/iron role.
  // Internal operators keep their role-based routing below.
  if (audience === "stakeholder") {
    return "/brief";
  }

  const normalizedRole = normalizeRole(userRole);

  switch (normalizedRole) {
    case "owner":
      return "/owner";
    case "admin":
    case "manager":
      return "/qrm";
    case "finance_admin":
      return "/service/metrics";
    case "parts":
      return "/parts/companion/queue";
    case "technician":
      return "/m/service";
    case "service":
      return "/service";
    case "rental":
    case "rentals":
      return "/qrm/rentals";
    case "rep": {
      if (isSupport) return "/floor";
      const ironOperatorHome = resolveIronOperatorHomeRoute(ironRole);
      if (ironOperatorHome) return ironOperatorHome;
      return "/sales/today";
    }
    default:
      if (floorMode || isFloorIronRole(ironRole)) {
        return "/floor";
      }
      return "/chat";
  }
}

/** Maps live `user_role` enum strings to the home-route buckets used in
 *  `resolveHomeRoute`. Short aliases (`parts`, `service`) remain supported. */
const ROLE_HOME_ALIASES: Record<string, string> = {
  parts_counter: "parts",
  parts_manager: "parts",
  service_writer: "service",

  // No dedicated haul/dispatch board route in the web shell yet; dispatch
  // operators coordinate through the service command center.
  dispatch: "service",
};

function normalizeRole(userRole: string | null | undefined): string {
  const raw = (userRole ?? "").trim().toLowerCase();
  return ROLE_HOME_ALIASES[raw] ?? raw;
}

/** When user_role is still `rep` (invite default) but iron_role names a floor
 *  department, route to that department's operational home. Elevated business
 *  roles are handled earlier in resolveHomeRoute and are not overridden here. */
function resolveIronOperatorHomeRoute(ironRole: string | null | undefined): string | null {
  switch (ironRole) {
    case "iron_man":
      return "/floor";
    case "iron_parts_counter":
    case "iron_parts_manager":
      return "/parts/companion/queue";
    default:
      return null;
  }
}

/** Nav item role filter: honor iron-assigned department for rep invites.
 *  Uses live user_role strings (not home-route buckets) so workforce and
 *  floor-operator nav roles keep matching their NAV_ITEMS entries. */
export function resolveOperatorNavRole(
  userRole: string | null | undefined,
  ironRole?: string | null,
): string {
  const raw = (userRole ?? "").trim().toLowerCase();
  if (raw === "rep") {
    if (ironRole === "iron_parts_counter" || ironRole === "iron_parts_manager") {
      return "parts_counter";
    }
    return "rep";
  }
  return raw;
}

function isFloorIronRole(ironRole: string | null | undefined): boolean {
  return (
    ironRole === "iron_manager" ||
    ironRole === "iron_advisor" ||
    ironRole === "iron_woman" ||
    ironRole === "iron_man" ||
    ironRole === "iron_owner" ||
    ironRole === "iron_parts_counter" ||
    ironRole === "iron_parts_manager"
  );
}

export function canUseElevatedQrmScopes(
  userRole: string | null | undefined,
  ironRole?: string | null,
): boolean {
  const normalizedRole = normalizeRole(userRole);
  return (
    normalizedRole === "owner" ||
    normalizedRole === "admin" ||
    normalizedRole === "manager" ||
    ironRole === "iron_manager"
  );
}

export const SERVICE_OPERATIONS_ROLES = ["rep", "admin", "manager", "owner", "service_writer", "technician", "dispatch", "finance_admin", "parts_counter"] as const;
export const PARTS_OPERATIONS_ROLES = ["rep", "admin", "manager", "owner", "parts_counter", "parts_manager"] as const;

export function canAccessServiceOperations(role: string | null | undefined): boolean {
  return SERVICE_OPERATIONS_ROLES.some((candidate) => candidate === role);
}

export function canAccessPartsOperations(role: string | null | undefined): boolean {
  return PARTS_OPERATIONS_ROLES.some((candidate) => candidate === role);
}

export function canAccessFloorSurface(userRole: string | null | undefined, ironRole?: string | null, isSupport = false): boolean {
  return normalizeRole(userRole) !== "rep" || ironRole === "iron_man" || isSupport;
}

/** Machine-record surfaces: /fleet (map) and /qrm/equipment/:id (detail).
 *
 *  Deliberately limited to the core sales/management roles because the
 *  floor operator roles (parts_counter, service_writer, technician,
 *  dispatch) hold NO qrm_equipment RLS policy yet — routing them in would
 *  render an empty map/detail, which reads as breakage. Surfaces that link
 *  here (e.g. SerialFirstWidget) must check this same helper and degrade
 *  to non-link content instead of letting the route guard bounce the user
 *  to /dashboard. Widen this together with the RLS policies, not before. */
export function canAccessMachineRecords(userRole: string | null | undefined): boolean {
  const normalizedRole = normalizeRole(userRole);
  return (
    normalizedRole === "rep" ||
    normalizedRole === "admin" ||
    normalizedRole === "manager" ||
    normalizedRole === "owner"
  );
}

export function canAccessQrmSurface(userRole: string | null | undefined): boolean {
  const normalizedRole = normalizeRole(userRole);
  return normalizedRole === "owner" || normalizedRole === "admin" || normalizedRole === "manager";
}

export function canAccessManagerAdminSurface(userRole: string | null | undefined): boolean {
  return canAccessQrmSurface(userRole);
}

export type ManagerAdminRouteKey =
  | "qrm_activities_templates"
  | "admin_sequences"
  | "admin_duplicates";

export function canAccessManagerAdminRoute(
  userRole: string | null | undefined,
  _routeKey: ManagerAdminRouteKey,
): boolean {
  return canAccessManagerAdminSurface(userRole);
}

export function resolveManagerAdminRouteRedirect(
  userRole: string | null | undefined,
  homeRoute: string,
  routeKey: ManagerAdminRouteKey,
): string | null {
  return canAccessManagerAdminRoute(userRole, routeKey) ? null : homeRoute;
}
