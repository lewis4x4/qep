import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  BookOpen,
  ShoppingCart,
  Package,
  Truck,
  Boxes,
  ChevronLeft,
  PlusCircle,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PRIMARY_LINKS = [
  { to: "/parts", label: "Command", icon: LayoutDashboard, end: true },
  { to: "/parts/catalog", label: "Catalog", icon: BookOpen, end: false },
  { to: "/parts/orders", label: "Orders", icon: ShoppingCart, end: false },
  { to: "/parts/orders/new", label: "New order", icon: PlusCircle, end: false },
  { to: "/parts/fulfillment", label: "Fulfillment", icon: Package, end: false },
  { to: "/parts/inventory", label: "Inventory", icon: Boxes, end: false },
  { to: "/parts/vendors", label: "Vendors", icon: Truck, end: false },
  { to: "/parts/forecast", label: "Forecast", icon: TrendingUp, end: false },
  { to: "/parts/analytics", label: "Analytics", icon: BarChart3, end: false },
] as const;

const pillBase = cn(
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5",
  "text-[11px] font-semibold tracking-wide leading-none",
  "border transition-all duration-200 select-none",
  "border-border/50 bg-white/60 text-muted-foreground",
  "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_1px_2px_rgba(0,0,0,0.06)]",
  "hover:border-border hover:bg-white hover:text-foreground",
  "dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400",
  "dark:hover:border-white/[0.18] dark:hover:bg-white/[0.09] dark:hover:text-white",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
);

const pillActive = cn(
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5",
  "text-[11px] font-semibold tracking-wide leading-none",
  "border transition-all duration-200 select-none",
  "border-primary/30 text-primary",
  "bg-gradient-to-b from-primary/[0.18] to-primary/[0.08]",
  "shadow-[inset_0_1px_0_0_rgba(232,119,34,0.25),0_2px_8px_rgba(232,119,34,0.15)]",
  "dark:border-primary/[0.35] dark:text-primary",
  "dark:bg-gradient-to-b dark:from-primary/[0.2] dark:to-primary/[0.08]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
);

const backPill = cn(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-1.5",
  "text-[11px] font-semibold tracking-wide leading-none",
  "border border-transparent text-muted-foreground/70",
  "hover:border-border/60 hover:text-foreground hover:bg-muted/30",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
);

export function PartsSubNav() {
  const location = useLocation();

  const isActive = (to: string, end: boolean) => {
    const p = location.pathname;
    if (to === "/parts/orders/new") return p === "/parts/orders/new";
    if (to === "/parts/orders") {
      return (
        p === "/parts/orders" ||
        /^\/parts\/orders\/[0-9a-f-]{36}$/i.test(p)
      );
    }
    if (end) return p === to;
    return p === to || p.startsWith(`${to}/`);
  };

  return (
    <nav
      aria-label="Parts module navigation"
      className={cn(
        "flex max-w-full min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto rounded-2xl p-1.5",
        "scrollbar-thin scrollbar-thumb-border/50",
        "border border-border/40 bg-white/40 backdrop-blur-md",
        "shadow-[0_1px_3px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]",
        "dark:border-white/[0.07] dark:bg-white/[0.025]",
      )}
    >
      <Link to="/dashboard" className={cn(backPill, "shrink-0")} title="Back to Command Center">
        <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
        Home
      </Link>
      <div className="mx-0.5 h-4 w-px shrink-0 bg-gradient-to-b from-transparent via-border to-transparent dark:via-white/[0.12]" />
      {PRIMARY_LINKS.map((link) => {
        const NavIcon = link.icon;
        const active = isActive(link.to, link.end);
        return (
          <Link
            key={link.to}
            to={link.to}
            aria-current={active ? "page" : undefined}
            className={cn(active ? pillActive : pillBase, "shrink-0 whitespace-nowrap")}
          >
            <NavIcon className="h-3.5 w-3.5 shrink-0" />
            {link.label}
          </Link>
        );
      })}
      <div className="mx-0.5 h-4 w-px shrink-0 bg-gradient-to-b from-transparent via-border to-transparent dark:via-white/[0.12]" />
      <Link to="/service" className={cn(pillBase, "shrink-0 whitespace-nowrap")} title="Service engine">
        Service
      </Link>
    </nav>
  );
}
