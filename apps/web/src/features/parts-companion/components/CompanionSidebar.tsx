import {
  Layers,
  Search,
  Cpu,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Package,
} from "lucide-react";

interface CompanionSidebarProps {
  activeTab: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate: (tab: string) => void;
  aiPanelOpen: boolean;
  onToggleAi: () => void;
}

const NAV_ITEMS = [
  { key: "queue", label: "Queue", icon: Layers, badge: true, shortcut: null },
  { key: "lookup", label: "Lookup", icon: Search, badge: false, shortcut: "/" },
  { key: "machines", label: "Machines", icon: Cpu, badge: false, shortcut: null },
];

export function CompanionSidebar({
  activeTab,
  collapsed,
  onToggleCollapse,
  onNavigate,
  aiPanelOpen,
  onToggleAi,
}: CompanionSidebarProps) {
  return (
    <div
      className="flex flex-col flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out"
      style={{
        width: collapsed ? 60 : 220,
        background: "#1B2A3D",
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2.5 flex-shrink-0"
        style={{
          padding: collapsed ? "16px 12px" : "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-qep-orange flex-shrink-0">
          <Package size={18} className="text-white" />
        </div>
        {!collapsed && (
          <div>
            <div className="text-sm font-extrabold text-white leading-tight">
              QEP
            </div>
            <div className="text-[10px] text-white/50 tracking-wider">
              PARTS COMPANION
            </div>
          </div>
        )}
      </div>

      {/* Nav Items */}
      <div className="flex-1 flex flex-col gap-0.5 p-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className="flex items-center gap-2.5 w-full text-left rounded-lg border-none cursor-pointer transition-all duration-150"
              style={{
                padding: collapsed ? "10px 12px" : "10px 14px",
                background: isActive
                  ? "rgba(232, 119, 34, 0.15)"
                  : "transparent",
                color: isActive ? "#E87722" : "rgba(255,255,255,0.6)",
                borderLeft: isActive
                  ? "3px solid #E87722"
                  : "3px solid transparent",
              }}
            >
              <Icon size={18} />
              {!collapsed && (
                <>
                  <span className="flex-1 text-[13px] font-semibold">
                    {item.label}
                  </span>
                  {item.badge && (
                    <span className="text-[10px] font-bold px-1.5 py-px rounded-lg bg-qep-orange text-white">
                      0
                    </span>
                  )}
                  {item.shortcut && (
                    <kbd className="inline-flex items-center justify-center px-1.5 py-px rounded border border-white/20 text-[11px] font-mono text-white/40 min-w-[20px]">
                      {item.shortcut}
                    </kbd>
                  )}
                </>
              )}
            </button>
          );
        })}

        <div
          className="my-2 mx-1.5"
          style={{
            height: 1,
            background: "rgba(255,255,255,0.08)",
          }}
        />

        {/* AI Panel Toggle */}
        <button
          onClick={onToggleAi}
          className="flex items-center gap-2.5 w-full text-left rounded-lg border-none cursor-pointer transition-all duration-150"
          style={{
            padding: collapsed ? "10px 12px" : "10px 14px",
            background: aiPanelOpen
              ? "rgba(232, 119, 34, 0.15)"
              : "transparent",
            color: aiPanelOpen ? "#E87722" : "rgba(255,255,255,0.6)",
          }}
        >
          <MessageSquare size={18} />
          {!collapsed && (
            <span className="text-[13px] font-semibold">Knowledge AI</span>
          )}
        </button>
      </div>

      {/* User */}
      <div
        className="flex-shrink-0 flex items-center gap-2.5"
        style={{
          padding: collapsed ? "12px" : "12px 14px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[#253649] text-xs font-bold text-white/70 flex-shrink-0">
          PC
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-white/85 truncate">
              Parts Counter
            </div>
            <span className="text-[10px] px-1.5 py-px rounded bg-[#718096] text-white font-semibold">
              Parts
            </span>
          </div>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={onToggleCollapse}
        className="flex justify-center border-none bg-transparent cursor-pointer text-white/30"
        style={{
          padding: "8px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </div>
  );
}
