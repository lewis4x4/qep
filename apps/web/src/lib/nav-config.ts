import {
  Crosshair,
  MessageSquare,
  Mic,
  FileText,
  Settings,
  Plug,
  LayoutGrid,
  Truck,
  Cog,
  MapPin,
  Gauge,
  Users,
  UserPlus,
  Wrench,
  Layers3,
} from "lucide-react";
import type { UserRole } from "@/lib/database.types";

export interface NavItemDefinition {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
  requiresIntelliDealer?: boolean;
  showcase?: boolean;
}

export interface NavItem extends NavItemDefinition {
  gated: boolean;
}

export const NAV_ITEMS: NavItemDefinition[] = [
  // ── Live pages ──────────────────────────────────
  {
    label: "Command Center",
    href: "/dashboard",
    icon: Crosshair,
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "Knowledge",
    href: "/chat",
    icon: MessageSquare,
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "Field Note",
    href: "/voice",
    icon: Mic,
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "Service",
    href: "/service",
    icon: Wrench,
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "Operating System",
    href: "/os",
    icon: Layers3,
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "QRM",
    href: "/qrm",
    icon: LayoutGrid,
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "Admin",
    href: "/admin",
    icon: Settings,
    roles: ["admin", "manager", "owner"],
  },
  {
    label: "Integrations",
    href: "/admin/integrations",
    icon: Plug,
    roles: ["admin", "owner"],
  },
  // ── Showcase pages ──────────────────────────────
  {
    label: "Quotes",
    href: "/quote-v2",
    icon: FileText,
    roles: ["rep", "admin", "manager", "owner"],
    showcase: true,
  },
  {
    label: "Rentals",
    href: "/rentals",
    icon: Truck,
    roles: ["rep", "admin", "manager", "owner"],
    showcase: true,
  },
  {
    label: "Parts",
    href: "/parts",
    icon: Cog,
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "Logistics",
    href: "/logistics",
    icon: MapPin,
    roles: ["rep", "admin", "manager", "owner"],
    showcase: true,
  },
  {
    label: "Customers",
    href: "/customers",
    icon: Users,
    roles: ["rep", "admin", "manager", "owner"],
    showcase: true,
  },
  {
    label: "Executive",
    href: "/exec",
    icon: Gauge,
    roles: ["manager", "owner"],
    showcase: true,
  },
  {
    label: "People",
    href: "/people",
    icon: UserPlus,
    roles: ["manager", "owner"],
    showcase: true,
  },
];

export const BOTTOM_TAB_HREFS = ["/dashboard", "/service", "/chat", "/voice", "/quote-v2"];

export function resolveNavItems(
  quoteBuilderEnabled: boolean,
  quoteBuilderLoading: boolean
): NavItem[] {
  return NAV_ITEMS.map((item) => ({
    ...item,
    gated: Boolean(
      item.requiresIntelliDealer && !quoteBuilderEnabled && !quoteBuilderLoading
    ),
  }));
}

export function getInitials(
  name: string | null | undefined,
  email: string | null | undefined
): string {
  if (name) {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  if (email) {
    return email[0].toUpperCase();
  }
  return "?";
}
