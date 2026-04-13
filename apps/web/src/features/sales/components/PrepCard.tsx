import { useNavigate } from "react-router-dom";
import { Calendar, ChevronRight } from "lucide-react";
import type { PrepCard as PrepCardType } from "../lib/types";

export function PrepCard({ card }: { card: PrepCardType }) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => {
        if (card.customer_id) navigate(`/sales/customers/${card.customer_id}`);
      }}
      className="w-full text-left bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 hover:shadow-sm transition-shadow"
    >
      <div className="flex items-center gap-2 mb-2">
        <Calendar className="w-4 h-4 text-indigo-600" />
        <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
          {card.meeting_time
            ? `Meeting at ${new Date(card.meeting_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
            : "Upcoming Meeting"}
        </span>
      </div>

      <p className="text-sm font-semibold text-slate-900">
        {card.customer_name}
      </p>

      {card.fleet_summary && (
        <p className="text-sm text-slate-600 mt-1">{card.fleet_summary}</p>
      )}

      {card.last_interaction && (
        <p className="text-xs text-slate-500 mt-1">
          Last contact: {card.last_interaction}
        </p>
      )}

      {card.talking_points.length > 0 && (
        <div className="mt-2 space-y-1">
          {card.talking_points.map((point, i) => (
            <p key={i} className="text-xs text-indigo-700 flex items-start gap-1">
              <span className="shrink-0 mt-0.5">&bull;</span>
              {point}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end mt-2">
        <span className="text-xs text-indigo-600 font-medium flex items-center gap-0.5">
          Full Prep <ChevronRight className="w-3 h-3" />
        </span>
      </div>
    </button>
  );
}
