import { Bell, Zap } from "lucide-react";

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
      className="flex items-center justify-between flex-shrink-0 bg-white"
      style={{
        height: 48,
        padding: "0 24px",
        borderBottom: "1px solid #E2E8F0",
      }}
    >
      <div className="flex items-center gap-4">
        <span className="text-[15px] font-bold text-[#2D3748]">{title}</span>
      </div>

      <div className="flex items-center gap-3">
        {/* Notifications */}
        <button className="relative border-none bg-transparent cursor-pointer p-1">
          <Bell size={18} className="text-[#718096]" />
          <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-qep-orange border-2 border-white" />
        </button>

        <div className="w-px h-5 bg-[#E2E8F0]" />

        {/* AI Toggle */}
        <button
          onClick={onToggleAi}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md cursor-pointer text-xs font-semibold transition-all duration-150"
          style={{
            border: `1px solid ${aiPanelOpen ? "#E87722" : "#E2E8F0"}`,
            background: aiPanelOpen ? "#FFF3E8" : "white",
            color: aiPanelOpen ? "#E87722" : "#4A5568",
          }}
        >
          <Zap size={13} />
          AI Assistant
        </button>
      </div>
    </div>
  );
}
