import { useState } from "react";
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
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
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
    label: "Voice Capture",
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
  "/voice": "Voice Capture",
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

export function AppLayout({ profile, onLogout, children }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const sidebarWidth = isCollapsed ? "lg:w-16" : "lg:w-64";
  const mainPadding = isCollapsed ? "lg:pl-16" : "lg:pl-64";

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 border-r border-white/10 transition-all duration-200",
          sidebarWidth
        )}
      >
        <NavContent
          profile={profile}
          onLogout={onLogout}
          isCollapsed={isCollapsed}
        />

        {/* Collapse toggle */}
        <button
          onClick={() => setIsCollapsed((v) => !v)}
          className={cn(
            "absolute -right-3 top-[72px] w-6 h-6 rounded-full bg-qep-dark border border-white/20 flex items-center justify-center text-[#94A3B8] hover:text-white transition-colors duration-150 z-10"
          )}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="w-3 h-3" />
          ) : (
            <PanelLeftClose className="w-3 h-3" />
          )}
        </button>
      </aside>

      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14 bg-qep-dark border-b border-white/10">
        <div className="flex items-center gap-2">
          <HardHat className="w-6 h-6 text-qep-orange" />
          <span className="font-bold text-sm text-white">QEP</span>
        </div>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              className="text-[#94A3B8] hover:text-white hover:bg-white/10"
            >
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 bg-qep-dark border-r border-white/10">
            <NavContent
              profile={profile}
              onLogout={onLogout}
              onNavClick={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main content */}
      <main className={cn("flex-1 transition-all duration-200", mainPadding)}>
        <div className="pt-14 lg:pt-0 min-h-screen">
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
