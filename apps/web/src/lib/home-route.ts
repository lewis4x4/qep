export function resolveHomeRoute(
  userRole: string | null | undefined,
  ironRole?: string | null,
): string {
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
      return resolveRepHomeRoute(ironRole);
    default:
      return resolveIronRoleFallback(ironRole);
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

function resolveRepHomeRoute(ironRole?: string | null): string {
  switch (ironRole) {
    case "iron_man":
      return "/service";
    case "iron_woman":
      return "/parts/companion/queue";
    case "iron_manager":
      return "/qrm";
    case "iron_advisor":
    default:
      return "/sales/today";
  }
}

function resolveIronRoleFallback(ironRole?: string | null): string {
  switch (ironRole) {
    case "iron_man":
      return "/service";
    case "iron_woman":
      return "/parts/companion/queue";
    case "iron_manager":
      return "/qrm";
    default:
      return "/dashboard";
  }
}
