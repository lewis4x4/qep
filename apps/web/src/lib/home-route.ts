export function resolveHomeRoute(
  userRole: string | null | undefined,
  ironRole?: string | null,
): string {
  // Iron role is the most reliable routing signal — check it first.
  // This handles cases where role is generic ("rep") but iron_role
  // is explicitly set to a department-specific persona.
  if (ironRole) {
    const resolved = resolveByIronRole(ironRole);
    if (resolved) return resolved;
  }

  const normalizedRole = (userRole ?? "").trim().toLowerCase();

  switch (normalizedRole) {
    case "owner":
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

function resolveByIronRole(ironRole: string): string | null {
  switch (ironRole) {
    case "iron_woman":
      return "/parts/companion/queue";
    case "iron_man":
      return "/service";
    case "iron_manager":
      return "/qrm";
    case "iron_advisor":
      return "/sales/today";
    default:
      return null;
  }
}
