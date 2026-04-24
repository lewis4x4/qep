import { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import {
  Search,
  Bell,
  LogOut,
  ChevronDown,
  Moon,
  Sun,
  PanelTopOpen,
  Bug,
  Menu,
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
import {
  getInitials,
  isUtilityRoute,
  resolveActivePrimaryHeader,
  resolvePrimaryNavGroups,
  resolveUtilityNavSections,
} from "@/lib/nav-config";
import { supabase } from "@/lib/supabase";
import { QrmGlobalSearchCommand } from "@/features/qrm/components/QrmGlobalSearchCommand";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
  iron_role: string | null;
  iron_role_display: string | null;
  is_support: boolean;
  /** Nullable to match useAuth.Profile — Slice 08 M4 fix. */
  active_workspace_id: string | null;
}

interface TopBarProps {
  profile: Profile;
  onLogout: () => void;
  quoteBuilderEnabled?: boolean;
  quoteBuilderLoading?: boolean;
  /** Slice: The Floor — when true, the Back-to-Floor chip (36px) is
   *  pinned above TopBar, so TopBar shifts down to clear it. */
  floorMode?: boolean;
}

const BELL_STORAGE_KEY = "qep-bell-last-click";

const BREADCRUMB_LABELS: Record<string, string> = {
  "/dashboard": "Command Center",
  "/os": "Operating System",
  "/chat": "Knowledge",
  "/voice": "Field Note",
  "/sales/field-note": "Field Note",
  "/quote": "Quotes",
  "/sales/quotes": "Quotes",
  "/quote-v2": "Quote Builder",
  "/qrm": "QRM",
  "/qrm/activities": "Activities",
  "/qrm/deals": "Deals",
  "/qrm/contacts": "Contacts",
  "/qrm/companies": "Companies",
  "/qrm/iron-in-motion": "Iron in Motion",
  "/qrm/rentals": "Rental Command",
  "/qrm/service-to-sales": "Service-to-Sales",
  "/qrm/parts-intelligence": "Parts Intelligence",
  "/qrm/exceptions": "Exception Handling",
  "/qrm/opportunity-map": "Opportunity Map",
  "/qrm/operations-copilot": "AI Operations Copilot",
  "/qrm/competitive-threat-map": "Competitive Threat Map",
  "/qrm/learning-layer": "Learning Layer",
  "/qrm/seasonal-opportunity-map": "Seasonal Opportunity Map",
  "/qrm/replacement-prediction": "Replacement Prediction",
  "/qrm/revenue-rescue": "Revenue Rescue",
  "/qrm/competitive-displacement": "Competitive Displacement",
  "/qrm/operator-intelligence": "Operator Intelligence",
  "/qrm/post-sale-experience": "Post-Sale Experience",
  "/qrm/workflow-audit": "Workflow Audit",
  "/qrm/sop-folk": "SOP + Folk Workflow",
  "/qrm/rep-sku": "Rep as SKU",
  "/qrm/exit-register": "Death and Exit Register",
  "/qrm/my/reality": "Rep Reality Reflection",
  "/nervous-system": "Nervous System",
  "/price-intelligence": "Price Intelligence",
  "/exceptions": "Exception Inbox",
  "/admin/data-quality": "Data Quality",
  "/exec": "Executive Intelligence Center",
  "/executive": "Executive Intelligence Center",
  "/executive/live": "Executive Intelligence Center",
  "/executive/owner-briefing": "AI Owner Briefing",
  "/executive/vision": "Executive Vision",
  "/admin": "Admin",
  "/admin/sequences": "Sequences",
  "/admin/templates": "Templates",
  "/admin/duplicates": "Duplicates",
  "/admin/integrations": "Integrations",
  "/admin/documents": "Document Center",
};

const QUICK_ACTION_MAP: Record<string, { label: string; route: string } | null> = {
  "/dashboard": { label: "Open OS Hub", route: "/os" },
  "/os": { label: "Open QRM", route: "/qrm" },
  "/chat": { label: "New Chat", route: "/chat" },
  "/voice": { label: "Record", route: "/voice" },
  "/sales/field-note": { label: "Record", route: "/sales/field-note" },
  "/quote": { label: "New Quote", route: "/quote-v2" },
  "/sales/quotes": { label: "New Quote", route: "/quote-v2" },
  "/quote-v2": { label: "New Quote", route: "/quote-v2" },
  "/qrm": { label: "QRM Hub", route: "/qrm" },
  "/qrm/activities": { label: "Activities", route: "/qrm/activities" },
  "/qrm/deals": { label: "Deals", route: "/qrm/deals" },
  "/qrm/contacts": { label: "Contacts", route: "/qrm/contacts" },
  "/qrm/companies": { label: "Companies", route: "/qrm/companies" },
  "/qrm/iron-in-motion": { label: "Open traffic", route: "/ops/traffic" },
  "/qrm/rentals": { label: "Open returns", route: "/ops/returns" },
  "/qrm/service-to-sales": { label: "Open service", route: "/service" },
  "/qrm/parts-intelligence": { label: "Open parts", route: "/parts/analytics" },
  "/qrm/exceptions": { label: "Open inbox", route: "/exceptions" },
  "/qrm/opportunity-map": { label: "Open fleet", route: "/fleet" },
  "/qrm/operations-copilot": { label: "Open ops", route: "/ops/payments" },
  "/qrm/competitive-threat-map": { label: "Open compete", route: "/qrm/competitive-displacement" },
  "/qrm/learning-layer": { label: "Open workflow audit", route: "/qrm/workflow-audit" },
  "/qrm/seasonal-opportunity-map": { label: "Open map", route: "/qrm/opportunity-map" },
  "/qrm/replacement-prediction": { label: "Open QRM", route: "/qrm" },
  "/qrm/revenue-rescue": { label: "Open blockers", route: "/qrm/command/blockers" },
  "/qrm/competitive-displacement": { label: "Open account command", route: "/qrm/companies" },
  "/qrm/operator-intelligence": { label: "Open voice QRM", route: "/voice-qrm" },
  "/qrm/post-sale-experience": { label: "Open portal", route: "/portal" },
  "/qrm/workflow-audit": { label: "Open flow admin", route: "/admin/flow" },
  "/qrm/sop-folk": { label: "Open SOP dashboard", route: "/ops/sop-compliance" },
  "/qrm/rep-sku": { label: "Open deals", route: "/qrm/deals" },
  "/qrm/exit-register": { label: "Open companies", route: "/qrm/companies" },
  "/qrm/my/reality": { label: "Open deals", route: "/qrm/deals" },
  "/nervous-system": { label: "Open OS Hub", route: "/os" },
  "/price-intelligence": { label: "Open OS Hub", route: "/os" },
  "/exceptions": { label: "Open OS Hub", route: "/os" },
  "/admin/data-quality": { label: "Open OS Hub", route: "/os" },
  "/exec": { label: "Open OS Hub", route: "/os" },
  "/executive": { label: "Open OS Hub", route: "/os" },
  "/executive/live": { label: "Open executive", route: "/executive" },
  "/executive/owner-briefing": { label: "Open executive", route: "/executive" },
  "/executive/vision": { label: "Open live executive", route: "/executive" },
  "/admin": null,
  "/admin/sequences": null,
  "/admin/templates": null,
  "/admin/duplicates": null,
  "/admin/integrations": null,
  "/admin/documents": null,
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

export function TopBar({ profile, onLogout, quoteBuilderEnabled = true, quoteBuilderLoading = false, floorMode = false }: TopBarProps) {
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
  const isQuotesListRoute = location.pathname === "/sales/quotes";

  const primaryNavGroups = resolvePrimaryNavGroups(
    quoteBuilderEnabled,
    quoteBuilderLoading,
    profile.role
  );
  const utilitySections = resolveUtilityNavSections(
    quoteBuilderEnabled,
    quoteBuilderLoading,
    profile.role
  );
  const activePrimaryHeader = resolveActivePrimaryHeader(location.pathname);
  const utilityRouteActive = isUtilityRoute(location.pathname);

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
    (location.pathname.startsWith("/m/qrm") ? "Mobile Field Command" : undefined) ??
    (location.pathname.startsWith("/qrm/visit-intelligence") ? "Visit Intelligence" : undefined) ??
    (location.pathname.startsWith("/qrm/branches/") && location.pathname.endsWith("/chief") ? "AI Branch Chief" : undefined) ??
    (location.pathname.includes("/deals/") && location.pathname.endsWith("/room") ? "Deal Room" : undefined) ??
    (location.pathname.includes("/deals/") && location.pathname.endsWith("/decision-room") ? "Decision Room Simulator" : undefined) ??
    (location.pathname.includes("/deals/") && location.pathname.endsWith("/coach") ? "AI Deal Coach" : undefined) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/decision-cycle") ? "Decision Cycle Synchronizer" : undefined) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/ecosystem") ? "Ecosystem Layer" : undefined) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/reputation") ? "Reputation Surface" : undefined) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/cashflow-weather") ? "Cashflow Weather Map" : undefined) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/cross-dealer-mirror") ? "Cross-Dealer Mirror" : undefined) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/strategist") ? "AI Customer Strategist" : undefined) ??
    (location.pathname.includes("/deals/") && location.pathname.endsWith("/autopsy") ? "Deal Autopsy" : undefined) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/rental-conversion") ? "Rental Conversion Engine" : undefined) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/white-space") ? "White-Space Map" : undefined) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/relationship-map") ? "Relationship Map" : undefined) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/fleet-intelligence") ? "Fleet Intelligence" : undefined) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/operating-profile") ? "Customer Operating Profile" : undefined) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/genome") ? "Customer Genome" : undefined) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/timeline") ? "Customer 360 Timeline" : undefined) ??
    (location.pathname.includes("/trade-walkaround") ? "Trade Walkaround" : undefined) ??
    (location.pathname.startsWith("/qrm/deals/") ? "Deal Detail" : undefined) ??
    (location.pathname.startsWith("/qrm/contacts/") ? "Contact Detail" : undefined) ??
    (location.pathname.startsWith("/qrm/accounts/") ? "Account Command" : undefined) ??
    (location.pathname.startsWith("/qrm/territories/") ? "Territory Command" : undefined) ??
    (location.pathname.startsWith("/qrm/companies/") ? "Company Detail" : undefined);
  const quickAction =
    QUICK_ACTION_MAP[location.pathname] ??
    (location.pathname.startsWith("/m/qrm") ? { label: "QRM", route: "/qrm" } : null) ??
    (location.pathname.startsWith("/qrm/visit-intelligence") ? { label: "QRM", route: "/qrm" } : null) ??
    (location.pathname.startsWith("/qrm/branches/") && location.pathname.endsWith("/chief") ? { label: "Branch command", route: location.pathname.replace(/\/chief$/, "/command") } : null) ??
    (location.pathname.includes("/deals/") && location.pathname.endsWith("/room") ? { label: "Deals", route: "/qrm/deals" } : null) ??
    (location.pathname.includes("/deals/") && location.pathname.endsWith("/decision-room") ? { label: "Deal Room", route: location.pathname.replace(/\/decision-room$/, "/room") } : null) ??
    (location.pathname.includes("/deals/") && location.pathname.endsWith("/coach") ? { label: "Deal detail", route: location.pathname.replace(/\/coach$/, "") } : null) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/decision-cycle") ? { label: "Strategist", route: location.pathname.replace(/\/decision-cycle$/, "/strategist") } : null) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/ecosystem") ? { label: "Strategist", route: location.pathname.replace(/\/ecosystem$/, "/strategist") } : null) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/reputation") ? { label: "Strategist", route: location.pathname.replace(/\/reputation$/, "/strategist") } : null) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/cashflow-weather") ? { label: "Strategist", route: location.pathname.replace(/\/cashflow-weather$/, "/strategist") } : null) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/cross-dealer-mirror") ? { label: "Strategist", route: location.pathname.replace(/\/cross-dealer-mirror$/, "/strategist") } : null) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/strategist") ? { label: "Account Command", route: location.pathname.replace(/\/strategist$/, "/command") } : null) ??
    (location.pathname.includes("/deals/") && location.pathname.endsWith("/autopsy") ? { label: "Deals", route: "/qrm/deals" } : null) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/rental-conversion") ? { label: "Account Command", route: location.pathname.replace(/\/rental-conversion$/, "/command") } : null) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/white-space") ? { label: "Account Command", route: location.pathname.replace(/\/white-space$/, "/command") } : null) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/relationship-map") ? { label: "Account Command", route: location.pathname.replace(/\/relationship-map$/, "/command") } : null) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/fleet-intelligence") ? { label: "Account Command", route: location.pathname.replace(/\/fleet-intelligence$/, "/command") } : null) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/operating-profile") ? { label: "Account Command", route: location.pathname.replace(/\/operating-profile$/, "/command") } : null) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/genome") ? { label: "Account Command", route: location.pathname.replace(/\/genome$/, "/command") } : null) ??
    (location.pathname.startsWith("/qrm/accounts/") && location.pathname.endsWith("/timeline") ? { label: "Companies", route: "/qrm/companies" } : null) ??
    (location.pathname.includes("/trade-walkaround") ? { label: "Deals", route: "/qrm/deals" } : null) ??
    (location.pathname.startsWith("/qrm/deals/") ? { label: "Deals", route: "/qrm/deals" } : null) ??
    (location.pathname.startsWith("/qrm/contacts/") ? { label: "Contacts", route: "/qrm/contacts" } : null) ??
    (location.pathname.startsWith("/qrm/accounts/") ? { label: "Companies", route: "/qrm/companies" } : null) ??
    (location.pathname.startsWith("/qrm/territories/") ? { label: "Contacts", route: "/qrm/contacts" } : null) ??
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

  function isNavHrefActive(href: string) {
    if (
      href === "/dashboard" ||
      href === "/qrm" ||
      href === "/parts" ||
      href === "/service" ||
      href === "/rentals" ||
      href === "/chat" ||
      href === "/voice" ||
      href === "/quote-v2" ||
      href === "/os" ||
      href === "/admin" ||
      href === "/executive"
    ) {
      return location.pathname === href;
    }
    return location.pathname === href || location.pathname.startsWith(`${href}/`);
  }

  return (
    <>
      <div
        className={cn(
          "fixed z-50 flex justify-center pointer-events-none",
          floorMode ? "top-[52px]" : "top-4",
          isQuotesListRoute ? "inset-x-1 px-0" : "inset-x-0 px-4 sm:px-6 lg:px-8",
        )}
      >
        <header
          className={cn(
            "w-full flex items-center gap-4 bg-slate-900/80 dark:bg-white/[0.05] border border-white/10 backdrop-blur-xl shadow-2xl pointer-events-auto",
            isQuotesListRoute
              ? "max-w-[calc(100vw-12px)] rounded-[24px] px-3 py-2 sm:px-4 xl:px-9 xl:py-3.5"
              : "max-w-7xl rounded-full px-6 py-3.5",
          )}
          role="banner"
        >
          {isQuotesListRoute && (
            <Link to="/floor" className="hidden min-w-[185px] items-center gap-3 xl:flex">
              <div className="rounded-md border border-white/10 bg-black/20 p-1">
                <BrandLogo className="h-8 w-auto" decorative />
              </div>
              <span className="h-7 w-px bg-white/15" aria-hidden="true" />
              <span className="text-sm font-bold uppercase tracking-[0.14em] text-qep-orange">QEP</span>
            </Link>
          )}

          {isQuotesListRoute && (
            <div className="flex min-w-0 flex-1 items-center gap-3 xl:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 outline-none transition hover:bg-white/10 hover:text-white"
                    aria-label="Open navigation menu"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-[min(22rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto rounded-2xl border-white/10 bg-slate-900/95 p-2 text-white backdrop-blur-xl"
                >
                  {primaryNavGroups.map((group) => (
                    <div key={`compact-${group.id}`}>
                      <DropdownMenuLabel className="px-3 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        {group.label}
                      </DropdownMenuLabel>
                      {group.sections.flatMap((section) => section.items).map((item) => (
                        <DropdownMenuItem
                          key={`compact-${item.href}`}
                          asChild
                          disabled={item.gated}
                          className="rounded-xl px-3 py-3 focus:bg-white/10 focus:text-white"
                        >
                          {item.gated ? (
                            <div className="flex w-full cursor-not-allowed items-center gap-3 opacity-60">
                              <item.icon className="h-4 w-4 text-slate-400" />
                              <span className="flex-1 text-sm font-medium tracking-normal">{item.label}</span>
                              <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Locked</span>
                            </div>
                          ) : (
                            <Link to={item.href} className="flex w-full items-center gap-3">
                              <item.icon
                                className={cn(
                                  "h-4 w-4",
                                  isNavHrefActive(item.href) ? "text-qep-orange" : "text-slate-400",
                                )}
                              />
                              <span
                                className={cn(
                                  "flex-1 text-sm font-medium tracking-normal",
                                  isNavHrefActive(item.href) && "text-qep-orange",
                                )}
                              >
                                {item.label}
                              </span>
                            </Link>
                          )}
                        </DropdownMenuItem>
                      ))}
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-qep-orange">QEP</div>
                <div className="truncate text-sm font-semibold text-white">Quotes</div>
              </div>
            </div>
          )}

          <nav
            className={cn(
              "min-w-0 flex-1 items-center gap-1.5 text-[11px] font-bold tracking-[0.12em] uppercase text-slate-300",
              isQuotesListRoute ? "hidden justify-start xl:flex" : "hidden justify-center lg:flex",
            )}
          >
            {primaryNavGroups.map((group) => {
              const isActive = activePrimaryHeader === group.id;
              return (
                <DropdownMenu key={group.id}>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-2 transition-colors outline-none",
                        isActive
                          ? "bg-qep-orange/10 text-qep-orange"
                          : "text-slate-300 hover:bg-white/5 hover:text-white"
                      )}
                      aria-label={`${group.label} navigation`}
                    >
                      <span>{group.label}</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="center"
                    className="w-[20rem] max-h-[70vh] overflow-y-auto rounded-2xl border-white/10 bg-slate-900/95 p-2 text-white backdrop-blur-xl"
                  >
                    {group.sections.map((section) => (
                      <div key={`${group.id}-${section.label}`}>
                        <DropdownMenuLabel className="px-3 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          {section.label}
                        </DropdownMenuLabel>
                        {section.items.map((item) => (
                          <DropdownMenuItem
                            key={item.href}
                            asChild
                            className={cn(
                              "rounded-xl px-3 py-3 focus:bg-white/10 focus:text-white",
                              item.gated && "opacity-60"
                            )}
                          >
                            {item.gated ? (
                              <div className="flex w-full cursor-not-allowed items-center gap-3">
                                <item.icon className="h-4 w-4 text-slate-400" />
                                <span className="flex-1 text-sm font-medium tracking-normal">
                                  {item.label}
                                </span>
                                <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                                  Locked
                                </span>
                              </div>
                            ) : (
                              <Link to={item.href} className="flex w-full items-center gap-3">
                                <item.icon
                                  className={cn(
                                    "h-4 w-4",
                                    isNavHrefActive(item.href) ? "text-qep-orange" : "text-slate-400"
                                  )}
                                />
                                <span
                                  className={cn(
                                    "flex-1 text-sm font-medium tracking-normal",
                                    isNavHrefActive(item.href) && "text-qep-orange"
                                  )}
                                >
                                  {item.label}
                                </span>
                              </Link>
                            )}
                          </DropdownMenuItem>
                        ))}
                      </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
          </nav>

        {/* Right: Search + Bell + Workspace + Avatar */}
        <div className="flex items-center gap-3 ml-auto shrink-0">
          <div className={cn("hidden transition-all", isQuotesListRoute ? "w-[340px] 2xl:block" : "w-40 focus-within:w-52 lg:block")}>
            {showCrmSearch ? (
              <QrmGlobalSearchCommand />
            ) : (
              <form onSubmit={handleSearchSubmit} className="w-full">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  <input
                    type="search"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    placeholder={location.pathname === "/sales/quotes" ? "Search quotes, customers, or #..." : "Search..."}
                    className={cn(
                      "w-full pl-9 py-1.5 text-xs bg-white/5 border border-white/10 rounded-full text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-qep-orange focus:bg-white/10 transition-all",
                      isQuotesListRoute ? "h-10 pr-14" : "pr-4",
                    )}
                  />
                  {isQuotesListRoute && (
                    <kbd className="pointer-events-none absolute right-3 top-1/2 hidden h-6 -translate-y-1/2 items-center rounded border border-white/10 bg-white/10 px-2 font-mono text-[10px] text-slate-300 xl:inline-flex">
                      ⌘K
                    </kbd>
                  )}
                </div>
              </form>
            )}
          </div>

          {utilitySections.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] outline-none transition-colors",
                    isQuotesListRoute ? "hidden xl:inline-flex" : "hidden lg:inline-flex",
                    utilityRouteActive
                      ? "bg-qep-orange/10 text-qep-orange"
                      : "text-slate-300 hover:bg-white/5 hover:text-white"
                  )}
                  aria-label="System navigation"
                >
                  <PanelTopOpen className="h-3.5 w-3.5" />
                  <span>System</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-64 rounded-2xl border-white/10 bg-slate-900/95 p-2 text-white backdrop-blur-xl"
              >
                {utilitySections.map((section) => (
                  <div key={`utility-${section.label}`}>
                    <DropdownMenuLabel className="px-3 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      {section.label}
                    </DropdownMenuLabel>
                    {section.items.map((item) => (
                      <DropdownMenuItem
                        key={item.href}
                        asChild
                        className="rounded-xl px-3 py-3 focus:bg-white/10 focus:text-white"
                      >
                        <Link to={item.href} className="flex w-full items-center gap-3">
                          <item.icon
                            className={cn(
                              "h-4 w-4",
                              isNavHrefActive(item.href) ? "text-qep-orange" : "text-slate-400"
                            )}
                          />
                          <span
                            className={cn(
                              "flex-1 text-sm font-medium tracking-normal",
                              isNavHrefActive(item.href) && "text-qep-orange"
                            )}
                          >
                            {item.label}
                          </span>
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          
          {profile.active_workspace_id && (
            <div className={cn(isQuotesListRoute && "hidden xl:block")}>
              <WorkspaceSwitcher activeWorkspaceId={profile.active_workspace_id} />
            </div>
          )}
          {/* Quick action pill */}
          {quickAction && (
            <Button
              size="sm"
              onClick={handleQuickAction}
              className={cn(
                "bg-qep-orange hover:bg-qep-orange-hover text-white font-medium",
                isQuotesListRoute
                  ? "flex h-9 rounded-lg px-3 text-xs shadow-[0_0_18px_rgba(249,115,22,0.25)] sm:h-10 sm:px-4 sm:text-sm"
                  : "hidden h-8 rounded-full px-3 text-xs xl:flex",
              )}
            >
              {quickAction.label}
              {isQuotesListRoute && (
                <kbd className="ml-3 hidden rounded border border-white/20 bg-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white/90 xl:inline">
                  ⌘N
                </kbd>
              )}
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
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => {
                  const w = window as Window & { flare?: (sev?: string) => void };
                  if (typeof w.flare === "function") w.flare("bug");
                }}
              >
                <Bug className="w-4 h-4 mr-2" aria-hidden="true" />
                Report a Bug
              </DropdownMenuItem>
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
      </div>

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
