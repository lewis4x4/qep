export function resolveHomeRoute(
  userRole: string | null | undefined,
  ironRole?: string | null,
  audience?: string | null,
  floorMode?: boolean | null,
): string {
  // The Floor is now the role-home surface. Any user with an assigned
  // Iron role lands there; /floor resolves the exact role layout at render
  // time. This also lets stakeholder viewers with real Iron roles (Ryan,
  // Rylee, etc.) inspect the same operator home they are accountable for.
  if (floorMode || isFloorIronRole(ironRole)) {
    return "/floor";
  }

  // Stakeholder audience (external QEP USA build observers — Ryan, Rylee,
  // Juan, Angela) always lands on the Build Hub regardless of role/iron role.
  // Internal operators keep their role-based routing below.
  if (audience === "stakeholder") {
    return "/brief";
  }

  const normalizedRole = (userRole ?? "").trim().toLowerCase();

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
      return "/dashboard";
  }
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
  const normalizedRole = (userRole ?? "").trim().toLowerCase();
  return (
    normalizedRole === "owner" ||
    normalizedRole === "admin" ||
    normalizedRole === "manager" ||
    ironRole === "iron_manager"
  );
}
