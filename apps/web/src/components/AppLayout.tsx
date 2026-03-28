import { useState, useEffect } from "react";
import { useLocation, NavLink, Link } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Mic,
  FileText,
  Settings,
  LogOut,
  Menu,
  HardHat,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
  Home,
  Bell,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
}

export interface AppLayoutProps {
  profile: Profile;
  onLogout: () => void;
  children: React.ReactNode;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
  gated?: boolean;
}

const isIntelliDealerConnected = !!import.meta.env.VITE_INTELLIDEALER_URL;

const NAV_ITEMS: NavItem[] = [
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
    gated: !isIntelliDealerConnected,
  },
  {
    label: "Admin",
    href: "/admin",
    icon: Settings,
    roles: ["admin", "manager", "owner"],
  },
];

const ROLE_LABELS: Record<UserRole, string> = {
  rep: "Sales Rep",
  admin: "Admin",
  manager: "Manager",
  owner: "Owner",
};

const ROLE_BADGE_VARIANT: Record<
  UserRole,
  "default" | "secondary" | "info" | "success"
> = {
  owner: "default",    // orange
  admin: "info",       // blue
  manager: "success",  // green
  rep: "secondary",    // gray
};

const BREADCRUMB_LABELS: Record<string, string> = {
  "/chat": "Knowledge Chat",
  "/voice": "Field Note",
  "/quote": "Quote Builder",
  "/admin": "Admin",
};

function getInitials(name: string | null, email: string | null): string {
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

function Breadcrumb() {
  const location = useLocation();
  const label = BREADCRUMB_LABELS[location.pathname];
  if (!label) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-[#94A3B8] mb-0">
      <Link
        to="/dashboard"
        className="flex items-center gap-1 hover:text-foreground transition-colors duration-150"
      >
        <Home className="w-3.5 h-3.5" />
        <span>Home</span>
      </Link>
      <ChevronRight className="w-3.5 h-3.5 shrink-0" />
      <span className="text-foreground font-medium">{label}</span>
    </nav>
  );
}

function NavContent({
  profile,
  onLogout,
  onNavClick,
  isCollapsed,
}: {
  profile: Profile;
  onLogout: () => void;
  onNavClick?: () => void;
  isCollapsed?: boolean;
}) {
  const location = useLocation();
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);

  const visibleItems = NAV_ITEMS.filter((item) =>
    item.roles.includes(profile.role)
  );

  return (
    <div className="flex flex-col h-full bg-qep-dark">
      {/* Brand */}
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-5",
          isCollapsed && "justify-center px-2"
        )}
      >
        <HardHat className="w-7 h-7 text-qep-orange shrink-0" />
        {!isCollapsed && (
          <div>
            <p className="font-bold text-sm leading-none text-white">QEP</p>
            <p className="text-xs leading-none mt-0.5 text-[#94A3B8]">
              Quality Equipment &amp; Parts
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-white/10" />

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        <TooltipProvider delayDuration={0}>
          {visibleItems.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? location.pathname === "/" || location.pathname === "/dashboard"
                : location.pathname.startsWith(item.href);

            const navContent = (
              <div
                className={cn(
                  "relative flex items-center gap-3 py-2 text-sm font-medium rounded-md transition-colors duration-150 cursor-pointer select-none",
                  isCollapsed ? "justify-center px-2" : "px-3",
                  isActive
                    ? "bg-[rgba(232,119,34,0.1)] text-white"
                    : item.gated
                    ? "text-[#94A3B8] opacity-60 cursor-not-allowed"
                    : "text-[#94A3B8] hover:bg-[rgba(255,255,255,0.05)]"
                )}
              >
                {/* Active left bar */}
                {isActive && (
                  <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-qep-orange rounded-r-sm" />
                )}

                <item.icon
                  className={cn(
                    "w-4 h-4 shrink-0",
                    isActive ? "text-qep-orange" : ""
                  )}
                />

                {!isCollapsed && (
                  <>
                    <span className="flex-1">{item.label}</span>
                    {item.gated && <Lock className="w-3.5 h-3.5 shrink-0" />}
                  </>
                )}
              </div>
            );

            // Gated item — no navigation, show tooltip
            if (item.gated) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <div>{navContent}</div>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    Connect IntelliDealer in Admin to access Quote Builder
                  </TooltipContent>
                </Tooltip>
              );
            }

            // Collapsed — wrap in tooltip showing label
            if (isCollapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <NavLink
                      to={item.href}
                      onClick={onNavClick}
                      className="block"
                    >
                      {navContent}
                    </NavLink>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            }

            return (
              <NavLink
                key={item.href}
                to={item.href}
                onClick={onNavClick}
                className="block"
              >
                {navContent}
              </NavLink>
            );
          })}
        </TooltipProvider>
      </nav>

      <div className="border-t border-white/10" />

      {/* User footer */}
      <div className={cn("px-3 py-4", isCollapsed && "px-2")}>
        {!isCollapsed && (
          <>
            <div className="flex items-center gap-3 mb-2">
              <Avatar className="w-8 h-8 shrink-0">
                <AvatarFallback className="bg-qep-orange text-white text-xs">
                  {getInitials(profile.full_name, profile.email)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-white">
                  {profile.full_name ?? profile.email ?? "User"}
                </p>
                <p className="text-xs truncate text-[#94A3B8]">
                  {profile.email}
                </p>
              </div>
            </div>
            <Badge
              variant={ROLE_BADGE_VARIANT[profile.role]}
              className="mb-3 text-xs"
            >
              {ROLE_LABELS[profile.role]}
            </Badge>
          </>
        )}

        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size={isCollapsed ? "icon" : "sm"}
                onClick={() => setShowSignOutDialog(true)}
                className={cn(
                  "text-[#94A3B8] hover:text-white hover:bg-white/10",
                  isCollapsed ? "w-full" : "w-full justify-start"
                )}
              >
                <LogOut className={cn("w-4 h-4", !isCollapsed && "mr-2")} />
                {!isCollapsed && "Sign out"}
              </Button>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">Sign out</TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Sign out confirmation dialog */}
      <Dialog open={showSignOutDialog} onOpenChange={setShowSignOutDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
            <DialogDescription>
              You'll need to sign in again to access QEP.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setShowSignOutDialog(false);
                onLogout();
              }}
            >
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NotificationBell({ count, dark = true }: { count: number; dark?: boolean }) {
  const iconClass = dark
    ? "text-[#94A3B8] hover:text-white hover:bg-white/10"
    : "text-muted-foreground hover:text-foreground hover:bg-muted";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Notifications${count > 0 ? ` (${count})` : ""}`}
      className={cn("relative", iconClass)}
    >
      <Bell className="w-5 h-5" />
      {count > 0 && (
        <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-qep-orange text-white text-[9px] font-bold leading-none">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Button>
  );
}

/** Bottom tab bar items — 4 primary items (exclude Admin which goes in the drawer) */
const BOTTOM_TAB_ITEMS: NavItem[] = NAV_ITEMS.filter((item) =>
  ["/dashboard", "/chat", "/voice", "/quote"].includes(item.href)
);

function MobileBottomTabBar({
  profile,
  onMenuOpen,
}: {
  profile: Profile;
  onMenuOpen: () => void;
}) {
  const location = useLocation();

  const visibleTabs = BOTTOM_TAB_ITEMS.filter((item) =>
    item.roles.includes(profile.role)
  );

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
              <Lock className="w-2.5 h-2.5 absolute top-2 right-2 text-[#4A5568]" aria-hidden="true" />
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
            aria-current={isActive ? "page" : undefined}
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

export function AppLayout({ profile, onLogout, children }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);

  useEffect(() => {
    async function fetchNotificationCount() {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [docsResult, voiceResult] = await Promise.all([
        supabase
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .gte("created_at", since),
        supabase
          .from("voice_captures")
          .select("id", { count: "exact", head: true })
          .gte("created_at", since),
      ]);
      setNotificationCount((docsResult.count ?? 0) + (voiceResult.count ?? 0));
    }
    fetchNotificationCount();
  }, []);

  const sidebarWidth = isCollapsed ? "lg:w-16" : "lg:w-64";
  const mainPadding = isCollapsed ? "lg:pl-16" : "lg:pl-64";

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 border-r border-white/10 transition-all duration-250 ease-out",
          sidebarWidth
        )}
        aria-label="Sidebar navigation"
      >
        <NavContent
          profile={profile}
          onLogout={onLogout}
          isCollapsed={isCollapsed}
        />

        {/* Collapse toggle */}
        <button
          onClick={() => setIsCollapsed((v) => !v)}
          className="absolute -right-3 top-[72px] w-6 h-6 rounded-full bg-qep-dark border border-white/20 flex items-center justify-center text-[#94A3B8] hover:text-white transition-colors duration-150 z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--qep-orange))]"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="w-3 h-3" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="w-3 h-3" aria-hidden="true" />
          )}
        </button>
      </aside>

      {/* Mobile top header (brand + notifications) */}
      <div
        className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14 bg-qep-dark border-b border-white/10"
        role="banner"
      >
        <div className="flex items-center gap-2">
          <HardHat className="w-6 h-6 text-qep-orange" aria-hidden="true" />
          <span className="font-bold text-sm text-white">QEP</span>
        </div>

        <NotificationBell count={notificationCount} />
      </div>

      {/* Mobile full-nav drawer (sheet) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-64 p-0 bg-qep-dark border-r border-white/10"
        >
          <NavContent
            profile={profile}
            onLogout={onLogout}
            onNavClick={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Mobile bottom tab bar */}
      <MobileBottomTabBar
        profile={profile}
        onMenuOpen={() => setMobileOpen(true)}
      />

      {/* Main content */}
      <main className={cn("flex-1 transition-all duration-200", mainPadding)}>
        {/* Desktop top bar */}
        <div className="hidden lg:flex items-center justify-end px-6 h-12 border-b border-border bg-white">
          <NotificationBell count={notificationCount} dark={false} />
        </div>
        {/* pt-14: clears mobile top header; pb-16: clears mobile bottom tab bar; lg overrides */}
        <div className="pt-14 pb-16 lg:pt-12 lg:pb-0 min-h-screen">
          {/* Breadcrumb bar (all pages except Dashboard) */}
          <BreadcrumbBar />
          {children}
        </div>
      </main>
    </div>
  );
}

function BreadcrumbBar() {
  const location = useLocation();
  const label = BREADCRUMB_LABELS[location.pathname];
  if (!label) return null;

  return (
    <div className="px-6 pt-5 pb-0">
      <Breadcrumb />
    </div>
  );
}
