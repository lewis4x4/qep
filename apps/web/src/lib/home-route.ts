export function resolveHomeRoute(
  userRole: string | null | undefined,
  ironRole?: string | null,
  audience?: string | null,
  floorMode?: boolean | null,
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
    case "parts":
      return "/parts/companion/queue";
    case "service":
      return "/service";
    case "rental":
    case "rentals":
      return "/rentals";
    case "rep":
      return "/sales/today";
    default:
      if (floorMode || isFloorIronRole(ironRole)) {
        return "/floor";
      }
      return "/dashboard";
  }
}

function normalizeRole(userRole: string | null | undefined): string {
  return (userRole ?? "").trim().toLowerCase();
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

export function canAccessFloorSurface(userRole: string | null | undefined): boolean {
  return normalizeRole(userRole) !== "rep";
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
