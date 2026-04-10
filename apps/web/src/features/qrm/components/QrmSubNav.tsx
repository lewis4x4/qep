import { NavLink, useLocation } from "react-router-dom";
import {
  MessageCircleMore,
  LayoutGrid,
  UsersRound,
  Building2,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SubNavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const CRM_SUB_NAV_ITEMS: SubNavItem[] = [
  { label: "Activities", href: "/qrm/activities", icon: MessageCircleMore },
  { label: "Deals", href: "/qrm/deals", icon: LayoutGrid },
  { label: "Contacts", href: "/qrm/contacts", icon: UsersRound },
  { label: "Companies", href: "/qrm/companies", icon: Building2 },
  { label: "Time Bank", href: "/qrm/time-bank", icon: Timer },
];

export function QrmSubNav() {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="QRM sections"
      className="mb-5 flex gap-1 overflow-x-auto border-b border-border pb-px"
    >
      {CRM_SUB_NAV_ITEMS.map((item) => {
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
