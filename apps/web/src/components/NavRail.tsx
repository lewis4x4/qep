import { useState } from "react";
import { useLocation, NavLink } from "react-router-dom";
import { LogOut, Lock } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeAppearanceSubmenu } from "@/components/ThemeAppearanceSubmenu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/database.types";
import { resolveNavItems, getInitials } from "@/lib/nav-config";
import { BRAND_NAME } from "@/components/BrandLogo";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
}

interface NavRailProps {
  profile: Profile;
  onLogout: () => void;
  quoteBuilderEnabled: boolean;
  quoteBuilderLoading: boolean;
}

export function NavRail({
  profile,
  onLogout,
  quoteBuilderEnabled,
  quoteBuilderLoading,
}: NavRailProps) {
  const location = useLocation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);

  const visibleItems = resolveNavItems(quoteBuilderEnabled, quoteBuilderLoading).filter((item) =>
    item.roles.includes(profile.role)
  );

  return (
    <>
      <nav
        aria-label="Main navigation"
        aria-expanded={isExpanded}
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
        onFocus={() => setIsExpanded(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setIsExpanded(false);
          }
        }}
        className={cn(
          "hidden lg:flex flex-col fixed left-0 z-40 bg-qep-dark border-r border-white/10",
          "nav-rail-transition",
          isExpanded
            ? "w-60 shadow-[4px_0_12px_rgba(0,0,0,0.15)]"
            : "w-16"
        )}
        style={{
          top: "56px",
          height: "calc(100vh - 56px)",
        }}
      >
        {/* Nav items */}
        <div className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
          <TooltipProvider delayDuration={0}>
            {visibleItems.map((item, idx) => {
              const prevItem = idx > 0 ? visibleItems[idx - 1] : null;
              const showDivider = item.showcase && (!prevItem || !prevItem.showcase);

              const isActive =
                item.href === "/dashboard"
                  ? location.pathname === "/" || location.pathname === "/dashboard"
                  : location.pathname.startsWith(item.href);

              const itemContent = (
                <div
                  className={cn(
                    "relative flex items-center gap-3 py-2 px-2 text-sm font-medium rounded-md transition-colors duration-150 select-none",
                    isActive
                      ? "bg-[rgba(232,119,34,0.1)] text-white"
                      : item.gated
                      ? "text-[#94A3B8] opacity-60 cursor-not-allowed"
                      : "text-[#94A3B8] hover:bg-[rgba(255,255,255,0.05)] hover:text-white"
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-qep-orange rounded-r-sm" />
                  )}

                  <item.icon
                    className={cn(
                      "w-4 h-4 shrink-0",
                      isActive ? "text-white" : ""
                    )}
                    aria-hidden="true"
                  />

                  <span
                    className={cn(
                      "flex-1 whitespace-nowrap overflow-hidden text-[#C5D0DB]",
                      "transition-opacity duration-150",
                      isExpanded
                        ? "opacity-100 [transition-delay:50ms]"
                        : "opacity-0 [transition-delay:0ms]",
                      isActive && "text-white"
                    )}
                  >
                    {item.label}
                  </span>

                  {item.gated && isExpanded && (
                    <Lock className="w-3.5 h-3.5 shrink-0 text-[#94A3B8]" aria-hidden="true" />
                  )}
                </div>
              );

              let navElement: React.ReactNode;

              if (item.gated) {
                navElement = (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>
                      <div
                        role="link"
                        aria-disabled="true"
                        aria-label={`${item.label} — connect IntelliDealer to unlock`}
                        className="block"
                      >
                        {itemContent}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      Connect IntelliDealer in Admin to access Quotes
                    </TooltipContent>
                  </Tooltip>
                );
              } else if (!isExpanded) {
                navElement = (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>
                      <NavLink
                        to={item.href}
                        className="block"
                        aria-current={isActive ? "page" : undefined}
                      >
                        {itemContent}
                      </NavLink>
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                );
              } else {
                navElement = (
                  <NavLink
                    key={item.href}
                    to={item.href}
                    className="block"
                    aria-current={isActive ? "page" : undefined}
                  >
                    {itemContent}
                  </NavLink>
                );
              }

              if (showDivider) {
                return (
                  <div key={`section-${item.href}`}>
                    <div className="!my-2.5 px-1">
                      <div className="h-px bg-white/[0.08]" />
                      <span
                        className={cn(
                          "block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25 mt-2 mb-1 transition-opacity duration-150",
                          isExpanded ? "opacity-100 px-2 [transition-delay:50ms]" : "opacity-0 [transition-delay:0ms]"
                        )}
                      >
                        Showcase
                      </span>
                    </div>
                    {navElement}
                  </div>
                );
              }

              return navElement;
            })}
          </TooltipProvider>
        </div>

        {/* Bottom: avatar + logout */}
        <div className="border-t border-white/10 px-2 py-3 mt-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "w-full flex items-center gap-3 rounded-md py-2 px-2 transition-colors duration-150",
                  "text-[#94A3B8] hover:bg-[rgba(255,255,255,0.05)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange"
                )}
                aria-label="User menu"
              >
                <Avatar className="w-8 h-8 shrink-0">
                  <AvatarFallback className="bg-qep-orange text-white text-xs">
                    {getInitials(profile.full_name, profile.email)}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    "flex-1 min-w-0 text-left transition-opacity duration-150",
                    isExpanded
                      ? "opacity-100 [transition-delay:50ms]"
                      : "opacity-0 [transition-delay:0ms]"
                  )}
                >
                  <span className="block text-sm font-medium truncate text-white">
                    {profile.full_name ?? profile.email ?? "User"}
                  </span>
                  <span className="block text-xs truncate text-[#94A3B8]">
                    {profile.email}
                  </span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-44">
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
      </nav>

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
