import { Bell, Search } from "lucide-react";
import { IronAvatar } from "../../../lib/iron/IronAvatar";

interface CompanionTopBarProps {
  title: string;
  aiPanelOpen: boolean;
  onToggleAi: () => void;
}

export function CompanionTopBar({
  title,
  aiPanelOpen,
  onToggleAi,
}: CompanionTopBarProps) {
  return (
    <div
      className="flex items-center justify-between flex-shrink-0"
      style={{
        height: 56,
        padding: "0 24px",
        background: "#0F1D31",
        borderBottom: "1px solid #1F3254",
      }}
    >
      {/* Left: Search Input */}
      <div className="flex items-center gap-4 flex-1 max-w-md">
        <div
          className="flex items-center gap-2 flex-1 rounded-lg px-3 py-2"
          style={{
            background: "#132238",
            border: "1px solid #1F3254",
          }}
        >
          <Search size={16} style={{ color: "#5F7391" }} />
          <input
            type="text"
            placeholder="Search parts, machines, requests..."
            className="flex-1 bg-transparent border-none outline-none text-[13px]"
            style={{
              color: "#E5ECF5",
              caretColor: "#E87722",
            }}
          />
          <style>{`
            input::placeholder { color: #8A9BB4 !important; }
          `}</style>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3">
        {/* Notification Bell */}
        <button
          className="relative border-none cursor-pointer p-2 rounded-lg transition-colors duration-150"
          style={{ background: "#132238" }}
        >
          <Bell size={18} style={{ color: "#8A9BB4" }} />
          <span
            className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-qep-orange"
            style={{
              boxShadow: "0 0 6px rgba(232,119,34,0.6)",
            }}
          />
        </button>

        {/* Ask Iron Pill */}
        <button
          onClick={onToggleAi}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-all duration-150"
          style={{
            background: aiPanelOpen
              ? "rgba(232,119,34,0.2)"
              : "rgba(232,119,34,0.15)",
            border: aiPanelOpen
              ? "1px solid rgba(232,119,34,0.5)"
              : "1px solid rgba(232,119,34,0.25)",
          }}
        >
          <IronAvatar state="idle" size={28} />
          <span className="text-xs font-semibold text-qep-orange">
            Ask Iron
          </span>
        </button>
      </div>
    </div>
  );
}
