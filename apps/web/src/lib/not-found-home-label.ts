export function resolveNotFoundHomeLabel(homeHref: string): string {
  switch (homeHref) {
    case "/floor":
      return "Back to the floor";
    case "/dashboard":
      return "Back to Dashboard";
    case "/qrm":
      return "Back to QRM";
    case "/owner":
      return "Back to owner";
    case "/brief":
      return "Back to Build Hub";
    case "/sales/today":
      return "Back to sales";
    case "/service":
      return "Back to service";
    case "/portal":
      return "Back to portal";
    default:
      if (homeHref.startsWith("/parts/")) {
        return "Back to parts";
      }
      return "Back home";
  }
}
