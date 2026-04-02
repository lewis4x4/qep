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
} from "lucide-react";
import type { UserRole } from "@/lib/database.types";

export interface NavItemDefinition {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
  requiresIntelliDealer?: boolean;
}

export interface NavItem extends NavItemDefinition {
  gated: boolean;
}

export const NAV_ITEMS: NavItemDefinition[] = [
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
    label: "Quotes",
    href: "/quote",
    icon: FileText,
    roles: ["rep", "manager", "owner"],
    requiresIntelliDealer: true,
  },
  {
    label: "Rentals",
    href: "/rentals",
    icon: Truck,
    roles: ["rep", "admin", "manager", "owner"],
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
  },
  {
    label: "Customers",
    href: "/customers",
    icon: Users,
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "Executive",
    href: "/executive",
    icon: Gauge,
    roles: ["manager", "owner"],
  },
  {
    label: "People",
    href: "/people",
    icon: UserPlus,
    roles: ["manager", "owner"],
  },
  {
    label: "CRM",
    href: "/crm",
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
];

export const BOTTOM_TAB_HREFS = ["/dashboard", "/chat", "/voice", "/quote"];

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
