export interface PolicyWallActionLink {
  label: string;
  href: string;
}

export interface PolicyWallActions {
  primary: PolicyWallActionLink;
  secondary: PolicyWallActionLink;
}

export function resolvePolicyWallActions(source: string): PolicyWallActions {
  switch (source) {
    case "stripe_mismatch":
      return {
        primary: { label: "Open exception", href: "/exceptions" },
        secondary: { label: "Open invoice playbook", href: "/service/invoice" },
      };
    case "tax_failed":
      return {
        primary: { label: "Open exception", href: "/exceptions" },
        secondary: { label: "Open data quality", href: "/admin/data-quality" },
      };
    case "ar_override_pending":
      return {
        primary: { label: "Review override", href: "/exceptions" },
        secondary: { label: "Open exceptions queue", href: "/exceptions" },
      };
    case "analytics_alert":
    default:
      return {
        primary: { label: "Open exception", href: "/exceptions" },
        secondary: { label: "Open invoice playbook", href: "/service/invoice" },
      };
  }
}
