import {
  Layers,
  Search,
  Truck,
  Package,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Bug,
  Settings,
  Upload,
  Brain,
  Rocket,
  DollarSign,
  ShoppingCart,
} from "lucide-react";
import { IronAvatar } from "../../../lib/iron/IronAvatar";
import { useAuth } from "../../../hooks/useAuth";
import { supabase } from "../../../lib/supabase";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";

interface CompanionSidebarProps {
  activeTab: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate: (tab: string) => void;
  aiPanelOpen: boolean;
  onToggleAi: () => void;
}

const NAV_ITEMS = [
  { key: "queue", label: "Queue", icon: Layers, badge: true, shortcut: null, adminOnly: false },
  { key: "lookup", label: "Lookup", icon: Search, badge: false, shortcut: "/", adminOnly: false },
  { key: "machines", label: "Machines", icon: Truck, badge: false, shortcut: null, adminOnly: false },
  { key: "arrivals", label: "Arrivals", icon: Package, badge: true, shortcut: null, adminOnly: false },
  { key: "intelligence", label: "Intelligence", icon: Brain, badge: false, shortcut: null, adminOnly: false },
  { key: "predictive-plays", label: "Predictive", icon: Rocket, badge: false, shortcut: null, adminOnly: false },
  { key: "replenish", label: "Replenish", icon: ShoppingCart, badge: false, shortcut: null, adminOnly: true },
  { key: "pricing", label: "Pricing", icon: DollarSign, badge: false, shortcut: null, adminOnly: true },
  { key: "import", label: "Import", icon: Upload, badge: false, shortcut: null, adminOnly: true },
];

export function CompanionSidebar({
  activeTab,
  collapsed,
  onToggleCollapse,
  onNavigate,
  aiPanelOpen,
  onToggleAi,
}: CompanionSidebarProps) {
  const { profile } = useAuth();

  const displayName = profile?.full_name || "Parts Counter";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="flex flex-col flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out"
      style={{
        width: collapsed ? 64 : 230,
        background: "#0F1D31",
        borderRight: "1px solid #1F3254",
      }}
    >
      {/* Logo Section */}
      <div
        className="flex items-center gap-3 flex-shrink-0"
        style={{
          padding: collapsed ? "18px 14px" : "18px 20px",
          borderBottom: "1px solid #1F3254",
        }}
      >
        <div
          className="flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0"
          style={{
            background: "linear-gradient(135deg, #E87722 0%, #D06118 100%)",
            boxShadow: "0 4px 12px rgba(232,119,34,0.35)",
          }}
        >
          <span className="text-white text-sm font-black leading-none">Q</span>
        </div>
        {!collapsed && (
          <div>
            <div className="text-sm font-extrabold text-white leading-tight tracking-wide">
              QEP Parts
            </div>
            <div className="text-[10px] tracking-wider" style={{ color: "#5F7391" }}>
              Counter Companion
            </div>
          </div>
        )}
      </div>

      {/* Nav Items */}
      <div className="flex-1 flex flex-col gap-0.5 p-2 mt-1">
        {NAV_ITEMS.filter((item) => {
          if (!item.adminOnly) return true;
          const role = profile?.role ?? "";
          return ["admin", "manager", "owner"].includes(role);
        }).map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className="flex items-center gap-2.5 w-full text-left rounded-lg border-none cursor-pointer transition-all duration-150"
              style={{
                padding: collapsed ? "10px 14px" : "10px 14px",
                background: isActive ? "rgba(232,119,34,0.15)" : "transparent",
                color: isActive ? "#E87722" : "#8A9BB4",
              }}
            >
              <Icon size={18} />
              {!collapsed && (
                <>
                  <span className="flex-1 text-[13px] font-semibold">
                    {item.label}
                  </span>
                  {item.badge && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-px rounded-full"
                      style={{
                        background: isActive
                          ? "rgba(232,119,34,0.35)"
                          : "#1F3254",
                        color: isActive ? "#E87722" : "#5F7391",
                      }}
                    >
                      0
                    </span>
                  )}
                  {item.shortcut && (
                    <kbd
                      className="inline-flex items-center justify-center px-1.5 py-px rounded text-[11px] font-mono min-w-[20px]"
                      style={{
                        border: "1px solid #1F3254",
                        color: "#5F7391",
                        background: "transparent",
                      }}
                    >
                      {item.shortcut}
                    </kbd>
                  )}
                </>
              )}
            </button>
          );
        })}

        {/* Divider */}
        <div
          className="my-3 mx-1.5"
          style={{ height: 1, background: "#1F3254" }}
        />

        {/* Ask Iron Button */}
        <button
          onClick={onToggleAi}
          className="flex items-center gap-2.5 w-full text-left rounded-lg cursor-pointer transition-all duration-150"
          style={{
            padding: collapsed ? "8px 10px" : "8px 14px",
            background: aiPanelOpen
              ? "rgba(232,119,34,0.15)"
              : "rgba(232,119,34,0.15)",
            border: "1px solid rgba(232,119,34,0.35)",
            color: "#E87722",
          }}
        >
          <IronAvatar state="idle" size={34} collapsed={collapsed} />
          {!collapsed && (
            <>
              <span className="flex-1 text-[13px] font-semibold text-qep-orange">
                Ask Iron
              </span>
              <kbd
                className="inline-flex items-center justify-center px-1.5 py-px rounded text-[11px] font-mono min-w-[20px]"
                style={{
                  border: "1px solid rgba(232,119,34,0.35)",
                  color: "rgba(232,119,34,0.6)",
                  background: "transparent",
                }}
              >
                I
              </kbd>
            </>
          )}
        </button>
      </div>

      {/* User Profile Section with Dropdown */}
      <div
        className="flex-shrink-0"
        style={{ borderTop: "1px solid #1F3254" }}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2.5 w-full text-left border-none cursor-pointer transition-colors duration-150"
              style={{
                padding: collapsed ? "14px" : "14px 16px",
                background: "transparent",
              }}
            >
              <div
                className="flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 text-xs font-bold"
                style={{ background: "#1F3254", color: "#8A9BB4" }}
              >
                {initials}
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate" style={{ color: "#E5ECF5" }}>
                    {displayName}
                  </div>
                  <span
                    className="inline-block text-[10px] px-1.5 py-px rounded font-semibold mt-0.5"
                    style={{ background: "#1F3254", color: "#8A9BB4" }}
                  >
                    Parts
                  </span>
                </div>
              )}
              {!collapsed && (
                <Settings size={14} style={{ color: "#5F7391" }} />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="w-48"
          >
            {profile?.full_name && (
              <>
                <div className="px-2 py-1.5">
                  <p className="text-sm font-semibold text-foreground">
                    {profile.full_name}
                  </p>
                  {profile.email && (
                    <p className="text-xs text-muted-foreground truncate">
                      {profile.email}
                    </p>
                  )}
                </div>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              onClick={() => {
                const w = window as Window & { flare?: (sev?: string) => void };
                if (typeof w.flare === "function") {
                  w.flare("bug");
                }
              }}
            >
              <Bug className="w-4 h-4 mr-2" />
              Report a Bug
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => supabase.auth.signOut()}
              className="text-red-400 focus:text-red-400"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Log Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Collapse Toggle */}
      <button
        onClick={onToggleCollapse}
        className="flex justify-center border-none bg-transparent cursor-pointer"
        style={{
          padding: "10px",
          borderTop: "1px solid #1F3254",
          color: "#5F7391",
        }}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </div>
  );
}
