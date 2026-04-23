import { useState } from "react";
import { useLocation, NavLink } from "react-router-dom";
import { Menu, Lock } from "lucide-react";
import { BRAND_NAME, BrandLogo } from "@/components/BrandLogo";
import { OmniCommand } from "@/components/OmniCommand";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/database.types";
import {
  BOTTOM_TAB_HREFS,
  isUtilityRoute,
  resolveActivePrimaryHeader,
  resolveNavItems,
  resolvePrimaryNavGroups,
  resolveUtilityNavSections,
} from "@/lib/nav-config";
import { TopBar } from "@/components/TopBar";
import { AmbientMatrix } from "@/components/primitives/AmbientMatrix";

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

export interface AppLayoutProps {
  profile: Profile;
  onLogout: () => void;
  quoteBuilderEnabled: boolean;
  quoteBuilderLoading: boolean;
  children: React.ReactNode;
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

function MobileNavContent({
  profile,
  onNavClick,
  quoteBuilderEnabled,
  quoteBuilderLoading,
}: {
  profile: Profile;
  onNavClick: () => void;
  quoteBuilderEnabled: boolean;
  quoteBuilderLoading: boolean;
}) {
  const location = useLocation();
  const primaryGroups = resolvePrimaryNavGroups(
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

  function renderNavItem(item: ReturnType<typeof resolveNavItems>[number]) {
    const isActive = isNavHrefActive(item.href);

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
  }

  return (
    <div className="flex flex-col h-full bg-qep-dark">
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="shrink-0 rounded-md bg-black/50 p-1 ring-1 ring-white/10">
          <BrandLogo className="h-8 w-auto max-w-[140px]" decorative />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-sm leading-tight text-white">{BRAND_NAME}</p>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[#94A3B8]">
            Division navigation
          </p>
        </div>
      </div>

      <div className="border-t border-white/10" />

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {primaryGroups.map((group) => (
          <section key={group.id} className="mb-4">
            <div className="mb-1 px-3">
              <div
                className={cn(
                  "text-[10px] font-bold uppercase tracking-[0.16em]",
                  activePrimaryHeader === group.id ? "text-qep-orange" : "text-[#64748B]"
                )}
              >
                {group.label}
              </div>
            </div>
            <div className="space-y-0.5">
              {group.sections.flatMap((section) =>
                section.items.map((item) => renderNavItem(item))
              )}
            </div>
          </section>
        ))}

        {utilitySections.length > 0 && (
          <section className="border-t border-white/10 pt-4">
            <div className="mb-1 px-3">
              <div
                className={cn(
                  "text-[10px] font-bold uppercase tracking-[0.16em]",
                  utilityRouteActive ? "text-qep-orange" : "text-[#64748B]"
                )}
              >
                System
              </div>
            </div>
            <div className="space-y-0.5">
              {utilitySections.flatMap((section) =>
                section.items.map((item) => renderNavItem(item))
              )}
            </div>
          </section>
        )}
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
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const embeddedMode = new URLSearchParams(location.search).get("embedded") === "1";

  if (embeddedMode) {
    return (
      <div className="min-h-screen bg-transparent">
        <main className="min-h-screen">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-transparent relative z-0">
      <AmbientMatrix />
      
      {/* Desktop: enhanced top bar */}
      <TopBar 
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
        <div className="flex min-w-0 items-center gap-2">
          <div className="shrink-0 rounded bg-black/40 p-0.5 ring-1 ring-white/10">
            <BrandLogo className="h-6 w-auto max-w-[100px]" decorative />
          </div>
          <span className="truncate font-semibold text-[11px] leading-tight text-white sm:text-xs" title={BRAND_NAME}>
            {BRAND_NAME}
          </span>
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
      {/* pt-20: clears mobile top header; pb-16: clears mobile bottom tab bar */}
      {/* lg:pt-[104px]: clears desktop floating top bar; lg:pb-8; no left margin */}
      <main className="flex-1 pt-20 pb-16 lg:pt-[104px] lg:pb-8 min-h-screen">
        {children}
      </main>

      {/* Global Cmd-K command palette */}
      <OmniCommand role={profile.role} />
    </div>
  );
}

export default AppLayout;
