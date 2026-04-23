import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  BookOpen,
  ShoppingCart,
  Package,
  TrendingUp,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SubItem = {
  to: string;
  label: string;
  matches?: (pathname: string) => boolean;
  external?: boolean;
};

type NavGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  matches: (pathname: string) => boolean;
  children?: SubItem[];
};

const orderIdRe = /^\/parts\/orders\/[0-9a-f-]{36}$/i;
const poIdRe = /^\/parts\/purchase-orders\/[0-9a-f-]{36}$/i;
const fulfillRunRe = /^\/parts\/fulfillment\/[0-9a-f-]{36}$/i;

const GROUPS: NavGroup[] = [
  {
    id: "command",
    label: "Command",
    icon: LayoutDashboard,
    to: "/parts",
    matches: (p) => p === "/parts" || p === "/parts/lab",
  },
  {
    id: "catalog",
    label: "Catalog",
    icon: BookOpen,
    to: "/parts/catalog",
    matches: (p) => p === "/parts/catalog" || p.startsWith("/parts/catalog/"),
  },
  {
    id: "sell",
    label: "Sell",
    icon: ShoppingCart,
    to: "/parts/orders",
    matches: (p) =>
      p === "/parts/orders" ||
      p === "/parts/orders/new" ||
      orderIdRe.test(p),
    children: [
      {
        to: "/parts/orders",
        label: "Orders",
        matches: (p) => p === "/parts/orders" || orderIdRe.test(p),
      },
      { to: "/parts/orders/new", label: "New order" },
    ],
  },
  {
    id: "fulfill",
    label: "Fulfill",
    icon: Package,
    to: "/parts/fulfillment",
    matches: (p) =>
      p === "/parts/fulfillment" ||
      fulfillRunRe.test(p) ||
      p === "/parts/inventory" ||
      p === "/parts/vendors" ||
      p === "/parts/purchase-orders" ||
      poIdRe.test(p),
    children: [
      {
        to: "/parts/fulfillment",
        label: "Fulfillment",
        matches: (p) => p === "/parts/fulfillment" || fulfillRunRe.test(p),
      },
      { to: "/parts/inventory", label: "Inventory" },
      { to: "/parts/vendors", label: "Vendors" },
      {
        to: "/parts/purchase-orders",
        label: "Purchase POs",
        matches: (p) => p === "/parts/purchase-orders" || poIdRe.test(p),
      },
    ],
  },
  {
    id: "intel",
    label: "Intel",
    icon: TrendingUp,
    to: "/parts/forecast",
    matches: (p) =>
      p === "/parts/forecast" ||
      p === "/parts/analytics" ||
      p === "/qrm/parts-intelligence",
    children: [
      { to: "/parts/forecast", label: "Forecast" },
      { to: "/parts/analytics", label: "Analytics" },
      {
        to: "/qrm/parts-intelligence",
        label: "Parts Intelligence",
        external: true,
      },
    ],
  },
];

const pillBase = cn(
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5",
  "text-[11px] font-semibold tracking-wide leading-none",
  "border transition-all duration-200 select-none whitespace-nowrap",
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
  "border transition-all duration-200 select-none whitespace-nowrap",
  "border-primary/30 text-primary",
  "bg-gradient-to-b from-primary/[0.18] to-primary/[0.08]",
  "shadow-[inset_0_1px_0_0_rgba(232,119,34,0.25),0_2px_8px_rgba(232,119,34,0.15)]",
  "dark:border-primary/[0.35] dark:text-primary",
  "dark:bg-gradient-to-b dark:from-primary/[0.2] dark:to-primary/[0.08]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
);

const subPillBase = cn(
  "inline-flex items-center rounded-md px-2.5 py-1",
  "text-[11px] font-medium tracking-wide leading-none whitespace-nowrap",
  "border border-transparent text-muted-foreground",
  "transition-colors hover:text-foreground hover:bg-muted/60",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
);

const subPillActive = cn(
  "inline-flex items-center rounded-md px-2.5 py-1",
  "text-[11px] font-semibold tracking-wide leading-none whitespace-nowrap",
  "border border-primary/20 text-primary bg-primary/10",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
);

export function PartsSubNav() {
  const { pathname } = useLocation();

  const activeGroup = GROUPS.find((g) => g.matches(pathname)) ?? null;
  const hasChildren = !!(activeGroup && activeGroup.children && activeGroup.children.length > 0);

  return (
    <nav aria-label="Parts module navigation" className="space-y-1.5">
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 rounded-2xl p-1.5",
          "border border-border/40 bg-white/40 backdrop-blur-md",
          "shadow-[0_1px_3px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.8)]",
          "dark:border-white/[0.07] dark:bg-white/[0.025]",
        )}
      >
        {GROUPS.map((group) => {
          const Icon = group.icon;
          const active = group === activeGroup;
          return (
            <Link
              key={group.id}
              to={group.to}
              aria-current={active ? "page" : undefined}
              className={active ? pillActive : pillBase}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {group.label}
            </Link>
          );
        })}
      </div>

      {hasChildren && (
        <div
          role="tablist"
          aria-label={`${activeGroup?.label} sections`}
          className="flex flex-wrap items-center gap-0.5 px-1.5"
        >
          {activeGroup!.children!.map((child) => {
            const childActive = child.matches
              ? child.matches(pathname)
              : pathname === child.to;
            return (
              <Link
                key={child.to}
                to={child.to}
                aria-current={childActive ? "page" : undefined}
                className={cn(
                  childActive ? subPillActive : subPillBase,
                  child.external && "gap-1",
                )}
                title={child.external ? `${child.label} (opens in QRM)` : undefined}
              >
                {child.label}
                {child.external && (
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
