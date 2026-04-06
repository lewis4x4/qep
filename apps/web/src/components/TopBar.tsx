import { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import {
  Search,
  Bell,
  LogOut,
  ChevronRight,
  Moon,
  Sun,
} from "lucide-react";
import { BRAND_NAME, BrandLogo } from "@/components/BrandLogo";
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
import { QrmGlobalSearchCommand } from "@/features/qrm/components/QrmGlobalSearchCommand";

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
  "/dashboard": "Command Center",
  "/chat": "Knowledge",
  "/voice": "Field Note",
  "/quote": "Quotes",
  "/qrm": "QRM",
  "/qrm/activities": "Activities",
  "/qrm/deals": "Deals",
  "/qrm/contacts": "Contacts",
  "/qrm/companies": "Companies",
  "/admin": "Admin",
  "/admin/sequences": "Sequences",
  "/admin/templates": "Templates",
  "/admin/duplicates": "Duplicates",
  "/admin/integrations": "Integrations",
};

const QUICK_ACTION_MAP: Record<string, { label: string; route: string } | null> = {
  "/dashboard": { label: "New Quote", route: "/quote" },
  "/chat": { label: "New Chat", route: "/chat" },
  "/voice": { label: "Record", route: "/voice" },
  "/quote": { label: "New Quote", route: "/quote" },
  "/qrm": { label: "QRM Hub", route: "/qrm" },
  "/qrm/activities": { label: "Activities", route: "/qrm/activities" },
  "/qrm/deals": { label: "Deals", route: "/qrm/deals" },
  "/qrm/contacts": { label: "Contacts", route: "/qrm/contacts" },
  "/qrm/companies": { label: "Companies", route: "/qrm/companies" },
  "/admin": null,
  "/admin/sequences": null,
  "/admin/templates": null,
  "/admin/duplicates": null,
  "/admin/integrations": null,
};

type QrmBellRow = {
  id: string;
  title: string;
  body: string | null;
  deal_id: string | null;
  created_at: string;
  read_at: string | null;
};

function useTopBarBell(profileId: string) {
  const [docVoiceBadge, setDocVoiceBadge] = useState(false);
  const [crmRows, setCrmRows] = useState<QrmBellRow[]>([]);
  const [crmUnread, setCrmUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function checkDocVoiceUnread() {
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
        if (cancelled) return;
        const total = (docsResult.count ?? 0) + (voiceResult.count ?? 0);
        setDocVoiceBadge(total > 0);
      } catch {
        if (!cancelled) setDocVoiceBadge(false);
      }
    }
    void checkDocVoiceUnread();
    return () => { cancelled = true; };
  }, []);

  const refreshCrmNotifications = useCallback(async () => {
    if (!profileId) return;
    try {
      const [{ count }, { data, error }] = await Promise.all([
        supabase
          .from("crm_in_app_notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", profileId)
          .is("read_at", null),
        supabase
          .from("crm_in_app_notifications")
          .select("id, title, body, deal_id, created_at, read_at")
          .eq("user_id", profileId)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (error) {
        setCrmUnread(0);
        setCrmRows([]);
        return;
      }
      setCrmUnread(count ?? 0);
      setCrmRows((data ?? []) as QrmBellRow[]);
    } catch {
      setCrmUnread(0);
      setCrmRows([]);
    }
  }, [profileId]);

  useEffect(() => {
    void refreshCrmNotifications();
  }, [refreshCrmNotifications]);

  useEffect(() => {
    const id = window.setInterval(() => void refreshCrmNotifications(), 90_000);
    return () => window.clearInterval(id);
  }, [refreshCrmNotifications]);

  function clearDocVoiceBadge() {
    try {
      localStorage.setItem(BELL_STORAGE_KEY, new Date().toISOString());
    } catch {
      // localStorage unavailable — ignore
    }
    setDocVoiceBadge(false);
  }

  const markCrmNotificationRead = useCallback(
    async (notificationId: string) => {
      await supabase
        .from("crm_in_app_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notificationId)
        .eq("user_id", profileId);
      await refreshCrmNotifications();
    },
    [profileId, refreshCrmNotifications],
  );

  return {
    showBadge: docVoiceBadge || crmUnread > 0,
    docVoiceBadge,
    crmUnread,
    crmRows,
    clearDocVoiceBadge,
    refreshCrmNotifications,
    markCrmNotificationRead,
  };
}

export function TopBar({ profile, onLogout }: TopBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState("");
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);
  const {
    showBadge,
    docVoiceBadge,
    crmUnread,
    crmRows,
    clearDocVoiceBadge,
    refreshCrmNotifications,
    markCrmNotificationRead,
  } = useTopBarBell(profile.id);
  const { preference, resolvedDark } = useTheme();
  const showCrmSearch = location.pathname.startsWith("/qrm");

  const themeAriaLabel =
    preference === "system"
      ? `Theme: following system (${resolvedDark ? "dark" : "light"})`
      : `Theme: ${preference}`;

  const isCrmSubPage =
    location.pathname.startsWith("/qrm/") && location.pathname !== "/qrm";
  const isAdminSubPage =
    location.pathname.startsWith("/admin/") && location.pathname !== "/admin";
  const breadcrumbLabel =
    BREADCRUMB_LABELS[location.pathname] ??
    (location.pathname.startsWith("/qrm/deals/") ? "Deal Detail" : undefined) ??
    (location.pathname.startsWith("/qrm/contacts/") ? "Contact Detail" : undefined) ??
    (location.pathname.startsWith("/qrm/companies/") ? "Company Detail" : undefined);
  const quickAction =
    QUICK_ACTION_MAP[location.pathname] ??
    (location.pathname.startsWith("/qrm/deals/") ? { label: "Deals", route: "/qrm/deals" } : null) ??
    (location.pathname.startsWith("/qrm/contacts/") ? { label: "Contacts", route: "/qrm/contacts" } : null) ??
    (location.pathname.startsWith("/qrm/companies/") ? { label: "Companies", route: "/qrm/companies" } : null);

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
          <Link
            to="/dashboard"
            className="flex min-w-0 max-w-[min(100%,18rem)] items-center gap-2"
            aria-label={`${BRAND_NAME} — dashboard`}
          >
            <div className="shrink-0 rounded bg-black/40 p-0.5 ring-1 ring-white/10">
              <BrandLogo className="h-7 w-auto max-w-[104px]" decorative />
            </div>
            <span
              className="hidden font-semibold text-xs leading-tight text-white sm:inline sm:max-w-[11rem] sm:truncate md:max-w-[14rem] lg:max-w-none"
              title={BRAND_NAME}
              aria-hidden
            >
              {BRAND_NAME}
            </span>
          </Link>

          {breadcrumbLabel && (
            <nav
              aria-label="Breadcrumb"
              className="hidden lg:flex items-center gap-1.5 text-sm"
            >
              {isCrmSubPage ? (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-[#8A9BAE]" aria-hidden="true" />
                  <Link to="/qrm" className="text-[#8A9BAE] hover:text-white transition-colors">
                    QRM
                  </Link>
                  <ChevronRight className="w-3.5 h-3.5 text-[#8A9BAE]" aria-hidden="true" />
                  <span className="text-white font-medium">{breadcrumbLabel}</span>
                </>
              ) : isAdminSubPage ? (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-[#8A9BAE]" aria-hidden="true" />
                  <Link to="/admin" className="text-[#8A9BAE] hover:text-white transition-colors">
                    Admin
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
            <QrmGlobalSearchCommand />
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

          {/* Notifications: follow-up alerts + knowledge / field notes */}
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) void refreshCrmNotifications();
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={showBadge ? "Notifications — new items" : "Notifications"}
                aria-haspopup="menu"
                className="relative text-[#94A3B8] hover:text-white hover:bg-white/10"
              >
                <Bell className="w-5 h-5" />
                {showBadge && (
                  <span
                    className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-qep-orange"
                    aria-hidden="true"
                  />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 max-h-[min(70vh,420px)] overflow-y-auto">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Follow-up alerts
                {crmUnread > 0 ? (
                  <span className="ml-2 text-qep-orange tabular-nums">({crmUnread} unread)</span>
                ) : null}
              </DropdownMenuLabel>
              {crmRows.length === 0 ? (
                <p className="px-2 pb-2 text-xs text-muted-foreground">No follow-up notifications.</p>
              ) : (
                crmRows.map((row) => (
                  <DropdownMenuItem
                    key={row.id}
                    className="flex cursor-pointer flex-col items-start gap-0.5 py-2"
                    disabled={!row.deal_id}
                    onClick={() => {
                      if (!row.deal_id) return;
                      void markCrmNotificationRead(row.id);
                      navigate(`/qrm/deals/${row.deal_id}`);
                    }}
                  >
                    <span className="text-sm font-medium text-foreground">{row.title}</span>
                    {row.body ? (
                      <span className="line-clamp-2 text-xs text-muted-foreground">{row.body}</span>
                    ) : null}
                    <span className="text-[10px] text-muted-foreground">
                      {row.read_at ? "Read" : "Unread — opens deal"}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Knowledge &amp; field notes
                {docVoiceBadge ? (
                  <span className="ml-2 text-qep-orange tabular-nums">(new)</span>
                ) : null}
              </DropdownMenuLabel>
              <DropdownMenuItem
                className="cursor-pointer text-sm"
                onClick={() => clearDocVoiceBadge()}
              >
                Mark documents &amp; voice captures as seen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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
              {`You'll need to sign in again to access ${BRAND_NAME}.`}
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
