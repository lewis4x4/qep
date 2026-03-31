import { useState } from "react";
import { useLocation, NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Mic,
  FileText,
  Settings,
  Menu,
  HardHat,
  Lock,
  Plug,
  UsersRound,
  Building2,
  LayoutGrid,
  GitMerge,
  MessageCircleMore,
  NotebookPen,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/database.types";
import { NavRail } from "@/components/NavRail";
import { TopBar } from "@/components/TopBar";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
}

export interface AppLayoutProps {
  profile: Profile;
  onLogout: () => void;
  quoteBuilderEnabled: boolean;
  quoteBuilderLoading: boolean;
  children: React.ReactNode;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
  gated?: boolean;
}

interface NavItemDefinition {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
  requiresIntelliDealer?: boolean;
}

const NAV_ITEMS: NavItemDefinition[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "Knowledge Chat",
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
    label: "Quote Builder",
    href: "/quote",
    icon: FileText,
    roles: ["rep", "manager", "owner"],
    requiresIntelliDealer: true,
  },
  {
    label: "CRM Activities",
    href: "/crm/activities",
    icon: MessageCircleMore,
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "CRM Deals",
    href: "/crm/deals",
    icon: LayoutGrid,
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "CRM Contacts",
    href: "/crm/contacts",
    icon: UsersRound,
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "CRM Companies",
    href: "/crm/companies",
    icon: Building2,
    roles: ["rep", "admin", "manager", "owner"],
  },
  {
    label: "CRM Sequences",
    href: "/crm/sequences",
    icon: NotebookPen,
    roles: ["admin", "manager", "owner"],
  },
  {
    label: "CRM Templates",
    href: "/crm/templates",
    icon: NotebookPen,
    roles: ["admin", "manager", "owner"],
  },
  {
    label: "CRM Duplicates",
    href: "/crm/duplicates",
    icon: GitMerge,
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

const BOTTOM_TAB_HREFS = ["/dashboard", "/chat", "/voice", "/quote"];

function resolveNavItems(
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

function MobileBottomTabBar({
  profile,
  onMenuOpen,
  quoteBuilderEnabled,
  quoteBuilderLoading,
}: {
  profile: Profile;
  onMenuOpen: () => void;
  quoteBuilderEnabled: boolean;
  quoteBuilderLoading: boolean;
}) {
  const location = useLocation();
  const visibleTabs = resolveNavItems(quoteBuilderEnabled, quoteBuilderLoading)
    .filter((item) => BOTTOM_TAB_HREFS.includes(item.href))
    .filter((item) => item.roles.includes(profile.role));

  return (
    <nav
      aria-label="Main navigation"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch bg-qep-dark border-t border-white/10 safe-area-bottom"
    >
      {visibleTabs.map((item) => {
        const isActive =
          item.href === "/dashboard"
            ? location.pathname === "/" || location.pathname === "/dashboard"
            : location.pathname.startsWith(item.href);

        const tabContent = (
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-1 min-w-[44px] min-h-[56px] px-2 py-2 text-[10px] font-medium leading-none transition-colors duration-150",
              isActive
                ? "text-qep-orange"
                : item.gated
                ? "text-[#4A5568] cursor-not-allowed"
                : "text-[#94A3B8]"
            )}
          >
            <item.icon
              className={cn("w-5 h-5 shrink-0", isActive ? "text-qep-orange" : "")}
              aria-hidden="true"
            />
            <span className="truncate max-w-[56px] text-center">
              {item.label.split(" ")[0]}
            </span>
            {item.gated && (
              <Lock
                className="w-2.5 h-2.5 absolute top-2 right-2 text-[#4A5568]"
                aria-hidden="true"
              />
            )}
          </div>
        );

        if (item.gated) {
          return (
            <div
              key={item.href}
              className="flex-1 flex items-center justify-center relative"
              aria-label={`${item.label} — connect IntelliDealer to unlock`}
              role="none"
            >
              {tabContent}
            </div>
          );
        }

        return (
          <NavLink
            key={item.href}
            to={item.href}
            className="flex-1 flex items-center justify-center relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--qep-orange))] focus-visible:outline-offset-[-2px]"
            aria-label={item.label}
            aria-current={
              item.href === "/dashboard"
                ? location.pathname === "/" || location.pathname === "/dashboard"
                  ? "page"
                  : undefined
                : location.pathname.startsWith(item.href)
                ? "page"
                : undefined
            }
          >
            {tabContent}
          </NavLink>
        );
      })}

      {/* More / drawer trigger */}
      <button
        onClick={onMenuOpen}
        className="flex-1 flex flex-col items-center justify-center gap-1 min-w-[44px] min-h-[56px] px-2 py-2 text-[10px] font-medium text-[#94A3B8] transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--qep-orange))] focus-visible:outline-offset-[-2px]"
        aria-label="More options"
      >
        <Menu className="w-5 h-5 shrink-0" aria-hidden="true" />
        <span>More</span>
      </button>
    </nav>
  );
}

/** Mobile nav drawer content (used inside Sheet) */
function MobileNavContent({
  profile,
  onLogout,
  onNavClick,
  quoteBuilderEnabled,
  quoteBuilderLoading,
}: {
  profile: Profile;
  onLogout: () => void;
  onNavClick: () => void;
  quoteBuilderEnabled: boolean;
  quoteBuilderLoading: boolean;
}) {
  const location = useLocation();
  const visibleItems = resolveNavItems(quoteBuilderEnabled, quoteBuilderLoading).filter(
    (item) => item.roles.includes(profile.role)
  );

  return (
    <div className="flex flex-col h-full bg-qep-dark">
      <div className="flex items-center gap-2 px-4 py-5">
        <HardHat className="w-7 h-7 text-qep-orange shrink-0" />
        <div>
          <p className="font-bold text-sm leading-none text-white">QEP</p>
          <p className="text-xs leading-none mt-0.5 text-[#94A3B8]">
            Quality Equipment &amp; Parts
          </p>
        </div>
      </div>

      <div className="border-t border-white/10" />

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? location.pathname === "/" || location.pathname === "/dashboard"
              : location.pathname.startsWith(item.href);

          const itemContent = (
            <div
              className={cn(
                "relative flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors duration-150",
                isActive
                  ? "bg-[rgba(232,119,34,0.1)] text-white"
                  : item.gated
                  ? "text-[#94A3B8] opacity-60 cursor-not-allowed"
                  : "text-[#94A3B8] hover:bg-[rgba(255,255,255,0.05)]"
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-qep-orange rounded-r-sm" />
              )}
              <item.icon
                className={cn("w-4 h-4 shrink-0", isActive ? "text-white" : "")}
                aria-hidden="true"
              />
              <span className="flex-1">{item.label}</span>
              {item.gated && <Lock className="w-3.5 h-3.5 shrink-0" />}
            </div>
          );

          if (item.gated) {
            return (
              <div key={item.href} className="block">
                {itemContent}
              </div>
            );
          }

          return (
            <NavLink
              key={item.href}
              to={item.href}
              onClick={onNavClick}
              className="block"
              aria-current={isActive ? "page" : undefined}
            >
              {itemContent}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

export function AppLayout({
  profile,
  onLogout,
  quoteBuilderEnabled,
  quoteBuilderLoading,
  children,
}: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop: enhanced top bar */}
      <TopBar profile={profile} onLogout={onLogout} />

      {/* Desktop: hover-expand nav rail */}
      <NavRail
        profile={profile}
        onLogout={onLogout}
        quoteBuilderEnabled={quoteBuilderEnabled}
        quoteBuilderLoading={quoteBuilderLoading}
      />

      {/* Mobile: top header */}
      <div
        className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14 bg-qep-dark border-b border-white/10"
        role="banner"
      >
        <div className="flex items-center gap-2">
          <HardHat className="w-6 h-6 text-qep-orange" aria-hidden="true" />
          <span className="font-bold text-sm text-white">QEP</span>
        </div>
      </div>

      {/* Mobile: nav drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-64 p-0 bg-qep-dark border-r border-white/10"
        >
          <MobileNavContent
            profile={profile}
            onLogout={onLogout}
            onNavClick={() => setMobileOpen(false)}
            quoteBuilderEnabled={quoteBuilderEnabled}
            quoteBuilderLoading={quoteBuilderLoading}
          />
        </SheetContent>
      </Sheet>

      {/* Mobile: bottom tab bar */}
      <MobileBottomTabBar
        profile={profile}
        onMenuOpen={() => setMobileOpen(true)}
        quoteBuilderEnabled={quoteBuilderEnabled}
        quoteBuilderLoading={quoteBuilderLoading}
      />

      {/* Main content */}
      {/* pt-14: clears mobile top header; pb-16: clears mobile bottom tab bar */}
      {/* lg:pt-[56px]: clears desktop top bar; lg:pb-0; lg:ml-16: always-collapsed rail width */}
      <main className="flex-1 pt-14 pb-16 lg:pt-[56px] lg:pb-0 lg:ml-16 min-h-screen">
        {children}
      </main>
    </div>
  );
}
