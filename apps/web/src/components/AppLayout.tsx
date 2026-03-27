import { useState } from "react";
import { useLocation, NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Mic,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
  HardHat,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
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
}

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

function NavContent({
  profile,
  onLogout,
  onNavClick,
}: {
  profile: Profile;
  onLogout: () => void;
  onNavClick?: () => void;
}) {
  const location = useLocation();
  const visibleItems = NAV_ITEMS.filter((item) =>
    item.roles.includes(profile.role)
  );

  return (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="flex items-center gap-2 px-4 py-5">
        <HardHat className="w-7 h-7 text-accent" />
        <div>
          <p className="font-bold text-sm leading-none text-foreground">QEP</p>
          <p className="text-xs text-muted-foreground leading-none mt-0.5">
            Quality Equipment Parts
          </p>
        </div>
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? location.pathname === "/" || location.pathname === "/dashboard"
              : location.pathname.startsWith(item.href);

          return (
            <NavLink
              key={item.href}
              to={item.href}
              onClick={onNavClick}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                "hover:bg-secondary hover:text-secondary-foreground",
                isActive
                  ? "bg-primary text-primary-foreground border-l-2 border-accent"
                  : "text-muted-foreground"
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <Separator />

      {/* User footer */}
      <div className="px-3 py-4">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="w-8 h-8 shrink-0">
            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
              {getInitials(profile.full_name, profile.email)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate text-foreground">
              {profile.full_name ?? profile.email ?? "User"}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {profile.email}
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="mb-3 text-xs">
          {ROLE_LABELS[profile.role]}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={onLogout}
          className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign out
        </Button>
      </div>
    </div>
  );
}

export function AppLayout({ profile, onLogout, children }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 border-r bg-card">
        <NavContent profile={profile} onLogout={onLogout} />
      </aside>

      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14 bg-card border-b">
        <div className="flex items-center gap-2">
          <HardHat className="w-6 h-6 text-accent" />
          <span className="font-bold text-sm text-foreground">QEP</span>
        </div>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation">
              {mobileOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <NavContent
              profile={profile}
              onLogout={onLogout}
              onNavClick={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main content */}
      <main className="flex-1 lg:pl-64">
        <div className="pt-14 lg:pt-0 min-h-screen">{children}</div>
      </main>
    </div>
  );
}
