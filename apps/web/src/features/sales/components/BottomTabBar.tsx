import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Sun, BarChart3, Users, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { CaptureSheet } from "./CaptureSheet";

const TABS = [
  { path: "/sales/today", label: "Today", icon: Sun },
  { path: "/sales/pipeline", label: "Pipeline", icon: BarChart3 },
  // Center action button goes here (rendered separately)
  { path: "/sales/customers", label: "Customers", icon: Users },
] as const;

export function BottomTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [captureOpen, setCaptureOpen] = useState(false);

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-slate-200/80 safe-area-bottom"
        role="tablist"
        aria-label="Sales navigation"
      >
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
          {/* Today tab */}
          <TabButton
            tab={TABS[0]}
            active={location.pathname === TABS[0].path}
            onClick={() => navigate(TABS[0].path)}
          />

          {/* Pipeline tab */}
          <TabButton
            tab={TABS[1]}
            active={location.pathname === TABS[1].path}
            onClick={() => navigate(TABS[1].path)}
          />

          {/* Center action button */}
          <button
            onClick={() => setCaptureOpen(true)}
            className="relative -mt-5 w-14 h-14 rounded-full bg-qep-orange text-white shadow-lg shadow-qep-orange/30 flex items-center justify-center hover:bg-qep-orange/90 active:scale-95 transition-all"
            aria-label="Quick actions"
          >
            <Plus className="w-7 h-7" strokeWidth={2.5} />
          </button>

          {/* Customers tab */}
          <TabButton
            tab={TABS[2]}
            active={location.pathname.startsWith(TABS[2].path)}
            onClick={() => navigate(TABS[2].path)}
          />
        </div>
      </nav>

      <CaptureSheet open={captureOpen} onOpenChange={setCaptureOpen} />
    </>
  );
}

function TabButton({
  tab,
  active,
  onClick,
}: {
  tab: (typeof TABS)[number];
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
        "flex flex-col items-center justify-center gap-0.5 min-w-[64px] py-1 rounded-lg transition-colors",
        active
          ? "text-qep-orange"
          : "text-slate-400 hover:text-slate-600",
      )}
    >
      <Icon className="w-6 h-6" strokeWidth={active ? 2.2 : 1.8} />
      <span className={cn("text-[10px]", active ? "font-semibold" : "font-medium")}>
        {tab.label}
      </span>
    </button>
  );
}
