import { NavLink, useLocation } from "react-router-dom";
import {
  MessageCircleMore,
  LayoutGrid,
  UsersRound,
  Building2,
  Megaphone,
  Timer,
  AlertTriangle,
  Truck,
  Warehouse,
  Wrench,
  Package,
  ShieldAlert,
  Map,
  Bot,
  CalendarClock,
  LifeBuoy,
  Swords,
  Crosshair,
  Sprout,
  BookOpen,
  Mic2,
  HeartHandshake,
  Workflow,
  LibraryBig,
  UserRound,
  PackageSearch,
  DoorClosed,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { FLAGS, isFeatureEnabled } from "@/lib/feature-flags";
import { QrmShellV2 } from "../shell/QrmShellV2";

interface SubNavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Array<"rep" | "admin" | "manager" | "owner">;
}

const CRM_SUB_NAV_ITEMS: SubNavItem[] = [
  { label: "Activities", href: "/qrm/activities", icon: MessageCircleMore },
  { label: "Campaigns", href: "/qrm/campaigns", icon: Megaphone, roles: ["admin", "manager", "owner"] },
  { label: "Deals", href: "/qrm/deals", icon: LayoutGrid },
  { label: "Contacts", href: "/qrm/contacts", icon: UsersRound },
  { label: "Companies", href: "/qrm/companies", icon: Building2 },
  { label: "Time Bank", href: "/qrm/time-bank", icon: Timer },
  { label: "Inventory", href: "/qrm/inventory-pressure", icon: AlertTriangle },
  { label: "Motion", href: "/qrm/iron-in-motion", icon: Truck },
  { label: "Rentals", href: "/qrm/rentals", icon: Warehouse },
  { label: "Svc→Sales", href: "/qrm/service-to-sales", icon: Wrench },
  { label: "Parts Intel", href: "/qrm/parts-intelligence", icon: Package },
  { label: "Exceptions", href: "/qrm/exceptions", icon: ShieldAlert },
  { label: "Map", href: "/qrm/opportunity-map", icon: Map },
  { label: "Ops Copilot", href: "/qrm/operations-copilot", icon: Bot },
  { label: "Replace", href: "/qrm/replacement-prediction", icon: CalendarClock },
  { label: "Threat", href: "/qrm/competitive-threat-map", icon: Crosshair },
  { label: "Seasonal", href: "/qrm/seasonal-opportunity-map", icon: Sprout },
  { label: "Learning", href: "/qrm/learning-layer", icon: BookOpen },
  { label: "Rescue", href: "/qrm/revenue-rescue", icon: LifeBuoy },
  { label: "Compete", href: "/qrm/competitive-displacement", icon: Swords },
  { label: "Operators", href: "/qrm/operator-intelligence", icon: Mic2 },
  { label: "Post-Sale", href: "/qrm/post-sale-experience", icon: HeartHandshake },
  { label: "Audit", href: "/qrm/workflow-audit", icon: Workflow },
  { label: "SOP+Folk", href: "/qrm/sop-folk", icon: LibraryBig },
  { label: "Rep SKU", href: "/qrm/rep-sku", icon: PackageSearch, roles: ["admin", "manager", "owner"] },
  { label: "Exit Reg", href: "/qrm/exit-register", icon: DoorClosed, roles: ["admin", "manager", "owner"] },
  { label: "My Mirror", href: "/qrm/my/reality", icon: UserRound, roles: ["rep"] },
];

export function QrmSubNav() {
  const { profile } = useAuth();
  const { pathname } = useLocation();

  // Slice 0 cutover: when the 4-surface shell flag is on, every page that
  // used to render the 25-tab horizontal strip renders the new shell instead.
  // Default is now ON — the 26-tab legacy strip is only reachable by
  // explicitly setting localStorage.qep_flag_shell_v2=0 (for QA fallback).
  if (isFeatureEnabled(FLAGS.SHELL_V2, true)) {
    return <QrmShellV2 />;
  }

  const items = CRM_SUB_NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    if (!profile?.role) return false;
    return item.roles.includes(profile.role as "rep" | "admin" | "manager" | "owner");
  });

  return (
    <nav
      aria-label="QRM sections"
      className="mb-5 flex gap-1 overflow-x-auto border-b border-border pb-px"
    >
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");

        return (
          <NavLink
            key={item.href}
            to={item.href}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium transition-colors duration-150",
              active
                ? "border-b-2 border-qep-orange text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
