import {
  BarChart3,
  Bot,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Crosshair,
  DoorClosed,
  FileText,
  Gauge,
  HeartHandshake,
  LayoutGrid,
  LifeBuoy,
  LibraryBig,
  Map as MapIcon,
  Mic,
  MessageCircleMore,
  MessageSquare,
  PackageSearch,
  PackagePlus,
  ReceiptText,
  Settings,
  ShieldAlert,
  Plug,
  Sparkles,
  Sprout,
  Swords,
  Timer,
  Truck,
  UserRound,
  Users,
  UserPlus,
  UsersRound,
  Wrench,
  Layers3,
  Warehouse,
  Workflow,
  Boxes,
  ShoppingCart,
  TrendingUp,
  Lightbulb,
  Activity,
} from "lucide-react";
import type { UserRole } from "@/lib/database.types";

export type PrimaryHeaderId = "sales" | "parts" | "service" | "rentals" | "qrm";

export interface NavItemDefinition {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
  primaryHeaderId?: PrimaryHeaderId;
  sectionLabel?: string;
  utility?: boolean;
  requiresIntelliDealer?: boolean;
  showcase?: boolean;
}

export interface NavItem extends NavItemDefinition {
  gated: boolean;
}

export interface PrimaryNavGroupDefinition {
  id: PrimaryHeaderId;
  label: string;
  href: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export interface PrimaryNavGroup extends PrimaryNavGroupDefinition {
  sections: NavSection[];
}

export const PRIMARY_NAV_GROUPS: PrimaryNavGroupDefinition[] = [
  { id: "sales", label: "Sales", href: "/dashboard" },
  { id: "parts", label: "Parts", href: "/parts" },
  { id: "service", label: "Service", href: "/service" },
  { id: "rentals", label: "Rentals", href: "/rentals" },
  { id: "qrm", label: "QRM", href: "/qrm" },
];

export const NAV_ITEMS: NavItemDefinition[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: BriefcaseBusiness,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "sales",
    sectionLabel: "Workspace",
  },
  {
    label: "Quote Builder",
    href: "/quote-v2",
    icon: FileText,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "sales",
    sectionLabel: "Execution",
    requiresIntelliDealer: true,
  },
  {
    label: "Field Note",
    href: "/voice",
    icon: Mic,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "sales",
    sectionLabel: "Execution",
  },
  {
    label: "Parts Command",
    href: "/parts",
    icon: Boxes,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "parts",
    sectionLabel: "Operations",
  },
  {
    label: "Catalog",
    href: "/parts/catalog",
    icon: BookOpen,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "parts",
    sectionLabel: "Operations",
  },
  {
    label: "Orders",
    href: "/parts/orders",
    icon: ShoppingCart,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "parts",
    sectionLabel: "Operations",
  },
  {
    label: "New Order",
    href: "/parts/orders/new",
    icon: PackagePlus,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "parts",
    sectionLabel: "Operations",
  },
  {
    label: "Fulfillment",
    href: "/parts/fulfillment",
    icon: ReceiptText,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "parts",
    sectionLabel: "Operations",
  },
  {
    label: "Inventory",
    href: "/parts/inventory",
    icon: Boxes,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "parts",
    sectionLabel: "Operations",
  },
  {
    label: "Vendors",
    href: "/parts/vendors",
    icon: Truck,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "parts",
    sectionLabel: "Operations",
  },
  {
    label: "Forecast",
    href: "/parts/forecast",
    icon: TrendingUp,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "parts",
    sectionLabel: "Operations",
  },
  {
    label: "Analytics",
    href: "/parts/analytics",
    icon: BarChart3,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "parts",
    sectionLabel: "Insight",
  },
  {
    label: "Parts Intelligence",
    href: "/qrm/parts-intelligence",
    icon: Sparkles,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "parts",
    sectionLabel: "Insight",
  },
  {
    label: "Command Center",
    href: "/service",
    icon: Wrench,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "service",
    sectionLabel: "Operations",
  },
  {
    label: "Dashboard",
    href: "/service/dashboard",
    icon: Activity,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "service",
    sectionLabel: "Operations",
  },
  {
    label: "Intake",
    href: "/service/intake",
    icon: Mic,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "service",
    sectionLabel: "Operations",
  },
  {
    label: "Shop Parts",
    href: "/service/parts",
    icon: Boxes,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "service",
    sectionLabel: "Operations",
  },
  {
    label: "Portal Parts",
    href: "/service/portal-parts",
    icon: Warehouse,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "service",
    sectionLabel: "Operations",
  },
  {
    label: "Vendors",
    href: "/service/vendors",
    icon: Truck,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "service",
    sectionLabel: "Operations",
  },
  {
    label: "Efficiency",
    href: "/service/efficiency",
    icon: Gauge,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "service",
    sectionLabel: "Operations",
  },
  {
    label: "Branches",
    href: "/service/branches",
    icon: UserPlus,
    roles: ["admin", "manager", "owner"],
    primaryHeaderId: "service",
    sectionLabel: "Management",
  },
  {
    label: "Job Codes",
    href: "/service/job-code-suggestions",
    icon: Lightbulb,
    roles: ["admin", "manager", "owner"],
    primaryHeaderId: "service",
    sectionLabel: "Management",
  },
  {
    label: "Cron Health",
    href: "/service/scheduler-health",
    icon: Activity,
    roles: ["admin", "manager", "owner"],
    primaryHeaderId: "service",
    sectionLabel: "Management",
  },
  {
    label: "Service-to-Sales",
    href: "/qrm/service-to-sales",
    icon: Wrench,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "service",
    sectionLabel: "Bridge",
  },
  {
    label: "Rentals Hub",
    href: "/rentals",
    icon: Truck,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "rentals",
    sectionLabel: "Operations",
    showcase: true,
  },
  {
    label: "Rental Command",
    href: "/qrm/rentals",
    icon: Warehouse,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "rentals",
    sectionLabel: "Operations",
  },
  {
    label: "Command Center",
    href: "/qrm",
    icon: Crosshair,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Core",
  },
  {
    label: "Knowledge",
    href: "/chat",
    icon: MessageSquare,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Assistant",
  },
  {
    label: "Activities",
    href: "/qrm/activities",
    icon: MessageCircleMore,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Core",
  },
  {
    label: "Deals",
    href: "/qrm/deals",
    icon: LayoutGrid,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Core",
  },
  {
    label: "Contacts",
    href: "/qrm/contacts",
    icon: UsersRound,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Core",
  },
  {
    label: "Companies",
    href: "/qrm/companies",
    icon: Building2,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Core",
  },
  {
    label: "Templates",
    href: "/qrm/templates",
    icon: BookOpen,
    roles: ["admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Core",
  },
  {
    label: "Sequences",
    href: "/qrm/sequences",
    icon: Workflow,
    roles: ["admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Core",
  },
  {
    label: "Time Bank",
    href: "/qrm/time-bank",
    icon: Timer,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Execution",
  },
  {
    label: "Inventory Pressure",
    href: "/qrm/inventory-pressure",
    icon: ShieldAlert,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Execution",
  },
  {
    label: "Iron in Motion",
    href: "/qrm/iron-in-motion",
    icon: Truck,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Execution",
  },
  {
    label: "Exceptions",
    href: "/qrm/exceptions",
    icon: ShieldAlert,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Execution",
  },
  {
    label: "Opportunity Map",
    href: "/qrm/opportunity-map",
    icon: MapIcon,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Signals",
  },
  {
    label: "Operations Copilot",
    href: "/qrm/operations-copilot",
    icon: Bot,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Signals",
  },
  {
    label: "Replacement Prediction",
    href: "/qrm/replacement-prediction",
    icon: CalendarClock,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Signals",
  },
  {
    label: "Competitive Threat",
    href: "/qrm/competitive-threat-map",
    icon: Crosshair,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Signals",
  },
  {
    label: "Seasonal Opportunity",
    href: "/qrm/seasonal-opportunity-map",
    icon: Sprout,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Signals",
  },
  {
    label: "Learning Layer",
    href: "/qrm/learning-layer",
    icon: BookOpen,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Signals",
  },
  {
    label: "Revenue Rescue",
    href: "/qrm/revenue-rescue",
    icon: LifeBuoy,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Signals",
  },
  {
    label: "Competitive Displacement",
    href: "/qrm/competitive-displacement",
    icon: Swords,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Signals",
  },
  {
    label: "Operator Intelligence",
    href: "/qrm/operator-intelligence",
    icon: Mic,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Signals",
  },
  {
    label: "Post-Sale Experience",
    href: "/qrm/post-sale-experience",
    icon: HeartHandshake,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Signals",
  },
  {
    label: "Workflow Audit",
    href: "/qrm/workflow-audit",
    icon: Workflow,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Signals",
  },
  {
    label: "SOP + Folk",
    href: "/qrm/sop-folk",
    icon: LibraryBig,
    roles: ["rep", "admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Signals",
  },
  {
    label: "Rep SKU",
    href: "/qrm/rep-sku",
    icon: PackageSearch,
    roles: ["admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Admin",
  },
  {
    label: "Exit Register",
    href: "/qrm/exit-register",
    icon: DoorClosed,
    roles: ["admin", "manager", "owner"],
    primaryHeaderId: "qrm",
    sectionLabel: "Admin",
  },
  {
    label: "My Mirror",
    href: "/qrm/my/reality",
    icon: UserRound,
    roles: ["rep"],
    primaryHeaderId: "qrm",
    sectionLabel: "Admin",
  },
  {
    label: "Operating System",
    href: "/os",
    icon: Layers3,
    roles: ["rep", "admin", "manager", "owner"],
    utility: true,
    sectionLabel: "System",
  },
  {
    label: "Executive",
    href: "/executive",
    icon: Gauge,
    roles: ["admin", "manager", "owner"],
    utility: true,
    sectionLabel: "System",
  },
  {
    label: "Admin",
    href: "/admin",
    icon: Settings,
    roles: ["admin", "manager", "owner"],
    utility: true,
    sectionLabel: "Admin",
  },
  {
    label: "Integrations",
    href: "/admin/integrations",
    icon: Plug,
    roles: ["admin", "owner"],
    utility: true,
    sectionLabel: "Admin",
  },
];

export const BOTTOM_TAB_HREFS = ["/qrm", "/service", "/chat", "/voice", "/quote-v2"];

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

function groupItemsBySection(items: NavItem[]): NavSection[] {
  const bySection = new Map<string, NavItem[]>();
  for (const item of items) {
    const sectionKey = item.sectionLabel ?? "General";
    const existing = bySection.get(sectionKey);
    if (existing) {
      existing.push(item);
    } else {
      bySection.set(sectionKey, [item]);
    }
  }
  return Array.from(bySection.entries()).map(([label, sectionItems]) => ({
    label,
    items: sectionItems,
  }));
}

export function resolvePrimaryNavGroups(
  quoteBuilderEnabled: boolean,
  quoteBuilderLoading: boolean,
  role: UserRole
): PrimaryNavGroup[] {
  const navItems = resolveNavItems(quoteBuilderEnabled, quoteBuilderLoading).filter(
    (item) => item.roles.includes(role) && item.primaryHeaderId
  );

  return PRIMARY_NAV_GROUPS.map((group) => {
    const groupItems = navItems.filter((item) => item.primaryHeaderId === group.id);
    return {
      ...group,
      sections: groupItems.length > 0 ? groupItemsBySection(groupItems) : [],
    };
  }).filter((group) => group.sections.length > 0);
}

export function resolveUtilityNavSections(
  quoteBuilderEnabled: boolean,
  quoteBuilderLoading: boolean,
  role: UserRole
): NavSection[] {
  const utilityItems = resolveNavItems(quoteBuilderEnabled, quoteBuilderLoading).filter(
    (item) => item.roles.includes(role) && item.utility
  );
  return groupItemsBySection(utilityItems);
}

export function resolveActivePrimaryHeader(pathname: string): PrimaryHeaderId | null {
  if (
    pathname === "/dashboard" ||
    pathname === "/dashboard/classic" ||
    pathname.startsWith("/quote") ||
    pathname === "/voice" ||
    pathname.startsWith("/voice/") ||
    pathname === "/voice-qrm"
  ) {
    return "sales";
  }

  if (pathname.startsWith("/parts") || pathname === "/qrm/parts-intelligence") {
    return "parts";
  }

  if (pathname.startsWith("/service") || pathname === "/qrm/service-to-sales") {
    return "service";
  }

  if (
    pathname === "/rentals" ||
    pathname.startsWith("/rentals/") ||
    pathname === "/qrm/rentals" ||
    pathname.startsWith("/qrm/rentals/") ||
    /^\/qrm\/accounts\/[^/]+\/rental-conversion$/.test(pathname)
  ) {
    return "rentals";
  }

  if (pathname === "/chat" || pathname.startsWith("/qrm")) {
    return "qrm";
  }

  return null;
}

export function isUtilityRoute(pathname: string): boolean {
  return (
    pathname === "/os" ||
    pathname.startsWith("/executive") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
  );
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
