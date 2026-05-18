import { useNavigate } from "react-router-dom";
import { MapPin, Briefcase, FileText, Users, type LucideIcon } from "lucide-react";

export interface EmptyStateQuickStartProps {
  onLogVisit: () => void;
}

interface Tile {
  key: string;
  icon: LucideIcon;
  label: string;
  helper: string;
  accent: string;
  action: () => void;
}

export function EmptyStateQuickStart({ onLogVisit }: EmptyStateQuickStartProps) {
  const navigate = useNavigate();

  const tiles: Tile[] = [
    {
      key: "visit",
      icon: MapPin,
      label: "Log a visit",
      helper: "30 seconds, voice OK",
      accent: "bg-qep-orange/10 text-qep-orange",
      action: onLogVisit,
    },
    {
      key: "deal",
      icon: Briefcase,
      label: "Add a deal",
      helper: "Start tracking pipeline",
      accent: "bg-emerald-400/10 text-emerald-400",
      action: () => navigate("/sales/pipeline?new=1"),
    },
    {
      key: "quote",
      icon: FileText,
      label: "New quote",
      helper: "Voice-build in minutes",
      accent: "bg-purple-400/10 text-purple-400",
      action: () => navigate("/sales/quotes/new"),
    },
    {
      key: "customer",
      icon: Users,
      label: "Find a customer",
      helper: "Search your book",
      accent: "bg-sky-400/10 text-sky-400",
      action: () => navigate("/sales/customers"),
    },
  ];

  return (
    <div data-testid="empty-state-quick-start" className="space-y-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground px-1">
        Start anywhere
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((tile) => (
          <TileButton key={tile.key} tile={tile} />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground/60 text-center pt-2">
        Your briefing sharpens the moment you start.
      </p>
    </div>
  );
}

function TileButton({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  return (
    <button
      type="button"
      onClick={tile.action}
      className="text-left bg-[hsl(var(--card))] border border-white/[0.08] rounded-xl p-3 active:scale-[0.98] hover:border-white/[0.18] transition-all"
    >
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2 ${tile.accent}`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-sm font-semibold text-foreground">{tile.label}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{tile.helper}</p>
    </button>
  );
}
