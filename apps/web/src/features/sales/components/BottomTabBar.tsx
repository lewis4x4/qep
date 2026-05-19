import { useLocation, useNavigate } from "react-router-dom";
import { Sun, BarChart3, Mic, FileText, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const navigate = useNavigate();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-slate-200/80 safe-area-bottom"
      role="tablist"
      aria-label="Sales navigation"
      data-testid="sales-bottom-tab-bar"
      data-bottom-tab-height="64"
      style={{ height: "var(--sales-shell-bottom-offset)" }}
    >
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {TABS.map((tab) => (
          <TabButton
            key={tab.path}
            tab={tab}
            active={tab.isActive(location.pathname)}
            onClick={() => navigate(tab.path)}
          />
        ))}
      </div>
    </nav>
  );
}

function TabButton({
  tab,
  active,
  onClick,
}: {
  tab: Tab;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 min-w-[56px] py-1 rounded-lg transition-colors",
        active ? "text-qep-orange" : "text-slate-400 hover:text-slate-600",
      )}
    >
      {tab.signature ? (
        <span
          className={cn(
            "w-9 h-9 rounded-[10px] flex items-center justify-center transition-colors",
            active ? "bg-qep-orange" : "bg-qep-orange/10",
          )}
        >
          <Icon
            className={cn("w-6 h-6", active ? "text-white" : "text-qep-orange")}
            strokeWidth={active ? 2.2 : 1.8}
          />
        </span>
      ) : (
        <Icon className="w-6 h-6" strokeWidth={active ? 2.2 : 1.8} />
      )}
      <span
        className={cn("text-[10px]", active ? "font-semibold" : "font-medium")}
      >
        {tab.label}
      </span>
    </button>
  );
}
