import { Link, useLocation } from "react-router-dom";
import {
  Package,
  ShoppingCart,
  Truck,
  ClipboardCheck,
  FileText,
  BarChart3,
  GitBranch,
  Boxes,
  Lightbulb,
  ExternalLink,
  ChevronLeft,
  Settings2,
  Activity,
  Smartphone,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const SUB_NAV_LINKS = [
  { to: "/m/service", label: "Tech Mobile", icon: Smartphone },
  { to: "/service/inspections", label: "Inspections", icon: ClipboardCheck },
  { to: "/service/agreements", label: "Agreements", icon: FileText },
  { to: "/service/parts", label: "Shop Parts", icon: Package },
  { to: "/parts/orders", label: "Parts Orders", icon: ShoppingCart },
  { to: "/parts/vendors", label: "Vendors", icon: Truck },
  { to: "/service/efficiency", label: "Efficiency", icon: BarChart3 },
] as const;

const ADMIN_LINKS = [
  { to: "/service/branches", label: "Branches", icon: GitBranch },
  { to: "/parts/inventory", label: "Inventory", icon: Boxes },
  { to: "/service/job-code-suggestions", label: "Job Codes", icon: Lightbulb },
  { to: "/service/scheduler-health", label: "Cron health", icon: Activity },
] as const;

/** Inactive pill: frosted glass chip */
const pillBase = cn(
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5",
  "text-[11px] font-semibold tracking-wide leading-none",
  "border transition-all duration-200 select-none",
  // light
  "border-border/50 bg-white/60 text-muted-foreground",
  "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_1px_2px_rgba(0,0,0,0.06)]",
  "hover:border-border hover:bg-white hover:text-foreground hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,1),0_2px_6px_rgba(0,0,0,0.1)] hover:-translate-y-px",
  // dark
  "dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400",
  "dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_1px_3px_rgba(0,0,0,0.4)]",
  "dark:hover:border-white/[0.18] dark:hover:bg-white/[0.09] dark:hover:text-white dark:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1),0_4px_12px_rgba(0,0,0,0.5)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
);

/** Active pill: orange gradient + glow */
const pillActive = cn(
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5",
  "text-[11px] font-semibold tracking-wide leading-none",
  "border transition-all duration-200 select-none",
  // light
  "border-primary/30 text-primary",
  "bg-gradient-to-b from-primary/[0.18] to-primary/[0.08]",
  "shadow-[inset_0_1px_0_0_rgba(232,119,34,0.25),0_2px_8px_rgba(232,119,34,0.15)]",
  // dark
  "dark:border-primary/[0.35] dark:text-primary",
  "dark:bg-gradient-to-b dark:from-primary/[0.2] dark:to-primary/[0.08]",
  "dark:shadow-[inset_0_1px_0_0_rgba(232,119,34,0.2),0_0_12px_rgba(232,119,34,0.2)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
);

/** Back button: ghost with chevron */
const backPill = cn(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-1.5",
  "text-[11px] font-semibold tracking-wide leading-none",
  "border transition-all duration-200 select-none",
  "border-transparent text-muted-foreground/70",
  "hover:border-border/60 hover:text-foreground hover:bg-muted/30",
  "dark:text-slate-500 dark:hover:border-white/[0.1] dark:hover:text-slate-300 dark:hover:bg-white/[0.04]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
);

/** Divider between pill groups */
function Divider() {
  return (
    <div className="mx-0.5 h-4 w-px shrink-0 bg-gradient-to-b from-transparent via-border to-transparent dark:via-white/[0.12]" />
  );
}

export function ServiceSubNav() {
  const { profile } = useAuth();
  const location = useLocation();
  const isAdmin = ["admin", "manager", "owner"].includes(profile?.role ?? "");
  const isCommandCenter = location.pathname === "/service";

  const isActive = (to: string) => {
    if (to === "/parts/orders") {
      return (
        location.pathname === "/parts/orders" ||
        /^\/parts\/orders\//.test(location.pathname)
      );
    }
    return location.pathname === to;
  };

  return (
    <nav
      aria-label="Service section navigation"
      className={cn(
        "flex max-w-full min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto rounded-2xl p-1.5",
        "scrollbar-thin scrollbar-thumb-border/50",
        // frosted rail container
        "border border-border/40 bg-white/40 backdrop-blur-md",
        "shadow-[0_1px_3px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]",
        // dark
        "dark:border-white/[0.07] dark:bg-white/[0.025]",
        "dark:shadow-[0_1px_4px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.04)]",
      )}
    >
      {/* Back to Command Center — only on sub-pages */}
      {!isCommandCenter && (
        <>
          <Link to="/service" className={cn(backPill, "shrink-0")} aria-label="Back to Command Center">
            <ChevronLeft className="h-3 w-3" />
            <span>Command Center</span>
          </Link>
          <Divider />
        </>
      )}

      {/* Core service links */}
      {SUB_NAV_LINKS.map((navItem) => {
        const NavIcon = navItem.icon;
        return (
          <Link
            key={navItem.to}
            to={navItem.to}
            aria-current={isActive(navItem.to) ? "page" : undefined}
            className={cn(isActive(navItem.to) ? pillActive : pillBase, "shrink-0 whitespace-nowrap")}
          >
            <NavIcon className="h-3.5 w-3.5 shrink-0" />
            {navItem.label}
          </Link>
        );
      })}

      {/* Admin-only group */}
      {isAdmin && (
        <>
          <Divider />
          <span className={cn(
            "inline-flex shrink-0 items-center gap-1 px-1.5 text-[9px] font-bold uppercase tracking-[0.12em]",
            "text-muted-foreground/40 dark:text-white/20 select-none"
          )}>
            <Settings2 className="h-2.5 w-2.5" />
            Ops
          </span>
          {ADMIN_LINKS.map((navItem) => {
            const NavIcon = navItem.icon;
            return (
              <Link
                key={navItem.to}
                to={navItem.to}
                aria-current={isActive(navItem.to) ? "page" : undefined}
                className={cn(isActive(navItem.to) ? pillActive : pillBase, "shrink-0 whitespace-nowrap")}
              >
                <NavIcon className="h-3.5 w-3.5 shrink-0" />
                {navItem.label}
              </Link>
            );
          })}
        </>
      )}

      <Divider />

      {/* Track Job — external-facing, slightly distinct */}
      <Link
        to="/service/track"
        aria-current={isActive("/service/track") ? "page" : undefined}
        className={cn(
          isActive("/service/track") ? pillActive : pillBase,
          "shrink-0 whitespace-nowrap",
          // Extra: dashed border when inactive to signal it's an external-facing link
          !isActive("/service/track") && "border-dashed opacity-80 hover:opacity-100",
        )}
      >
        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
        Track Job
      </Link>
    </nav>
  );
}
