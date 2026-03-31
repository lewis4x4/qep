import { useState, useEffect } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import {
  HardHat,
  Search,
  Bell,
  LogOut,
  ChevronRight,
  Moon,
  Sun,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeAppearanceSubmenu } from "@/components/ThemeAppearanceSubmenu";
import { ThemePreferenceRadioGroup } from "@/components/ThemePreferenceRadioGroup";
import { useTheme } from "@/hooks/useTheme";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/database.types";
import { getInitials } from "@/lib/nav-config";
import { supabase } from "@/lib/supabase";
import { CrmGlobalSearchCommand } from "@/features/crm/components/CrmGlobalSearchCommand";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
}

interface TopBarProps {
  profile: Profile;
  onLogout: () => void;
}

const BELL_STORAGE_KEY = "qep-bell-last-click";

const BREADCRUMB_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/chat": "Knowledge",
  "/voice": "Field Note",
  "/quote": "Quotes",
  "/crm": "CRM",
  "/crm/activities": "Activities",
  "/crm/templates": "Templates",
  "/crm/sequences": "Sequences",
  "/crm/deals": "Deals",
  "/crm/contacts": "Contacts",
  "/crm/companies": "Companies",
  "/crm/duplicates": "Duplicates",
  "/admin": "Admin",
};

const QUICK_ACTION_MAP: Record<string, { label: string; route: string } | null> = {
  "/dashboard": { label: "New Quote", route: "/quote" },
  "/chat": { label: "New Chat", route: "/chat" },
  "/voice": { label: "Record", route: "/voice" },
  "/quote": { label: "New Quote", route: "/quote" },
  "/crm": { label: "CRM Hub", route: "/crm" },
  "/crm/activities": { label: "Activities", route: "/crm/activities" },
  "/crm/templates": { label: "Templates", route: "/crm/templates" },
  "/crm/sequences": { label: "Sequences", route: "/crm/sequences" },
  "/crm/deals": { label: "Deals", route: "/crm/deals" },
  "/crm/contacts": { label: "Contacts", route: "/crm/contacts" },
  "/crm/companies": { label: "Companies", route: "/crm/companies" },
  "/crm/duplicates": { label: "Duplicates", route: "/crm/duplicates" },
  "/admin": null,
};

function useBadge(): [boolean, () => void] {
  const [hasBadge, setHasBadge] = useState(false);

  useEffect(() => {
    async function checkUnread() {
      try {
        const lastClick = localStorage.getItem(BELL_STORAGE_KEY);
        const since = lastClick ?? new Date(0).toISOString();
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
        const total = (docsResult.count ?? 0) + (voiceResult.count ?? 0);
        setHasBadge(total > 0);
      } catch {
        // localStorage unavailable or query failed — no badge
        setHasBadge(false);
      }
    }
    void checkUnread();
  }, []);

  function clearBadge() {
    try {
      localStorage.setItem(BELL_STORAGE_KEY, new Date().toISOString());
    } catch {
      // localStorage unavailable — ignore
    }
    setHasBadge(false);
  }

  return [hasBadge, clearBadge];
}

export function TopBar({ profile, onLogout }: TopBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState("");
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);
  const [hasBadge, clearBadge] = useBadge();
  const { preference, resolvedDark } = useTheme();
  const showCrmSearch = location.pathname.startsWith("/crm");

  const themeAriaLabel =
    preference === "system"
      ? `Theme: following system (${resolvedDark ? "dark" : "light"})`
      : `Theme: ${preference}`;

  const isCrmSubPage =
    location.pathname.startsWith("/crm/") && location.pathname !== "/crm";
  const breadcrumbLabel =
    BREADCRUMB_LABELS[location.pathname] ??
    (location.pathname.startsWith("/crm/deals/") ? "Deal Detail" : undefined) ??
    (location.pathname.startsWith("/crm/contacts/") ? "Contact Detail" : undefined) ??
    (location.pathname.startsWith("/crm/companies/") ? "Company Detail" : undefined);
  const quickAction =
    QUICK_ACTION_MAP[location.pathname] ??
    (location.pathname.startsWith("/crm/deals/") ? { label: "Deals", route: "/crm/deals" } : null) ??
    (location.pathname.startsWith("/crm/contacts/") ? { label: "Contacts", route: "/crm/contacts" } : null) ??
    (location.pathname.startsWith("/crm/companies/") ? { label: "Companies", route: "/crm/companies" } : null) ??
    (location.pathname.startsWith("/crm/templates") ? { label: "Templates", route: "/crm/templates" } : null);

  // Clear search on route change
  useEffect(() => {
    setSearchValue("");
  }, [location.pathname]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const query = searchValue.trim();
    if (!query) return;
    setSearchValue("");
    navigate("/chat", { state: { initialQuery: query } });
  }

  function handleQuickAction() {
    if (!quickAction) return;
    if (quickAction.route === "/chat" && location.pathname === "/chat") {
      navigate("/chat", { state: { newChat: Date.now() } });
    } else {
      navigate(quickAction.route);
    }
  }

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-50 flex items-center px-4 gap-4 bg-qep-dark border-b border-white/10"
        style={{ height: "56px", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}
        role="banner"
      >
        {/* Left: Logo + Breadcrumb */}
        <div className="flex items-center gap-3 shrink-0">
          <Link to="/dashboard" className="flex items-center gap-2">
            <HardHat className="w-6 h-6 text-qep-orange" aria-hidden="true" />
            <span className="font-bold text-sm text-white">QEP</span>
          </Link>

          {breadcrumbLabel && (
            <nav
              aria-label="Breadcrumb"
              className="hidden lg:flex items-center gap-1.5 text-sm"
            >
              {isCrmSubPage ? (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-[#8A9BAE]" aria-hidden="true" />
                  <Link to="/crm" className="text-[#8A9BAE] hover:text-white transition-colors">
                    CRM
                  </Link>
                  <ChevronRight className="w-3.5 h-3.5 text-[#8A9BAE]" aria-hidden="true" />
                  <span className="text-white font-medium">{breadcrumbLabel}</span>
                </>
              ) : (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-[#8A9BAE]" aria-hidden="true" />
                  <span className="text-white font-medium">{breadcrumbLabel}</span>
                </>
              )}
            </nav>
          )}
        </div>

        {/* Center: Global search */}
        <div className="hidden lg:flex flex-1 justify-center" role="search">
          {showCrmSearch ? (
            <CrmGlobalSearchCommand />
          ) : (
            <form onSubmit={handleSearchSubmit} className="w-full max-w-[400px]">
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A9BAE] pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  placeholder="Search knowledge base, quotes, team..."
                  aria-label="Global search"
                  className={cn(
                    "w-full pl-9 pr-4 py-1.5 text-sm rounded-full",
                    "bg-white/10 border border-white/20 text-white placeholder:text-[#8A9BAE]",
                    "focus:outline-none focus:ring-2 focus:ring-qep-orange focus:bg-white/15",
                    "transition-all duration-150"
                  )}
                />
              </div>
            </form>
          )}
        </div>

        {/* Right: Quick action + Bell + Avatar */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {/* Quick action pill */}
          {quickAction && (
            <Button
              size="sm"
              onClick={handleQuickAction}
              className="hidden lg:flex rounded-full bg-qep-orange hover:bg-qep-orange-hover text-white text-xs px-3 h-8 font-medium"
            >
              {quickAction.label}
            </Button>
          )}

          {/* Theme — visible in top bar (Light / Dark / System) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={themeAriaLabel}
                aria-haspopup="menu"
                className="inline-flex text-[#94A3B8] hover:text-white hover:bg-white/10"
              >
                {resolvedDark ? (
                  <Moon className="w-5 h-5" aria-hidden />
                ) : (
                  <Sun className="w-5 h-5" aria-hidden />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Appearance
              </DropdownMenuLabel>
              <ThemePreferenceRadioGroup />
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Notification bell */}
          <Button
            variant="ghost"
            size="icon"
            aria-label={hasBadge ? "Notifications — new items" : "Notifications"}
            onClick={clearBadge}
            className="relative text-[#94A3B8] hover:text-white hover:bg-white/10"
          >
            <Bell className="w-5 h-5" />
            {hasBadge && (
              <span
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-qep-orange"
                aria-hidden="true"
              />
            )}
          </Button>

          {/* User avatar dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="User menu"
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange"
              >
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="bg-qep-orange text-white text-xs">
                    {getInitials(profile.full_name, profile.email)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <ThemeAppearanceSubmenu />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive cursor-pointer"
                onClick={() => setShowSignOutDialog(true)}
              >
                <LogOut className="w-4 h-4 mr-2" aria-hidden="true" />
                Log Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

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
    </>
  );
}
