import { Link, useLocation } from "react-router-dom";
import { Sun, BarChart3, Mic, FileText, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOBILE } from "../lib/mobile-design-tokens";

export const SALES_BOTTOM_TAB_BAR_HEIGHT = MOBILE.bottomTabBarHeight;

type Tab = {
  path: string;
  label: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
  signature?: boolean;
};

const TABS: Tab[] = [
  {
    path: "/sales/today",
    label: "Today",
    icon: Sun,
    isActive: (p) => p === "/sales/today",
  },
  {
    path: "/sales/pipeline",
    label: "Pipeline",
    icon: BarChart3,
    isActive: (p) =>
      p.startsWith("/sales/pipeline") || p.startsWith("/sales/deals"),
  },
  {
    path: "/sales/capture",
    label: "Capture",
    icon: Mic,
    isActive: (p) =>
      p.startsWith("/sales/capture") ||
      p.startsWith("/sales/field-note") ||
      p.startsWith("/sales/voice-quote") ||
      p.startsWith("/sales/my-mirror"),
    signature: true,
  },
  {
    path: "/sales/quotes",
    label: "Quote",
    icon: FileText,
    isActive: (p) => p.startsWith("/sales/quotes"),
  },
  {
    path: "/sales/customers",
    label: "Customers",
    icon: Users,
    isActive: (p) => p.startsWith("/sales/customers"),
  },
];

export function BottomTabBar() {
  const location = useLocation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-lg border-t border-slate-200/80"
      aria-label="Sales navigation"
      data-testid="sales-bottom-tab-bar"
      data-bottom-tab-height={String(SALES_BOTTOM_TAB_BAR_HEIGHT)}
      data-safe-area-contract="height-includes-padding-bottom-once"
      style={{
        height: "var(--sales-shell-bottom-offset)",
        paddingBottom: "var(--sales-shell-safe-area-bottom)",
      }}
    >
      <div className="flex h-[var(--sales-shell-bottom-tab-height)] items-center justify-around max-w-lg mx-auto px-2">
        {TABS.map((tab) => (
          <TabLink
            key={tab.path}
            tab={tab}
            active={tab.isActive(location.pathname)}
          />
        ))}
      </div>
    </nav>
  );
}

function TabLink({
  tab,
  active,
}: {
  tab: Tab;
  active: boolean;
}) {
  const Icon = tab.icon;
  return (
    <Link
      to={tab.path}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-12 flex-col items-center justify-center gap-0.5 min-w-[56px] px-1 py-2 rounded-lg transition-colors",
        active ? "text-qep-orange-accessible" : "text-slate-600 hover:text-slate-800",
      )}
    >
      {tab.signature ? (
        <span
          className={cn(
            "w-9 h-9 rounded-[10px] flex items-center justify-center transition-colors",
            active ? "bg-qep-orange-accessible" : "bg-qep-orange/10",
          )}
        >
          <Icon
            className={cn("w-6 h-6", active ? "text-white" : "text-qep-orange-accessible")}
            strokeWidth={active ? 2.2 : 1.8}
            aria-hidden="true"
          />
        </span>
      ) : (
        <Icon className="w-6 h-6" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
      )}
      <span
        className={cn("text-[10px] leading-none", active ? "font-semibold" : "font-medium")}
      >
        {tab.label}
      </span>
    </Link>
  );
}
