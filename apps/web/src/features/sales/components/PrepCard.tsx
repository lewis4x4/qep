import { useNavigate } from "react-router-dom";
import { Calendar, ChevronRight, Truck } from "lucide-react";
import type { PrepCard as PrepCardType } from "../lib/types";

export function PrepCard({ card }: { card: PrepCardType }) {
  const navigate = useNavigate();

  const meetingLabel = card.meeting_time
    ? formatMeetingTime(card.meeting_time)
    : "Upcoming Meeting";

  const relativeTime = card.meeting_time
    ? getRelativeTime(card.meeting_time)
    : null;

  // Split fleet_summary into individual items if possible
  const fleetItems = card.fleet_summary
    ? card.fleet_summary
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return (
    <button
      onClick={() => {
        if (card.customer_id) navigate(`/sales/customers/${card.customer_id}`);
      }}
      className="w-full text-left relative bg-[hsl(var(--card))] rounded-xl border border-white/[0.06] overflow-hidden transition-all duration-200 hover:border-white/20 hover:shadow-lg hover:shadow-black/20"
    >
      {/* Purple left stripe */}
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-purple-500" />

      <div className="pl-5 pr-4 py-4">
        {/* Time badge */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-500/20 rounded-full">
            <Calendar className="w-3 h-3 text-purple-400" />
            <span className="text-[11px] font-bold text-purple-400 tracking-wide uppercase">
              {meetingLabel}
              {relativeTime && (
                <span className="font-normal ml-1 text-purple-400/70">
                  {relativeTime}
                </span>
              )}
            </span>
          </span>
        </div>

        {/* Customer name */}
        <p className="text-base font-bold text-foreground mt-2.5">
          {card.customer_name}
        </p>

        {/* Fleet summary */}
        {fleetItems.length > 0 && (
          <div className="mt-2 text-sm text-muted-foreground">
            {fleetItems.length > 1 ? (
              <div className="space-y-1">
                {fleetItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <Truck className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm">{card.fleet_summary}</p>
            )}
          </div>
        )}

        {/* Last contact */}
        {card.last_interaction && (
          <p className="text-xs text-muted-foreground/60 mt-2">
            Last contact: {card.last_interaction}
          </p>
        )}

        {/* Talking points */}
        {card.talking_points.length > 0 && (
          <div className="mt-3 space-y-1">
            {card.talking_points.map((point, i) => (
              <p
                key={i}
                className="text-xs text-muted-foreground flex items-start gap-1.5"
              >
                <span className="shrink-0 mt-0.5 text-purple-400/60">
                  &bull;
                </span>
                {point}
              </p>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.06]">
          <span className="text-xs text-muted-foreground/60">
            {card.talking_points.length > 0
              ? `${card.talking_points.length} AI talking points`
              : "Meeting prep ready"}
          </span>
          <span className="text-xs font-semibold text-qep-orange flex items-center gap-0.5">
            Full Prep <ChevronRight className="w-3 h-3" />
          </span>
        </div>
      </div>
    </button>
  );
}

function formatMeetingTime(iso: string): string {
  try {
    return `Meeting at ${new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  } catch {
    return "Upcoming Meeting";
  }
}

function getRelativeTime(iso: string): string | null {
  try {
    const diff = new Date(iso).getTime() - Date.now();
    if (diff < 0) return null;
    const mins = Math.round(diff / 60_000);
    if (mins < 60) return `in ${mins} min`;
    const hours = Math.round(mins / 60);
    return `in ${hours}h`;
  } catch {
    return null;
  }
}
